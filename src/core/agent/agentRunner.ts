import type { AgentRunEvent, ChatMessage, ToolCall, ToolDefinition, ToolResult } from '../../shared/types'
import { streamChatCompletion } from '../llm/openAiChat'
import type { ResolvedModel } from '../models/resolveModel'
import type { ToolRegistry } from '../tools/toolRegistry'
import { buildContextBudget, trimMessagesToBudget } from './contextBudget'

export interface AgentRunInput {
  messages: ChatMessage[]
  model: ResolvedModel
  tools: ToolRegistry
  signal?: AbortSignal
  temperature?: number
  maxToolSteps?: number
  maxRepeatedToolCalls?: number
  maxRepeatedToolFailures?: number
  confirmTool?: (toolCall: ToolCall, definition: ToolDefinition) => Promise<boolean>
  confirmContinue?: (toolSteps: number, nextLimit: number) => Promise<boolean>
}

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function parseToolArgs(toolCall: ToolCall): Record<string, unknown> {
  if (toolCall.argumentsJson) return toolCall.argumentsJson
  if (!toolCall.argumentsText.trim()) return {}
  return JSON.parse(toolCall.argumentsText) as Record<string, unknown>
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function toolSignature(toolCall: ToolCall, args: Record<string, unknown>): string {
  return `${toolCall.name}:${stableStringify(args)}`
}

function truncateForError(value: string, maxLength = 500): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function toolDisplayName(toolName: string): string {
  return toolName === 'run_command' ? '本地命令 run_command' : `工具「${toolName}」`
}

function repeatedToolCallResult(toolName: string, count: number): string {
  return `${toolDisplayName(toolName)}第 ${count} 次使用了完全相同的参数。为避免无限循环，本次调用已被拦截；请直接基于前面的工具结果继续回复，不要再次请求同一参数。`
}

function repeatedToolCallError(toolName: string, count: number): string {
  return `${toolDisplayName(toolName)}累计 ${count} 次使用相同参数，已停止本轮运行，避免无限循环。请根据上一条工具结果继续，或换一个不同的操作。`
}

function repeatedToolFailureError(toolName: string, count: number, lastError: string): string {
  return `${toolDisplayName(toolName)}用相同参数连续失败 ${count} 次，已停止本轮运行。最后一次错误：${truncateForError(lastError)}`
}

function invalidJsonResult(toolName: string, error: unknown): string {
  return `${toolDisplayName(toolName)}的参数不是有效 JSON：${error instanceof Error ? error.message : String(error)}`
}

function repeatedInvalidJsonError(toolName: string, count: number, lastError: string): string {
  return `${toolDisplayName(toolName)}连续 ${count} 次给出了无效 JSON 参数，已停止本轮运行。最后一次错误：${truncateForError(lastError)}`
}

function toolRequiresArguments(definition: ToolDefinition | undefined): boolean {
  return Boolean(definition?.parameters.required?.length)
}

function isEmptyRequiredToolCall(toolCall: ToolCall, definition: ToolDefinition | undefined): boolean {
  return toolRequiresArguments(definition) && !toolCall.argumentsJson && !toolCall.argumentsText.trim()
}

export async function* runAgent(input: AgentRunInput): AsyncGenerator<AgentRunEvent> {
  const messages = [...input.messages]
  const maxToolSteps = input.maxToolSteps ?? 42
  const maxRepeatedToolCalls = input.maxRepeatedToolCalls ?? 2
  const maxRepeatedToolFailures = input.maxRepeatedToolFailures ?? 2
  let allowedToolSteps = maxToolSteps
  let toolSteps = 0
  const repeatedToolCalls = new Map<string, number>()
  const repeatedToolFailures = new Map<string, number>()

  while (true) {
    if (input.signal?.aborted) return
    const assistantId = id('assistant')
    const budget = buildContextBudget()
    const requestMessages = trimMessagesToBudget(messages, budget.inputBudgetTokens)
    let assistantContent = ''
    const toolCalls = new Map<string, ToolCall>()

    yield { type: 'message-start', messageId: assistantId }

    try {
      for await (const event of streamChatCompletion({
        model: input.model,
        messages: requestMessages,
        tools: input.tools.definitions,
        signal: input.signal,
        temperature: input.temperature
      })) {
        if (event.type === 'text-delta') {
          assistantContent += event.text
          yield { type: 'text-delta', messageId: assistantId, text: event.text }
        } else if (event.type === 'tool-call' && event.toolCall.name) {
          const definition = input.tools.definitions.find((item) => item.name === event.toolCall.name)
          if (!isEmptyRequiredToolCall(event.toolCall, definition)) {
            toolCalls.set(event.toolCall.id, event.toolCall)
            yield { type: 'tool-call', messageId: assistantId, toolCall: event.toolCall }
          }
        } else if (event.type === 'usage') {
          yield { type: 'usage', usage: event }
        }
      }
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) }
      return
    }

    const completedToolCalls = [...toolCalls.values()].filter((toolCall) => toolCall.name)
    if (input.signal?.aborted) return
    messages.push({
      id: assistantId,
      role: 'assistant',
      content: assistantContent,
      toolCalls: completedToolCalls,
      createdAt: Date.now()
    })

    if (!completedToolCalls.length) {
      yield { type: 'done', messageId: assistantId }
      return
    }

    for (const toolCall of completedToolCalls) {
      if (input.signal?.aborted) return
      if (toolSteps >= allowedToolSteps) {
        const canContinue = await input.confirmContinue?.(toolSteps, allowedToolSteps + maxToolSteps)
        if (!canContinue) {
          yield { type: 'error', error: `本轮工具调用已达到上限：${allowedToolSteps} 步。请缩小任务范围，或明确要求继续。` }
          return
        }
        allowedToolSteps += maxToolSteps
      }

      let args: Record<string, unknown>
      try {
        args = parseToolArgs(toolCall)
      } catch (error) {
        toolSteps += 1
        const invalidArgsContent = invalidJsonResult(toolCall.name, error)
        const invalidArgsResult: ToolResult = {
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: invalidArgsContent,
          isSuccess: false
        }
        yield { type: 'tool-call', messageId: assistantId, toolCall: { ...toolCall, status: 'error' } }
        messages.push({
          id: id('tool'),
          role: 'tool',
          toolCallId: toolCall.id,
          content: invalidArgsResult.content,
          createdAt: Date.now()
        })
        yield { type: 'tool-result', toolResult: invalidArgsResult }
        const invalidSignature = `${toolCall.name}:invalid-json:${toolCall.argumentsText}`
        const failureCount = (repeatedToolFailures.get(invalidSignature) ?? 0) + 1
        repeatedToolFailures.set(invalidSignature, failureCount)
        if (failureCount >= maxRepeatedToolFailures) {
          yield {
            type: 'error',
            error: repeatedInvalidJsonError(toolCall.name, failureCount, invalidArgsResult.content)
          }
          return
        }
        continue
      }
      const signature = toolSignature(toolCall, args)
      const repeatedCount = (repeatedToolCalls.get(signature) ?? 0) + 1
      repeatedToolCalls.set(signature, repeatedCount)
      if (repeatedCount > maxRepeatedToolCalls) {
        toolSteps += 1
        const guardResult: ToolResult = {
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: repeatedToolCallResult(toolCall.name, repeatedCount),
          isSuccess: false
        }
        yield { type: 'tool-call', messageId: assistantId, toolCall: { ...toolCall, status: 'error' } }
        messages.push({
          id: id('tool'),
          role: 'tool',
          toolCallId: toolCall.id,
          content: guardResult.content,
          createdAt: Date.now()
        })
        yield { type: 'tool-result', toolResult: guardResult }
        if (repeatedCount > maxRepeatedToolCalls + 1) {
          yield { type: 'error', error: repeatedToolCallError(toolCall.name, repeatedCount) }
          return
        }
        continue
      }
      const definition = input.tools.definitions.find((item) => item.name === toolCall.name)
      if (definition && input.confirmTool) {
        const approved = await input.confirmTool(toolCall, definition)
        if (!approved) {
          const deniedCall: ToolCall = { ...toolCall, status: 'error' }
          const deniedResult: ToolResult = {
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: `用户拒绝执行 ${definition.mode} 工具：${toolCall.name}`,
            isSuccess: false
          }
          yield { type: 'tool-call', messageId: assistantId, toolCall: deniedCall }
          messages.push({
            id: id('tool'),
            role: 'tool',
            toolCallId: toolCall.id,
            content: deniedResult.content,
            createdAt: Date.now()
          })
          yield { type: 'tool-result', toolResult: deniedResult }
          continue
        }
      }

      toolSteps += 1
      const toolResult = await input.tools.execute(toolCall.name, args, toolCall.id, input.signal)
      if (input.signal?.aborted) return
      yield {
        type: 'tool-call',
        messageId: assistantId,
        toolCall: { ...toolCall, status: toolResult.isSuccess ? 'success' : 'error' }
      }
      messages.push({
        id: id('tool'),
        role: 'tool',
        toolCallId: toolCall.id,
        content: toolResult.content,
        createdAt: Date.now()
      })
      yield { type: 'tool-result', toolResult }
      if (!toolResult.isSuccess) {
        const failureCount = (repeatedToolFailures.get(signature) ?? 0) + 1
        repeatedToolFailures.set(signature, failureCount)
        if (failureCount >= maxRepeatedToolFailures) {
          yield {
            type: 'error',
            error: repeatedToolFailureError(toolCall.name, failureCount, toolResult.content)
          }
          return
        }
      }
    }
  }
}
