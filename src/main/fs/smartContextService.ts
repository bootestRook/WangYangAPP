import { open, readdir, readFile, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { streamChatCompletion } from '../../core/llm/openAiChat'
import { resolveModel } from '../../core/models/resolveModel'
import { buildSmartContextUserPrompt } from '../../core/smartContext/smartContext'
import type { AiConfig, ChatMessage, SmartContextDraft, SmartContextGenerationResult } from '../../shared/types'

const contextDirs = ['rules', 'outline', 'chapters', 'roles', 'objects', 'records', 'inspirations']
const textExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml'])
const defaultMaxFiles = 40
const hardMaxFiles = 60
const maxFileBytes = 256 * 1024

function ensureRoot(root: string): string {
  if (!root.trim()) throw new Error('Project root is not configured.')
  return path.resolve(root)
}

function toRelative(root: string, fullPath: string): string {
  return path.relative(root, fullPath).replace(/\\/g, '/')
}

function clampMaxFiles(value: unknown): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : defaultMaxFiles
  if (!Number.isFinite(numeric)) return defaultMaxFiles
  return Math.min(hardMaxFiles, Math.max(1, Math.floor(numeric)))
}

async function readLimitedText(fullPath: string): Promise<string> {
  const meta = await stat(fullPath)
  if (meta.size <= maxFileBytes) return readFile(fullPath, 'utf8')

  const handle = await open(fullPath, 'r')
  try {
    const buffer = Buffer.alloc(maxFileBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxFileBytes, 0)
    return `${buffer.subarray(0, bytesRead).toString('utf8')}\n\n[文件超过 ${maxFileBytes} bytes，仅收集开头片段]`
  } finally {
    await handle.close()
  }
}

function hashText(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function collectTextFiles(
  root: string,
  dir: string,
  out: Array<{ path: string; content: string }>,
  maxFiles: number
): Promise<void> {
  if (out.length >= maxFiles) return
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (out.length >= maxFiles) break
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'out') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectTextFiles(root, fullPath, out, maxFiles)
      continue
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue
    try {
      const content = await readLimitedText(fullPath)
      out.push({ path: toRelative(root, fullPath), content })
    } catch {
      // Unreadable or non-UTF8 files are ignored.
    }
  }
}

export async function buildSmartContextDraft(root: string, maxFilesInput: unknown = defaultMaxFiles): Promise<SmartContextDraft> {
  const resolvedRoot = ensureRoot(root)
  const maxFiles = clampMaxFiles(maxFilesInput)
  const files: Array<{ path: string; content: string }> = []
  for (const dir of contextDirs) {
    await collectTextFiles(resolvedRoot, path.join(resolvedRoot, dir), files, maxFiles)
  }

  const projectName = path.basename(resolvedRoot)
  const prompt = buildSmartContextUserPrompt({
    projectName,
    files,
    maxInputTokens: 70_000
  })

  return {
    projectName,
    files: files.map((file) => ({ path: file.path, chars: file.content.length, hash: hashText(file.content) })),
    prompt,
    createdAt: Date.now()
  }
}

export async function generateSmartContext(
  root: string,
  aiConfig: AiConfig,
  maxFilesInput: unknown = defaultMaxFiles
): Promise<SmartContextGenerationResult> {
  const draft = await buildSmartContextDraft(root, maxFilesInput)
  const model = resolveModel(aiConfig, aiConfig.scenario.smartContext)
  if (!model.interfaceConfig.apiKey.trim()) {
    throw new Error('Smart context generation requires an API key for the configured smartContext model.')
  }

  const messages: ChatMessage[] = [
    {
      id: 'smart_context_system',
      role: 'system',
      content:
        'You maintain a durable memory document for a long-form fiction project. Return concise Chinese Markdown with stable facts, character state, world rules, unresolved threads, and continuity risks. Do not include tool instructions.',
      createdAt: Date.now()
    },
    {
      id: 'smart_context_user',
      role: 'user',
      content: draft.prompt,
      createdAt: Date.now()
    }
  ]

  let content = ''
  for await (const event of streamChatCompletion({
    model,
    messages,
    temperature: 0.2
  })) {
    if (event.type === 'text-delta') content += event.text
  }

  const generatedContent = content.trim()
  if (!generatedContent) {
    throw new Error('Smart context model returned empty content.')
  }

  return {
    ...draft,
    content: generatedContent,
    model: model.modelId
  }
}
