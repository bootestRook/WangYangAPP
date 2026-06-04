import { estimateTokens } from '../agent/contextBudget'

export interface SmartContextInput {
  projectName: string
  files: Array<{ path: string; content: string }>
  existingContext?: string
  maxInputTokens?: number
}

export function buildSmartContextUserPrompt(input: SmartContextInput): string {
  const maxInputTokens = input.maxInputTokens ?? 70_000
  const chunks: string[] = []
  let used = estimateTokens(input.existingContext ?? '')

  for (const file of input.files) {
    const block = `<file path="${file.path}">\n${file.content}\n</file>`
    const cost = estimateTokens(block)
    if (used + cost > maxInputTokens) {
      const head = file.content.slice(0, 4_000)
      const tail = file.content.slice(-4_000)
      chunks.push(`<file path="${file.path}" truncated="true">\n${head}\n...\n${tail}\n</file>`)
      break
    }
    chunks.push(block)
    used += cost
  }

  return [
    `Project: ${input.projectName}`,
    input.existingContext ? `<existing_context>\n${input.existingContext}\n</existing_context>` : '',
    '<changed_files>',
    chunks.join('\n\n'),
    '</changed_files>',
    'Update the project memory so future writing and agent tasks can use concise, durable context.'
  ]
    .filter(Boolean)
    .join('\n\n')
}
