import type { McpToolInfo, ToolDefinition, ToolResult } from '../../shared/types'
import type { RegisteredTool } from '../tools/builtinTools'

function stringifyMcpResult(result: unknown): string {
  if (!result || typeof result !== 'object') return String(result ?? '')
  const maybeContent = (result as { content?: unknown }).content
  if (Array.isArray(maybeContent)) {
    return maybeContent
      .map((item) => {
        if (item && typeof item === 'object' && 'text' in item) return String(item.text)
        return JSON.stringify(item)
      })
      .join('\n')
  }
  return JSON.stringify(result, null, 2)
}

export function mcpInfoToTool(info: McpToolInfo): ToolDefinition {
  return {
    name: info.finalName,
    description: info.description,
    parameters: info.parameters,
    mode: 'network'
  }
}

export function createMcpTool(info: McpToolInfo, api: Window['electronAPI']): RegisteredTool {
  return {
    ...mcpInfoToTool(info),
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const raw = await api.callMcpTool(info.serverName, info.toolName, args)
      return {
        toolCallId: '',
        name: info.finalName,
        content: stringifyMcpResult(raw),
        isSuccess: true,
        raw
      }
    }
  }
}
