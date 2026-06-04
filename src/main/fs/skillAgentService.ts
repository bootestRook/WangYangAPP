import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentFileInfo, ProjectEntry, SkillInfo } from '../../shared/types'

const skillsRoot = '.wangyang/skills'
const agentsRoot = '.wangyang/agents'

function ensureRoot(root: string): string {
  if (!root.trim()) throw new Error('Project root is not configured.')
  return path.resolve(root)
}

function safeName(name: string, label: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`${label} name must not be empty or contain path separators.`)
  }
  return trimmed.replace(/[<>:"|?*]/g, '-').slice(0, 80)
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

function toRelative(root: string, fullPath: string): string {
  return path.relative(root, fullPath).replace(/\\/g, '/')
}

async function listEntries(root: string, relativePath: string): Promise<ProjectEntry[]> {
  const resolvedRoot = ensureRoot(root)
  const absolute = resolveInside(resolvedRoot, relativePath)
  const entries = await readdir(absolute, { withFileTypes: true })
  return Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(absolute, entry.name)
      const meta = await stat(fullPath)
      return {
        name: entry.name,
        relativePath: toRelative(resolvedRoot, fullPath),
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isFile() ? meta.size : undefined,
        updatedAt: meta.mtimeMs
      } satisfies ProjectEntry
    })
  ).then((items) =>
    items.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
  )
}

function parseSkillDescription(content: string): string | undefined {
  const description = /^description:\s*(.+)$/im.exec(content)?.[1]?.trim()
  if (description) return description.replace(/^["']|["']$/g, '')
  const firstParagraph = content
    .replace(/^---[\s\S]*?---\s*/, '')
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#\s+.+\n?/, '').trim())
    .find(Boolean)
  return firstParagraph?.slice(0, 180)
}

function parseFrontmatter(content: string): Record<string, string | string[]> {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return {}
  const lines = match[1].split(/\r?\n/)
  const parsed: Record<string, string | string[]> = {}
  let activeListKey = ''
  for (const line of lines) {
    const listItem = /^\s*-\s*(.+?)\s*$/.exec(line)
    if (listItem && activeListKey) {
      const current = parsed[activeListKey]
      parsed[activeListKey] = [...(Array.isArray(current) ? current : []), listItem[1].replace(/^["']|["']$/g, '')]
      continue
    }

    const separator = line.indexOf(':')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
    if (!key) continue
    if (!value) {
      parsed[key] = []
      activeListKey = key
    } else {
      parsed[key] = value
      activeListKey = ''
    }
  }
  return parsed
}

function parseFrontmatterList(value: string | string[] | undefined): string[] | undefined {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean)
  if (!value?.trim()) return undefined
  const raw = value.trim()
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const parsed = JSON.parse(raw.replace(/'/g, '"')) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean)
      }
    } catch {
      // Fall back to comma splitting below.
    }
  }
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

function parseFrontmatterString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseFrontmatterBoolean(value: string | string[] | undefined): boolean | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  if (/^(true|yes|1)$/i.test(value.trim())) return true
  if (/^(false|no|0)$/i.test(value.trim())) return false
  return undefined
}

function parseAgentMetadata(content: string, fallbackName: string): Pick<AgentFileInfo, 'name' | 'description' | 'tools' | 'skills' | 'isBuiltIn'> {
  const frontmatter = parseFrontmatter(content)
  return {
    name: parseFrontmatterString(frontmatter.name) || fallbackName,
    description: parseFrontmatterString(frontmatter.description),
    tools: parseFrontmatterList(frontmatter.tools),
    skills: parseFrontmatterList(frontmatter.skills),
    isBuiltIn: parseFrontmatterBoolean(frontmatter.isBuiltIn ?? frontmatter.builtIn)
  }
}

export async function listSkills(root: string): Promise<SkillInfo[]> {
  const resolvedRoot = ensureRoot(root)
  const base = resolveInside(resolvedRoot, skillsRoot)
  await mkdir(base, { recursive: true })
  const entries = await readdir(base, { withFileTypes: true })
  const skills: SkillInfo[] = []
  for (const entry of entries) {
    const fullPath = path.join(base, entry.name)
    const meta = await stat(fullPath)
    const entryFile = entry.isDirectory() ? path.join(fullPath, 'SKILL.md') : fullPath
    if (!entry.isDirectory() && !entry.name.toLowerCase().endsWith('.md')) continue
    try {
      const content = await readFile(entryFile, 'utf8')
      skills.push({
        name: entry.isDirectory() ? entry.name : entry.name.replace(/\.md$/i, ''),
        relativePath: toRelative(resolvedRoot, fullPath),
        entryPath: toRelative(resolvedRoot, entryFile),
        description: parseSkillDescription(content),
        updatedAt: meta.mtimeMs
      })
    } catch {
      // Skill folders without SKILL.md are skipped.
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

export async function listSkillDirectory(root: string, skillName: string): Promise<ProjectEntry[]> {
  const name = safeName(skillName, 'Skill')
  return listEntries(root, `${skillsRoot}/${name}`)
}

export async function createSkill(root: string, name: string, content?: string): Promise<SkillInfo> {
  const resolvedRoot = ensureRoot(root)
  const skillName = safeName(name, 'Skill')
  const parent = resolveInside(resolvedRoot, skillsRoot)
  const dir = resolveInside(resolvedRoot, `${skillsRoot}/${skillName}`)
  await mkdir(parent, { recursive: true })
  try {
    await mkdir(dir)
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') {
      throw new Error(`Skill already exists: ${skillName}`)
    }
    throw error
  }
  const entryFile = path.join(dir, 'SKILL.md')
  const body =
    content ??
    `---\nname: ${skillName}\ndescription: 本地项目技能。\n---\n\n# ${skillName}\n\n## 使用场景\n\n## 输入要求\n\n## 执行步骤\n\n## 输出格式\n`
  await writeFile(entryFile, body, { encoding: 'utf8', flag: 'wx' })
  const meta = await stat(entryFile)
  return {
    name: skillName,
    relativePath: toRelative(resolvedRoot, dir),
    entryPath: toRelative(resolvedRoot, entryFile),
    description: parseSkillDescription(body),
    updatedAt: meta.mtimeMs
  }
}

export async function deleteSkill(root: string, name: string): Promise<{ deleted: string }> {
  const skillName = safeName(name, 'Skill')
  await rm(resolveInside(root, `${skillsRoot}/${skillName}`), { recursive: true, force: false })
  return { deleted: skillName }
}

export async function listAgents(root: string): Promise<AgentFileInfo[]> {
  const resolvedRoot = ensureRoot(root)
  const base = resolveInside(resolvedRoot, agentsRoot)
  await mkdir(base, { recursive: true })
  const entries = await readdir(base, { withFileTypes: true })
  const agents: AgentFileInfo[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    const fullPath = path.join(base, entry.name)
    const meta = await stat(fullPath)
    const content = await readFile(fullPath, 'utf8')
    const fallbackName = entry.name.replace(/\.md$/i, '')
    const metadata = parseAgentMetadata(content, fallbackName)
    agents.push({
      id: fallbackName,
      name: metadata.name || fallbackName,
      relativePath: toRelative(resolvedRoot, fullPath),
      description: metadata.description,
      tools: metadata.tools,
      skills: metadata.skills,
      isBuiltIn: metadata.isBuiltIn,
      updatedAt: meta.mtimeMs
    })
  }
  return agents.sort((left, right) => left.name.localeCompare(right.name))
}

function agentPath(root: string, agentId: string): string {
  const name = safeName(agentId.replace(/\.md$/i, ''), 'Agent')
  return resolveInside(root, `${agentsRoot}/${name}.md`)
}

export async function readAgentContent(root: string, agentId: string): Promise<string> {
  return readFile(agentPath(root, agentId), 'utf8')
}

export async function writeAgentContent(root: string, agentId: string, content: string): Promise<AgentFileInfo> {
  const resolvedRoot = ensureRoot(root)
  const target = agentPath(resolvedRoot, agentId)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
  const meta = await stat(target)
  const metadata = parseAgentMetadata(content, path.basename(target, '.md'))
  return {
    id: path.basename(target, '.md'),
    name: metadata.name || path.basename(target, '.md'),
    relativePath: toRelative(resolvedRoot, target),
    description: metadata.description,
    tools: metadata.tools,
    skills: metadata.skills,
    isBuiltIn: metadata.isBuiltIn,
    updatedAt: meta.mtimeMs
  }
}

export async function createAgent(root: string, agentId: string, content?: string): Promise<AgentFileInfo> {
  const resolvedRoot = ensureRoot(root)
  const name = safeName(agentId, 'Agent')
  const target = agentPath(resolvedRoot, name)
  const body =
    content ??
    `---\nname: ${name}\ndescription: 本地项目智能体。\ntools: []\nskills: []\nisBuiltIn: false\n---\n\n# ${name}\n\n## 角色定位\n\n## 工作方式\n\n## 输出要求\n`
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, body, { encoding: 'utf8', flag: 'wx' })
  const meta = await stat(target)
  const metadata = parseAgentMetadata(body, path.basename(target, '.md'))
  return {
    id: path.basename(target, '.md'),
    name: metadata.name || path.basename(target, '.md'),
    relativePath: toRelative(resolvedRoot, target),
    description: metadata.description,
    tools: metadata.tools,
    skills: metadata.skills,
    isBuiltIn: metadata.isBuiltIn,
    updatedAt: meta.mtimeMs
  }
}

export async function deleteAgent(root: string, agentId: string): Promise<{ deleted: string }> {
  const name = safeName(agentId, 'Agent')
  await rm(agentPath(root, name), { force: false })
  return { deleted: name }
}
