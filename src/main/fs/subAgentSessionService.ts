import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChatMessage, SubAgentRole, SubAgentSession } from '../../shared/types'

const sessionsRoot = '.wangyang/memory/sessions'
const roles = new Set<SubAgentRole>(['planner', 'writer', 'reviewer', 'researcher'])
const statuses = new Set<SubAgentSession['status']>(['running', 'done', 'error'])

function ensureRoot(root: string): string {
  if (!root.trim()) throw new Error('Project root is not configured.')
  return path.resolve(root)
}

function resolveInside(root: string, relativePath: string): string {
  const resolvedRoot = ensureRoot(root)
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/').filter(Boolean)
  if (!normalized || path.isAbsolute(normalized) || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Path must be project-relative and stay inside the project root.')
  }
  const target = path.resolve(resolvedRoot, normalized)
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`
  if (target !== resolvedRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`Path escapes project root: ${relativePath}`)
  }
  return target
}

function safeSessionId(id: string): string {
  const safe = id.trim().replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 120)
  if (!safe || safe === '.' || safe === '..') throw new Error('Sub-agent session id is invalid.')
  return safe
}

function sessionJsonPath(root: string, sessionId: string): string {
  return resolveInside(root, `${sessionsRoot}/${safeSessionId(sessionId)}.json`)
}

function sessionMarkdownPath(root: string, sessionId: string): string {
  return resolveInside(root, `${sessionsRoot}/${safeSessionId(sessionId)}.md`)
}

function normalizeMessage(value: unknown): ChatMessage | undefined {
  const candidate = value as Partial<ChatMessage>
  if (
    !candidate ||
    typeof candidate.id !== 'string' ||
    !['system', 'user', 'assistant', 'tool'].includes(String(candidate.role)) ||
    typeof candidate.content !== 'string' ||
    typeof candidate.createdAt !== 'number'
  ) {
    return undefined
  }
  return candidate as ChatMessage
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeMessage).filter((message): message is ChatMessage => Boolean(message))
}

function normalizeSession(value: unknown): SubAgentSession | undefined {
  const candidate = value as Partial<SubAgentSession>
  if (
    !candidate ||
    typeof candidate.id !== 'string' ||
    !roles.has(candidate.role as SubAgentRole) ||
    typeof candidate.title !== 'string' ||
    typeof candidate.prompt !== 'string' ||
    !statuses.has(candidate.status as SubAgentSession['status']) ||
    typeof candidate.createdAt !== 'number' ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return undefined
  }
  return {
    id: candidate.id,
    role: candidate.role as SubAgentRole,
    title: candidate.title,
    prompt: candidate.prompt,
    messages: normalizeMessages(candidate.messages),
    status: candidate.status as SubAgentSession['status'],
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  }
}

function normalizeLoadedSession(value: unknown): { session?: SubAgentSession; changed: boolean } {
  const session = normalizeSession(value)
  if (!session) return { changed: false }
  if (session.status !== 'running') return { session, changed: false }
  return {
    session: {
      ...session,
      status: 'error',
      error: session.error ?? 'Previous sub-agent run was interrupted before completion.',
      updatedAt: Date.now()
    },
    changed: true
  }
}

function dateLabel(value: number): string {
  return Number.isFinite(value) ? new Date(value).toISOString() : ''
}

function renderSessionMarkdown(session: SubAgentSession): string {
  const lines = [
    '# Sub-agent Session',
    '',
    `- ID: ${session.id}`,
    `- Role: ${session.role}`,
    `- Status: ${session.status}`,
    `- Created: ${dateLabel(session.createdAt)}`,
    `- Updated: ${dateLabel(session.updatedAt)}`,
    ...(session.error ? [`- Error: ${session.error}`] : []),
    '',
    '## Prompt',
    '',
    session.prompt,
    '',
    '## Messages'
  ]

  for (const message of session.messages.filter((item) => item.role !== 'system')) {
    lines.push('', `### ${message.role}`, '', message.content)
  }

  return `${lines.join('\n')}\n`
}

export async function listSubAgentSessions(root: string): Promise<SubAgentSession[]> {
  const sessionDir = resolveInside(root, sessionsRoot)
  try {
    const entries = await readdir(sessionDir, { withFileTypes: true })
    const sessions: SubAgentSession[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue
      try {
        const raw = await readFile(path.join(sessionDir, entry.name), 'utf8')
        const { session, changed } = normalizeLoadedSession(JSON.parse(raw))
        if (!session) continue
        sessions.push(session)
        if (changed) await writeSubAgentSession(root, session)
      } catch {
        // Ignore malformed session files so one bad record does not block the panel.
      }
    }
    return sessions.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 50)
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return []
    throw error
  }
}

export async function writeSubAgentSession(root: string, value: SubAgentSession): Promise<SubAgentSession> {
  const session = normalizeSession(value)
  if (!session) throw new Error('Sub-agent session is invalid.')
  const jsonPath = sessionJsonPath(root, session.id)
  const markdownPath = sessionMarkdownPath(root, session.id)
  await mkdir(path.dirname(jsonPath), { recursive: true })
  await writeFile(jsonPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, renderSessionMarkdown(session), 'utf8')
  return session
}

export async function deleteSubAgentSession(root: string, sessionId: string): Promise<{ deleted: string }> {
  const safeId = safeSessionId(sessionId)
  await rm(sessionJsonPath(root, safeId), { force: true })
  await rm(sessionMarkdownPath(root, safeId), { force: true })
  return { deleted: safeId }
}
