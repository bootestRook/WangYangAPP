import { encode } from 'gpt-tokenizer'
import type { ChatMessage } from '../../shared/types'

export interface ContextBudget {
  modelMaxContext: number
  reservedOutputTokens: number
  reservedToolTokens: number
  safetyTokens: number
  inputBudgetTokens: number
}

export function buildContextBudget(modelMaxContext = 64_000): ContextBudget {
  const reservedOutputTokens = 8_000
  const reservedToolTokens = 2_000
  const safetyTokens = 1_000
  return {
    modelMaxContext,
    reservedOutputTokens,
    reservedToolTokens,
    safetyTokens,
    inputBudgetTokens: Math.max(
      1_024,
      modelMaxContext - reservedOutputTokens - reservedToolTokens - safetyTokens
    )
  }
}

export function estimateTokens(text: string): number {
  try {
    return encode(text).length
  } catch {
    return Math.ceil(text.length / 4)
  }
}

export function trimMessagesToBudget(messages: ChatMessage[], budgetTokens: number): ChatMessage[] {
  const system = messages.filter((message) => message.role === 'system')
  const rest = messages.filter((message) => message.role !== 'system')
  const keptRest: ChatMessage[] = []
  let used = estimateTokens(system.map((message) => message.content).join('\n'))

  for (const message of [...rest].reverse()) {
    const cost = estimateTokens(message.content)
    if (used + cost > budgetTokens) continue
    keptRest.unshift(message)
    used += cost
  }

  return [...system, ...keptRest]
}
