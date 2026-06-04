import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

type ConfigGroup =
  | 'rules'
  | 'outline'
  | 'chapters'
  | 'roles'
  | 'objects'
  | 'records'
  | 'inspirations'
  | 'assets'
  | 'others'

type ProjectConfigRecord = {
  relativePath: string
  [key: string]: unknown
}

export type ProjectConfigShape = Record<string, unknown> & Partial<Record<ConfigGroup, ProjectConfigRecord[]>>

const groupDirs: Array<{ key: ConfigGroup; dir: string }> = [
  { key: 'rules', dir: 'rules' },
  { key: 'outline', dir: 'outline' },
  { key: 'chapters', dir: 'chapters' },
  { key: 'roles', dir: 'roles' },
  { key: 'objects', dir: 'objects' },
  { key: 'records', dir: 'records' },
  { key: 'inspirations', dir: 'inspirations' },
  { key: 'assets', dir: 'assets' },
  { key: 'others', dir: 'others' }
]

function configPath(root: string): string {
  if (!root.trim()) throw new Error('Project root is not configured.')
  return path.join(root, 'wangyang.json')
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

function isSafeConfigPath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  const segments = normalized.split('/').filter(Boolean)
  return (
    Boolean(normalized) &&
    !path.isAbsolute(relativePath) &&
    !path.isAbsolute(normalized) &&
    segments.length > 0 &&
    segments.every((segment) => segment !== '.' && segment !== '..') &&
    normalized !== 'wangyang.json' &&
    !normalized.startsWith('.wangyang/')
  )
}

function groupForPath(relativePath: string): ConfigGroup | undefined {
  const normalized = normalizeRelativePath(relativePath)
  if (!isSafeConfigPath(normalized)) return undefined
  return groupDirs.find((entry) => normalized === entry.dir || normalized.startsWith(`${entry.dir}/`))?.key
}

function defaultProjectConfig(): ProjectConfigShape {
  return {
    projectType: 'basic',
    chapters: [],
    rules: [],
    outline: [],
    roles: [],
    objects: [],
    records: [],
    inspirations: [],
    assets: [],
    others: []
  }
}

function sanitizeProjectConfig(input: ProjectConfigShape): ProjectConfigShape {
  const config: ProjectConfigShape = {
    ...defaultProjectConfig(),
    ...(input && typeof input === 'object' ? input : {})
  }

  for (const { key } of groupDirs) {
    const current = config[key]
    const seen = new Set<string>()
    config[key] = Array.isArray(current)
      ? current
          .filter((item): item is ProjectConfigRecord => Boolean(item && typeof item.relativePath === 'string'))
          .map((item) => ({ ...item, relativePath: normalizeRelativePath(item.relativePath) }))
          .filter((item) => {
            if (!item.relativePath || groupForPath(item.relativePath) !== key || seen.has(item.relativePath)) return false
            seen.add(item.relativePath)
            return true
          })
      : []
  }

  return config
}

export async function readProjectConfig(root: string): Promise<ProjectConfigShape> {
  const target = configPath(root)
  try {
    const raw = await readFile(target, 'utf8')
    const parsed = JSON.parse(raw) as ProjectConfigShape
    return sanitizeProjectConfig(parsed)
  } catch {
    return defaultProjectConfig()
  }
}

export async function writeProjectConfig(root: string, config: ProjectConfigShape): Promise<ProjectConfigShape> {
  const target = configPath(root)
  const next = {
    ...sanitizeProjectConfig(config),
    updatedAt: new Date().toISOString()
  }
  await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

function listFor(config: ProjectConfigShape, group: ConfigGroup): ProjectConfigRecord[] {
  const current = config[group]
  return Array.isArray(current) ? current.filter((item) => item && typeof item.relativePath === 'string') : []
}

export async function addProjectConfigEntry(root: string, relativePath: string): Promise<void> {
  const normalized = normalizeRelativePath(relativePath)
  const group = groupForPath(normalized)
  if (!group) return
  const config = await readProjectConfig(root)
  const list = listFor(config, group)
  if (list.some((item) => item.relativePath === normalized)) return
  config[group] = [...list, { relativePath: normalized }]
  await writeProjectConfig(root, config)
}

export async function removeProjectConfigEntry(root: string, relativePath: string): Promise<void> {
  const normalized = normalizeRelativePath(relativePath)
  const config = await readProjectConfig(root)
  let changed = false
  for (const { key } of groupDirs) {
    const list = listFor(config, key)
    const next = list.filter(
      (item) => item.relativePath !== normalized && !item.relativePath.startsWith(`${normalized}/`)
    )
    if (next.length !== list.length) {
      config[key] = next
      changed = true
    }
  }
  if (changed) await writeProjectConfig(root, config)
}

export async function moveProjectConfigEntry(root: string, sourcePath: string, targetPath: string): Promise<void> {
  const source = normalizeRelativePath(sourcePath)
  const target = normalizeRelativePath(targetPath)
  const sourceGroup = groupForPath(source)
  const targetGroup = groupForPath(target)
  if (!sourceGroup && !targetGroup) return

  const config = await readProjectConfig(root)
  let movedRecords: ProjectConfigRecord[] = []
  if (sourceGroup) {
    const list = listFor(config, sourceGroup)
    const remaining: ProjectConfigRecord[] = []
    for (const item of list) {
      if (item.relativePath === source || item.relativePath.startsWith(`${source}/`)) {
        movedRecords.push({
          ...item,
          relativePath: item.relativePath === source ? target : `${target}/${item.relativePath.slice(source.length + 1)}`
        })
      } else {
        remaining.push(item)
      }
    }
    config[sourceGroup] = remaining
  }

  if (!movedRecords.length && targetGroup) {
    movedRecords = [{ relativePath: target }]
  }

  if (targetGroup && movedRecords.length) {
    const existing = listFor(config, targetGroup)
    const existingPaths = new Set(existing.map((item) => item.relativePath))
    config[targetGroup] = [
      ...existing,
      ...movedRecords.filter((item) => {
        if (existingPaths.has(item.relativePath)) return false
        existingPaths.add(item.relativePath)
        return true
      })
    ]
  }

  await writeProjectConfig(root, config)
}
