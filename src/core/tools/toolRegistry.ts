import type { SubAgentRole, SubAgentSession, ToolDefinition, ToolResult } from '../../shared/types'
import { createMcpTool } from '../mcp/mcpToolAdapter'
import { createBuiltinTools, type RegisteredTool } from './builtinTools'

export interface ToolRegistry {
  definitions: ToolDefinition[]
  execute: (name: string, args: Record<string, unknown>, toolCallId: string, signal?: AbortSignal) => Promise<ToolResult>
}

export interface ToolRegistryOptions {
  runSubAgent?: (role: SubAgentRole, prompt: string, signal?: AbortSignal) => Promise<SubAgentSession | undefined>
  selectOption?: (payload: { title: string; question: string; options: string[] }) => Promise<{ index: number; option: string }>
}

export async function createToolRegistry(api: Window['electronAPI'], options: ToolRegistryOptions = {}): Promise<ToolRegistry> {
  const builtin = createBuiltinTools({
    electronAPI: api,
    runSubAgent: options.runSubAgent,
    selectOption: options.selectOption
  })
  let mcpTools: RegisteredTool[] = []
  try {
    const mcpInfos = await api.listMcpTools()
    mcpTools = mcpInfos.map((info) => createMcpTool(info, api))
  } catch {
    mcpTools = []
  }

  const tools = [...builtin, ...mcpTools]
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]))

  return {
    definitions: tools.map(({ execute: _execute, ...definition }) => definition),
    execute: async (name, args, toolCallId, signal) => {
      const tool = toolMap.get(name)
      if (!tool) {
        return {
          toolCallId,
          name,
          content: `Tool is not registered: ${name}`,
          isSuccess: false
        }
      }

      try {
        const output = await tool.execute(args, signal)
        return { ...output, toolCallId, name }
      } catch (error) {
        return {
          toolCallId,
          name,
          content: error instanceof Error ? error.message : String(error),
          isSuccess: false
        }
      }
    }
  }
}
