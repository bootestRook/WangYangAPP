import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LocalSettings, ProjectBackupInfo } from '../../shared/types'

const skipNames = new Set(['node_modules', '.git', 'out', 'dist'])

function ensureRoot(root: string): string {
  if (!root.trim()) throw new Error('Project root is not configured.')
  return path.resolve(root)
}

function backupRoot(root: string, settings: LocalSettings): string {
  return path.resolve(settings.backup.backupDir.trim() || path.join(root, '.wangyang', 'backups'))
}

function backupId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

async function copyProjectTree(
  sourceRoot: string,
  current: string,
  targetRoot: string,
  backupsRoot: string,
  stats: { files: number; bytes: number }
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue
    const source = path.join(current, entry.name)
    if (source === backupsRoot || source.startsWith(`${backupsRoot}${path.sep}`)) continue
    const relative = path.relative(sourceRoot, source)
    const target = path.join(targetRoot, relative)
    if (entry.isDirectory()) {
      await mkdir(target, { recursive: true })
      await copyProjectTree(sourceRoot, source, targetRoot, backupsRoot, stats)
      continue
    }
    if (!entry.isFile()) continue
    const meta = await stat(source)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(source, target)
    stats.files += 1
    stats.bytes += meta.size
  }
}

export async function createProjectBackup(root: string, settings: LocalSettings): Promise<ProjectBackupInfo> {
  const resolvedRoot = ensureRoot(root)
  const backupsRoot = backupRoot(resolvedRoot, settings)
  const id = backupId()
  const targetRoot = path.join(backupsRoot, id)
  const stats = { files: 0, bytes: 0 }
  await mkdir(targetRoot, { recursive: true })
  await copyProjectTree(resolvedRoot, resolvedRoot, targetRoot, backupsRoot, stats)
  const info: ProjectBackupInfo = {
    id,
    path: targetRoot,
    createdAt: Date.now(),
    files: stats.files,
    bytes: stats.bytes
  }
  await writeFile(path.join(targetRoot, 'backup.json'), JSON.stringify(info, null, 2), 'utf8')
  await pruneProjectBackups(resolvedRoot, settings)
  return info
}

export async function listProjectBackups(root: string, settings: LocalSettings): Promise<ProjectBackupInfo[]> {
  const backupsRoot = backupRoot(ensureRoot(root), settings)
  let entries: string[]
  try {
    entries = await readdir(backupsRoot)
  } catch {
    return []
  }
  const backups: ProjectBackupInfo[] = []
  for (const entry of entries) {
    try {
      const raw = await readFile(path.join(backupsRoot, entry, 'backup.json'), 'utf8')
      backups.push(JSON.parse(raw) as ProjectBackupInfo)
    } catch {
      // Ignore incomplete backup directories.
    }
  }
  return backups.sort((a, b) => b.createdAt - a.createdAt)
}

export async function pruneProjectBackups(root: string, settings: LocalSettings): Promise<void> {
  const resolvedRoot = ensureRoot(root)
  const backupsRoot = backupRoot(resolvedRoot, settings)
  const keepVersions = Math.max(1, Math.floor(settings.backup.keepVersions || 1))
  const backups = await listProjectBackups(resolvedRoot, settings)
  const staleBackups = backups.slice(keepVersions)
  for (const backup of staleBackups) {
    const backupPath = path.resolve(backup.path)
    if (backupPath === backupsRoot || !backupPath.startsWith(`${backupsRoot}${path.sep}`)) continue
    await rm(backupPath, { recursive: true, force: true })
  }
}
