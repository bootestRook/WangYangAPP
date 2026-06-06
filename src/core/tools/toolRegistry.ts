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

const projectMutatingToolNames = new Set([
  'create_file_or_folder',
  'rename_file',
  'delete_file_or_folder',
  'move_file',
  'write_file_content',
  'replace_content_words',
  'move_file_to_index',
  'update_chapter_status',
  'todo_write',
  'manipulate_file_lines',
  'generate_image',
  'edit_image'
])

function normalizedPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const path = value.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
  return path || undefined
}

function rawRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function changedProjectPaths(name: string, args: Record<string, unknown>, raw: unknown): string[] {
  const paths = new Set<string>()
  const add = (value: unknown): void => {
    const path = normalizedPath(value)
    if (path) paths.add(path)
  }

  add(args.path)
  add(args.targetPath)
  add(args.targetDirectory)

  const record = rawRecord(raw)
  if (record) {
    add(record.relativePath)
    add(record.deleted)
    add(record.path)
    const written = rawRecord(record.written)
    if (written) add(written.relativePath)
    const currentWritten = rawRecord(record.currentWritten)
    if (currentWritten) add(currentWritten.relativePath)
  }

  if (name === 'todo_write') {
    add('.wangyang/todos.json')
  }

  return [...paths]
}

function notifyProjectFilesChanged(name: string, args: Record<string, unknown>, raw: unknown): void {
  if (typeof window === 'undefined' || !projectMutatingToolNames.has(name)) return
  window.dispatchEvent(
    new CustomEvent('wangyang:project-files-changed', {
      detail: {
        source: 'agent-tool',
        tool: name,
        paths: changedProjectPaths(name, args, raw)
      }
    })
  )
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
        if (output.isSuccess) notifyProjectFilesChanged(name, args, output.raw)
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
