import { App as AntApp, Button, Input, Modal, Select } from 'antd'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectBackupInfo, ProjectEntry, ProjectInfo, ProjectTemplateType, SkillInfo, SmartContextGenerationResult } from '../../shared/types'
import { OriginalIcon, type OriginalIconName } from './OriginalIcon'
import { useAppStore } from '../stores/useAppStore'

const navItems = [
  { icon: 'file', label: '文件' },
  { icon: 'search', label: '搜索' },
  { icon: 'skill', label: '技能' },
  { icon: 'agent', label: '智能' },
  { icon: 'snapshot', label: '快照' },
  { icon: 'knowledge', label: '知识' },
  { icon: 'toolbox', label: '百宝箱' }
] as const

type NavLabel = (typeof navItems)[number]['label']
type EntryType = 'file' | 'directory'
type SearchMode = 'content' | 'file' | 'ask'

type ProjectExplorerProps = {
  isSidebarCollapsed?: boolean
  onToggleSidebar?: () => void
}
type ProjectSection = {
  title: string
  dir: string
  special?: 'context' | 'cover'
  settings?: boolean
}

type ChapterStatusMap = Record<string, { status: string; notes?: string; updatedAt?: number }>
type KnowledgeBaseEntry = {
  id: string
  name: string
  path: string
  enabled: boolean
  createdAt: number
  updatedAt?: number
}
type KnowledgeSearchResult = {
  file: string
  line: number
  preview: string
  knowledgeBase: string
}

const sections: ProjectSection[] = [
  { title: '规则', dir: 'rules' },
  { title: '大纲', dir: 'outline' },
  { title: '章节', dir: 'chapters' },
  { title: '角色', dir: 'roles' },
  { title: '设定', dir: 'objects' },
  { title: '记录', dir: 'records', special: 'context' },
  { title: '灵感', dir: 'inspirations' },
  { title: '资产', dir: 'assets', special: 'cover' },
  { title: '技能', dir: '.wangyang/skills', settings: true },
  { title: '其他', dir: 'others' }
]
const chapterSectionTitle = sections.find((section) => section.dir === 'chapters')?.title ?? '章节'

const navPanelText: Record<Exclude<NavLabel, '文件'>, { title: string; search?: boolean; actions: string[] }> = {
  '搜索': {
    title: '搜索',
    search: true,
    actions: ['搜索项目内容', '搜索文件名', '全文问答']
  },
  '技能': {
    title: '技能',
    actions: ['新建技能', '导入技能', '查看项目技能']
  },
  '智能': {
    title: '智能',
    actions: ['智能开篇', '创建角色', '世界观构建', '剧情讨论']
  },
  '快照': {
    title: '快照',
    actions: ['创建本地快照', '刷新快照记录', '查看本地记录']
  },
  '知识': {
    title: '知识',
    actions: ['添加知识库', '搜索知识库', '绑定项目知识']
  },
  '百宝箱': {
    title: '百宝箱',
    actions: ['生成封面', '导出文档', '项目统计', '批量处理']
  }
}

const initialSectionDirs = Object.fromEntries(sections.map((section) => [section.title, section.dir]))
const initialSectionVisibility = Object.fromEntries(sections.map((section) => [section.title, true]))
const initialSectionOrder = Object.fromEntries(sections.map((section, index) => [section.title, index]))
const knowledgeConfigPath = '.wangyang/knowledge-bases.json'
const sectionDirsConfigPath = '.wangyang/section-dirs.json'
const sectionLayoutConfigPath = '.wangyang/section-layout.json'
const fallbackKnowledgeDirs = ['knowledge', '.wangyang/knowledge', 'records', 'rules', 'objects', 'inspirations']
const toolboxExportDirs = ['rules', 'outline', 'chapters', 'roles', 'objects', 'records', 'inspirations']

const searchModes: Array<{ mode: SearchMode; label: string; placeholder: string }> = [
  { mode: 'content', label: '搜内容', placeholder: '搜索项目内容' },
  { mode: 'file', label: '搜文件', placeholder: '搜索文件名或路径' },
  { mode: 'ask', label: '全文问答', placeholder: '输入要让智能体基于全文回答的问题' }
]

const sectionDefaults: Record<string, { file: string; directory: string }> = {
  '规则': { file: '创作规则.md', directory: '规则资料' },
  '大纲': { file: '故事大纲.md', directory: '大纲资料' },
  '章节': { file: '第01章.md', directory: '第一卷' },
  '角色': { file: '新角色.md', directory: '角色组' },
  '设定': { file: '世界设定.md', directory: '设定资料' },
  '记录': { file: '创作记录.md', directory: '记录归档' },
  '灵感': { file: '灵感片段.md', directory: '灵感箱' },
  '资产': { file: '资产说明.md', directory: '图片资产' },
  '技能': { file: '新技能.md', directory: '技能组' },
  '其他': { file: '未分类.md', directory: '未分类' }
}

function todayLabel(): string {
  return new Date().toLocaleDateString('zh-CN')
}

function sectionTemplate(sectionTitle: string, fileName: string): string {
  const title = fileName.replace(/\.[^.]+$/, '')
  const date = todayLabel()
  const templates: Record<string, string> = {
    '规则': `# ${title}\n\n创建日期：${date}\n\n## 创作目标\n\n## 作品定位\n\n## 核心卖点\n\n## 创作规则\n\n## 阶段计划\n\n## 待办\n\n- [ ] \n`,
    '大纲': `# ${title}\n\n创建日期：${date}\n\n## 一句话梗概\n\n## 主线冲突\n\n## 起承转合\n\n### 起\n\n### 承\n\n### 转\n\n### 合\n\n## 关键伏笔\n`,
    '章节': `# ${title}\n\n## 本章目标\n\n## 出场角色\n\n## 剧情正文\n\n`,
    '角色': `# ${title}\n\n## 基础信息\n\n- 姓名：\n- 年龄：\n- 身份：\n\n## 外貌\n\n## 性格\n\n## 欲望与弱点\n\n## 背景秘密\n\n## 关系网\n\n## 剧情作用\n`,
    '设定': `# ${title}\n\n## 设定概述\n\n## 规则\n\n## 限制\n\n## 冲突来源\n\n## 可展开剧情\n`,
    '记录': `# ${title}\n\n创建日期：${date}\n\n## 今日进展\n\n## 关键决定\n\n## 待跟进问题\n\n## AI 上下文补充\n`,
    '灵感': `# ${title}\n\n## 灵感来源\n\n## 可用片段\n\n## 可关联角色/章节\n\n## 后续处理\n`,
    '资产': `# ${title}\n\n## 资产用\n\n## 描述\n\n## 风格要求\n\n## 关联文件\n`,
    '技能': `# ${title}\n\n## 触发场景\n\n## 输入要求\n\n## 执行步骤\n\n## 输出格式\n\n## 提示词\n\n`,
    '其他': `# ${title}\n\n创建日期：${date}\n\n## 内容\n`
  }
  return templates[sectionTitle] ?? templates.其他
}

function timestampName(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `${prefix}-${stamp}.md`
}

function isEditableTextPath(relativePath: string): boolean {
  return ['.md', '.txt', '.json', '.yaml', '.yml'].some((ext) => relativePath.toLowerCase().endsWith(ext))
}

function isImagePath(relativePath: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].some((ext) => relativePath.toLowerCase().endsWith(ext))
}

function safeImportFileName(title: string, index: number): string {
  const cleaned =
    title
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48) || `章节-${index + 1}`
  return `${String(index + 1).padStart(3, '0')}-${cleaned}.md`
}

function splitBookContent(content: string): Array<{ title: string; body: string }> {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const lines = normalized.split('\n')
  const headingPattern = /^\s*(Chapter\s+\d+.*)\s*$/i
  const chapters: Array<{ title: string; body: string }> = []
  let currentTitle = ''
  let currentLines: string[] = []
  let matchedHeading = false

  const pushCurrent = (): void => {
    const body = currentLines.join('\n').trim()
    if (currentTitle || body) {
      chapters.push({ title: currentTitle || `章节 ${chapters.length + 1}`, body })
    }
  }

  for (const line of lines) {
    if (headingPattern.test(line)) {
      matchedHeading = true
      pushCurrent()
      currentTitle = line.trim()
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }
  pushCurrent()

  if (matchedHeading) return chapters
  const chunkSize = 5000
  const chunks: Array<{ title: string; body: string }> = []
  for (let offset = 0; offset < normalized.length; offset += chunkSize) {
    chunks.push({
      title: `章节 ${chunks.length + 1}`,
      body: normalized.slice(offset, offset + chunkSize).trim()
    })
  }
  return chunks
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function docxTextParagraphs(text: string): Paragraph[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun(line || ' ')]
      })
  )
}

async function buildDocxBase64(
  header: string,
  exportedAt: string,
  rows: Array<{ path: string; content: string }>
): Promise<string> {
  const children: Paragraph[] = [
    new Paragraph({ text: header, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `导出时间：${exportedAt} / 文件数：${rows.length}` })
  ]

  for (const row of rows) {
    children.push(new Paragraph({ text: row.path, heading: HeadingLevel.HEADING_2 }))
    children.push(...docxTextParagraphs(row.content))
  }

  const document = new Document({
    sections: [
      {
        properties: {},
        children
      }
    ]
  })

  return Packer.toBase64String(document)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function xhtmlDocument(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head>
  <title>${escapeHtml(title)}</title>
  <meta charset="utf-8" />
  <style>body{font-family:serif;line-height:1.7;}pre{white-space:pre-wrap;font-family:serif;}h1,h2{line-height:1.35;}</style>
</head>
<body>
${body}
</body>
</html>`
}

function buildEpubBase64(
  header: string,
  exportedAt: string,
  rows: Array<{ path: string; content: string }>
): string {
  const chapters = rows.length ? rows : [{ path: 'empty.txt', content: '暂无内容' }]
  const manifestItems = chapters
    .map((_, index) => `<item id="chapter-${index + 1}" href="chapters/chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('\n    ')
  const spineItems = chapters.map((_, index) => `<itemref idref="chapter-${index + 1}"/>`).join('\n    ')
  const navItems = chapters
    .map(
      (row, index) =>
        `<li><a href="chapters/chapter-${index + 1}.xhtml">${escapeHtml(row.path)}</a></li>`
    )
    .join('\n        ')

  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:title>${escapeHtml(header)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>王阳</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`),
    'OEBPS/nav.xhtml': strToU8(
      xhtmlDocument(
        header,
        `<nav epub:type="toc" id="toc"><h1>${escapeHtml(header)}</h1><p>导出时间：${escapeHtml(exportedAt)} / 文件数：${chapters.length}</p><ol>${navItems}</ol></nav>`
      )
    )
  }

  chapters.forEach((row, index) => {
    files[`OEBPS/chapters/chapter-${index + 1}.xhtml`] = strToU8(
      xhtmlDocument(row.path, `<h1>${escapeHtml(row.path)}</h1><pre>${escapeHtml(row.content)}</pre>`)
    )
  })

  return bytesToBase64(zipSync(files, { level: 9 }))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function basename(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? relativePath
}

function dirname(fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return fullPath.includes(':') ? `${parts[0] ?? ''}\\` : ''
  const prefix = normalized.startsWith('/') ? '/' : ''
  return `${prefix}${parts.slice(0, -1).join('/')}`
}

function sameLocalPath(left: string, right: string): boolean {
  const normalize = (value: string): string => value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return Boolean(left.trim() && right.trim() && normalize(left) === normalize(right))
}

function projectNameFromRoot(root: string): string {
  return basename(root) || '未配置项目'
}

function countWritingChars(text: string): number {
  return text.replace(/\s/g, '').length
}

function validateEntryName(name: string): string | undefined {
  const normalized = name.trim()
  if (!normalized) return '名称不能为空'
  if (normalized === '.' || normalized.includes('..')) return '名称不能包含 ..'
  if (normalized.includes('/') || normalized.includes('\\')) return '名称不能包含路径分隔符'
  return undefined
}

function normalizeRelativePath(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

function sameStringRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key])
}

function validateRelativePath(input: string): string | undefined {
  const normalized = normalizeRelativePath(input)
  if (!normalized) return '路径不能为空'
  if (normalized.split('/').some((segment) => segment === '..' || segment === '.')) return '路径不能包含 . 或 ..'
  if (/^[a-zA-Z]:/.test(normalized)) return '路径必须是项目内相对路径'
  return undefined
}

async function countTextCharsInDirectory(relativeDir: string): Promise<number> {
  let total = 0
  let listing
  try {
    listing = await window.electronAPI.listDirectory(relativeDir)
  } catch {
    return 0
  }

  for (const entry of listing.entries) {
    if (entry.type === 'directory') {
      total += await countTextCharsInDirectory(entry.relativePath)
    } else if (isEditableTextPath(entry.relativePath)) {
      try {
        total += countWritingChars(await window.electronAPI.readFile(entry.relativePath))
      } catch {
        // Ignore unreadable text-like files.
      }
    }
  }

  return total
}

async function searchTextInDirectory(
  relativeDir: string,
  query: string,
  knowledgeBase: string,
  out: KnowledgeSearchResult[],
  limit: number
): Promise<void> {
  if (out.length >= limit) return
  let listing
  try {
    listing = await window.electronAPI.listDirectory(relativeDir)
  } catch {
    return
  }

  const needle = query.toLowerCase()
  for (const entry of listing.entries) {
    if (out.length >= limit) return
    if (entry.type === 'directory') {
      await searchTextInDirectory(entry.relativePath, query, knowledgeBase, out, limit)
      continue
    }
    if (!isEditableTextPath(entry.relativePath)) continue
    try {
      const lines = (await window.electronAPI.readFile(entry.relativePath)).split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        if (out.length >= limit) return
        if (lines[index].toLowerCase().includes(needle)) {
          out.push({
            file: entry.relativePath,
            line: index + 1,
            preview: lines[index].trim().slice(0, 220),
            knowledgeBase
          })
        }
      }
    } catch {
      // Skip unreadable text-like files.
    }
  }
}

async function collectTextFilesInDirectory(relativeDir: string, out: ProjectEntry[], limit: number): Promise<void> {
  if (out.length >= limit) return
  let listing
  try {
    listing = await window.electronAPI.listDirectory(relativeDir)
  } catch {
    return
  }

  for (const entry of listing.entries) {
    if (out.length >= limit) return
    if (entry.type === 'directory') {
      await collectTextFilesInDirectory(entry.relativePath, out, limit)
      continue
    }
    if (isEditableTextPath(entry.relativePath)) out.push(entry)
  }
}

async function collectProjectTextFiles(limit = 600): Promise<ProjectEntry[]> {
  const files: ProjectEntry[] = []
  for (const dir of toolboxExportDirs) {
    await collectTextFilesInDirectory(dir, files, limit)
  }
  return files
}

function parentDirFor(section: ProjectSection, currentDir: string, rootDir = section.dir): string {
  const normalized = currentDir.replace(/\\/g, '/')
  const normalizedRoot = rootDir.replace(/\\/g, '/')
  if (normalized === normalizedRoot) return normalizedRoot
  const parent = normalized.split('/').slice(0, -1).join('/')
  return parent && (parent === normalizedRoot || parent.startsWith(`${normalizedRoot}/`)) ? parent : normalizedRoot
}

export function ProjectExplorer({ isSidebarCollapsed = false, onToggleSidebar }: ProjectExplorerProps) {
  const { message, modal } = AntApp.useApp()
  const smartContextRunRef = useRef(0)
  const projectRoot = useAppStore((state) => state.projectRoot)
  const setProjectRoot = useAppStore((state) => state.setProjectRoot)
  const openProjectById = useAppStore((state) => state.openProjectById)
  const refreshDirectory = useAppStore((state) => state.refreshDirectory)
  const openProjectFile = useAppStore((state) => state.openProjectFile)
  const editorDirty = useAppStore((state) => state.editorDirty)
  const saveActiveFile = useAppStore((state) => state.saveActiveFile)
  const setDraft = useAppStore((state) => state.setDraft)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const isRunning = useAppStore((state) => state.isRunning)
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [projectManagerOpen, setProjectManagerOpen] = useState(false)
  const [railDirectoryOpen, setRailDirectoryOpen] = useState(false)
  const [activeSectionShortcut, setActiveSectionShortcut] = useState('all')
  const [projectCreating, setProjectCreating] = useState(false)
  const [projectCreateDraft, setProjectCreateDraft] = useState({
    name: '新小说项目',
    parentPath: '',
    projectType: 'basic' as ProjectTemplateType
  })
  const [rootDraft, setRootDraft] = useState(projectRoot)
  const [activeNav, setActiveNav] = useState<NavLabel>('文件')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ file: string; line: number; preview: string }>>([])
  const [fileSearchResults, setFileSearchResults] = useState<ProjectEntry[]>([])
  const [searchMode, setSearchMode] = useState<SearchMode>('content')
  const [searching, setSearching] = useState(false)
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const [knowledgeSearching, setKnowledgeSearching] = useState(false)
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseEntry[]>([])
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeSearchResult[]>([])
  const [skillEntries, setSkillEntries] = useState<SkillInfo[]>([])
  const [groupEntries, setGroupEntries] = useState<Record<string, ProjectEntry[]>>({})
  const [groupLoading, setGroupLoading] = useState<Record<string, boolean>>({})
  const [sectionDirs, setSectionDirs] = useState<Record<string, string>>(initialSectionDirs)
  const [sectionVisibility, setSectionVisibility] = useState<Record<string, boolean>>(initialSectionVisibility)
  const [sectionOrder, setSectionOrder] = useState<Record<string, number>>(initialSectionOrder)
  const [chapterCharCount, setChapterCharCount] = useState(0)
  const [mcpToolCount, setMcpToolCount] = useState(0)
  const [createDialog, setCreateDialog] = useState<{
    open: boolean
    sectionTitle: string
    baseDir: string
    type: EntryType
    name: string
  }>({ open: false, sectionTitle: '', baseDir: '', type: 'file', name: '' })
  const [renameDialog, setRenameDialog] = useState<{
    open: boolean
    path: string
    name: string
    sectionTitle: string
  }>({
    open: false,
    path: '',
    name: '',
    sectionTitle: ''
  })
  const [moveDialog, setMoveDialog] = useState<{
    open: boolean
    sourcePath: string
    targetPath: string
    sectionTitle: string
  }>({
    open: false,
    sourcePath: '',
    targetPath: '',
    sectionTitle: ''
  })
  const [knowledgeDialog, setKnowledgeDialog] = useState({
    open: false,
    name: '项目知识库',
    path: 'knowledge'
  })
  const [skillImportDialog, setSkillImportDialog] = useState({
    open: false,
    sourcePath: '',
    targetName: ''
  })
  const [helpOpen, setHelpOpen] = useState(false)
  const [projectSettingsDialog, setProjectSettingsDialog] = useState({
    open: false,
    name: '',
    dirs: initialSectionDirs,
    visibility: initialSectionVisibility,
    order: initialSectionOrder
  })
  const [statsDialog, setStatsDialog] = useState({
    open: false,
    loading: false,
    content: ''
  })
  const [toolboxLoading, setToolboxLoading] = useState(false)
  const [exportDialog, setExportDialog] = useState({
    open: false,
    format: 'markdown' as 'markdown' | 'txt' | 'html' | 'pdf' | 'docx' | 'epub',
    scope: 'all' as 'all' | 'chapters',
    includeMeta: true,
    exporting: false,
    lastExportPath: ''
  })
  const [pendingOpenPath, setPendingOpenPath] = useState('')
  const [imageDialog, setImageDialog] = useState({
    open: false,
    mode: 'generate' as 'generate' | 'edit',
    sourcePath: '',
    prompt: '小说封面，精致插画风，高级构图，清晰主体，合作品封面',
    size: '1024x1024',
    generating: false
  })
  const [assetPreviewDialog, setAssetPreviewDialog] = useState({
    open: false,
    loading: false,
    relativePath: '',
    name: '',
    dataUrl: '',
    mime: '',
    size: 0,
    error: ''
  })
  const [importBookDialog, setImportBookDialog] = useState({
    open: false,
    sourcePath: '',
    title: '',
    content: '',
    creating: false
  })
  const [smartContextStatus, setSmartContextStatus] = useState<'idle' | 'collecting' | 'committing'>('idle')
  const [projectDisplayName, setProjectDisplayName] = useState<string>()
  const [chapterStatusMap, setChapterStatusMap] = useState<ChapterStatusMap>({})
  const [backups, setBackups] = useState<ProjectBackupInfo[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(
    Object.fromEntries(sections.map((section) => [section.title, true]))
  )
  const treeScrollRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const projectRootRef = useRef(projectRoot)
  const sectionDirsRef = useRef(sectionDirs)
  const projectName = projectDisplayName || projectNameFromRoot(projectRoot)
  const currentProject = useMemo(
    () => projects.find((project) => sameLocalPath(project.root, projectRoot)),
    [projectRoot, projects]
  )
  const orderedSections = useMemo(
    () =>
      [...sections].sort(
        (left, right) =>
          (sectionOrder[left.title] ?? initialSectionOrder[left.title] ?? 0) -
          (sectionOrder[right.title] ?? initialSectionOrder[right.title] ?? 0)
      ),
    [sectionOrder]
  )
  const visibleSections = useMemo(
    () => orderedSections.filter((section) => sectionVisibility[section.title] !== false),
    [orderedSections, sectionVisibility]
  )

  useEffect(() => {
    projectRootRef.current = projectRoot
  }, [projectRoot])

  useEffect(() => {
    sectionDirsRef.current = sectionDirs
  }, [sectionDirs])

  const loadSection = useCallback(
    async (section: ProjectSection, relativeDir = section.dir): Promise<void> => {
      if (!projectRoot) {
        setGroupEntries((current) => ({ ...current, [section.title]: [] }))
        return
      }

      const requestedRoot = projectRoot
      const requestedDir = relativeDir
      setGroupLoading((current) => ({ ...current, [section.title]: true }))
      try {
        const listing = await window.electronAPI.listDirectory(relativeDir)
        const currentRoot = projectRootRef.current
        const currentDir = sectionDirsRef.current[section.title] ?? section.dir
        if (currentRoot !== requestedRoot || currentDir !== requestedDir) return
        setGroupEntries((current) => ({ ...current, [section.title]: listing.entries }))
      } catch {
        const currentRoot = projectRootRef.current
        const currentDir = sectionDirsRef.current[section.title] ?? section.dir
        if (currentRoot !== requestedRoot || currentDir !== requestedDir) return
        setGroupEntries((current) => ({ ...current, [section.title]: [] }))
      } finally {
        const currentRoot = projectRootRef.current
        const currentDir = sectionDirsRef.current[section.title] ?? section.dir
        if (currentRoot === requestedRoot && currentDir === requestedDir) {
          setGroupLoading((current) => ({ ...current, [section.title]: false }))
        }
      }
    },
    [projectRoot]
  )

  const refreshChapterStats = useCallback(async (relativeDir?: string): Promise<void> => {
    if (!projectRoot) {
      setChapterCharCount(0)
      return
    }
    const requestedRoot = projectRoot
    const requestedDir = relativeDir ?? sectionDirs[chapterSectionTitle] ?? 'chapters'
    const total = await countTextCharsInDirectory(requestedDir)
    const currentDir = sectionDirsRef.current[chapterSectionTitle] ?? 'chapters'
    if (projectRootRef.current === requestedRoot && currentDir === requestedDir) {
      setChapterCharCount(total)
    }
  }, [projectRoot, sectionDirs])

  const refreshMcpStatus = useCallback(async (): Promise<void> => {
    try {
      const tools = await window.electronAPI.listMcpTools()
      setMcpToolCount(tools.length)
    } catch {
      setMcpToolCount(0)
    }
  }, [])

  const refreshProjectList = useCallback(async (): Promise<ProjectInfo[]> => {
    const list = await window.electronAPI.getProjects()
    setProjects(list)
    return list
  }, [])

  const ensureCanSwitchProject = useCallback(async (): Promise<boolean> => {
    if (!editorDirty) return true
    return new Promise<boolean>((resolve) => {
      modal.confirm({
        title: '当前文件有未保存修改',
        content: '切换项目会关闭当前编辑内容要先保存后切换吗？',
        okText: '保存并切换',
        cancelText: '取消',
        centered: true,
        onOk: async () => {
          const saved = await saveActiveFile()
          resolve(saved)
          if (!saved) throw new Error('save failed')
        },
        onCancel: () => resolve(false)
      })
    })
  }, [editorDirty, modal, saveActiveFile])

  const openProjectManager = useCallback(() => {
    void refreshProjectList()
    setProjectCreateDraft((current) => ({
      ...current,
      parentPath: current.parentPath || (projectRoot ? dirname(projectRoot) : '')
    }))
    setProjectManagerOpen(true)
  }, [projectRoot, refreshProjectList])

  const chooseProjectParent = async (): Promise<void> => {
    const result = await window.electronAPI.selectDirectory(projectCreateDraft.parentPath || projectRoot || undefined)
    if (result?.path) {
      setProjectCreateDraft((current) => ({ ...current, parentPath: result.path }))
    }
  }

  const openExistingProject = async (): Promise<void> => {
    const result = await window.electronAPI.selectDirectory(projectRoot || projectCreateDraft.parentPath || undefined)
    if (!result?.path) return
    const canSwitch = await ensureCanSwitchProject()
    if (!canSwitch) return

    try {
      await setProjectRoot(result.path)
      setRootDraft(result.path)
      await refreshProjectList()
      setProjectManagerOpen(false)
      message.success(`已打开项目：${basename(result.path) || result.path}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开已有项目失败')
    }
  }

  const createProject = async (): Promise<void> => {
    const name = projectCreateDraft.name.trim()
    if (!name) {
      message.error('项目名称不能为空')
      return
    }
    if (!projectCreateDraft.parentPath.trim()) {
      message.error('请选择项目父目录')
      return
    }
    const canSwitch = await ensureCanSwitchProject()
    if (!canSwitch) return
    setProjectCreating(true)
    try {
      const project = await window.electronAPI.createProject({
        name,
        parentPath: projectCreateDraft.parentPath,
        projectType: projectCreateDraft.projectType,
        language: 'zh'
      })
      await setProjectRoot(project.root)
      setRootDraft(project.root)
      await refreshProjectList()
      setProjectManagerOpen(false)
      message.success(`项目已创建：${project.name}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建项目失败')
    } finally {
      setProjectCreating(false)
    }
  }

  const switchProject = async (project: ProjectInfo): Promise<void> => {
    if (sameLocalPath(project.root, projectRoot)) {
      setProjectManagerOpen(false)
      return
    }
    const canSwitch = await ensureCanSwitchProject()
    if (!canSwitch) return
    try {
      await openProjectById(project.id)
      setRootDraft(project.root)
      await refreshProjectList()
      setProjectManagerOpen(false)
      message.success(`已打开项目 ${project.name}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开项目失败')
    }
  }

  const renameProject = async (project: ProjectInfo): Promise<void> => {
    let nextName = project.name
    modal.confirm({
      title: '重命名项目',
      content: (
        <Input
          defaultValue={project.name}
          onChange={(event) => {
            nextName = event.target.value
          }}
          placeholder="项目名称"
        />
      ),
      okText: '保存',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        const renamed = await window.electronAPI.renameProject(project.id, nextName)
        await refreshProjectList()
        if (sameLocalPath(renamed.root, projectRoot)) {
          setProjectDisplayName(renamed.name)
        }
        message.success('项目名称已更新')
      }
    })
  }

  const deleteProject = async (project: ProjectInfo): Promise<void> => {
    let deleteFiles = false
    modal.confirm({
      title: '删除项目',
      content: (
        <div className="modal-form-stack">
          <p>{project.name}</p>
          <small className="settings-muted">{project.root}</small>
          <label className="settings-inline-label">
            <input
              type="checkbox"
              onChange={(event) => {
                deleteFiles = event.target.checked
              }}
            />
            <span>同时删除磁盘项目目录</span>
          </label>
        </div>
      ),
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        if (sameLocalPath(project.root, projectRoot)) {
          const canSwitch = await ensureCanSwitchProject()
          if (!canSwitch) throw new Error('cancelled')
        }
        const result = await window.electronAPI.deleteProject(project.id, deleteFiles)
        await refreshProjectList()
        if (sameLocalPath(project.root, projectRoot)) {
          await setProjectRoot('')
          setRootDraft('')
        }
        message.success(result.filesDeleted ? '项目目录已删除' : '项目已从列表移除')
      }
    })
  }

  const refreshProjectMetadata = useCallback(async (): Promise<void> => {
    try {
      const raw = await window.electronAPI.readFile('.wangyang/project.json')
      const parsed = JSON.parse(raw) as { name?: unknown }
      setProjectDisplayName(typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : undefined)
    } catch {
      setProjectDisplayName(undefined)
    }
  }, [])

  const refreshChapterStatus = useCallback(async (): Promise<void> => {
    try {
      const raw = await window.electronAPI.readFile('.wangyang/chapter-status.json')
      const parsed = JSON.parse(raw) as ChapterStatusMap
      setChapterStatusMap(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {})
    } catch {
      setChapterStatusMap({})
    }
  }, [])

  const refreshSectionDirs = useCallback(async (): Promise<void> => {
    try {
      const raw = await window.electronAPI.readFile(sectionDirsConfigPath)
      const parsed = JSON.parse(raw) as Record<string, string>
      const next = {
        ...initialSectionDirs,
        ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {})
      }
      setSectionDirs((current) => (sameStringRecord(current, next) ? current : next))
    } catch {
      setSectionDirs((current) => (sameStringRecord(current, initialSectionDirs) ? current : initialSectionDirs))
    }
  }, [])

  const refreshSectionLayout = useCallback(async (): Promise<void> => {
    try {
      const raw = await window.electronAPI.readFile(sectionLayoutConfigPath)
      const parsed = JSON.parse(raw) as { visibility?: Record<string, boolean>; order?: Record<string, number> }
      setSectionVisibility({ ...initialSectionVisibility, ...(parsed.visibility ?? {}) })
      setSectionOrder({ ...initialSectionOrder, ...(parsed.order ?? {}) })
    } catch {
      setSectionVisibility(initialSectionVisibility)
      setSectionOrder(initialSectionOrder)
    }
  }, [])

  const refreshKnowledgeBases = useCallback(async (): Promise<KnowledgeBaseEntry[]> => {
    try {
      const raw = await window.electronAPI.readFile(knowledgeConfigPath)
      const parsed = JSON.parse(raw) as KnowledgeBaseEntry[]
      const entries = Array.isArray(parsed)
        ? parsed.filter((entry) => entry && typeof entry.name === 'string' && typeof entry.path === 'string')
        : []
      setKnowledgeBases(entries)
      return entries
    } catch {
      setKnowledgeBases([])
      return []
    }
  }, [])

  const saveKnowledgeBases = async (entries: KnowledgeBaseEntry[]): Promise<void> => {
    await window.electronAPI.writeFile(knowledgeConfigPath, `${JSON.stringify(entries, null, 2)}\n`)
    setKnowledgeBases(entries)
  }

  const ensureDefaultKnowledgeBase = async (): Promise<KnowledgeBaseEntry[]> => {
    const current = knowledgeBases.length ? knowledgeBases : await refreshKnowledgeBases()
    const existing = current.find((entry) => entry.path === 'knowledge')
    if (existing) return current
    await window.electronAPI.createEntry('knowledge', 'directory').catch(() => undefined)
    const now = Date.now()
    const next = [
      ...current,
      { id: `kb_${now}`, name: '项目知识库', path: 'knowledge', enabled: true, createdAt: now, updatedAt: now }
    ]
    await saveKnowledgeBases(next)
    return next
  }

  const submitKnowledgeBase = async (): Promise<void> => {
    const name = knowledgeDialog.name.trim()
    const path = normalizeRelativePath(knowledgeDialog.path)
    const pathError = validateRelativePath(path)
    if (!name) {
      message.error('知识库名称不能为空')
      return
    }
    if (pathError) {
      message.error(pathError)
      return
    }
    await window.electronAPI.createEntry(path, 'directory').catch(() => undefined)
    const now = Date.now()
    const current = knowledgeBases.length ? knowledgeBases : await refreshKnowledgeBases()
    const next = [
      { id: `kb_${now}`, name, path, enabled: true, createdAt: now, updatedAt: now },
      ...current.filter((entry) => entry.path !== path)
    ]
    await saveKnowledgeBases(next)
    setKnowledgeDialog({ open: false, name: '项目知识库', path: 'knowledge' })
    message.success('知识库已添加')
  }

  const toggleKnowledgeBase = async (id: string): Promise<void> => {
    const next = knowledgeBases.map((entry) =>
      entry.id === id ? { ...entry, enabled: !entry.enabled, updatedAt: Date.now() } : entry
    )
    await saveKnowledgeBases(next)
  }

  const searchKnowledgeBases = async (): Promise<void> => {
    const query = knowledgeQuery.trim()
    if (!query) {
      message.warning('请输入知识库搜索关键词')
      return
    }
    setKnowledgeSearching(true)
    try {
      const configured = knowledgeBases.length ? knowledgeBases : await refreshKnowledgeBases()
      const enabled = configured.filter((entry) => entry.enabled)
      const dirs = configured.length
        ? enabled.map((entry) => ({ path: entry.path, name: entry.name }))
        : fallbackKnowledgeDirs.map((path) => ({ path, name: path }))
      const results: KnowledgeSearchResult[] = []
      for (const dir of dirs) {
        await searchTextInDirectory(dir.path, query, dir.name, results, 80)
      }
      setKnowledgeResults(results)
    } finally {
      setKnowledgeSearching(false)
    }
  }

  useEffect(() => {
    setRootDraft(projectRoot)
  }, [projectRoot])

  useEffect(() => {
    void refreshProjectList()
  }, [projectRoot, refreshProjectList])

  useEffect(() => {
    if (activeNav !== '文件') return
    void Promise.all(visibleSections.map((section) => loadSection(section, sectionDirs[section.title] ?? section.dir)))
  }, [activeNav, loadSection, projectRoot, sectionDirs, visibleSections])

  useEffect(() => {
    void refreshChapterStats()
    void refreshMcpStatus()
    void refreshProjectMetadata()
    void refreshChapterStatus()
    void refreshSectionDirs()
    void refreshSectionLayout()
    void refreshKnowledgeBases()
  }, [projectRoot, refreshChapterStats, refreshChapterStatus, refreshKnowledgeBases, refreshMcpStatus, refreshProjectMetadata, refreshSectionDirs, refreshSectionLayout])

  useEffect(() => {
    if (activeNav !== '知识') return
    void refreshKnowledgeBases()
  }, [activeNav, refreshKnowledgeBases])

  useEffect(() => {
    if (activeNav !== '技能') return
    void refreshSkills()
  }, [activeNav])

  const refreshAllSections = async (): Promise<void> => {
    await Promise.all(visibleSections.map((section) => loadSection(section, sectionDirs[section.title] ?? section.dir)))
    await refreshChapterStats()
    await refreshMcpStatus()
    await refreshProjectMetadata()
    await refreshChapterStatus()
    await refreshKnowledgeBases()
  }

  const setAllSectionsExpanded = (expanded: boolean): void => {
    const next = Object.fromEntries(visibleSections.map((section) => [section.title, expanded]))
    setExpandedSections((current) => ({ ...current, ...next }))
    if (expanded) {
      void Promise.all(visibleSections.map((section) => loadSection(section, sectionDirs[section.title] ?? section.dir)))
    }
  }

  const jumpToAllProjectSections = (): void => {
    setActiveNav('文件')
    setActiveSectionShortcut('all')
    setAllSectionsExpanded(true)
    window.setTimeout(() => {
      if (treeScrollRef.current) treeScrollRef.current.scrollTop = 0
    }, 0)
  }

  const jumpToProjectSection = (section: ProjectSection): void => {
    setActiveNav('文件')
    setActiveSectionShortcut(section.title)
    setExpandedSections((current) => ({ ...current, [section.title]: true }))
    void loadSection(section, sectionDirs[section.title] ?? section.dir)
    window.setTimeout(() => {
      sectionRefs.current[section.title]?.scrollIntoView({ block: 'start' })
    }, 0)
  }

  const toggleGroupShortcutRail = (): void => {
    const nextOpen = !railDirectoryOpen
    setActiveNav('文件')
    setRailDirectoryOpen(nextOpen)
    if (nextOpen) {
      setActiveSectionShortcut('all')
      setAllSectionsExpanded(true)
    }
  }

  const toggleProjectSidebar = (): void => {
    if (!isSidebarCollapsed) {
      setRailDirectoryOpen(false)
    }
    onToggleSidebar?.()
  }

  const loadSectionByTitle = async (title: string, relativeDir?: string): Promise<void> => {
    const section = sections.find((candidate) => candidate.title === title)
    if (!section) return
    await loadSection(section, relativeDir ?? sectionDirs[title] ?? section.dir)
    if (title === chapterSectionTitle) await refreshChapterStats(relativeDir ?? sectionDirs[title] ?? 'chapters')
  }

  const changeSectionDir = async (section: ProjectSection, relativeDir: string): Promise<void> => {
    setSectionDirs((current) => ({ ...current, [section.title]: relativeDir }))
    await loadSection(section, relativeDir)
  }

  const toggleSection = (section: ProjectSection): void => {
    setExpandedSections((current) => {
      const expanded = !current[section.title]
      if (expanded) {
        void loadSection(section, sectionDirs[section.title] ?? section.dir)
      }
      return { ...current, [section.title]: expanded }
    })
  }

  const draftAction = (text: string, autoSend = false): void => {
    setDraft(text)
    if (!autoSend) return
    if (isRunning) {
      message.warning('智能体正在运行，已先写入输入框')
      return
    }
    window.setTimeout(() => {
      void sendMessage(undefined, undefined, { draftOverride: text })
    }, 0)
  }

  const openProjectFolder = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openProjectFolder()
      if (result.error) message.error(result.error)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开项目文件夹失败')
    }
  }

  const startFullTextQa = (): void => {
    setActiveNav('搜索')
    setSearchMode('ask')
    setSearchQuery('')
    draftAction('请基于项目全文回答我的问题。请先按需读取项目规则、大纲、章节、角色和设定，再给出有引用依据的回答。')
  }

  const startPureChat = (): void => {
    draftAction('请进入纯聊天模式：暂时不要读取项目文件，也不要调用工具。先只和我讨论想法，等我明确要求时再接入项目上下文。')
  }

  const startSmartNaming = (): void => {
    draftAction('请为当前项目做智能命名：先列出需要命名或命名不规范的章节、角色、设定和资产文件，再给出统一命名方案；如需要重命名，请先列计划，等待我确认。', true)
  }

  const openNavMorePanel = (): void => {
    if (activeNav === '文件') {
      openProjectSettings()
      return
    }
    if (activeNav === '搜索') {
      setSearchMode('content')
      message.info('已切换到内容搜索')
      return
    }
    if (activeNav === '快照') {
      void refreshBackups()
      return
    }
    if (activeNav === '知识') {
      setKnowledgeDialog({ open: true, name: '项目知识库', path: 'knowledge' })
      return
    }
    if (activeNav === '技能') {
      setSkillImportDialog({ open: true, sourcePath: '', targetName: '' })
      return
    }
    if (activeNav === '百宝箱') {
      openExportDialog()
      return
    }
    if (activeNav === '智能') {
      draftAction('请通过提问的方式帮我完成小说开篇设计，包括核心卖点、主角、开场冲突、前三章目标和创作规则。', true)
      message.info('已写入智能开篇任务')
      return
    }
    message.info('请选择一个具体操作')
  }

  const openProjectSettings = (): void => {
    setProjectSettingsDialog({
      open: true,
      name: projectDisplayName || projectNameFromRoot(projectRoot),
      dirs: { ...sectionDirs },
      visibility: { ...sectionVisibility },
      order: { ...sectionOrder }
    })
  }

  const setProjectSectionOrder = (sectionTitle: string, direction: -1 | 1): void => {
    setProjectSettingsDialog((current) => {
      const ordered = [...sections].sort(
        (left, right) =>
          (current.order[left.title] ?? initialSectionOrder[left.title] ?? 0) -
          (current.order[right.title] ?? initialSectionOrder[right.title] ?? 0)
      )
      const index = ordered.findIndex((section) => section.title === sectionTitle)
      const swapIndex = index + direction
      if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return current
      const nextOrder = { ...current.order }
      ordered.forEach((section, itemIndex) => {
        nextOrder[section.title] = itemIndex
      })
      const currentValue = nextOrder[ordered[index].title]
      nextOrder[ordered[index].title] = nextOrder[ordered[swapIndex].title]
      nextOrder[ordered[swapIndex].title] = currentValue
      return { ...current, order: nextOrder }
    })
  }

  const submitProjectSettings = async (): Promise<void> => {
    const name = projectSettingsDialog.name.trim()
    if (!name) {
      message.warning('项目名称不能为空')
      return
    }
    for (const [sectionTitle, dir] of Object.entries(projectSettingsDialog.dirs)) {
      const validationError = validateRelativePath(dir)
      if (validationError) {
        message.warning(`${sectionTitle}: ${validationError}`)
        return
      }
    }
    try {
      await window.electronAPI.writeFile(
        '.wangyang/project.json',
        `${JSON.stringify({ name, updatedAt: Date.now() }, null, 2)}\n`
      )
      await window.electronAPI.writeFile(sectionDirsConfigPath, `${JSON.stringify(projectSettingsDialog.dirs, null, 2)}\n`)
      await window.electronAPI.writeFile(
        sectionLayoutConfigPath,
        `${JSON.stringify({ visibility: projectSettingsDialog.visibility, order: projectSettingsDialog.order }, null, 2)}\n`
      )
      setProjectDisplayName(name)
      setSectionDirs(projectSettingsDialog.dirs)
      setSectionVisibility(projectSettingsDialog.visibility)
      setSectionOrder(projectSettingsDialog.order)
      setProjectSettingsDialog((current) => ({ ...current, open: false }))
      const nextVisibleSections = [...sections]
        .sort(
          (left, right) =>
            (projectSettingsDialog.order[left.title] ?? initialSectionOrder[left.title] ?? 0) -
            (projectSettingsDialog.order[right.title] ?? initialSectionOrder[right.title] ?? 0)
        )
        .filter((section) => projectSettingsDialog.visibility[section.title] !== false)
      await Promise.all(nextVisibleSections.map((section) => loadSection(section, projectSettingsDialog.dirs[section.title] ?? section.dir)))
      await refreshChapterStats(projectSettingsDialog.dirs[chapterSectionTitle] ?? 'chapters')
      message.success('项目设置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '项目设置保存失败')
    }
  }

  const requestOpenProjectFile = (relativePath: string): void => {
    if (editorDirty) {
      setPendingOpenPath(relativePath)
      return
    }
    void openProjectFile(relativePath)
  }

  const saveAndOpenPendingFile = async (): Promise<void> => {
    if (!pendingOpenPath) return
    const saved = await saveActiveFile()
    if (!saved) {
      message.error('保存失败，未切换文件')
      return
    }
    const nextPath = pendingOpenPath
    setPendingOpenPath('')
    await openProjectFile(nextPath, { force: true })
  }

  const discardAndOpenPendingFile = async (): Promise<void> => {
    if (!pendingOpenPath) return
    const nextPath = pendingOpenPath
    setPendingOpenPath('')
    await openProjectFile(nextPath, { force: true })
  }

  const openCreate = (section: ProjectSection, type: EntryType) => {
    const baseDir = sectionDirs[section.title] ?? section.dir
    const defaults = sectionDefaults[section.title] ?? sectionDefaults.其他
    setExpandedSections((current) => ({ ...current, [section.title]: true }))
    setCreateDialog({
      open: true,
      sectionTitle: section.title,
      baseDir,
      type,
      name: type === 'file' ? defaults.file : defaults.directory
    })
  }

  const submitCreate = async () => {
    const name = createDialog.name.trim()
    const validationError = validateEntryName(name)
    if (validationError) {
      message.warning(validationError)
      return
    }
    const normalizedName = createDialog.type === 'file' && !name.includes('.') ? `${name}.md` : name
    const relativePath = `${createDialog.baseDir}/${normalizedName}`.replace(/\\/g, '/')
    try {
      const content = createDialog.type === 'file' ? sectionTemplate(createDialog.sectionTitle, normalizedName) : undefined
      const created = await window.electronAPI.createEntry(relativePath, createDialog.type, content)
      setCreateDialog((current) => ({ ...current, open: false }))
      await loadSectionByTitle(createDialog.sectionTitle, createDialog.baseDir)
      if (created.type === 'file') requestOpenProjectFile(created.relativePath)
      message.success('已创建')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建失败')
    }
  }

  const submitRename = async () => {
    const name = renameDialog.name.trim()
    const validationError = validateEntryName(name)
    if (validationError) {
      message.warning(validationError)
      return
    }
    try {
      await window.electronAPI.renameEntry(renameDialog.path, name)
      const sectionTitle = renameDialog.sectionTitle
      setRenameDialog({ open: false, path: '', name: '', sectionTitle: '' })
      await loadSectionByTitle(sectionTitle)
      message.success('已重命名')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重命名失败')
    }
  }

  const deleteEntry = (sectionTitle: string, relativePath: string) => {
    modal.confirm({
      title: '删除确认',
      content: `Delete ${relativePath}? This cannot be undone.`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.electronAPI.deleteEntry(relativePath)
        await loadSectionByTitle(sectionTitle)
        message.success('已删除')
      }
    })
  }

  const submitMove = async (): Promise<void> => {
    const targetPath = moveDialog.targetPath.trim().replace(/\\/g, '/')
    if (!targetPath || targetPath.includes('..')) {
      message.warning('目标路径不能为空，也不能包含 ..')
      return
    }
    if (targetPath === moveDialog.sourcePath) {
      setMoveDialog({ open: false, sourcePath: '', targetPath: '', sectionTitle: '' })
      return
    }

    try {
      await window.electronAPI.moveEntry(moveDialog.sourcePath, targetPath)
      const sectionTitle = moveDialog.sectionTitle
      setMoveDialog({ open: false, sourcePath: '', targetPath: '', sectionTitle: '' })
      await refreshAllSections()
      if (
        sectionTitle === chapterSectionTitle ||
        targetPath.startsWith(`${sectionDirs[chapterSectionTitle] ?? 'chapters'}/`)
      ) await refreshChapterStats()
      message.success('已移动')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移动失败')
    }
  }

  const archiveEntry = (sectionTitle: string, relativePath: string) => {
    const targetPath = `.wangyang/archive/${sectionTitle}/${basename(relativePath)}`
    modal.confirm({
      title: '归档确认',
      content: `Delete ${relativePath}? This cannot be undone.`,
      okText: '归档',
      cancelText: '取消',
      onOk: async () => {
        await window.electronAPI.moveEntry(relativePath, targetPath)
        await refreshAllSections()
        if (sectionTitle === chapterSectionTitle) await refreshChapterStats()
        message.success('已归档')
      }
    })
  }

  const createGeneratedSectionFile = async (
    sectionTitle: string,
    baseDir: string,
    fileName: string,
    content: string
  ): Promise<ProjectEntry | undefined> => {
    const relativePath = `${baseDir}/${fileName}`.replace(/\\/g, '/')
    try {
      const created = await window.electronAPI.createEntry(relativePath, 'file', content)
      await loadSectionByTitle(sectionTitle, baseDir)
      requestOpenProjectFile(created.relativePath)
      message.success('已生成')
      return created
    } catch (error) {
      message.error(error instanceof Error ? error.message : '生成失败')
      return undefined
    }
  }

  const openImportBookDialog = (): void => {
    setImportBookDialog({
      open: true,
      sourcePath: '',
      title: '',
      content: '',
      creating: false
    })
  }

  const chooseImportBookFile = async (): Promise<void> => {
    try {
      const selected = await window.electronAPI.openTextFile()
      if (!selected) return
      const title = selected.name.replace(/\.(txt|md|markdown|html?|htm)$/i, '')
      setImportBookDialog((current) => ({
        ...current,
        open: true,
        sourcePath: selected.path,
        title: current.title.trim() || title,
        content: selected.content
      }))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取导入文件失败')
    }
  }

  const submitImportBook = async (): Promise<void> => {
    const chapters = splitBookContent(importBookDialog.content)
    if (!chapters.length) {
      message.warning('请粘贴要导入的小说正文')
      return
    }
    const baseDir = sectionDirs.章节 ?? 'chapters'
    const batch = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
    setImportBookDialog((current) => ({ ...current, creating: true }))
    try {
      for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index]
        const title = chapter.title.trim() || `章节 ${index + 1}`
        const fileName = safeImportFileName(title, index)
        const relativePath = `${baseDir}/${batch}-${fileName}`.replace(/\\/g, '/')
        const content = `# ${title}\n\n${chapter.body.trim()}\n`
        await window.electronAPI.createEntry(relativePath, 'file', content)
      }
      await loadSectionByTitle('章节', baseDir)
      setImportBookDialog((current) => ({ ...current, open: false, creating: false }))
      message.success(`Imported ${chapters.length} chapters`)
    } catch (error) {
      setImportBookDialog((current) => ({ ...current, creating: false }))
      message.error(error instanceof Error ? error.message : '导入全本失败')
    }
  }

  const createSmartContextFile = async (): Promise<void> => {
    if (smartContextStatus !== 'idle') return
    const runId = smartContextRunRef.current + 1
    smartContextRunRef.current = runId
    setSmartContextStatus('collecting')
    let draft: SmartContextGenerationResult
    try {
      draft = await window.electronAPI.generateSmartContext(40)
    } catch (error) {
      if (smartContextRunRef.current === runId) {
        await window.electronAPI.writeFile(
          '.wangyang/smart-context-state.json',
          `${JSON.stringify({ status: 'error', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() }, null, 2)}\n`
        )
        setSmartContextStatus('idle')
      }
      message.error(error instanceof Error ? error.message : '智能上下文生成失败')
      return
    }

    if (smartContextRunRef.current !== runId) {
      return
    }

    setSmartContextStatus('committing')
    const collectedFiles =
      draft.files.map((file) => `- ${file.path}: ${file.chars} chars, hash: ${file.hash.slice(0, 12)}`).join('\n') ||
      '- 暂无可收集文件'
    try {
      const created = await createGeneratedSectionFile(
        '记录',
        sectionDirs.记录 ?? 'records',
        timestampName('智能上下文'),
        `# Smart Context\n\nCreated: ${todayLabel()}\nProject: ${draft.projectName}\nModel: ${draft.model}\n\n## Files\n\n${collectedFiles}\n\n## Content\n\n${draft.content || '(empty)'}\n\n## Prompt\n\n${draft.prompt}\n`
      )
      if (smartContextRunRef.current !== runId) {
        return
      }
      if (!created) {
        await window.electronAPI.writeFile(
          '.wangyang/smart-context-state.json',
          `${JSON.stringify({ status: 'error', projectName: draft.projectName, files: draft.files, updatedAt: Date.now() }, null, 2)}\n`
        )
        return
      }
      const state = {
        status: 'ready',
        projectName: draft.projectName,
        files: draft.files,
        recordPath: created.relativePath,
        model: draft.model,
        updatedAt: draft.createdAt
      }
      await window.electronAPI.writeFile('.wangyang/smart-context-state.json', `${JSON.stringify(state, null, 2)}\n`)
      if (created) {
        setDraft(`Smart context generated: ${created.relativePath}`)
      }
    } catch (error) {
      await window.electronAPI.writeFile(
        '.wangyang/smart-context-state.json',
        `${JSON.stringify({ status: 'error', projectName: draft.projectName, files: draft.files, updatedAt: Date.now() }, null, 2)}\n`
      )
      message.error(error instanceof Error ? error.message : '智能上下文状态写入失败')
    } finally {
      if (smartContextRunRef.current === runId) setSmartContextStatus('idle')
    }
  }

  const cancelSmartContextFile = (): void => {
    smartContextRunRef.current += 1
    setSmartContextStatus('idle')
    void window.electronAPI.writeFile(
      '.wangyang/smart-context-state.json',
      `${JSON.stringify({ status: 'canceled', updatedAt: Date.now() }, null, 2)}\n`
    )
    message.info('已取消本次智能上下文生成')
  }

  const createCoverBriefFile = async (): Promise<void> => {
    await createGeneratedSectionFile(
      '资产',
      sectionDirs.资产 ?? 'assets',
      timestampName('封面需求'),
      `# 封面需求\n\n创建日期：${todayLabel()}\n\n## 作品名称\n\n## 类型与基调\n\n## 主视觉\n\n## 角色/场景元素\n\n## 色彩与字体\n\n## 禁止事项\n\n## 可交给智能体的生成提示\n\n请根据以上封面需求，生成一张适合小说的封面图。\n`
    )
  }

  const openImageDialog = (mode: 'generate' | 'edit' = 'generate', sourcePath = ''): void => {
    setImageDialog({
      open: true,
      mode,
      sourcePath,
      prompt: '小说封面，精致插画风，高级构图，清晰主体，合作品封面',
      size: '1024x1024',
      generating: false
    })
  }

  const openAssetPreview = async (entry: ProjectEntry): Promise<void> => {
    setAssetPreviewDialog({
      open: true,
      loading: isImagePath(entry.relativePath),
      relativePath: entry.relativePath,
      name: entry.name,
      dataUrl: '',
      mime: '',
      size: entry.size ?? 0,
      error: ''
    })
    if (!isImagePath(entry.relativePath)) return
    try {
      const preview = await window.electronAPI.readProjectFileDataUrl(entry.relativePath)
      setAssetPreviewDialog((current) =>
        current.relativePath === entry.relativePath
          ? { ...current, loading: false, dataUrl: preview.dataUrl, mime: preview.mime, size: preview.size, error: '' }
          : current
      )
    } catch (error) {
      setAssetPreviewDialog((current) =>
        current.relativePath === entry.relativePath
          ? { ...current, loading: false, error: error instanceof Error ? error.message : '预览失败' }
          : current
      )
    }
  }

  const openAssetExternal = async (relativePath: string): Promise<void> => {
    const result = await window.electronAPI.openProjectPathExternal(relativePath)
    if (result.error) message.error(result.error)
  }

  const revealAssetInFolder = async (relativePath: string): Promise<void> => {
    await window.electronAPI.showProjectPathInFolder(relativePath)
  }

  const copyAssetPath = async (relativePath: string): Promise<void> => {
    await navigator.clipboard.writeText(relativePath)
    message.success('已复制项目相对路径')
  }

  const submitGenerateImage = async (): Promise<void> => {
    const prompt = imageDialog.prompt.trim()
    const sourcePath = imageDialog.sourcePath.trim()
    if (!prompt) {
      message.warning('请输入图片提示词')
      return
    }
    if (imageDialog.mode === 'edit' && !sourcePath) {
      message.warning('请输入要编辑的项目内图片路径')
      return
    }
    setImageDialog((current) => ({ ...current, generating: true }))
    try {
      const result =
        imageDialog.mode === 'edit'
          ? await window.electronAPI.editImage(sourcePath, prompt, imageDialog.size)
          : await window.electronAPI.generateImage(prompt, imageDialog.size)
      await loadSectionByTitle('资产', sectionDirs.资产 ?? 'assets')
      requestOpenProjectFile(result.manifestPath)
      setImageDialog((current) => ({ ...current, open: false, generating: false }))
      message.success(`已生成图片：${result.relativePath}`)
    } catch (error) {
      setImageDialog((current) => ({ ...current, generating: false }))
      message.error(error instanceof Error ? error.message : '图片生成失败')
    }
  }

  const performSearch = async (): Promise<void> => {
    const query = searchQuery.trim()
    if (!query) return

    if (searchMode === 'ask') {
      draftAction(`请基于项目全文回答这个问题：${query}`, true)
      message.success(isRunning ? '已写入智能体输入框' : '已发送全文问答任务')
      return
    }

    setSearching(true)
    try {
      if (searchMode === 'file') {
        const results = await window.electronAPI.searchFiles(query, 120)
        setFileSearchResults(results)
      } else {
        const results = await window.electronAPI.searchInFiles(query, 80)
        setSearchResults(results)
      }
    } finally {
      setSearching(false)
    }
  }

  const refreshBackups = async (): Promise<void> => {
    setBackupsLoading(true)
    try {
      setBackups(await window.electronAPI.listBackups())
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取备份历史失败')
    } finally {
      setBackupsLoading(false)
    }
  }

  const createBackup = async (): Promise<void> => {
    setBackupsLoading(true)
    try {
      const backup = await window.electronAPI.createBackup()
      setBackups((current) => [backup, ...current.filter((item) => item.id !== backup.id)])
      message.success('本地快照已创建')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建本地快照失败')
    } finally {
      setBackupsLoading(false)
    }
  }

  const refreshSkills = async (): Promise<void> => {
    try {
      setSkillEntries(await window.electronAPI.listSkills())
    } catch {
      setSkillEntries([])
    }
  }

  const createProjectSkill = async (): Promise<void> => {
    const skillName = timestampName('新技能').replace(/\.md$/i, '')
    try {
      const created = await window.electronAPI.createSkill(skillName, sectionTemplate('技能', `${skillName}.md`))
      await refreshSkills()
      requestOpenProjectFile(created.entryPath)
      message.success('抢能已创建')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建技能失败')
    }
  }

  const deleteProjectSkill = async (entry: SkillInfo): Promise<void> => {
    modal.confirm({
      title: '删除技能',
      content: `Delete project skill "${entry.name}"? This removes the skill directory.`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await window.electronAPI.deleteSkill(entry.name)
        await refreshSkills()
        message.success('抢能已删除')
      }
    })
  }

  const submitImportSkill = async (): Promise<void> => {
    const sourcePath = normalizeRelativePath(skillImportDialog.sourcePath)
    const sourceError = validateRelativePath(sourcePath)
    if (sourceError) {
      message.warning(sourceError)
      return
    }
    const defaultName = basename(sourcePath).replace(/\.md$/i, '')
    const targetName = (skillImportDialog.targetName.trim() || defaultName).replace(/\\/g, '/').replace(/\.md$/i, '')
    const nameError = validateEntryName(targetName)
    if (nameError) {
      message.warning(nameError)
      return
    }
    try {
      const content = await window.electronAPI.readFile(sourcePath)
      const created = await window.electronAPI.createSkill(targetName, content)
      await refreshSkills()
      setSkillImportDialog({ open: false, sourcePath: '', targetName: '' })
      requestOpenProjectFile(created.entryPath)
      message.success('抢能已导入')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入技能失败')
    }
  }

  const openExportDialog = (): void => {
    setExportDialog((current) => ({ ...current, open: true }))
  }

  const exportProjectDocument = async (): Promise<void> => {
    if (toolboxLoading) return
    setToolboxLoading(true)
    setExportDialog((current) => ({ ...current, exporting: true }))
    try {
      const exportDirs =
        exportDialog.scope === 'chapters'
          ? [sectionDirs.章节 ?? 'chapters']
          : exportDialog.includeMeta
            ? sections
                .filter((section) => ['规则', '大纲', '章节', '角色', '设定', '记录', '灵感'].includes(section.title))
                .map((section) => sectionDirs[section.title] ?? section.dir)
            : [sectionDirs.章节 ?? 'chapters']
      const files: ProjectEntry[] = []
      for (const dir of exportDirs) {
        await collectTextFilesInDirectory(dir, files, 600)
      }
      const uniqueFiles = Array.from(new Map(files.map((file) => [file.relativePath, file])).values())
      const rows: Array<{ path: string; content: string }> = []
      for (const file of uniqueFiles) {
        try {
          const content = await window.electronAPI.readFile(file.relativePath)
          rows.push({ path: file.relativePath, content: content.trim() })
        } catch {
          // Skip unreadable files during export.
        }
      }
      const header = `${projectName} 项目导出`
      const exportedAt = new Date().toLocaleString('zh-CN')
      const htmlContent = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(header)}</title>
  <style>body{font-family:"Microsoft YaHei",sans-serif;line-height:1.7;max-width:860px;margin:40px auto;padding:0 24px;color:#1f2933}pre{white-space:pre-wrap;font-family:inherit}hr{border:0;border-top:1px solid #ddd;margin:32px 0}</style>
</head>
<body>
  <h1>${escapeHtml(header)}</h1>
  <p>导出时间：${escapeHtml(exportedAt)} / 文件数：${rows.length}</p>
  ${rows.map((row) => `<hr><h2>${escapeHtml(row.path)}</h2><pre>${escapeHtml(row.content)}</pre>`).join('\n')}
</body>
</html>
`
      const txtContent = [
        header,
        `导出时间：${exportedAt}`,
        `文件数：${rows.length}`,
        '',
        ...rows.flatMap((row) => ['='.repeat(72), row.path, '='.repeat(72), '', row.content, ''])
      ].join('\n')
      const markdownContent = [
        `# ${header}`,
        '',
        `导出时间：${exportedAt}`,
        `文件数：${rows.length}`,
        '',
        ...rows.flatMap((row) => ['---', '', `## ${row.path}`, '', row.content, ''])
      ].join('\n')
      const extension =
        exportDialog.format === 'html'
          ? 'html'
          : exportDialog.format === 'txt'
            ? 'txt'
            : exportDialog.format === 'pdf'
              ? 'pdf'
              : exportDialog.format === 'docx'
                ? 'docx'
                : exportDialog.format === 'epub'
                  ? 'epub'
                : 'md'
      const exportName = timestampName('项目导出').replace(/\.md$/, `.${extension}`)
      const saved =
        exportDialog.format === 'pdf'
          ? await window.electronAPI.savePdfFromHtml(exportName, htmlContent)
          : exportDialog.format === 'docx'
            ? await window.electronAPI.saveBinaryFile(exportName, await buildDocxBase64(header, exportedAt, rows))
            : exportDialog.format === 'epub'
              ? await window.electronAPI.saveBinaryFile(exportName, buildEpubBase64(header, exportedAt, rows))
            : await window.electronAPI.saveTextFile(
                exportName,
                `${exportDialog.format === 'html' ? htmlContent : exportDialog.format === 'txt' ? txtContent : markdownContent}\n`
              )
      if (!saved) {
        message.info('已取消导出')
        return
      }
      await window.electronAPI.showItemInFolder(saved.path)
      setExportDialog((current) => ({ ...current, open: false }))
      setExportDialog((current) => ({ ...current, lastExportPath: saved.path }))
      message.success(`项目文档已导出：${saved.path}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出文档失败')
    } finally {
      setToolboxLoading(false)
      setExportDialog((current) => ({ ...current, exporting: false }))
    }
  }

  const showProjectStats = async (): Promise<void> => {
    setStatsDialog({ open: true, loading: true, content: '' })
    try {
      const sectionRows: string[] = []
      let totalFiles = 0
      let totalChars = 0
      for (const dir of toolboxExportDirs) {
        const files: ProjectEntry[] = []
        await collectTextFilesInDirectory(dir, files, 300)
        let chars = 0
        for (const file of files) {
          try {
            chars += countWritingChars(await window.electronAPI.readFile(file.relativePath))
          } catch {
            // Ignore unreadable files.
          }
        }
        totalFiles += files.length
        totalChars += chars
        sectionRows.push(`| ${dir} | ${files.length} | ${chars} |`)
      }
      setStatsDialog({
        open: true,
        loading: false,
        content: [
          `# ${projectName} 项目统计`,
          '',
          `统计时间：${new Date().toLocaleString('zh-CN')}`,
          '',
          `- 文本文件：${totalFiles}`,
          `- 去空白字符数：${totalChars}`,
          `- MCP 工具数：${mcpToolCount}`,
          `- 章节字符数：${chapterCharCount}`,
          '',
          '| 分组 | 文件数 | 字符数 |',
          '| --- | ---: | ---: |',
          ...sectionRows
        ].join('\n')
      })
    } catch (error) {
      setStatsDialog({ open: true, loading: false, content: error instanceof Error ? error.message : '统计失败' })
    }
  }

  const createBatchTaskFile = async (): Promise<void> => {
    if (toolboxLoading) return
    setToolboxLoading(true)
    try {
      const files = await collectProjectTextFiles(200)
      const created = await window.electronAPI.createEntry(
        `.wangyang/batch-tasks/${timestampName('批量处理任务')}`,
        'file',
        [
          '# 批量处理任务',
          '',
          `创建时间：${new Date().toLocaleString('zh-CN')}`,
          '',
          '## 可执行动作',
          '',
          '- [ ] 批量重命名',
          '- [ ] 批量移动',
          '- [ ] 批量归档',
          '- [ ] 批量生成摘要',
          '- [ ] 批量检查缺口',
          '',
          '## 文件清单',
          '',
          ...files.map((file) => `- [ ] ${file.relativePath}`)
        ].join('\n')
      )
      requestOpenProjectFile(created.relativePath)
      message.success('批量处理任务已创建')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建批量任务失败')
    } finally {
      setToolboxLoading(false)
    }
  }

  const renderEntryRows = (section: ProjectSection) => {
    const entries = groupEntries[section.title] ?? []
    const currentDir = sectionDirs[section.title] ?? section.dir
    const isLoading = groupLoading[section.title]
    const rootDir = sectionDirs[section.title] ?? section.dir
    const canGoUp = currentDir !== rootDir

    return (
      <div className="chapter-list">
        {canGoUp ? (
          <button
            className="chapter-row section-back-row"
            onClick={() => void changeSectionDir(section, parentDirFor(section, currentDir, rootDir))}
          >
            <OriginalIcon name="folder" size={13} />
            <span>返回上级</span>
          </button>
        ) : null}

        {section.special === 'context' ? (
          <div className="smart-card">
            <button
              disabled={smartContextStatus === 'committing'}
              onClick={() => (smartContextStatus === 'collecting' ? cancelSmartContextFile() : void createSmartContextFile())}
            >
              <OriginalIcon name="inspiration" size={15} />
              <span>
                {smartContextStatus === 'collecting'
                  ? '取消生成'
                  : smartContextStatus === 'committing'
                    ? '写入中'
                    : '创建智能上下文'}
              </span>
            </button>
            <p>
              {smartContextStatus === 'collecting'
                ? '正在收集项目文件和变更依据...'
                : smartContextStatus === 'committing'
                  ? '正在写入智能上下文记录...'
                  : '基于项目内容生成智能上下文，便于 AI 更好地理解你的作品。'}
            </p>
          </div>
        ) : null}

        {section.special === 'cover' ? (
          <div className="smart-card">
            <button onClick={() => openImageDialog('generate')}>
              <OriginalIcon name="assets" size={15} />
              <span>生成封面</span>
            </button>
            <button onClick={() => openImageDialog('edit')}>
              <OriginalIcon name="edit" size={15} />
              <span>编辑图片</span>
            </button>
            <p>使用图片模型生成封面并保存到 assets/generated，同时生成资产记录。</p>
          </div>
        ) : null}

        {isLoading ? <div className="empty-mini">加载中...</div> : null}

        {!isLoading && entries.length
          ? entries.slice(0, 30).map((entry) => {
              const chapterStatus = section.title === '章节' ? chapterStatusMap[entry.relativePath] : undefined
              return (
              <div className="chapter-row-wrap" key={entry.relativePath}>
                <button
                  className="chapter-row"
                  onClick={() => {
                    if (entry.type === 'directory') void changeSectionDir(section, entry.relativePath)
                    else if (isEditableTextPath(entry.relativePath)) requestOpenProjectFile(entry.relativePath)
                    else if (isImagePath(entry.relativePath)) void openAssetPreview(entry)
                    else void openAssetPreview(entry)
                  }}
                  title={entry.relativePath}
                >
                  <OriginalIcon name={entry.type === 'directory' ? 'folder' : 'file'} size={13} />
                  <span>{entry.name}</span>
                  {chapterStatus ? <em className="chapter-status-pill">{chapterStatus.status}</em> : null}
                </button>
                {section.special === 'cover' && entry.type === 'file' && isImagePath(entry.relativePath) ? (
                  <button
                    className="entry-action"
                    title="编辑图片"
                    onClick={() => openImageDialog('edit', entry.relativePath)}
                  >
                    <OriginalIcon name="assets" size={12} />
                  </button>
                ) : null}
                <button
                  className="entry-action"
                  title="重命名"
                  onClick={() =>
                    setRenameDialog({
                      open: true,
                      path: entry.relativePath,
                      name: entry.name,
                      sectionTitle: section.title
                    })
                  }
                >
                  <OriginalIcon name="edit" size={12} />
                </button>
                <button
                  className="entry-action"
                  title="移动"
                  onClick={() =>
                    setMoveDialog({
                      open: true,
                      sourcePath: entry.relativePath,
                      targetPath: entry.relativePath,
                      sectionTitle: section.title
                    })
                  }
                >
                  <OriginalIcon name="move" size={12} />
                </button>
                <button
                  className="entry-action"
                  title="归档"
                  onClick={() => archiveEntry(section.title, entry.relativePath)}
                >
                  <OriginalIcon name="archive" size={12} />
                </button>
                <button
                  className="entry-action danger"
                  title="删除"
                  onClick={() => deleteEntry(section.title, entry.relativePath)}
                >
                  <OriginalIcon name="delete" size={12} />
                </button>
              </div>
              )
            })
          : null}

        {!isLoading && entries.length === 0 && section.title === '章节' ? (
          <>
            <button className="import-book" onClick={openImportBookDialog}>
              <OriginalIcon name="file" size={15} />
              <span>导入全本，智能拆分</span>
            </button>
            <p className="hint-text">已有小说内容，可以导入后继续创作或分析。</p>
          </>
        ) : null}

        {!isLoading && entries.length === 0 && section.title !== '章节' && !section.special ? (
          <div className="empty-mini">暂无内容</div>
        ) : null}
      </div>
    )
  }

  const renderSectionMiniRail = () => {
    const icons: Record<string, OriginalIconName> = {
      '规则': 'rules',
      '大纲': 'outline',
      '章节': 'chapters',
      '角色': 'roles',
      '设定': 'settings',
      '记录': 'records',
      '灵感': 'inspiration',
      '资产': 'assets',
      '技能': 'skill',
      '其他': 'folder'
    }

    return (
      <aside className="section-mini-rail" aria-label="项目分组快捷栏">
        <button
          className={activeSectionShortcut === 'all' ? 'section-mini-button all selected' : 'section-mini-button all'}
          title="收起分组快捷栏"
          onClick={toggleGroupShortcutRail}
        >
          <OriginalIcon name="all" size={17} />
        </button>
        {visibleSections.map((section) => {
          const icon = icons[section.title] ?? 'file'
          const count = groupEntries[section.title]?.length ?? 0
          return (
            <button
              className={
                activeSectionShortcut === section.title ? 'section-mini-button selected' : 'section-mini-button'
              }
              key={section.title}
              title={section.title}
              onClick={() => jumpToProjectSection(section)}
            >
              <OriginalIcon name={icon} size={15} />
              <em>{count}</em>
            </button>
          )
        })}
      </aside>
    )
  }

  const renderFileTree = () => {
    const displayedSections =
      railDirectoryOpen && activeSectionShortcut !== 'all'
        ? visibleSections.filter((section) => section.title === activeSectionShortcut)
        : visibleSections

    return (
    <section className={railDirectoryOpen ? 'project-tree file-tree directory-sidebar-open' : 'project-tree file-tree'}>
      <header className="project-head">
        <button className="project-switcher" title="项目管理" onClick={openProjectManager}>
          <span className="project-type">{currentProject?.projectType === 'analysis' ? '分析' : '小说'}</span>
          <strong>{projectName}</strong>
          <ChevronDown size={13} />
        </button>
        <button className="ghost-icon" title="更多" onClick={openProjectSettings}>
          <OriginalIcon name="more" size={16} />
        </button>
      </header>

      <div className="tree-content">
        {railDirectoryOpen ? renderSectionMiniRail() : null}
        <div className="tree-main">
          {railDirectoryOpen ? null : (
            <div className="tree-tabs">
              <div className="tree-tabs-left">
                <button className="tree-shortcut-toggle" title="Open group rail" onClick={toggleGroupShortcutRail}>
                  <OriginalIcon name="all" size={16} />
                </button>
                <button className="active" onClick={jumpToAllProjectSections}>
                  全部
                </button>
              </div>
              <button title="刷新" onClick={() => void refreshAllSections()}>
                <OriginalIcon name="refresh" size={13} />
              </button>
            </div>
          )}

          <div className="tree-scroll" ref={treeScrollRef}>
            {displayedSections.map((section) => (
              <section
                className="tree-section"
                key={section.title}
                ref={(node) => {
                  sectionRefs.current[section.title] = node
                }}
              >
                <header>
                  <button className="section-toggle" onClick={() => toggleSection(section)}>
                    <ChevronDown className={expandedSections[section.title] ? '' : 'collapsed'} size={13} />
                    <span>{section.title}</span>
                  </button>
                  <div className="section-actions">
                    {section.settings ? (
                      <button title={`${section.title}设置`} onClick={openProjectSettings}>
                        <OriginalIcon name="settings" size={13} />
                      </button>
                    ) : null}
                    <button title={`编辑${section.title}`} onClick={() => void loadSection(section, sectionDirs[section.title])}>
                      <OriginalIcon name="edit" size={15} />
                    </button>
                    <button title={`New ${section.title} folder`} onClick={() => openCreate(section, 'directory')}>
                      <OriginalIcon name="folder" size={15} />
                    </button>
                    <button title={`新增${section.title}`} onClick={() => openCreate(section, 'file')}>
                      <OriginalIcon name="add" size={16} />
                    </button>
                  </div>
                </header>

                {expandedSections[section.title] ? renderEntryRows(section) : null}
              </section>
            ))}
          </div>

          <footer className="project-footer">
            <span>MCP: {mcpToolCount} 工具</span>
            <span>章节内容总字数：{chapterCharCount.toLocaleString('zh-CN')} 字</span>
          </footer>
        </div>
      </div>

      <details className="path-config">
        <summary>项目路径</summary>
        <div className="inline-input">
          <input
            value={rootDraft}
            onChange={(event) => setRootDraft(event.target.value)}
            placeholder="F:\\Projects\\Novel"
          />
          <button title="保存路径" onClick={() => void setProjectRoot(rootDraft)}>
            <OriginalIcon name="save" size={15} />
          </button>
          <button title="Open project folder" onClick={() => void openProjectFolder()}>
            <OriginalIcon name="folder" size={15} />
          </button>
        </div>
      </details>
    </section>
    )
  }

  const renderNavPanel = () => {
    const panel = navPanelText[activeNav as Exclude<NavLabel, '文件'>]
    const activeIcon = navItems.find((item) => item.label === activeNav)?.icon ?? 'toolbox'
    const activeSearchMode = searchModes.find((item) => item.mode === searchMode) ?? searchModes[0]

    return (
      <section className="project-tree nav-panel">
        <header className="project-head nav-panel-head">
          <div>
            <OriginalIcon name={activeIcon} size={16} />
            <strong>{panel.title}</strong>
          </div>
          <button className="ghost-icon" title="更多" onClick={openNavMorePanel}>
            <OriginalIcon name="more" size={16} />
          </button>
        </header>

        {panel.search ? (
          <div className="panel-search-shell">
            <div className="search-mode-tabs">
              {searchModes.map((item) => (
                <button
                  className={searchMode === item.mode ? 'active' : ''}
                  key={item.mode}
                  onClick={() => setSearchMode(item.mode)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="panel-search">
              <OriginalIcon name="search" size={14} />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={activeSearchMode.placeholder}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void performSearch()
                  }
                }}
              />
              <button onClick={() => void performSearch()}>{searching ? '...' : searchMode === 'ask' ? '?' : '?'}</button>
            </div>
          </div>
        ) : null}

        <div className="tree-scroll nav-panel-scroll">
          {panel.search && searchMode === 'content' && searchResults.length > 0 ? (
            <div className="search-results">
              {searchResults.map((match) => (
                <button
                  key={`${match.file}:${match.line}:${match.preview}`}
                  onClick={() => {
                    requestOpenProjectFile(match.file)
                    draftAction(`Analyze ${match.file}:${match.line} nearby content.`, true)
                  }}
                >
                  <OriginalIcon name="search" size={16} />
                  <div>
                    <strong>{match.file}</strong>
                    <span>第 {match.line} 行：{match.preview}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
          {panel.search && searchMode === 'file' && fileSearchResults.length > 0 ? (
            <div className="search-results">
              {fileSearchResults.map((entry) => (
                <button
                  key={entry.relativePath}
                  onClick={() =>
                    entry.type === 'directory'
                      ? setActiveNav('文件')
                      : isEditableTextPath(entry.relativePath)
                        ? requestOpenProjectFile(entry.relativePath)
                        : isImagePath(entry.relativePath)
                          ? void openAssetPreview(entry)
                          : void openAssetPreview(entry)
                  }
                >
                  <OriginalIcon name={entry.type === 'directory' ? 'folder' : 'file'} size={16} />
                  <div>
                    <strong>{entry.name}</strong>
                    <span>{entry.relativePath}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
          {panel.search && searchMode === 'content' && searchQuery && !searching && searchResults.length === 0 ? (
            <div className="empty-mini panel-empty">暂无搜索结果</div>
          ) : null}
          {panel.search && searchMode === 'file' && searchQuery && !searching && fileSearchResults.length === 0 ? (
            <div className="empty-mini panel-empty">暂无文件结果</div>
          ) : null}
          {panel.search && searchMode === 'ask' ? (
            <div className="empty-mini panel-empty">输入问题后点击问”，右侧智能体会接收全文问答任务</div>
          ) : null}
          {activeNav === '快照' ? (
            <div className="cloud-sync-panel">
              <div className="cloud-sync-actions">
                <button disabled={backupsLoading} onClick={() => void createBackup()}>
                  创建快照
                </button>
                <button disabled={backupsLoading} onClick={() => void refreshBackups()}>
                  刷新记录
                </button>
              </div>
              <div className="backup-list">
                {backups.map((backup) => (
                  <button key={backup.id} onClick={() => void window.electronAPI.showItemInFolder(backup.path)}>
                    <strong>{backup.id}</strong>
                    <span>
                      {backup.files} 个文件 / {formatBytes(backup.bytes)}
                    </span>
                    <em>{backup.path}</em>
                  </button>
                ))}
                {!backups.length ? <div className="empty-mini panel-empty">暂无本地快照记录</div> : null}
              </div>
            </div>
          ) : null}
          {activeNav === '知识' ? (
            <div className="knowledge-panel">
              <div className="panel-search">
                <OriginalIcon name="search" size={14} />
                <input
                  value={knowledgeQuery}
                  onChange={(event) => setKnowledgeQuery(event.target.value)}
                  placeholder="搜索本地知识库"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void searchKnowledgeBases()
                  }}
                />
                <button disabled={knowledgeSearching} onClick={() => void searchKnowledgeBases()}>
                  {knowledgeSearching ? '...' : '?'}
                </button>
              </div>
              <div className="knowledge-actions">
                <button onClick={() => setKnowledgeDialog({ open: true, name: '项目知识库', path: 'knowledge' })}>
                  添加知识库
                </button>
                <button onClick={() => void ensureDefaultKnowledgeBase()}>绑定项目知识</button>
              </div>
              <div className="knowledge-base-list">
                {knowledgeBases.map((entry) => (
                  <button
                    className={entry.enabled ? 'enabled' : ''}
                    key={entry.id}
                    onClick={() => void toggleKnowledgeBase(entry.id)}
                    title={entry.enabled ? '点击停用' : '点击启用'}
                  >
                    <strong>{entry.name}</strong>
                    <span>{entry.path}</span>
                    <em>{entry.enabled ? '已启用' : '已停用'}</em>
                  </button>
                ))}
                {!knowledgeBases.length ? (
                  <div className="empty-mini panel-empty">暂无知识库，默认会搜索 knowledge、records、rules、objects 和 inspirations。</div>
                ) : null}
              </div>
              {knowledgeResults.length ? (
                <div className="search-results knowledge-results">
                  {knowledgeResults.map((match) => (
                    <button
                      key={`${match.file}:${match.line}:${match.preview}`}
                      onClick={() => {
                        requestOpenProjectFile(match.file)
                        draftAction(`Use knowledge base ${match.knowledgeBase}, ${match.file}:${match.line}: answer from nearby content.`, true)
                      }}
                    >
                      <OriginalIcon name="knowledge" size={16} />
                      <div>
                        <strong>{match.file}</strong>
                        <span>
                          {match.knowledgeBase} / 第 {match.line} 行：{match.preview}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
              {knowledgeQuery && !knowledgeSearching && !knowledgeResults.length ? (
                <div className="empty-mini panel-empty">暂无知识库搜索结果</div>
              ) : null}
            </div>
          ) : null}
          {activeNav === '技能' ? (
            <div className="skill-panel">
              <div className="knowledge-actions">
                <button onClick={() => void createProjectSkill()}>新建技能</button>
                <button onClick={() => setSkillImportDialog({ open: true, sourcePath: '', targetName: '' })}>
                  导入技能
                </button>
                <button onClick={() => void refreshSkills()}>刷新</button>
              </div>
              <div className="skill-list">
                {skillEntries.map((entry) => (
                  <div className="skill-list-row" key={entry.relativePath}>
                    <button onClick={() => requestOpenProjectFile(entry.entryPath)}>
                      <OriginalIcon name="skill" size={15} />
                      <span>
                        <strong>{entry.name}</strong>
                        <small>{entry.description || entry.entryPath}</small>
                      </span>
                    </button>
                    <button
                      aria-label={`删除技能 ${entry.name}`}
                      className="entry-action danger"
                      onClick={() => void deleteProjectSkill(entry)}
                      title="删除"
                    >
                      <OriginalIcon name="delete" size={13} />
                    </button>
                  </div>
                ))}
                {!skillEntries.length ? <div className="empty-mini panel-empty">暂无项目技能</div> : null}
              </div>
            </div>
          ) : null}
          {activeNav === '百宝箱' ? (
            <div className="toolbox-panel">
              <button disabled={toolboxLoading} onClick={openExportDialog}>
                导出项目 Markdown
              </button>
              <button onClick={() => void showProjectStats()}>查看项目统计</button>
              <button disabled={toolboxLoading} onClick={() => void createBatchTaskFile()}>
                创建批量任务
              </button>
            </div>
          ) : null}
          {activeNav === '智能' ? (
            <div className="toolbox-panel">
              <button onClick={startFullTextQa}>全文问答</button>
              <button onClick={startPureChat}>纯聊天</button>
              <button onClick={startSmartNaming}>智能命名</button>
            </div>
          ) : null}
          <div className="panel-card-list">
            {panel.actions.map((action) => (
              <button
                className="panel-card"
                key={action}
                onClick={() => {
                  if (panel.search) {
                    if (action === '搜索文件名') setSearchMode('file')
                    else if (action === '全文问答') setSearchMode('ask')
                    else setSearchMode('content')
                    return
                  }
                  if (activeNav === '快照') {
                    if (action === '创建本地快照') void createBackup()
                    else if (action === '刷新快照记录' || action === '查看本地记录') void refreshBackups()
                    return
                  }
                  if (activeNav === '知识') {
                    if (action === '添加知识库') setKnowledgeDialog({ open: true, name: '项目知识库', path: 'knowledge' })
                    else if (action === '搜索知识库') void searchKnowledgeBases()
                    else if (action === '绑定项目知识') void ensureDefaultKnowledgeBase()
                    return
                  }
                  if (activeNav === '技能') {
                    if (action === '新建技能') void createProjectSkill()
                    else if (action === '导入技能') setSkillImportDialog({ open: true, sourcePath: '', targetName: '' })
                    else if (action === '查看项目技能') void refreshSkills()
                    return
                  }
                  if (activeNav === '百宝箱') {
                    if (action === '生成封面') openImageDialog()
                    else if (action === '导出文档') openExportDialog()
                    else if (action === '项目统计') void showProjectStats()
                    else if (action === '批量处理') void createBatchTaskFile()
                    return
                  }
                  if (activeNav === '智能') {
                    if (action === '智能开篇') {
                      draftAction('请通过提问的方式帮我完成小说开篇设计，包括核心卖点、主角、开场冲突、前三章目标和创作规则。', true)
                    } else if (action === '创建角色') {
                      draftAction('请帮我创建一个立体角色。请依次补全外貌、性格、欲望、弱点、背景、关系网和可用于剧情推进的秘密。', true)
                    } else if (action === '世界观构建') {
                      draftAction('请帮我构建故事世界观，包括地理、历史、势力、文化、规则限制、冲突来源和可写成章节的事件。', true)
                    } else if (action === '剧情讨论') {
                      draftAction('请和我讨论当前剧情，指出可加强的矛盾、悬念和人物动机，并给出三个后续走向方案。', true)
                    }
                    return
                  }
                  draftAction(`Please help me with ${action}.`)
                }}
              >
                    <OriginalIcon name={activeIcon} size={16} />
                <div>
                  <strong>{action}</strong>
                  <span>{activeNav === '知识' ? '本地知识库操作' : '点击后会在智能体输入框生成对应任务'}</span>
                </div>
              </button>
            ))}
          </div>
          {activeNav === navItems[5].label || activeNav === navItems[2].label || activeNav === navItems[6].label ? null : (
            <div className="empty-mini panel-empty">暂无内容</div>
          )}
        </div>

        <footer className="project-footer">
          <span>{panel.title}</span>
          <span>{projectName}</span>
        </footer>
      </section>
    )
  }

  return (
    <div className="project-explorer">
      <nav className={`nav-rail${railDirectoryOpen ? ' directory-open' : ''}`}>
        <button className="rail-project-switcher" title="切换项目" onClick={openProjectManager}>
          <OriginalIcon name="switch-project" size={18} />
        </button>
        <button
          className="rail-sidebar-toggle"
          title={isSidebarCollapsed ? '展开侧栏' : '收齐侧栏'}
          onClick={toggleProjectSidebar}
        >
          <OriginalIcon name={isSidebarCollapsed ? 'sidebar-open' : 'sidebar-close'} size={18} />
        </button>
        <div className="rail-items">
          {navItems.map((item) => {
            return (
              <button
                className={activeNav === item.label ? 'rail-item active' : 'rail-item'}
                key={item.label}
                title={item.label}
                onClick={() => setActiveNav(item.label)}
              >
                <OriginalIcon name={item.icon} size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
        <div className="rail-bottom">
          <button className="rail-icon" title="帮助" onClick={() => setHelpOpen(true)}>
            <OriginalIcon name="help" size={17} />
          </button>
          <button className="rail-icon" title="设置" onClick={openProjectSettings}>
            <OriginalIcon name="settings" size={17} />
          </button>
        </div>
      </nav>

      {activeNav === '文件' ? renderFileTree() : renderNavPanel()}
      <Modal
        title="项目管理"
        open={projectManagerOpen}
        onCancel={() => setProjectManagerOpen(false)}
        footer={null}
        width={760}
      >
        <div className="project-manager">
          <section className="project-manager-create">
            <h3>新建项目</h3>
            <div className="project-create-grid">
              <Input
                value={projectCreateDraft.name}
                onChange={(event) => setProjectCreateDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="项目名称"
              />
              <Select
            showSearch={false}
                value={projectCreateDraft.projectType}
                onChange={(projectType: ProjectTemplateType) =>
                  setProjectCreateDraft((current) => ({ ...current, projectType }))
                }
                options={[
                  { label: '基础创作项目', value: 'basic' },
                  { label: '分析/智能上下文项目', value: 'analysis' }
                ]}
              />
              <Input
                value={projectCreateDraft.parentPath}
                onChange={(event) => setProjectCreateDraft((current) => ({ ...current, parentPath: event.target.value }))}
                placeholder="项目父目录"
              />
              <Button onClick={() => void chooseProjectParent()}>选择目录</Button>
              <Button type="primary" loading={projectCreating} onClick={() => void createProject()}>
                创建并打开
              </Button>
            </div>
          </section>

          <section className="project-manager-list">
            <header>
              <h3>最近项目</h3>
              <div className="project-manager-actions">
                <Button size="small" type="primary" onClick={() => void openExistingProject()}>
                  打开已有项目
                </Button>
                <Button size="small" onClick={() => void refreshProjectList()}>
                  刷新
                </Button>
              </div>
            </header>
            <div className="project-list">
              {projects.map((project) => {
                const active = sameLocalPath(project.root, projectRoot)
                return (
                  <div className={active ? 'project-list-item active' : 'project-list-item'} key={project.id}>
                    <button onClick={() => void switchProject(project)}>
                      <span>{project.projectType === 'analysis' ? '分析' : '小说'}</span>
                      <strong>{project.name}</strong>
                      <small>{project.root}</small>
                    </button>
                    <div>
                      <Button size="small" onClick={() => void switchProject(project)}>
                        打开
                      </Button>
                      <Button size="small" onClick={() => void renameProject(project)}>
                        重命名
                      </Button>
                      <Button size="small" danger onClick={() => void deleteProject(project)}>
                        删除
                      </Button>
                    </div>
                  </div>
                )
              })}
              {!projects.length ? <div className="empty-mini">暂无项目，请先新建或在下方设置项目路径。</div> : null}
            </div>
          </section>
        </div>
      </Modal>
      <Modal
        title={`新建${createDialog.type === 'file' ? '文件' : '文件夹'} - ${createDialog.sectionTitle}`}
        open={createDialog.open}
        onOk={() => void submitCreate()}
        onCancel={() => setCreateDialog((current) => ({ ...current, open: false }))}
        okText="创建"
        cancelText="取消"
      >
        <div className="modal-form-stack">
          <Select
            showSearch={false}
            value={createDialog.type}
            onChange={(type: EntryType) => setCreateDialog((current) => ({ ...current, type }))}
            options={[
              { label: '文件', value: 'file' },
              { label: '文件夹', value: 'directory' }
            ]}
          />
          <Input
            value={createDialog.name}
            onChange={(event) => setCreateDialog((current) => ({ ...current, name: event.target.value }))}
            placeholder="名称"
          />
        </div>
      </Modal>

      <Modal
        title="重命名"
        open={renameDialog.open}
        onOk={() => void submitRename()}
        onCancel={() => setRenameDialog({ open: false, path: '', name: '', sectionTitle: '' })}
        okText="保存"
        cancelText="取消"
      >
        <Input
          value={renameDialog.name}
          onChange={(event) => setRenameDialog((current) => ({ ...current, name: event.target.value }))}
          placeholder="新名称"
        />
      </Modal>

      <Modal
        title="移动"
        open={moveDialog.open}
        onOk={() => void submitMove()}
        onCancel={() => setMoveDialog({ open: false, sourcePath: '', targetPath: '', sectionTitle: '' })}
        okText="移动"
        cancelText="取消"
      >
        <div className="modal-form-stack">
          <Input value={moveDialog.sourcePath} disabled />
          <Input
            value={moveDialog.targetPath}
            onChange={(event) => setMoveDialog((current) => ({ ...current, targetPath: event.target.value }))}
            placeholder="目标项目相对路径"
          />
        </div>
      </Modal>

      <Modal
        title="添加知识库"
        open={knowledgeDialog.open}
        onOk={() => void submitKnowledgeBase()}
        onCancel={() => setKnowledgeDialog((current) => ({ ...current, open: false }))}
        okText="添加"
        cancelText="取消"
      >
        <div className="modal-form-stack">
          <Input
            value={knowledgeDialog.name}
            onChange={(event) => setKnowledgeDialog((current) => ({ ...current, name: event.target.value }))}
            placeholder="知识库名称"
          />
          <Input
            value={knowledgeDialog.path}
            onChange={(event) => setKnowledgeDialog((current) => ({ ...current, path: event.target.value }))}
            placeholder="项目内相对目录，例如 knowledge/world"
          />
        </div>
      </Modal>

      <Modal
        title="导入技能"
        open={skillImportDialog.open}
        onOk={() => void submitImportSkill()}
        onCancel={() => setSkillImportDialog({ open: false, sourcePath: '', targetName: '' })}
        okText="导入"
        cancelText="取消"
      >
        <div className="modal-form-stack">
          <Input
            value={skillImportDialog.sourcePath}
            onChange={(event) => setSkillImportDialog((current) => ({ ...current, sourcePath: event.target.value }))}
            placeholder="项目内源文件路径，例如 skills/example.md"
          />
          <Input
            value={skillImportDialog.targetName}
            onChange={(event) => setSkillImportDialog((current) => ({ ...current, targetName: event.target.value }))}
            placeholder="目标技能文件名，留空使用源文件名"
          />
        </div>
      </Modal>

      <Modal
        title="导出项目文档"
        open={exportDialog.open}
        onOk={() => void exportProjectDocument()}
        onCancel={() => setExportDialog((current) => ({ ...current, open: false }))}
        okText="导出"
        cancelText="取消"
        confirmLoading={exportDialog.exporting}
      >
        <div className="modal-form-stack">
          <Select
            showSearch={false}
            value={exportDialog.format}
            onChange={(format) => setExportDialog((current) => ({ ...current, format }))}
            options={[
              { label: 'Markdown (.md)', value: 'markdown' },
              { label: 'Text (.txt)', value: 'txt' },
              { label: 'HTML (.html)', value: 'html' },
              { label: 'PDF (.pdf)', value: 'pdf' },
              { label: 'DOCX (.docx)', value: 'docx' },
              { label: 'EPUB (.epub)', value: 'epub' }
            ]}
          />
          <Select
            showSearch={false}
            value={exportDialog.scope}
            onChange={(scope) => setExportDialog((current) => ({ ...current, scope }))}
            options={[
              { label: '全部资料', value: 'all' },
              { label: '仅章节', value: 'chapters' }
            ]}
          />
          <label className="settings-inline-label">
            <input
              type="checkbox"
              checked={exportDialog.includeMeta}
              disabled={exportDialog.scope === 'chapters'}
              onChange={(event) => setExportDialog((current) => ({ ...current, includeMeta: event.target.checked }))}
            />
            <span>包含规则、大纲角色设定记录和灵感</span>
          </label>
          {exportDialog.lastExportPath ? (
            <Button onClick={() => void window.electronAPI.showItemInFolder(exportDialog.lastExportPath)}>
              打开上次导出位置
            </Button>
          ) : null}
        </div>
      </Modal>

      <Modal
        title="项目统计"
        open={statsDialog.open}
        onCancel={() => setStatsDialog((current) => ({ ...current, open: false }))}
        footer={[
          <Button key="close" onClick={() => setStatsDialog((current) => ({ ...current, open: false }))}>
            关闭
          </Button>
        ]}
        width={760}
      >
        <pre className="stats-report">{statsDialog.loading ? '统计中...' : statsDialog.content}</pre>
      </Modal>

      <Modal
        title="导入全本，智能拆分"
        open={importBookDialog.open}
        onOk={() => void submitImportBook()}
        onCancel={() => setImportBookDialog((current) => ({ ...current, open: false }))}
        okText="导入"
        cancelText="取消"
        confirmLoading={importBookDialog.creating}
        width={760}
      >
        <div className="modal-form-stack">
          <Button onClick={() => void chooseImportBookFile()}>
            选择 TXT/MD/HTML 文件
          </Button>
          {importBookDialog.sourcePath ? <small className="settings-muted">{importBookDialog.sourcePath}</small> : null}
          <Input
            value={importBookDialog.title}
            onChange={(event) => setImportBookDialog((current) => ({ ...current, title: event.target.value }))}
            placeholder="作品名（可）"
          />
          <Input.TextArea
            rows={16}
            value={importBookDialog.content}
            onChange={(event) => setImportBookDialog((current) => ({ ...current, content: event.target.value }))}
            placeholder="粘贴全本正文。会按第 N 章 / 卷 N / Chapter N 等标题拆分；没有章节标题时会按长度分块。"
          />
        </div>
      </Modal>

      <Modal
        title="本地帮助"
        open={helpOpen}
        onCancel={() => setHelpOpen(false)}
        footer={[
          <Button key="close" onClick={() => setHelpOpen(false)}>
            关闭
          </Button>
        ]}
        width={720}
      >
        <div className="help-panel">
          <h3>王阳本地无登录版</h3>
          <p>项目、文件搜索、智能体、模型、MCP、知识库、图片生成、子智能体和本地备份默认开放。</p>
          <div>
            <strong>常用入口</strong>
            <span>文件：管理规则、大纲、章节、角色、设定、记录、灵感、资产和技能。</span>
            <span>智能体：支持上下文、提示词、图片附件、工具调用历史和子智能体。</span>
            <span>设置：配置模型接口、提示词、MCP、编辑器、备份和系统主题。</span>
          </div>
        </div>
      </Modal>

      <Modal
        title="项目设置"
        open={projectSettingsDialog.open}
        onOk={() => void submitProjectSettings()}
        onCancel={() => setProjectSettingsDialog((current) => ({ ...current, open: false }))}
        okText="保存"
        cancelText="取消"
        width={820}
      >
        <div className="project-settings-form">
          <label>
            <span>项目名称</span>
            <Input
              value={projectSettingsDialog.name}
              onChange={(event) =>
                setProjectSettingsDialog((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <div className="project-settings-dirs">
            {[...sections]
              .sort(
                (left, right) =>
                  (projectSettingsDialog.order[left.title] ?? initialSectionOrder[left.title] ?? 0) -
                  (projectSettingsDialog.order[right.title] ?? initialSectionOrder[right.title] ?? 0)
              )
              .map((section, index) => (
              <label key={section.title}>
                <span>{section.title}</span>
                <div className="section-layout-controls">
                  <label>
                    <input
                      type="checkbox"
                      checked={projectSettingsDialog.visibility[section.title] !== false}
                      onChange={(event) =>
                        setProjectSettingsDialog((current) => ({
                          ...current,
                          visibility: {
                            ...current.visibility,
                            [section.title]: event.target.checked
                          }
                        }))
                      }
                    />
                    <span>显示</span>
                  </label>
                  <div className="section-order-buttons">
                    <button
                      disabled={index === 0}
                      onClick={() => setProjectSectionOrder(section.title, -1)}
                      title="上移"
                      type="button"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      disabled={index === sections.length - 1}
                      onClick={() => setProjectSectionOrder(section.title, 1)}
                      title="下移"
                      type="button"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                  <Input
                    value={String(projectSettingsDialog.order[section.title] ?? initialSectionOrder[section.title] ?? 0)}
                    onChange={(event) =>
                      setProjectSettingsDialog((current) => ({
                        ...current,
                        order: {
                          ...current.order,
                          [section.title]: Number(event.target.value) || 0
                        }
                      }))
                    }
                  />
                </div>
                <Input
                  value={projectSettingsDialog.dirs[section.title] ?? section.dir}
                  onChange={(event) =>
                    setProjectSettingsDialog((current) => ({
                      ...current,
                      dirs: {
                        ...current.dirs,
                        [section.title]: normalizeRelativePath(event.target.value)
                      }
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        title="切换文件"
        open={Boolean(pendingOpenPath)}
        onCancel={() => setPendingOpenPath('')}
        footer={[
          <Button key="cancel" onClick={() => setPendingOpenPath('')}>
            取消
          </Button>,
          <Button key="discard" danger onClick={() => void discardAndOpenPendingFile()}>
            放弃并打开
          </Button>,
          <Button key="save" type="primary" onClick={() => void saveAndOpenPendingFile()}>
            保存并打开
          </Button>
        ]}
      >
        <p>当前文件有未保存修改。要先保存，还是放弃修改后打开 {pendingOpenPath}？</p>
      </Modal>

      <Modal
        title={assetPreviewDialog.name || '资产预览'}
        open={assetPreviewDialog.open}
        onCancel={() => setAssetPreviewDialog((current) => ({ ...current, open: false }))}
        footer={[
          <Button key="copy" onClick={() => void copyAssetPath(assetPreviewDialog.relativePath)}>
            复制路径
          </Button>,
          <Button key="folder" onClick={() => void revealAssetInFolder(assetPreviewDialog.relativePath)}>
            在文件夹中显示
          </Button>,
          <Button key="external" onClick={() => void openAssetExternal(assetPreviewDialog.relativePath)}>
            外部打开
          </Button>,
          isImagePath(assetPreviewDialog.relativePath) ? (
            <Button
              key="edit"
              type="primary"
              onClick={() => {
                setAssetPreviewDialog((current) => ({ ...current, open: false }))
                openImageDialog('edit', assetPreviewDialog.relativePath)
              }}
            >
              编辑图片
            </Button>
          ) : null
        ]}
        width={820}
      >
        <div className="asset-preview-panel">
          <div className="asset-preview-meta">
            <span>{assetPreviewDialog.relativePath}</span>
            <span>{assetPreviewDialog.mime || '未知类型'} · {assetPreviewDialog.size.toLocaleString('zh-CN')} bytes</span>
          </div>
          {assetPreviewDialog.loading ? <div className="empty-mini">预览加载中...</div> : null}
          {assetPreviewDialog.error ? <div className="empty-mini">{assetPreviewDialog.error}</div> : null}
          {assetPreviewDialog.dataUrl ? <img src={assetPreviewDialog.dataUrl} alt={assetPreviewDialog.name} /> : null}
          {!assetPreviewDialog.loading && !assetPreviewDialog.error && !assetPreviewDialog.dataUrl ? (
            <div className="empty-mini">该文件不支持内嵌预览，可使用外部打开或在文件夹中显示。</div>
          ) : null}
        </div>
      </Modal>

      <Modal
        title={imageDialog.mode === 'edit' ? '编辑图片' : '生成封面'}
        open={imageDialog.open}
        onOk={() => void submitGenerateImage()}
        onCancel={() => setImageDialog((current) => ({ ...current, open: false }))}
        okText={imageDialog.mode === 'edit' ? '编辑' : '生成'}
        cancelText="取消"
        confirmLoading={imageDialog.generating}
      >
        <div className="modal-form-stack">
          {imageDialog.mode === 'edit' ? (
            <Input
              value={imageDialog.sourcePath}
              onChange={(event) => setImageDialog((current) => ({ ...current, sourcePath: event.target.value }))}
              placeholder="项目内图片路径，例如 assets/generated/cover.png"
            />
          ) : null}
          <Select
            showSearch={false}
            value={imageDialog.size}
            onChange={(size) => setImageDialog((current) => ({ ...current, size }))}
            options={[
              { label: '1024 x 1024', value: '1024x1024' },
              { label: '1024 x 1792', value: '1024x1792' },
              { label: '1792 x 1024', value: '1792x1024' }
            ]}
          />
          <Input.TextArea
            rows={6}
            value={imageDialog.prompt}
            onChange={(event) => setImageDialog((current) => ({ ...current, prompt: event.target.value }))}
            placeholder={imageDialog.mode === 'edit' ? '请输入图片编辑提示词' : '请输入封面图片提示词'}
          />
          <Button onClick={() => void createCoverBriefFile()}>Create cover brief</Button>
        </div>
      </Modal>
    </div>
  )
}
