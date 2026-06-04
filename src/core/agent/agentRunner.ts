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

function loopGuardError(reason: string): string {
  return `${reason} Stopped this run to prevent an infinite tool loop.`
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
          yield { type: 'error', error: `Maximum tool steps reached: ${allowedToolSteps}` }
          return
        }
        allowedToolSteps += maxToolSteps
      }

      let args: Record<string, unknown>
      try {
        args = parseToolArgs(toolCall)
      } catch (error) {
        toolSteps += 1
        const invalidArgsResult: ToolResult = {
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: `Invalid JSON arguments for tool "${toolCall.name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
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
            error: loopGuardError(
              `Tool "${toolCall.name}" produced invalid JSON arguments ${failureCount} times. Last error: ${invalidArgsResult.content}`
            )
          }
          return
        }
        continue
      }
      const signature = toolSignature(toolCall, args)
      const repeatedCount = (repeatedToolCalls.get(signature) ?? 0) + 1
      repeatedToolCalls.set(signature, repeatedCount)
      if (repeatedCount > maxRepeatedToolCalls) {
        yield {
          type: 'error',
          error: loopGuardError(
            `Tool "${toolCall.name}" was requested with the same arguments ${repeatedCount} times.`
          )
        }
        return
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
            error: loopGuardError(
              `Tool "${toolCall.name}" failed ${failureCount} times with the same arguments. Last error: ${toolResult.content}`
            )
          }
          return
        }
      }
    }
  }
}
