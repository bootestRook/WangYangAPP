import OpenAI from 'openai'
import type { ChatMessage, ToolCall, ToolDefinition } from '../../shared/types'
import { buildDefaultHeaders, type ResolvedModel } from '../models/resolveModel'

export interface LlmStreamInput {
  model: ResolvedModel
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  signal?: AbortSignal
  temperature?: number
  promptCacheKey?: string
}

export type LlmStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }

function toOpenAiContent(message: ChatMessage): string | Array<Record<string, unknown>> {
  const imageAttachments = message.attachments?.filter((attachment) => attachment.type === 'image') ?? []
  if (!imageAttachments.length) return message.content
  return [
    { type: 'text', text: message.content || 'Please analyze these images.' },
    ...imageAttachments.map((attachment) => ({
      type: 'image_url',
      image_url: {
        url: attachment.dataUrl
      }
    }))
  ]
}

function toOpenAiMessages(messages: ChatMessage[]): any[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId ?? message.id,
        content: message.content
      }
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: toolCall.argumentsText
          }
        }))
      }
    }

    return {
      role: message.role,
      content: toOpenAiContent(message)
    }
  })
}

function toOpenAiTools(tools: ToolDefinition[] = []): any[] | undefined {
  if (!tools.length) return undefined
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }))
}

function toResponsesContent(message: ChatMessage): string | Array<Record<string, unknown>> {
  const imageAttachments = message.attachments?.filter((attachment) => attachment.type === 'image') ?? []
  if (!imageAttachments.length) return message.content
  return [
    { type: 'input_text', text: message.content || 'Please analyze these images.' },
    ...imageAttachments.map((attachment) => ({
      type: 'input_image',
      image_url: attachment.dataUrl,
      detail: 'auto'
    }))
  ]
}

function toResponsesInput(messages: ChatMessage[]): any[] {
  const input: any[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId ?? message.id,
        output: message.content
      })
      continue
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      if (message.content.trim()) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: message.content
        })
      }
      for (const toolCall of message.toolCalls) {
        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.argumentsText
        })
      }
      continue
    }

    input.push({
      type: 'message',
      role: message.role,
      content: toResponsesContent(message)
    })
  }
  return input
}

function toResponsesTools(tools: ToolDefinition[] = []): any[] | undefined {
  if (!tools.length) return undefined
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false
  }))
}

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | undefined {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl)
  return match ? { mediaType: match[1], data: match[2] } : undefined
}

function parseJsonObject(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function pushClaudeMessage(messages: any[], role: 'user' | 'assistant', content: any[]): void {
  const previous = messages.at(-1)
  if (previous?.role === role && Array.isArray(previous.content)) {
    previous.content.push(...content)
    return
  }
  messages.push({ role, content })
}

function toClaudeMessages(messages: ChatMessage[]): { system?: string; messages: any[] } {
  const system: string[] = []
  const output: any[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) system.push(message.content)
      continue
    }

    if (message.role === 'tool') {
      pushClaudeMessage(output, 'user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId ?? message.id,
          content: message.content
        }
      ])
      continue
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const content: any[] = []
      if (message.content.trim()) content.push({ type: 'text', text: message.content })
      for (const toolCall of message.toolCalls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.argumentsJson ?? parseJsonObject(toolCall.argumentsText)
        })
      }
      pushClaudeMessage(output, 'assistant', content)
      continue
    }

    const content: any[] = []
    if (message.content.trim() || !message.attachments?.length) {
      content.push({ type: 'text', text: message.content || 'Please analyze these images.' })
    }
    for (const attachment of message.attachments?.filter((item) => item.type === 'image') ?? []) {
      const parsed = parseDataUrl(attachment.dataUrl)
      if (!parsed) continue
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mediaType,
          data: parsed.data
        }
      })
    }
    pushClaudeMessage(output, message.role === 'assistant' ? 'assistant' : 'user', content)
  }

  return {
    system: system.length ? system.join('\n\n') : undefined,
    messages: output
  }
}

function toClaudeTools(tools: ToolDefinition[] = []): any[] | undefined {
  if (!tools.length) return undefined
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }))
}

function mergeToolCall(current: Map<number, ToolCall>, index: number, delta: any): ToolCall {
  const deltaId = nonEmptyString(delta.id)
  const deltaName = nonEmptyString(delta.function?.name)
  const existing =
    current.get(index) ??
    ({
      id: deltaId ?? `tool_${index}_${Date.now()}`,
      name: deltaName ?? '',
      argumentsText: '',
      status: 'running'
    } satisfies ToolCall)

  const next = {
    ...existing,
    id: deltaId ?? existing.id,
    name: deltaName ?? existing.name,
    argumentsText: `${existing.argumentsText}${delta.function?.arguments ?? ''}`
  }
  current.set(index, next)
  return next
}

function mergeResponsesToolCall(
  current: Map<number, ToolCall>,
  index: number,
  patch: {
    id?: string
    call_id?: string
    item_id?: string
    name?: string
    arguments?: string
    argumentsDelta?: string
  }
): ToolCall {
  const patchId = nonEmptyString(patch.call_id) ?? nonEmptyString(patch.id) ?? nonEmptyString(patch.item_id)
  const patchName = nonEmptyString(patch.name)
  const existing =
    current.get(index) ??
    ({
      id: patchId ?? `tool_${index}_${Date.now()}`,
      name: patchName ?? '',
      argumentsText: '',
      status: 'running'
    } satisfies ToolCall)

  const next = {
    ...existing,
    id: patchId ?? existing.id,
    name: patchName ?? existing.name,
    argumentsText:
      typeof patch.arguments === 'string' ? patch.arguments : `${existing.argumentsText}${patch.argumentsDelta ?? ''}`
  }
  current.set(index, next)
  return next
}

function createClient(input: LlmStreamInput, baseURL = input.model.interfaceConfig.apiUrl): OpenAI {
  if (!input.model.interfaceConfig.apiKey.trim()) {
    throw new Error(`Model interface "${input.model.interfaceConfig.label}" has no API key configured.`)
  }

  return new OpenAI({
    apiKey: input.model.interfaceConfig.apiKey,
    baseURL,
    defaultHeaders: buildDefaultHeaders(input.model),
    dangerouslyAllowBrowser: true
  })
}

function openAiErrorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isInvalidModelError(error: unknown): boolean {
  const text = openAiErrorText(error).toLowerCase()
  return (
    text.includes('invalid model') ||
    text.includes('model name') ||
    text.includes('model_not_found') ||
    text.includes('model not found') ||
    text.includes('no such model')
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function uniqueCandidates(candidates: string[]): string[] {
  return candidates
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
}

function versionedOpenAiBaseUrl(apiUrl: string): string | undefined {
  const base = apiUrl.replace(/\/+$/, '')
  if (/\/(?:v\d+|compatible-mode\/v\d+|api\/paas\/v\d+)$/i.test(base)) return undefined
  return `${base}/v1`
}

function modelsEndpointCandidates(apiUrl: string): string[] {
  const base = apiUrl.replace(/\/+$/, '')
  const versionedBase = versionedOpenAiBaseUrl(base)
  return uniqueCandidates([`${base}/models`, versionedBase ? `${versionedBase}/models` : ''])
}

function chatBaseUrlCandidates(apiUrl: string): string[] {
  const base = apiUrl.replace(/\/+$/, '')
  return uniqueCandidates([base, versionedOpenAiBaseUrl(base) ?? ''])
}

function openAiChatModelCandidates(input: LlmStreamInput, requestedModelName: string): string[] {
  return uniqueCandidates([requestedModelName, input.model.modelId])
}

function isLikelyChatModel(modelId: string): boolean {
  return !/(?:embed|embedding|rerank|moderation|whisper|tts|speech|audio|image|vision|stable-diffusion|dall-e|wan-t2i)/i.test(
    modelId
  )
}

function scoreFallbackModel(providerId: string, modelId: string): number {
  const model = modelId.toLowerCase()
  const provider = providerId.toLowerCase()
  let score = 0
  if (model === 'deepseek-chat') score += 120
  if (model.includes('deepseek-chat')) score += 110
  if (provider === 'deepseek' && model.includes('deepseek') && model.includes('chat')) score += 100
  if (provider === 'deepseek' && model.includes('deepseek')) score += 80
  if (model.includes('qwen') && model.includes('plus')) score += 70
  if (model.includes('gpt-4o-mini')) score += 65
  if (model.includes('chat')) score += 55
  if (model.includes('pro')) score += 10
  if (model.includes('free')) score -= 10
  return score
}

async function listOpenAiCompatibleModels(input: LlmStreamInput): Promise<string[]> {
  const headers: Record<string, string> = {
    ...buildDefaultHeaders(input.model),
    authorization: `Bearer ${input.model.interfaceConfig.apiKey}`,
    'content-type': 'application/json'
  }

  for (const url of modelsEndpointCandidates(input.model.interfaceConfig.apiUrl)) {
    try {
      const response = await fetch(url, { headers, signal: input.signal })
      if (!response.ok) continue
      const payload = (await response.json()) as { data?: Array<{ id?: unknown }> }
      const models = (payload.data ?? [])
        .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
        .filter(Boolean)
      if (models.length) return models
    } catch {
      // Try the next compatible endpoint shape.
    }
  }

  return []
}

async function resolveFallbackOpenAiModel(input: LlmStreamInput): Promise<string | undefined> {
  const listedModels = (await listOpenAiCompatibleModels(input)).filter(isLikelyChatModel)
  const [bestListedModel] = listedModels.sort(
    (left, right) =>
      scoreFallbackModel(input.model.interfaceId, right) - scoreFallbackModel(input.model.interfaceId, left)
  )
  if (bestListedModel && bestListedModel !== input.model.modelName) return bestListedModel

  if (input.model.interfaceId === 'deepseek' && input.model.modelName !== 'deepseek-chat') {
    return 'deepseek-chat'
  }

  if (input.model.interfaceId === 'wangyang' && input.model.modelName !== 'deepseek') {
    return 'deepseek'
  }

  return undefined
}

async function createOpenAiChatStream(
  input: LlmStreamInput,
  modelName: string,
  baseURL = input.model.interfaceConfig.apiUrl
): Promise<AsyncIterable<any>> {
  const client = createClient(input, baseURL)
  return client.chat.completions.create(
    {
      model: modelName,
      messages: toOpenAiMessages(input.messages),
      tools: toOpenAiTools(input.tools),
      temperature: input.temperature,
      stream: true,
      stream_options: {
        include_usage: true
      }
    },
    {
      signal: input.signal
    }
  ) as Promise<AsyncIterable<any>>
}

async function createCompatibleOpenAiChatStream(
  input: LlmStreamInput,
  requestedModelName: string
): Promise<AsyncIterable<any>> {
  const baseURLs = chatBaseUrlCandidates(input.model.interfaceConfig.apiUrl)
  const modelNames = openAiChatModelCandidates(input, requestedModelName)
  let lastError: unknown

  for (const baseURL of baseURLs) {
    for (const modelName of modelNames) {
      try {
        return await createOpenAiChatStream(input, modelName, baseURL)
      } catch (error) {
        if (isAbortError(error)) throw error
        lastError = error
        // Continue through compatible endpoint/model spellings. The final error is rethrown if none works.
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(openAiErrorText(lastError))
}

async function* streamOpenAiChatCompletion(input: LlmStreamInput): AsyncGenerator<LlmStreamEvent> {
  let stream: AsyncIterable<any>
  try {
    stream = await createCompatibleOpenAiChatStream(input, input.model.modelName)
  } catch (error) {
    if (!isInvalidModelError(error)) throw error
    const fallbackModel = await resolveFallbackOpenAiModel(input)
    if (!fallbackModel) throw error
    stream = await createCompatibleOpenAiChatStream(input, fallbackModel)
  }

  const toolCalls = new Map<number, ToolCall>()
  for await (const chunk of stream) {
    const usage = chunk.usage
    if (usage) {
      yield {
        type: 'usage',
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens
      }
    }

    const delta = chunk.choices?.[0]?.delta
    if (!delta) continue
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      yield { type: 'text-delta', text: delta.content }
    }
    for (const rawToolCall of delta.tool_calls ?? []) {
      const toolCall = mergeToolCall(toolCalls, rawToolCall.index ?? 0, rawToolCall)
      yield { type: 'tool-call', toolCall }
    }
  }
}

async function* streamResponsesCompletion(input: LlmStreamInput): AsyncGenerator<LlmStreamEvent> {
  const client = createClient(input)
  const stream = (await client.responses.create(
    {
      model: input.model.modelName,
      input: toResponsesInput(input.messages),
      tools: toResponsesTools(input.tools),
      temperature: input.temperature,
      stream: true,
      store: false,
      parallel_tool_calls: true
    } as any,
    {
      signal: input.signal
    }
  )) as unknown as AsyncIterable<any>

  const toolCalls = new Map<number, ToolCall>()
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string' && event.delta.length > 0) {
      yield { type: 'text-delta', text: event.delta }
      continue
    }

    if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      const toolCall = mergeResponsesToolCall(toolCalls, event.output_index ?? 0, event.item)
      yield { type: 'tool-call', toolCall }
      continue
    }

    if (event.type === 'response.function_call_arguments.delta') {
      const toolCall = mergeResponsesToolCall(toolCalls, event.output_index ?? 0, {
        item_id: event.item_id,
        argumentsDelta: event.delta
      })
      yield { type: 'tool-call', toolCall }
      continue
    }

    if (event.type === 'response.function_call_arguments.done') {
      const toolCall = mergeResponsesToolCall(toolCalls, event.output_index ?? 0, {
        item_id: event.item_id,
        arguments: event.arguments
      })
      yield { type: 'tool-call', toolCall }
      continue
    }

    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const toolCall = mergeResponsesToolCall(toolCalls, event.output_index ?? 0, event.item)
      yield { type: 'tool-call', toolCall }
      continue
    }

    if (event.type === 'response.completed' && event.response?.usage) {
      const usage = event.response.usage
      yield {
        type: 'usage',
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens
      }
    }
  }
}

async function* streamSseEvents(response: Response): AsyncGenerator<any> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = /\r?\n\r?\n/.exec(buffer)
    while (boundary) {
      const rawEvent = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary[0].length)
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim()
      if (data && data !== '[DONE]') {
        yield JSON.parse(data)
      }
      boundary = /\r?\n\r?\n/.exec(buffer)
    }
  }
}

function mergeClaudeToolCall(
  current: Map<number, ToolCall>,
  index: number,
  patch: { id?: string; name?: string; input?: Record<string, unknown>; inputDelta?: string }
): ToolCall {
  const patchId = nonEmptyString(patch.id)
  const patchName = nonEmptyString(patch.name)
  const existing =
    current.get(index) ??
    ({
      id: patchId ?? `tool_${index}_${Date.now()}`,
      name: patchName ?? '',
      argumentsText: patch.input && Object.keys(patch.input).length ? JSON.stringify(patch.input) : '',
      status: 'running'
    } satisfies ToolCall)

  const next = {
    ...existing,
    id: patchId ?? existing.id,
    name: patchName ?? existing.name,
    argumentsText: patch.input
      ? Object.keys(patch.input).length
        ? JSON.stringify(patch.input)
        : existing.argumentsText
      : `${existing.argumentsText}${patch.inputDelta ?? ''}`
  }
  current.set(index, next)
  return next
}

async function* streamClaudeCompletion(input: LlmStreamInput): AsyncGenerator<LlmStreamEvent> {
  if (!input.model.interfaceConfig.apiKey.trim()) {
    throw new Error(`Model interface "${input.model.interfaceConfig.label}" has no API key configured.`)
  }

  const mapped = toClaudeMessages(input.messages)
  const headers: Record<string, string> = {
    ...buildDefaultHeaders(input.model),
    'content-type': 'application/json',
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-api-key': input.model.interfaceConfig.apiKey
  }
  headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01'

  const response = await fetch(`${input.model.interfaceConfig.apiUrl.replace(/\/+$/, '')}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: input.model.modelName,
      max_tokens: 4096,
      system: mapped.system,
      messages: mapped.messages,
      tools: toClaudeTools(input.tools),
      temperature: input.temperature,
      stream: true
    }),
    signal: input.signal
  })

  if (!response.ok) {
    throw new Error(`Claude request failed (${response.status}): ${await response.text()}`)
  }

  const toolCalls = new Map<number, ToolCall>()
  let inputTokens: number | undefined
  for await (const event of streamSseEvents(response)) {
    if (event.type === 'message_start' && event.message?.usage) {
      inputTokens = event.message.usage.input_tokens
      yield {
        type: 'usage',
        inputTokens,
        outputTokens: event.message.usage.output_tokens,
        totalTokens:
          typeof inputTokens === 'number' && typeof event.message.usage.output_tokens === 'number'
            ? inputTokens + event.message.usage.output_tokens
            : undefined
      }
      continue
    }

    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const toolCall = mergeClaudeToolCall(toolCalls, event.index ?? 0, {
        id: event.content_block.id,
        name: event.content_block.name,
        input: event.content_block.input
      })
      yield { type: 'tool-call', toolCall }
      continue
    }

    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
      yield { type: 'text-delta', text: event.delta.text }
      continue
    }

    if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const toolCall = mergeClaudeToolCall(toolCalls, event.index ?? 0, {
        inputDelta: event.delta.partial_json ?? ''
      })
      yield { type: 'tool-call', toolCall }
      continue
    }

    if (event.type === 'content_block_stop') {
      const toolCall = toolCalls.get(event.index ?? 0)
      if (toolCall?.name) {
        yield { type: 'tool-call', toolCall: toolCall.argumentsText ? toolCall : { ...toolCall, argumentsText: '{}' } }
      }
      continue
    }

    if (event.type === 'message_delta' && event.usage) {
      const outputTokens = event.usage.output_tokens
      yield {
        type: 'usage',
        inputTokens,
        outputTokens,
        totalTokens:
          typeof inputTokens === 'number' && typeof outputTokens === 'number' ? inputTokens + outputTokens : undefined
      }
    }
  }
}

export async function* streamChatCompletion(input: LlmStreamInput): AsyncGenerator<LlmStreamEvent> {
  if (input.model.requestFormat === 'openai') {
    yield* streamOpenAiChatCompletion(input)
    return
  }

  if (input.model.requestFormat === 'responses') {
    yield* streamResponsesCompletion(input)
    return
  }

  if (input.model.requestFormat === 'claude') {
    yield* streamClaudeCompletion(input)
    return
  }

  throw new Error(`Unsupported request format: ${input.model.requestFormat}.`)
}
