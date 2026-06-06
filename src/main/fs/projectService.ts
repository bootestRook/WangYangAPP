import { readdir, readFile, stat, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { DirectoryListing, ProjectEntry, SearchMatch } from '../../shared/types'
import { addProjectConfigEntry, moveProjectConfigEntry, removeProjectConfigEntry } from './projectConfigService'

function ensureRoot(root: string): string {
  if (!root.trim()) {
    throw new Error('Project root is not configured.')
  }
  return path.resolve(root)
}

function resolveInsideRoot(root: string, relativePath = ''): string {
  const resolvedRoot = ensureRoot(root)
  const target = path.resolve(resolvedRoot, relativePath)
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`
  if (target !== resolvedRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`Path escapes project root: ${relativePath}`)
  }
  return target
}

function assertEntryPath(relativePath: string, operation: string): string {
  const raw = relativePath.trim()
  const normalized = relativePath.trim().replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  if (path.isAbsolute(raw) || path.isAbsolute(normalized)) {
    throw new Error(`${operation} path must be relative to the project root.`)
  }
  if (!normalized || normalized === '.' || normalized === '/' || segments.length === 0) {
    throw new Error(`${operation} path must not be the project root.`)
  }
  if (segments.some((segment) => segment.includes('..'))) {
    throw new Error(`${operation} path must not contain parent directory segments.`)
  }
  return normalized
}

function resolveMutableEntry(root: string, relativePath: string, operation: string): { relativePath: string; target: string } {
  const safeRelativePath = assertEntryPath(relativePath, operation)
  const target = resolveInsideRoot(root, safeRelativePath)
  if (target === ensureRoot(root)) {
    throw new Error(`${operation} path must not target the project root.`)
  }
  return { relativePath: safeRelativePath, target }
}

function assertEntryName(name: string): string {
  const normalized = name.trim()
  if (
    !normalized ||
    normalized === '.' ||
    normalized.includes('..') ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new Error('New name must not be empty, parent traversal, or contain path separators.')
  }
  return normalized
}

function toRelative(root: string, fullPath: string): string {
  return path.relative(root, fullPath).replace(/\\/g, '/')
}

export async function listDirectory(root: string, relativePath = ''): Promise<DirectoryListing> {
  const absolute = resolveInsideRoot(root, relativePath)
  const entries = await readdir(absolute, { withFileTypes: true })
  const resolvedRoot = ensureRoot(root)
  const listed: ProjectEntry[] = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(absolute, entry.name)
      const meta = await stat(fullPath)
      return {
        name: entry.name,
        relativePath: toRelative(resolvedRoot, fullPath),
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isFile() ? meta.size : undefined,
        updatedAt: meta.mtimeMs
      }
    })
  )

  return {
    root: resolvedRoot,
    relativePath,
    entries: listed.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }
}

export async function readProjectFile(root: string, relativePath: string): Promise<string> {
  return readFile(resolveInsideRoot(root, relativePath), 'utf8')
}

export async function writeProjectFile(
  root: string,
  relativePath: string,
  content: string
): Promise<{ relativePath: string; bytes: number }> {
  const target = resolveInsideRoot(root, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
  await addProjectConfigEntry(ensureRoot(root), relativePath)
  return { relativePath, bytes: Buffer.byteLength(content, 'utf8') }
}

export async function createProjectEntry(
  root: string,
  relativePath: string,
  type: 'file' | 'directory',
  content = ''
): Promise<ProjectEntry> {
  const { target } = resolveMutableEntry(root, relativePath, 'Create')
  const resolvedRoot = ensureRoot(root)
  if (type === 'directory') {
    await mkdir(target, { recursive: true })
  } else {
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
  }
  const meta = await stat(target)
  const entry = {
    name: path.basename(target),
    relativePath: toRelative(resolvedRoot, target),
    type,
    size: type === 'file' ? meta.size : undefined,
    updatedAt: meta.mtimeMs
  }
  await addProjectConfigEntry(resolvedRoot, entry.relativePath)
  return entry
}

export async function renameProjectEntry(
  root: string,
  relativePath: string,
  nextName: string
): Promise<ProjectEntry> {
  const { relativePath: safeRelativePath, target: source } = resolveMutableEntry(root, relativePath, 'Rename')
  const safeName = assertEntryName(nextName)
  const target = resolveInsideRoot(root, path.join(path.dirname(safeRelativePath), safeName))
  if (target === ensureRoot(root)) {
    throw new Error('Rename target must not be the project root.')
  }
  await rename(source, target)
  const resolvedRoot = ensureRoot(root)
  const nextRelativePath = toRelative(resolvedRoot, target)
  await moveProjectConfigEntry(resolvedRoot, safeRelativePath, nextRelativePath)
  const meta = await stat(target)
  const isDirectory = meta.isDirectory()
  return {
    name: path.basename(target),
    relativePath: nextRelativePath,
    type: isDirectory ? 'directory' : 'file',
    size: isDirectory ? undefined : meta.size,
    updatedAt: meta.mtimeMs
  }
}

export async function deleteProjectEntry(root: string, relativePath: string): Promise<{ deleted: string }> {
  const { relativePath: safeRelativePath, target } = resolveMutableEntry(root, relativePath, 'Delete')
  await rm(target, { recursive: true, force: false })
  await removeProjectConfigEntry(ensureRoot(root), safeRelativePath)
  return { deleted: safeRelativePath }
}

export async function moveProjectEntry(
  root: string,
  relativePath: string,
  targetRelativePath: string
): Promise<ProjectEntry> {
  const { relativePath: sourceRelativePath, target: source } = resolveMutableEntry(root, relativePath, 'Move')
  const { relativePath: nextRelativePath, target } = resolveMutableEntry(root, targetRelativePath, 'Move target')
  await mkdir(path.dirname(target), { recursive: true })
  await rename(source, target)
  const resolvedRoot = ensureRoot(root)
  await moveProjectConfigEntry(resolvedRoot, sourceRelativePath, nextRelativePath)
  const meta = await stat(target)
  const isDirectory = meta.isDirectory()
  return {
    name: path.basename(target),
    relativePath: toRelative(resolvedRoot, target),
    type: isDirectory ? 'directory' : 'file',
    size: isDirectory ? undefined : meta.size,
    updatedAt: meta.mtimeMs
  }
}

async function walkFiles(root: string, dir: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (out.length >= limit) break
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkFiles(root, fullPath, out, limit)
    } else if (entry.isFile()) {
      out.push(toRelative(root, fullPath))
    }
  }
}

async function walkProjectEntries(
  root: string,
  dir: string,
  query: string,
  out: ProjectEntry[],
  limit: number
): Promise<void> {
  if (out.length >= limit) return
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (out.length >= limit) break
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const fullPath = path.join(dir, entry.name)
    const meta = await stat(fullPath)
    const isDirectory = entry.isDirectory()
    const relativePath = toRelative(root, fullPath)
    if (entry.name.toLowerCase().includes(query) || relativePath.toLowerCase().includes(query)) {
      out.push({
        name: entry.name,
        relativePath,
        type: isDirectory ? 'directory' : 'file',
        size: isDirectory ? undefined : meta.size,
        updatedAt: meta.mtimeMs
      })
    }
    if (isDirectory) {
      await walkProjectEntries(root, fullPath, query, out, limit)
    }
  }
}

export async function searchProjectFiles(root: string, query: string, limit = 200): Promise<ProjectEntry[]> {
  const resolvedRoot = ensureRoot(root)
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const matches: ProjectEntry[] = []
  await walkProjectEntries(resolvedRoot, resolvedRoot, needle, matches, limit)
  return matches
}

export async function searchInFiles(
  root: string,
  query: string,
  limit = 200
): Promise<SearchMatch[]> {
  const resolvedRoot = ensureRoot(root)
  const files: string[] = []
  await walkFiles(resolvedRoot, resolvedRoot, files, 2000)

  const matches: SearchMatch[] = []
  const needle = query.toLowerCase()
  for (const file of files) {
    if (matches.length >= limit) break
    try {
      const text = await readProjectFile(resolvedRoot, file)
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        if (matches.length >= limit) break
        if (lines[i].toLowerCase().includes(needle)) {
          matches.push({ file, line: i + 1, preview: lines[i].trim().slice(0, 240) })
        }
      }
    } catch {
      // Binary or unreadable files are skipped.
    }
  }

  return matches
}
