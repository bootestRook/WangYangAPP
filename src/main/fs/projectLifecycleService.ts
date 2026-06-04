import { lstat, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectCreateInput, ProjectInfo, ProjectTemplateType } from '../../shared/types'

const projectDirectories = [
  'rules',
  'outline',
  'chapters',
  'roles',
  'objects',
  'records',
  'inspirations',
  'assets',
  'others',
  '.wangyang',
  '.wangyang/skills',
  '.wangyang/agents',
  '.wangyang/archive',
  '.wangyang/backups',
  '.wangyang/exports'
]

function now(): number {
  return Date.now()
}

function slugProjectName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
  return cleaned || `王阳项目 ${new Date().toISOString().slice(0, 10)}`
}

function projectId(root: string): string {
  return Buffer.from(path.resolve(root).toLowerCase()).toString('base64url').slice(0, 48)
}

function normalizeTemplateType(value: unknown): ProjectTemplateType {
  return value === 'analysis' ? 'analysis' : 'basic'
}

function assertInsideParent(parentPath: string, projectName: string): string {
  if (!parentPath.trim()) throw new Error('请选择项目父目录。')
  const parent = path.resolve(parentPath)
  const target = path.resolve(parent, slugProjectName(projectName))
  const parentWithSep = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`
  if (target !== parent && !target.startsWith(parentWithSep)) {
    throw new Error('项目目录必须位于选择的父目录内。')
  }
  return target
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

async function isEmptyDirectory(target: string): Promise<boolean> {
  try {
    const entries = await readdir(target)
    return entries.length === 0
  } catch {
    return true
  }
}

function createWangyangConfig(projectType: ProjectTemplateType): Record<string, unknown> {
  const base: Record<string, unknown> = {
    projectType,
    chapters: [],
    rules: [],
    outline: [],
    roles: [],
    objects: [],
    records: [],
    inspirations: [],
    assets: [],
    updatedAt: new Date().toISOString()
  }

  if (projectType === 'analysis') {
    base.records = [
      {
        relativePath: 'records/智能上下文-综合提炼小说信息.md',
        isSmartContext: true,
        smartContextPrompt:
          '请综合提炼当前小说信息，包括核心风格、人物关系、世界观设定、主线剧情、伏笔、章节进展和后续创作注意事项。'
      }
    ]
  }

  return base
}

function smartContextTemplate(): string {
  return [
    '# 智能上下文-综合提炼小说信息',
    '',
    '## 核心风格与基调',
    '',
    '## 人物信息',
    '',
    '## 世界观与设定',
    '',
    '## 当前故事脉络',
    '',
    '## 伏笔与待跟进事项',
    ''
  ].join('\n')
}

export function normalizeProjectInfo(project: Partial<ProjectInfo> & { root: string }): ProjectInfo {
  const root = path.resolve(project.root)
  const createdAt = typeof project.createdAt === 'number' ? project.createdAt : now()
  return {
    id: project.id || projectId(root),
    name: project.name?.trim() || path.basename(root) || '未命名项目',
    root,
    projectType: normalizeTemplateType(project.projectType),
    language: project.language || 'zh',
    createdAt,
    updatedAt: typeof project.updatedAt === 'number' ? project.updatedAt : createdAt,
    lastOpenedAt: typeof project.lastOpenedAt === 'number' ? project.lastOpenedAt : undefined
  }
}

export function upsertProject(projects: ProjectInfo[], project: ProjectInfo): ProjectInfo[] {
  const normalized = normalizeProjectInfo(project)
  const withoutSame = projects.filter(
    (item) => item.id !== normalized.id && path.resolve(item.root).toLowerCase() !== normalized.root.toLowerCase()
  )
  return [normalized, ...withoutSame].sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0))
}

export async function createProjectFromTemplate(input: ProjectCreateInput): Promise<ProjectInfo> {
  const projectType = normalizeTemplateType(input.projectType)
  const root = assertInsideParent(input.parentPath, input.name)
  if ((await pathExists(root)) && !(await isEmptyDirectory(root))) {
    throw new Error(`项目目录已存在且不为空：${root}`)
  }

  await mkdir(root, { recursive: true })
  await Promise.all(projectDirectories.map((dir) => mkdir(path.join(root, dir), { recursive: true })))
  await writeFile(path.join(root, 'wangyang.json'), `${JSON.stringify(createWangyangConfig(projectType), null, 2)}\n`, 'utf8')
  await writeFile(
    path.join(root, '.wangyang', 'solution.json'),
    `${JSON.stringify({ version: 1, active: 'professional', updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  )

  if (projectType === 'analysis') {
    await writeFile(path.join(root, 'records', '智能上下文-综合提炼小说信息.md'), smartContextTemplate(), 'utf8')
  }

  const timestamp = now()
  return {
    id: projectId(root),
    name: slugProjectName(input.name),
    root,
    projectType,
    language: input.language || 'zh',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp
  }
}

export async function inferProjectFromRoot(root: string): Promise<ProjectInfo> {
  const resolved = path.resolve(root)
  let projectType: ProjectTemplateType = 'basic'
  try {
    const raw = await readFile(path.join(resolved, 'wangyang.json'), 'utf8')
    const parsed = JSON.parse(raw) as { projectType?: unknown }
    projectType = normalizeTemplateType(parsed.projectType)
  } catch {
    // Existing folders without wangyang.json are still usable as local projects.
  }
  const meta = await stat(resolved)
  return {
    id: projectId(resolved),
    name: path.basename(resolved) || '未命名项目',
    root: resolved,
    projectType,
    language: 'zh',
    createdAt: meta.birthtimeMs || now(),
    updatedAt: meta.mtimeMs || now(),
    lastOpenedAt: now()
  }
}

export async function deleteProjectFiles(root: string): Promise<void> {
  const resolved = path.resolve(root)
  if (!resolved || resolved === path.parse(resolved).root) {
    throw new Error('拒绝删除磁盘根目录。')
  }
  const rootMeta = await lstat(resolved)
  if (!rootMeta.isDirectory() || rootMeta.isSymbolicLink()) {
    throw new Error('拒绝删除非真实项目目录。')
  }
  const realRoot = await realpath(resolved)
  if (path.resolve(realRoot) !== resolved) {
    throw new Error('拒绝删除符号链接或目录联接指向的项目。')
  }
  const projectConfigPath = path.join(resolved, 'wangyang.json')
  const solutionConfigPath = path.join(resolved, '.wangyang', 'solution.json')
  const [projectConfigMeta, solutionConfigMeta] = await Promise.all([lstat(projectConfigPath), lstat(solutionConfigPath)])
  if (!projectConfigMeta.isFile() || projectConfigMeta.isSymbolicLink() || !solutionConfigMeta.isFile() || solutionConfigMeta.isSymbolicLink()) {
    throw new Error('仅允许删除由本地模板创建并带有 wangyang.json 与 .wangyang/solution.json 的项目目录。')
  }
  await rm(resolved, { recursive: true, force: true })
}
