import type { ProjectEntry, SearchMatch, SubAgentRole, SubAgentSession, ToolDefinition, ToolResult } from '../../shared/types'

type ToolHandler = (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>

export interface ToolRuntime {
  electronAPI: Window['electronAPI']
  runSubAgent?: (role: SubAgentRole, prompt: string, signal?: AbortSignal) => Promise<SubAgentSession | undefined>
  selectOption?: (payload: { title: string; question: string; options: string[] }) => Promise<{ index: number; option: string }>
}

export interface RegisteredTool extends ToolDefinition {
  execute: ToolHandler
}

type HistorySessionSummary = {
  id: string
  title: string
  mode?: string
  messages: number
  updatedAt?: number
}

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
type TodoItem = {
  id: string
  title: string
  status: TodoStatus
  markdownPath?: string
  createdAt: number
  updatedAt: number
}

const textExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.tsv'])
const skippedDirectories = new Set(['node_modules', '.git', 'out', 'dist'])
const localKnowledgeDirs = ['knowledge', '.wangyang/knowledge', 'records', 'rules', 'objects', 'inspirations']
const agentSessionsKey = 'wangyang.agent.sessions'
const subAgentRoles = new Set(['planner', 'writer', 'reviewer', 'researcher'])

function stringify(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Argument "${key}" must be a non-empty string.`)
  return value
}

function requireStringValue(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`Argument "${key}" must be a string.`)
  return value
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalNumber(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = args[key]
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : fallback
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

function optionalBoolean(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = args[key]
  return typeof value === 'boolean' ? value : fallback
}

function requireSubAgentRole(args: Record<string, unknown>): SubAgentRole {
  const role = optionalString(args, 'role') ?? 'planner'
  if (!subAgentRoles.has(role)) {
    throw new Error(`Unsupported sub-agent role: ${role}`)
  }
  return role as SubAgentRole
}

function normalizeTodoStatus(value: string | undefined): TodoStatus {
  if (value === 'in_progress' || value === 'completed' || value === 'cancelled' || value === 'pending') return value
  if (value === 'done') return 'completed'
  if (value === 'todo') return 'pending'
  return 'pending'
}

function result(name: string, content: unknown, isSuccess = true, toolCallId = ''): ToolResult {
  return {
    toolCallId,
    name,
    content: stringify(content),
    isSuccess,
    raw: content
  }
}

function normalizePath(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

function basename(relativePath: string): string {
  const normalized = normalizePath(relativePath)
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized
}

function dirname(relativePath: string): string {
  const parts = normalizePath(relativePath).split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function joinPath(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
}

function extensionOf(relativePath: string): string {
  const name = basename(relativePath)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function isTextPath(relativePath: string): boolean {
  return textExtensions.has(extensionOf(relativePath))
}

function chapterNumberFromPath(relativePath: string): number | undefined {
  const name = basename(relativePath).replace(/\.[^.]+$/, '')
  const patterns = [/(?:^|[^a-z])chapter[-_\s]*(\d{1,4})(?:\D|$)/i, /第\s*0*(\d{1,4})\s*章/]
  for (const pattern of patterns) {
    const match = name.match(pattern)
    if (!match) continue
    const chapterNumber = Number(match[1])
    if (Number.isInteger(chapterNumber) && chapterNumber > 0) return chapterNumber
  }
  return undefined
}

async function findSameChapterFile(
  api: Window['electronAPI'],
  relativePath: string
): Promise<{ entry: ProjectEntry; chapterNumber: number } | undefined> {
  if (extensionOf(relativePath) !== '.md') return undefined
  const chapterNumber = chapterNumberFromPath(relativePath)
  if (!chapterNumber) return undefined

  const normalizedTarget = normalizePath(relativePath)
  let listing
  try {
    listing = await api.listDirectory(dirname(normalizedTarget))
  } catch {
    return undefined
  }

  const entry = listing.entries.find((candidate) => {
    if (candidate.type !== 'file') return false
    if (normalizePath(candidate.relativePath) === normalizedTarget) return false
    if (extensionOf(candidate.name) !== '.md') return false
    return chapterNumberFromPath(candidate.name) === chapterNumber
  })

  return entry ? { entry, chapterNumber } : undefined
}

async function assertNoSameChapterDuplicate(api: Window['electronAPI'], relativePath: string): Promise<void> {
  const duplicate = await findSameChapterFile(api, relativePath)
  if (!duplicate) return
  throw new Error(
    `章节重复保护：${duplicate.entry.relativePath} 已经是第 ${duplicate.chapterNumber} 章。不要再创建 ${normalizePath(
      relativePath
    )}；请覆盖已有文件，或先用 move_file/rename_file/delete_file_or_folder 统一命名后再写入。`
  )
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : stringify(item))).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

async function collectEntries(
  api: Window['electronAPI'],
  relativePath: string,
  maxEntries: number,
  out: ProjectEntry[]
): Promise<void> {
  if (out.length >= maxEntries) return

  let listing
  try {
    listing = await api.listDirectory(relativePath)
  } catch {
    return
  }

  for (const entry of listing.entries) {
    if (out.length >= maxEntries) return
    out.push(entry)
    if (entry.type === 'directory' && !skippedDirectories.has(entry.name)) {
      await collectEntries(api, entry.relativePath, maxEntries, out)
    }
  }
}

async function getProjectEntry(api: Window['electronAPI'], relativePath: string): Promise<ProjectEntry | undefined> {
  const normalized = normalizePath(relativePath)
  const parent = dirname(normalized)
  const name = basename(normalized)
  const listing = await api.listDirectory(parent)
  return listing.entries.find((entry) => entry.name === name || entry.relativePath === normalized)
}

async function searchLocalDirs(
  api: Window['electronAPI'],
  query: string,
  dirs: string[],
  limit: number
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = []
  const entries: ProjectEntry[] = []
  for (const dir of dirs) {
    await collectEntries(api, dir, limit * 8, entries)
  }

  const files = entries
    .filter((entry) => entry.type === 'file' && isTextPath(entry.relativePath))
    .slice(0, Math.max(limit * 4, limit))

  for (const file of files) {
    if (matches.length >= limit) break
    let text = ''
    try {
      text = await api.readFile(file.relativePath)
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    const needle = query.toLowerCase()
    for (let index = 0; index < lines.length; index += 1) {
      if (matches.length >= limit) break
      if (lines[index].toLowerCase().includes(needle)) {
        matches.push({ file: file.relativePath, line: index + 1, preview: lines[index].trim().slice(0, 240) })
      }
    }
  }

  return matches
}

async function writeJsonFile(api: Window['electronAPI'], relativePath: string, value: unknown): Promise<unknown> {
  const content = `${JSON.stringify(value, null, 2)}\n`
  return api.writeFile(relativePath, content)
}

async function readJsonFile(api: Window['electronAPI'], relativePath: string): Promise<unknown> {
  const raw = await api.readFile(relativePath)
  return JSON.parse(raw) as unknown
}

function summarizeHistorySessions(value: unknown): HistorySessionSummary[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).map((session) => {
    const candidate = session as {
      id?: string
      title?: string
      mode?: string
      messages?: unknown[]
      updatedAt?: number
    }
    return {
      id: candidate.id ?? '',
      title: candidate.title ?? 'Untitled',
      mode: candidate.mode,
      messages: Array.isArray(candidate.messages) ? candidate.messages.length : 0,
      updatedAt: candidate.updatedAt
    }
  })
}

async function readHistorySessions(api: Window['electronAPI']): Promise<HistorySessionSummary[]> {
  try {
    return summarizeHistorySessions(await readJsonFile(api, '.wangyang/agent-sessions.json'))
  } catch {
    // Fall through to legacy localStorage sessions.
  }

  try {
    const raw = localStorage.getItem(agentSessionsKey)
    if (!raw) return []
    return summarizeHistorySessions(JSON.parse(raw))
  } catch {
    return []
  }
}

async function readKnowledgeDirs(api: Window['electronAPI']): Promise<string[]> {
  try {
    const raw = await readJsonFile(api, '.wangyang/knowledge-bases.json')
    if (!Array.isArray(raw)) return localKnowledgeDirs
    if (!raw.length) return localKnowledgeDirs
    const dirs = raw
      .map((entry) => {
        const candidate = entry as { path?: unknown; enabled?: unknown }
        return candidate.enabled === false || typeof candidate.path !== 'string' ? '' : normalizePath(candidate.path)
      })
      .filter(Boolean)
    return dirs
  } catch {
    return localKnowledgeDirs
  }
}

export const reversedToolNames = [
  'list_project_files',
  'list_directory',
  'read_file_content',
  'search_in_files',
  'search_project_files',
  'get_file_info',
  'search_internet',
  'fetch_url_content',
  'semantic_search',
  'get_chapter_summary',
  'build_smart_context',
  'create_file_or_folder',
  'rename_file',
  'delete_file_or_folder',
  'move_file',
  'write_file_content',
  'replace_content_words',
  'move_file_to_index',
  'update_chapter_status',
  'rename_project',
  'todo_write',
  'create_options',
  'manipulate_file_lines',
  'generate_image',
  'edit_image',
  'search_knowledge_base',
  'ask_full_text',
  'call_sub_agent',
  'list_history_sessions',
  'run_command'
] as const

export function createBuiltinTools(runtime: ToolRuntime): RegisteredTool[] {
  const api = runtime.electronAPI

  return [
    {
      name: 'list_project_files',
      description: 'Recursively list project files and folders from a project-relative path.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative directory path. Defaults to project root.' },
          maxEntries: { type: 'number', description: 'Maximum entries to return. Default 200.' }
        }
      },
      execute: async (args) => {
        const entries: ProjectEntry[] = []
        await collectEntries(api, optionalString(args, 'path') ?? '', optionalNumber(args, 'maxEntries', 200, 1, 1000), entries)
        return result('list_project_files', entries)
      }
    },
    {
      name: 'list_directory',
      description: 'List files and folders under a project-relative directory.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative directory path.' }
        }
      },
      execute: async (args) => result('list_directory', await api.listDirectory(optionalString(args, 'path') ?? ''))
    },
    {
      name: 'read_file_content',
      description: 'Read a UTF-8 text file by project-relative path.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file path.' }
        },
        required: ['path']
      },
      execute: async (args) => result('read_file_content', await api.readFile(requireString(args, 'path')))
    },
    {
      name: 'search_in_files',
      description: 'Search project text files for a plain-text query.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Plain text to search for.' },
          limit: { type: 'number', description: 'Optional maximum number of matches.' }
        },
        required: ['query']
      },
      execute: async (args) =>
        result('search_in_files', await api.searchInFiles(requireString(args, 'query'), optionalNumber(args, 'limit', 80, 1, 500)))
    },
    {
      name: 'search_project_files',
      description: 'Search project file and folder names by a plain-text query.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Plain text to search for in file or folder paths.' },
          limit: { type: 'number', description: 'Optional maximum number of matches.' }
        },
        required: ['query']
      },
      execute: async (args) =>
        result('search_project_files', await api.searchFiles(requireString(args, 'query'), optionalNumber(args, 'limit', 80, 1, 500)))
    },
    {
      name: 'get_file_info',
      description: 'Return metadata for a project-relative file or directory.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file or directory path.' }
        },
        required: ['path']
      },
      execute: async (args) => {
        const entry = await getProjectEntry(api, requireString(args, 'path'))
        if (!entry) throw new Error('File or directory was not found.')
        return result('get_file_info', entry)
      }
    },
    {
      name: 'search_internet',
      description: 'Fetch a lightweight DuckDuckGo HTML search result page for a query.',
      mode: 'network',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' }
        },
        required: ['query']
      },
      execute: async (args) => {
        const query = requireString(args, 'query')
        const fetched = await api.fetchUrlContent(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, 30_000)
        return result('search_internet', {
          query,
          finalUrl: fetched.finalUrl,
          status: fetched.status,
          text: fetched.text.slice(0, 8000)
        })
      }
    },
    {
      name: 'fetch_url_content',
      description: 'Fetch http or https URL content and return readable text.',
      mode: 'network',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch.' }
        },
        required: ['url']
      },
      execute: async (args) => result('fetch_url_content', await api.fetchUrlContent(requireString(args, 'url')))
    },
    {
      name: 'semantic_search',
      description: 'Local semantic-search fallback. Searches project text and returns matching passages with source paths.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          limit: { type: 'number', description: 'Maximum matches.' }
        },
        required: ['query']
      },
      execute: async (args) => {
        const query = requireString(args, 'query')
        const limit = optionalNumber(args, 'limit', 20, 1, 80)
        const knowledgeMatches = await searchLocalDirs(api, query, await readKnowledgeDirs(api), limit)
        const matches = knowledgeMatches.length ? knowledgeMatches : await api.searchInFiles(query, limit)
        return result('semantic_search', {
          mode: knowledgeMatches.length ? 'local_knowledge_index' : 'project_keyword_fallback',
          matches
        })
      }
    },
    {
      name: 'get_chapter_summary',
      description: 'Read a chapter or summary file and return a compact excerpt for continuity checks.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative chapter or summary path.' },
          maxChars: { type: 'number', description: 'Maximum characters to return.' }
        },
        required: ['path']
      },
      execute: async (args) => {
        const path = requireString(args, 'path')
        const text = await api.readFile(path)
        const maxChars = optionalNumber(args, 'maxChars', 2400, 200, 12000)
        return result('get_chapter_summary', {
          path,
          chars: text.length,
          excerpt: text.slice(0, maxChars)
        })
      }
    },
    {
      name: 'build_smart_context',
      description: 'Collect project writing files and build a smart-context update prompt.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          maxFiles: { type: 'number', description: 'Optional maximum number of files to collect.' }
        }
      },
      execute: async (args) =>
        result('build_smart_context', await api.buildSmartContext(optionalNumber(args, 'maxFiles', 40, 1, 60)))
    },
    {
      name: 'create_file_or_folder',
      description: 'Create a project-relative file or folder.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative path to create.' },
          type: { type: 'string', enum: ['file', 'directory'], description: 'Entry type.' },
          content: { type: 'string', description: 'Initial file content.' }
        },
        required: ['path']
      },
      execute: async (args) => {
        const path = requireString(args, 'path')
        const rawType = optionalString(args, 'type')
        const type = rawType === 'directory' ? 'directory' : 'file'
        if (type === 'file') await assertNoSameChapterDuplicate(api, path)
        return result('create_file_or_folder', await api.createEntry(path, type, optionalString(args, 'content') ?? ''))
      }
    },
    {
      name: 'rename_file',
      description: 'Rename a project-relative file or folder without moving it to a different parent.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Existing project-relative path.' },
          newName: { type: 'string', description: 'New base name.' }
        },
        required: ['path', 'newName']
      },
      execute: async (args) => result('rename_file', await api.renameEntry(requireString(args, 'path'), requireString(args, 'newName')))
    },
    {
      name: 'delete_file_or_folder',
      description: 'Delete a project-relative file or folder.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative path to delete.' }
        },
        required: ['path']
      },
      execute: async (args) => result('delete_file_or_folder', await api.deleteEntry(requireString(args, 'path')))
    },
    {
      name: 'move_file',
      description: 'Move or rename a project-relative file or folder to an exact target path.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Existing project-relative path.' },
          targetPath: { type: 'string', description: 'Target project-relative path.' }
        },
        required: ['path', 'targetPath']
      },
      execute: async (args) => result('move_file', await api.moveEntry(requireString(args, 'path'), requireString(args, 'targetPath')))
    },
    {
      name: 'write_file_content',
      description:
        'Write UTF-8 content to a project-relative file. When writing chapters, reuse the existing file for the same chapter number instead of creating a second file with a different name.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file path.' },
          content: { type: 'string', description: 'Complete file content.' }
        },
        required: ['path', 'content']
      },
      execute: async (args) => {
        const path = requireString(args, 'path')
        await assertNoSameChapterDuplicate(api, path)
        return result('write_file_content', await api.writeFile(path, requireString(args, 'content')))
      }
    },
    {
      name: 'replace_content_words',
      description: 'Replace text in a UTF-8 project file.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file path.' },
          search: { type: 'string', description: 'Text to find.' },
          replace: { type: 'string', description: 'Replacement text.' },
          replaceAll: { type: 'boolean', description: 'Replace all matches. Defaults to true.' }
        },
        required: ['path', 'search', 'replace']
      },
      execute: async (args) => {
        const path = requireString(args, 'path')
        const search = requireString(args, 'search')
        const replacement = requireStringValue(args, 'replace')
        const replaceAll = optionalBoolean(args, 'replaceAll', true)
        const text = await api.readFile(path)
        const count = text.split(search).length - 1
        const next = replaceAll ? text.split(search).join(replacement) : text.replace(search, replacement)
        await api.writeFile(path, next)
        return result('replace_content_words', {
          path,
          replacements: replaceAll ? count : Math.min(count, 1)
        })
      }
    },
    {
      name: 'move_file_to_index',
      description: 'Move a file to a target directory/path or record a desired ordering index under .wangyang/file-index.json.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Existing project-relative path.' },
          targetPath: { type: 'string', description: 'Optional exact target path.' },
          targetDirectory: { type: 'string', description: 'Optional target directory; keeps the original file name.' },
          index: { type: 'number', description: 'Desired ordering index to persist when no target path is supplied.' }
        },
        required: ['path']
      },
      execute: async (args) => {
        const source = requireString(args, 'path')
        const targetPath = optionalString(args, 'targetPath')
        const targetDirectory = optionalString(args, 'targetDirectory')
        if (targetPath || targetDirectory) {
          const finalPath = targetPath ?? joinPath(targetDirectory, basename(source))
          return result('move_file_to_index', await api.moveEntry(source, finalPath))
        }

        const index = optionalNumber(args, 'index', 0, 0, 100000)
        const record = { path: normalizePath(source), index, updatedAt: Date.now() }
        await writeJsonFile(api, '.wangyang/file-index.json', record)
        return result('move_file_to_index', record)
      }
    },
    {
      name: 'update_chapter_status',
      description: 'Persist local chapter status metadata under .wangyang/chapter-status.json.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chapter path.' },
          status: { type: 'string', description: 'Status label, e.g. draft/review/done.' },
          notes: { type: 'string', description: 'Optional status notes.' }
        },
        required: ['path', 'status']
      },
      execute: async (args) => {
        const path = normalizePath(requireString(args, 'path'))
        const current = await readJsonFile(api, '.wangyang/chapter-status.json').catch(() => ({}))
        const currentRecord = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
        const record = {
          ...currentRecord,
          [path]: {
            status: requireString(args, 'status'),
            notes: optionalString(args, 'notes') ?? '',
            updatedAt: Date.now()
          }
        }
        await writeJsonFile(api, '.wangyang/chapter-status.json', record)
        return result('update_chapter_status', record)
      }
    },
    {
      name: 'rename_project',
      description: 'Persist a local project display name under .wangyang/project.json.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project display name.' }
        },
        required: ['name']
      },
      execute: async (args) => {
        const record = { name: requireString(args, 'name'), updatedAt: Date.now() }
        await writeJsonFile(api, '.wangyang/project.json', record)
        return result('rename_project', record)
      }
    },
    {
      name: 'todo_write',
      description: 'Create or update local project todos under .wangyang/todos.json and .wangyang/todos.md.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional todo file path.' },
          task: { type: 'string', description: 'Single task to append.' },
          status: { type: 'string', description: 'Task status label.' },
          items: { type: 'array', items: { type: 'string' }, description: 'Full list of todo items.' }
        }
      },
      execute: async (args) => {
        const defaultTodoPath = '.wangyang/todos.md'
        const path = optionalString(args, 'path') ?? defaultTodoPath
        const jsonPath = '.wangyang/todos.json'
        const items = coerceStringArray(args.items)
        let todos: TodoItem[] = []
        const markdownPaths = new Set<string>([defaultTodoPath, path])
        try {
          const raw = await api.readFile(jsonPath)
          const parsed = JSON.parse(raw) as TodoItem[]
          todos = Array.isArray(parsed)
            ? parsed
                .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
                .map((item) => {
                  const markdownPath = item.markdownPath || defaultTodoPath
                  markdownPaths.add(markdownPath)
                  return {
                    ...item,
                    status: normalizeTodoStatus(item.status),
                    markdownPath
                  }
                })
            : []
        } catch {
          todos = []
        }

        if (items.length) {
          const now = Date.now()
          todos = items.map((item, index) => ({
            id: `todo_${now}_${index}`,
            title: item,
            status: 'pending',
            markdownPath: path,
            createdAt: now,
            updatedAt: now
          }))
        } else {
          const task = optionalString(args, 'task') ?? 'Untitled task'
          const status = normalizeTodoStatus(optionalString(args, 'status'))
          const now = Date.now()
          todos = [
            ...todos,
            {
              id: `todo_${now}_${Math.random().toString(36).slice(2, 8)}`,
              title: task,
              status,
              markdownPath: path,
              createdAt: now,
              updatedAt: now
            }
          ]
        }

        todos.forEach((todo) => markdownPaths.add(todo.markdownPath || defaultTodoPath))
        const renderMarkdown = (scopedTodos: TodoItem[]): string =>
          `# Project Todo\n\n${scopedTodos
            .map((item) => `- [${item.status === 'completed' ? 'x' : ' '}] [${item.status}] ${item.title}`)
            .join('\n')}\n`
        await api.writeFile(jsonPath, `${JSON.stringify(todos, null, 2)}\n`)
        let written: Awaited<ReturnType<typeof api.writeFile>> | undefined
        for (const markdownPath of markdownPaths) {
          const scopedTodos =
            markdownPath === defaultTodoPath
              ? todos
              : todos.filter((todo) => (todo.markdownPath || defaultTodoPath) === markdownPath)
          const currentWritten = await api.writeFile(markdownPath, renderMarkdown(scopedTodos))
          if (markdownPath === path) written = currentWritten
        }
        return result('todo_write', {
          ...(written ?? { relativePath: path, bytes: 0 }),
          jsonPath,
          markdownPaths: Array.from(markdownPaths),
          count: todos.length,
          todos
        })
      }
    },
    {
      name: 'create_options',
      description: 'Return a structured option set for the agent to present to the user.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Option group title.' },
          question: { type: 'string', description: 'Question to ask.' },
          options: { type: 'array', items: { type: 'string' }, description: 'Candidate options.' }
        },
        required: ['options']
      },
      execute: async (args) => {
        const title = optionalString(args, 'title') ?? 'Options'
        const question = optionalString(args, 'question') ?? ''
        const options = coerceStringArray(args.options)
        if (!options.length) throw new Error('create_options requires at least one option.')
        const selection = runtime.selectOption
          ? await runtime.selectOption({ title, question, options })
          : { index: 0, option: options[0] }
        return result('create_options', {
          title,
          question,
          options,
          cancelled: selection.index < 0,
          selectedIndex: selection.index,
          selectedOption: selection.option
        })
      }
    },
    {
      name: 'manipulate_file_lines',
      description: 'Insert, replace, or delete 1-based line ranges in a text file.',
      mode: 'write',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file path.' },
          operation: { type: 'string', enum: ['insert', 'replace', 'delete', 'append'], description: 'Line operation.' },
          startLine: { type: 'number', description: '1-based start line.' },
          endLine: { type: 'number', description: '1-based end line for replace/delete.' },
          content: { type: 'string', description: 'Inserted or replacement content.' }
        },
        required: ['path', 'operation']
      },
      execute: async (args) => {
        const path = requireString(args, 'path')
        const operation = optionalString(args, 'operation') ?? 'replace'
        const text = await api.readFile(path)
        const lines = text.split(/\r?\n/)
        const startLine = optionalNumber(args, 'startLine', lines.length + 1, 1, lines.length + 1)
        const endLine = optionalNumber(args, 'endLine', startLine, startLine, lines.length)
        const contentLines = (optionalString(args, 'content') ?? '').split(/\r?\n/)

        if (operation === 'append') {
          lines.push(...contentLines)
        } else if (operation === 'insert') {
          lines.splice(startLine - 1, 0, ...contentLines)
        } else if (operation === 'delete') {
          lines.splice(startLine - 1, endLine - startLine + 1)
        } else {
          lines.splice(startLine - 1, endLine - startLine + 1, ...contentLines)
        }

        await api.writeFile(path, lines.join('\n'))
        return result('manipulate_file_lines', { path, operation, startLine, endLine })
      }
    },
    {
      name: 'generate_image',
      description: 'Generate an image asset from a prompt using the configured image model and save it under project assets.',
      mode: 'network',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Image generation prompt.' },
          size: { type: 'string', description: 'Optional image size, default 1024x1024.' }
        },
        required: ['prompt']
      },
      execute: async (args) => result('generate_image', await api.generateImage(requireString(args, 'prompt'), optionalString(args, 'size')))
    },
    {
      name: 'edit_image',
      description: 'Edit an existing project image using the configured image edit model and save the result under project assets.',
      mode: 'network',
      parameters: {
        type: 'object',
        properties: {
          sourcePath: { type: 'string', description: 'Project-relative source image path.' },
          prompt: { type: 'string', description: 'Image edit prompt.' },
          size: { type: 'string', description: 'Optional output size, default 1024x1024.' }
        },
        required: ['sourcePath', 'prompt']
      },
      execute: async (args) =>
        result(
          'edit_image',
          await api.editImage(requireString(args, 'sourcePath'), requireString(args, 'prompt'), optionalString(args, 'size'))
        )
    },
    {
      name: 'search_knowledge_base',
      description: 'Search local knowledge-style directories and return matching passages.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          limit: { type: 'number', description: 'Maximum matches.' }
        },
        required: ['query']
      },
      execute: async (args) =>
        result(
          'search_knowledge_base',
          await searchLocalDirs(
            api,
            requireString(args, 'query'),
            await readKnowledgeDirs(api),
            optionalNumber(args, 'limit', 30, 1, 120)
          )
        )
    },
    {
      name: 'ask_full_text',
      description: 'Collect bounded project context for full-text QA; the agent should answer using returned sources.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Full-text question.' },
          maxFiles: { type: 'number', description: 'Maximum files to collect.' }
        },
        required: ['query']
      },
      execute: async (args) => {
        const query = requireString(args, 'query')
        const draft = await api.buildSmartContext(optionalNumber(args, 'maxFiles', 40, 1, 60))
        return result('ask_full_text', {
          query,
          sources: draft.files,
          prompt: draft.prompt,
          instruction: 'Use these collected project sources to answer the query. Cite file paths when possible.'
        })
      }
    },
    {
      name: 'call_sub_agent',
      description: 'Queue a local sub-agent task request file for the UI sub-agent workflow.',
      mode: 'agent',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['planner', 'writer', 'reviewer', 'researcher'], description: 'Sub-agent role.' },
          prompt: { type: 'string', description: 'Task prompt.' }
        },
        required: ['role', 'prompt']
      },
      execute: async (args, signal) => {
        const role = requireSubAgentRole(args)
        const prompt = requireString(args, 'prompt')
        if (signal?.aborted) {
          return result('call_sub_agent', { role, status: 'canceled' }, false)
        }
        if (runtime.runSubAgent) {
          const session = await runtime.runSubAgent(role, prompt, signal)
          if (!session) {
            return result('call_sub_agent', { role, status: 'busy_or_rejected' }, false)
          }
          const reply =
            [...session.messages].reverse().find((message) => message.role === 'assistant' && message.content.trim())
              ?.content ?? ''
          return result('call_sub_agent', {
            role,
            sessionId: session.id,
            status: session.status,
            reply,
            error: session.error
          }, session.status === 'done')
        }
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
        const path = `.wangyang/sub-agent-requests/${role}-${stamp}.md`
        await api.writeFile(path, `# Sub-agent Request\n\nRole: ${role}\nCreated: ${new Date().toISOString()}\n\n## Prompt\n\n${prompt}\n`)
        return result('call_sub_agent', {
          role,
          path,
          status: 'queued_locally'
        })
      }
    },
    {
      name: 'list_history_sessions',
      description: 'List locally persisted agent chat sessions.',
      mode: 'read',
      parameters: {
        type: 'object',
        properties: {}
      },
      execute: async () => result('list_history_sessions', await readHistorySessions(api))
    },
    {
      name: 'run_command',
      description: 'Run a shell command in the current project only when local diagnostics, build checks, or file-state checks are necessary. Do not retry the exact same command after receiving stdout/stderr; use the prior result or change the command.',
      mode: 'danger',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run in the current project root. Must not be identical to a command already run in this turn unless the user explicitly requested a rerun.' }
        },
        required: ['command']
      },
      execute: async (args) => result('run_command', await api.runCommand(requireString(args, 'command')))
    }
  ]
}
