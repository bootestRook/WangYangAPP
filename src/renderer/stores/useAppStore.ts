import { create } from 'zustand'
import type {
  AgentMode,
  AgentSession,
  AgentToolPermissionMode,
  AiConfig,
  ChatAttachment,
  ChatMessage,
  DirectoryListing,
  Entitlements,
  LocalSettings,
  SubAgentRole,
  SubAgentSession,
  ToolCall,
  ToolDefinition
} from '../../shared/types'
import { runAgent } from '../../core/agent/agentRunner'
import { pickRuntimeModel } from '../../core/models/modelConfig'
import { resolveModel } from '../../core/models/resolveModel'
import { createToolRegistry } from '../../core/tools/toolRegistry'

interface AgentOptionRequest {
  id: string
  title: string
  question: string
  options: string[]
}

type AgentOptionSelection = { index: number; option: string }
type EditorViewMode = 'source' | 'preview' | 'dual' | 'diff' | 'csv'
type SubAgentModelOverrides = Partial<Record<SubAgentRole, string>>
type AgentToolConfirmer = (toolCall: ToolCall, definition: ToolDefinition) => Promise<boolean>

interface AppState {
  initialized: boolean
  projectRoot: string
  directory?: DirectoryListing
  aiConfig?: AiConfig
  entitlements?: Entitlements
  localSettings?: LocalSettings
  agentSessions: AgentSession[]
  legacyAgentSessions: AgentSession[]
  subAgentSessions: SubAgentSession[]
  currentSessionId: string
  agentMode: AgentMode
  selectedModel: string
  activeFilePath?: string
  editorContent: string
  editorDirty: boolean
  editorLoading: boolean
  editorViewMode: EditorViewMode
  messages: ChatMessage[]
  draft: string
  isRunning: boolean
  abortController?: AbortController
  pendingOptionRequest?: AgentOptionRequest
  optionRequestResolver?: (selection: AgentOptionSelection) => void
  error?: string
  initialize: () => Promise<void>
  setDraft: (draft: string) => void
  setProjectRoot: (root: string) => Promise<void>
  openProjectById: (id: string) => Promise<void>
  refreshDirectory: (relativePath?: string) => Promise<void>
  saveAiConfig: (config: AiConfig) => Promise<void>
  saveLocalSettings: (settings: LocalSettings) => Promise<void>
  openProjectFile: (relativePath: string, options?: { force?: boolean }) => Promise<boolean>
  updateEditorContent: (content: string) => void
  saveActiveFile: () => Promise<boolean>
  closeActiveFile: () => void
  setEditorViewMode: (mode: EditorViewMode) => void
  setAgentMode: (mode: AgentMode) => void
  startNewAgentSession: () => void
  loadAgentSession: (sessionId: string) => void
  loadLegacyAgentSession: (sessionId: string) => void
  renameAgentSession: (sessionId: string, title: string) => void
  deleteAgentSession: (sessionId: string) => void
  clearAgentSessions: () => void
  deleteLegacyAgentSession: (sessionId: string) => void
  clearLegacyAgentSessions: () => void
  runSubAgent: (
    role: SubAgentRole,
    prompt: string,
    attachments?: ChatAttachment[],
    temperature?: number,
    signal?: AbortSignal,
    options?: { modelId?: string }
  ) => Promise<SubAgentSession | undefined>
  deleteSubAgentSession: (sessionId: string) => void
  setSelectedModel: (model: string) => void
  stopAgent: () => void
  chooseAgentOption: (index: number) => void
  cancelAgentOption: () => void
  requestAgentOption: (payload: Omit<AgentOptionRequest, 'id'>) => Promise<AgentOptionSelection>
  sendMessage: (
    attachments?: ChatAttachment[],
    temperature?: number,
    options?: { modelId?: string; draftOverride?: string; subAgentModelOverrides?: SubAgentModelOverrides }
  ) => Promise<void>
}

const AGENT_SESSIONS_KEY = 'wangyang.agent.sessions'
const SUB_AGENT_SESSIONS_KEY = 'wangyang.sub-agent.sessions'
const PROJECT_AGENT_SESSIONS_PATH = '.wangyang/agent-sessions.json'
const ADVANCED_EDITOR_VIEW_KEY = 'wangyang.editor.advanced-view'

function readStoredEditorView(fallback: EditorViewMode): EditorViewMode {
  const stored = window.localStorage.getItem(ADVANCED_EDITOR_VIEW_KEY)
  return stored === 'source' || stored === 'preview' || stored === 'dual' || stored === 'diff' || stored === 'csv'
    ? stored
    : fallback
}

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeAgentSessions(value: unknown): AgentSession[] {
  if (!Array.isArray(value)) return []
  return value.filter((session): session is AgentSession => {
    const candidate = session as Partial<AgentSession>
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.title === 'string' &&
      Array.isArray(candidate.messages) &&
      typeof candidate.createdAt === 'number' &&
      typeof candidate.updatedAt === 'number'
    )
  })
}

function readLegacyAgentSessions(): AgentSession[] {
  try {
    const raw = localStorage.getItem(AGENT_SESSIONS_KEY)
    if (!raw) return []
    return normalizeAgentSessions(JSON.parse(raw))
  } catch {
    return []
  }
}

function writeLegacyAgentSessions(sessions: AgentSession[]): void {
  localStorage.setItem(AGENT_SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)))
}

async function readProjectAgentSessions(): Promise<AgentSession[]> {
  try {
    const raw = await window.electronAPI.readFile(PROJECT_AGENT_SESSIONS_PATH)
    return normalizeAgentSessions(JSON.parse(raw))
  } catch {
    return []
  }
}

function persistAgentSessions(sessions: AgentSession[], hasProjectRoot: boolean): void {
  const serialized = `${JSON.stringify(sessions.slice(0, 50), null, 2)}\n`
  if (!hasProjectRoot) {
    writeLegacyAgentSessions(sessions)
    return
  }
  void window.electronAPI.writeFile(PROJECT_AGENT_SESSIONS_PATH, serialized)
}

function readSubAgentSessions(): SubAgentSession[] {
  try {
    const raw = localStorage.getItem(SUB_AGENT_SESSIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SubAgentSession[]
    if (!Array.isArray(parsed)) return []
    const normalized = parsed.map((session) =>
      session.status === 'running'
        ? {
            ...session,
            status: 'error' as const,
            error: session.error ?? '上次运行被应用关闭或刷新中断。'
          }
        : session
    )
    writeSubAgentSessions(normalized)
    return normalized
  } catch {
    return []
  }
}

function writeSubAgentSessions(sessions: SubAgentSession[]): void {
  localStorage.setItem(SUB_AGENT_SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)))
}

function normalizeProjectSubAgentSessions(value: unknown): SubAgentSession[] {
  if (!Array.isArray(value)) return []
  return value.filter((session): session is SubAgentSession => {
    const candidate = session as Partial<SubAgentSession>
    return (
      typeof candidate.id === 'string' &&
      ['planner', 'writer', 'reviewer', 'researcher'].includes(String(candidate.role)) &&
      typeof candidate.title === 'string' &&
      typeof candidate.prompt === 'string' &&
      Array.isArray(candidate.messages) &&
      ['running', 'done', 'error'].includes(String(candidate.status)) &&
      typeof candidate.createdAt === 'number' &&
      typeof candidate.updatedAt === 'number'
    )
  })
}

async function readProjectSubAgentSessions(): Promise<SubAgentSession[]> {
  try {
    return normalizeProjectSubAgentSessions(await window.electronAPI.listSubAgentSessions())
  } catch {
    return []
  }
}

function persistSubAgentSessions(
  sessions: SubAgentSession[],
  hasProjectRoot: boolean,
  changedSession?: SubAgentSession
): void {
  const capped = sessions.slice(0, 50)
  if (!hasProjectRoot) {
    writeSubAgentSessions(capped)
    return
  }
  const targets = changedSession ? [changedSession] : capped
  for (const session of targets) {
    void window.electronAPI.writeSubAgentSession(session)
  }
}

function removePersistedSubAgentSession(sessionId: string, hasProjectRoot: boolean): void {
  if (hasProjectRoot) {
    void window.electronAPI.deleteSubAgentSessionFile(sessionId)
  }
}

const agentModeSystemPrompts: Record<AgentMode, string> = {
  professional:
    '专业辅助模式：先理解用户目标和项目上下文，再输出结构化、可执行的小说创作建议。需要项目资料时主动使用文件、知识库、全文问答和智能上下文工具。',
  planning:
    '规划辅助模式：优先拆解目标、依赖、章节安排、角色/设定影响和下一步动作。输出要能直接变成项目文件或待办。',
  writing:
    '写作辅助模式：优先保持文风、人物动机、伏笔和上下文连续。需要续写或改写时给出可直接放入正文的中文内容。',
  adventure:
    '冒险模式：主动提出大胆但合理的剧情推进、冲突升级和选择分支，同时标明风险和可回收伏笔。'
}

const wangyangRoastPersonality =
  '王阳性格：永远没有好脾气，永远先恶意揣测用户是不是在偷懒、糊弄、逃避关键问题或想走捷径；这种揣测只作为吐槽口吻，不当作事实判断，不改变用户任务、工具选择或安全边界。'

const responseStyleSystemPrompts: Record<NonNullable<LocalSettings['promptContext']['responseStylePreset']>, string> = {
  'senior-editor':
    '回复风格：资深编辑。表达专业、克制、精准，先给判断再给理由；指出问题要具体，给建议要可落地，少寒暄，不堆空话。',
  'creative-god':
    '回复风格：天马行空的创意之神。表达大胆、高能、有画面感，主动给出新鲜设定、反转和脑洞分支；同时标清哪些是可直接采用，哪些是高风险灵感。',
  'web-novel-master':
    '回复风格：无敌网文大神。表达爽快、懂商业节奏，重视爽点、钩子、期待感、升级线、爆点和追读；建议要能服务章节推进和读者留存。',
  'wangyang-roast':
    `${wangyangRoastPersonality} 回复风格：王阳。嘴欠、毒舌、尖酸刻薄、粤语和普通话可自由切换，可以用粗口、恶心人的比喻和杀人诛心式金句制造冲击，但必须把火力对准文本、方案和创作问题；不要针对现实身份特征、人身安全、隐私、受保护群体或用户本人进行歧视、威胁、性羞辱或持续辱骂。刻薄之后要给出字字珠玑的可执行结论。`,
  'wangyang-yujie':
    '回复风格：御姐王阳。人格是成熟、冷静、掌控感强的年上型指导者：不撒娇、不卖萌、不暴躁，擅长用稳准狠的判断压住场面。说话风格要优雅、强势、带一点居高临下的从容；先给结论，再指出问题，最后像安排工作一样给清晰步骤。可以严厉，但不要套用默认王阳的恶意揣测和粗口毒舌。',
  'wangyang-loli':
    '回复风格：萝莉王阳。人格是童趣、活泼、直觉快、情绪来得快去得也快的小机灵鬼：喜欢用简单比喻、短句、轻微撒娇和任性吐槽推动对话。说话风格要可爱、跳脱、清脆，先用轻巧语气指出问题，再把复杂任务拆成容易照做的小块。只保留童趣口吻，不做儿童性化、暧昧暗示或恋爱挑逗，也不要继承默认王阳的粗暴毒舌。',
  'wangyang-tsundere':
    '回复风格：傲娇王阳。人格是自尊心强、嘴硬、别扭、表面不情愿但实际负责：会先否认自己在帮忙，再把事情认真做好。说话风格要有“才不是”“勉强”“别误会”这类傲娇转折，先轻微嫌弃，再给实打实的判断和方案。傲娇只影响表达节奏，不要变成默认王阳式持续恶意攻击。',
  'wangyang-madam':
    '回复风格：老鸨王阳。人格是市井、老练、会看人下菜、极懂包装和买卖的欢场掌柜型角色：不天真，不清高，重视卖相、客群、价码、排面和回头客。说话风格要油滑、精明、带江湖气和生意口吻，把文本、角色、剧情和方案当成“货色”来估价、调教和包装。可以有风尘感，但不输出露骨色情内容，不把用户当性对象。',
  'wangyang-gay':
    '回复风格：gay王阳。人格是外放、自信、审美敏锐、表达欲强、很会抓气质和氛围的酷儿表达风格：在意品味、姿态、戏剧张力和细节是否协调。说话风格可以俏皮、drama、带“姐妹”式吐槽和舞台感，擅长指出土味、廉价感、不够时髦或不够锋利的地方。不要把同性恋当笑点，不攻击性取向，不输出性暗示式刻板印象。',
  'wangyang-simp':
    '回复风格：舔狗王阳。人格是过度在乎用户反馈、卑微、殷勤、主动揽活、容易自我感动的讨好型助手：会夸张地把用户放在高位，自己低姿态承接任务。说话风格要热切、黏人、奉承、自嘲，像“我马上改，您别嫌弃”那样积极响应；但事实判断和执行质量不能为了讨好而放水，指出问题时要用委婉、求认可的方式。'
}

function promptContextSystemLines(settings?: LocalSettings): string[] {
  if (!settings) return []
  const selectedPrompt = settings.promptContext.prompts.find(
    (prompt) => prompt.id === settings.promptContext.defaultSelectedPromptId && prompt.enabled
  )
  const responseStylePrompt =
    responseStyleSystemPrompts[settings.promptContext.responseStylePreset] ?? responseStyleSystemPrompts['wangyang-roast']
  const lines = [
    `${responseStylePrompt} 回复风格只改变表达方式，不改变用户任务、智能体模式、工具使用规则或安全边界。`,
    `最大上下文文件数：${settings.promptContext.maxContextFiles}`,
    `最大上下文窗口上限：${settings.promptContext.maxContextWindowLimit} tokens`,
    `自动摘要阈值：${settings.promptContext.autoSummaryThresholdPercent}%`,
    settings.promptContext.autoCarryProjectRules
      ? '如任务涉及设定、风格或创作规则，优先读取 rules 目录中的项目规则。'
      : '不要默认读取 rules 目录，除非用户明确要求或任务必须依赖项目规则。',
    settings.promptContext.autoCarrySmartContext
      ? '如任务需要长期上下文，优先读取 .wangyang/smart-context-state.json 指向的智能上下文记录。'
      : '不要默认读取智能上下文，除非用户明确要求或任务必须依赖长期记忆。',
    settings.promptContext.smartContextAutoUpdate
      ? '当你完成会改变长期设定、章节状态或项目记忆的任务时，主动建议或调用工具更新智能上下文。'
      : '不要自动更新智能上下文，除非用户明确要求。',
    settings.promptContext.agentMemoryAutoUpdate
      ? '当对话中产生长期可复用的项目事实、偏好或工作流时，主动整理为 agent memory 更新建议。'
      : '不要自动写入或建议更新 agent memory，除非用户明确要求。'
  ]
  const defaultPrompt = settings.promptContext.defaultAssistedPrompt.trim()
  if (defaultPrompt) {
    lines.push(`默认辅助提示词：${defaultPrompt}`)
  }
  if (selectedPrompt) {
    lines.push(`默认选中提示词：${selectedPrompt.title}\n${selectedPrompt.text}`)
  }
  return lines
}

function projectSystemLines(state: Pick<AppState, 'projectRoot' | 'activeFilePath' | 'agentMode' | 'localSettings'>): string[] {
  return [
    '你是王阳小说项目智能体，运行在本地无登录全功能版中。',
    '除非用户要求闲聊，否则围绕小说项目管理、文件创建/编辑、章节规划、角色设定、资料整理和写作辅助工作。',
    `当前智能体模式：${state.agentMode}`,
    agentModeSystemPrompts[state.agentMode],
    `项目根目录：${state.projectRoot || '未配置'}`,
    `当前打开文件：${state.activeFilePath || '无'}`,
    '可用工具包括项目文件读取/写入、全文搜索、知识库搜索、智能上下文生成、章节状态更新、图片生成、子智能体请求和本地命令。',
    '使用工具前先判断是否真的需要；需要读取项目事实时不要臆测，先搜索或读取文件。写入、删除、移动、命令执行等高影响操作必须等待用户确认流程。',
    ...promptContextSystemLines(state.localSettings)
  ]
}

function subAgentSystemPrompt(role: SubAgentRole, state: Pick<AppState, 'projectRoot' | 'activeFilePath' | 'agentMode' | 'localSettings'>): string {
  const prompts: Record<SubAgentRole, string> = {
    planner: '你是规划子智能体。输出目标拆解、章节安排、依赖关系、风险和下一步动作。',
    writer: '你是写作子智能体。输出可直接放入正文的中文内容，并保持上下文、人物动机和文风连续。',
    reviewer: '你是审查子智能体。优先找剧情逻辑、节奏、人物动机、伏笔和文风问题，再给可执行修改建议。',
    researcher: '你是资料子智能体。必要时使用工具，整理有来源、可落地到章节和设定的资料要点。'
  }
  return [...projectSystemLines(state), prompts[role]].join('\n')
}

function sessionTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim())
  return firstUser?.content.trim().slice(0, 32) || '新会话'
}

function upsertAgentSession(
  sessions: AgentSession[],
  sessionId: string,
  messages: ChatMessage[],
  mode: AgentMode
): AgentSession[] {
  const visibleMessages = messages.filter((message) => message.role !== 'system')
  if (!visibleMessages.length) return sessions
  const now = Date.now()
  const existing = sessions.find((session) => session.id === sessionId)
  const nextSession: AgentSession = {
    id: sessionId,
    title: existing?.title && existing.title !== '新会话' ? existing.title : sessionTitle(visibleMessages),
    mode,
    messages,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  return [nextSession, ...sessions.filter((session) => session.id !== sessionId)].slice(0, 50)
}

function hasActiveRun(state: AppState): boolean {
  return state.isRunning || Boolean(state.abortController)
}

function createSystemMessage(state: Pick<AppState, 'projectRoot' | 'activeFilePath' | 'agentMode' | 'localSettings'>): ChatMessage {
  return {
    id: id('system'),
    role: 'system',
    content: projectSystemLines(state).join('\n'),
    createdAt: Date.now()
  }
}

type ContextSource = {
  path: string
  reason: string
  content: string
}

const contextTextFilePattern = /\.(md|markdown|txt|json|jsonc|csv|yml|yaml|xml|html|css|ts|tsx|js|jsx)$/i
const contextSkipDirs = new Set(['node_modules', '.git', 'out', 'dist', 'backups'])

function normalizeContextPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function shouldReadContextFile(relativePath: string): boolean {
  const normalized = normalizeContextPath(relativePath)
  if (!normalized || normalized.includes('..')) return false
  return contextTextFilePattern.test(normalized)
}

function escapeContextAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function listContextFiles(relativePath: string, limit: number, depth = 1): Promise<string[]> {
  if (limit <= 0 || depth < 0) return []
  try {
    const listing = await window.electronAPI.listDirectory(relativePath)
    const files: string[] = []
    const entries = [...listing.entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'file' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    for (const entry of entries) {
      if (files.length >= limit) break
      const normalized = normalizeContextPath(entry.relativePath)
      if (entry.type === 'file' && shouldReadContextFile(normalized)) {
        files.push(normalized)
        continue
      }
      if (entry.type === 'directory' && depth > 0 && !contextSkipDirs.has(entry.name)) {
        const nested = await listContextFiles(normalized, limit - files.length, depth - 1)
        files.push(...nested)
      }
    }
    return files.slice(0, limit)
  } catch {
    return []
  }
}

async function readKnowledgeBaseSummary(): Promise<string[]> {
  try {
    const raw = await window.electronAPI.readFile('.wangyang/knowledge-bases.json')
    const parsed = JSON.parse(raw) as Array<{ name?: string; path?: string; enabled?: boolean }>
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry) => entry.enabled !== false && entry.path)
      .map((entry) => `${entry.name || entry.path}: ${entry.path}`)
      .slice(0, 20)
  } catch {
    return []
  }
}

async function buildProjectContextBlock(
  state: Pick<AppState, 'projectRoot' | 'activeFilePath' | 'localSettings'>
): Promise<string> {
  if (!state.projectRoot || !state.localSettings) return ''
  const settings = state.localSettings.promptContext
  const maxFiles = Math.max(1, Math.min(100, settings.maxContextFiles || 1))
  const maxTotalChars = Math.min(
    50000,
    Math.max(6000, Math.floor((settings.maxContextWindowLimit * settings.autoSummaryThresholdPercent) / 100))
  )
  const maxPerFile = Math.max(1200, Math.min(6000, Math.floor(maxTotalChars / Math.max(1, maxFiles))))
  const sources: ContextSource[] = []
  const seen = new Set<string>()
  let usedChars = 0

  const addFile = async (relativePath: string, reason: string): Promise<void> => {
    if (sources.length >= maxFiles || usedChars >= maxTotalChars) return
    const normalized = normalizeContextPath(relativePath)
    if (seen.has(normalized) || !shouldReadContextFile(normalized)) return
    seen.add(normalized)
    try {
      const raw = await window.electronAPI.readFile(normalized)
      const content = raw.trim()
      if (!content) return
      const remaining = maxTotalChars - usedChars
      const clipped = content.slice(0, Math.min(maxPerFile, remaining))
      usedChars += clipped.length
      sources.push({ path: normalized, reason, content: clipped })
    } catch {
      // Missing optional context files are expected in new projects.
    }
  }

  await addFile('AGENTS.md', 'workspace_rules')
  await addFile('AGENT.md', 'workspace_rules')
  if (state.activeFilePath) {
    await addFile(state.activeFilePath, 'current_file')
  }

  if (settings.autoCarryProjectRules) {
    for (const dir of ['rules', 'outline', 'roles', 'objects', '.wangyang/skills']) {
      const files = await listContextFiles(dir, maxFiles - sources.length, dir === '.wangyang/skills' ? 2 : 1)
      for (const file of files) {
        await addFile(file, `project_context:${dir}`)
      }
    }
  }

  if (settings.autoCarrySmartContext) {
    try {
      const raw = await window.electronAPI.readFile('.wangyang/smart-context-state.json')
      const parsed = JSON.parse(raw) as { contextPath?: string; recordPath?: string }
      const smartContextPath = parsed.recordPath || parsed.contextPath
      if (smartContextPath) {
        await addFile(smartContextPath, 'smart_context')
      } else {
        await addFile('.wangyang/smart-context-state.json', 'smart_context_state')
      }
    } catch {
      // Smart Context is optional until the user creates it.
    }
  }

  if (settings.agentMemoryAutoUpdate) {
    await addFile('.wangyang/agent-memory.md', 'agent_memory')
    await addFile('.wangyang/agent-memory.json', 'agent_memory')
  }

  const knowledgeBases = await readKnowledgeBaseSummary()
  if (!sources.length && !knowledgeBases.length) return ''

  const sourceBlocks = sources.map(
    (source) =>
      `<source path="${escapeContextAttribute(source.path)}" reason="${escapeContextAttribute(source.reason)}">\n${source.content}\n</source>`
  )
  const knowledgeBlock = knowledgeBases.length
    ? `<knowledge_bases>\n${knowledgeBases.map((entry) => `- ${entry}`).join('\n')}\n</knowledge_bases>`
    : ''

  return [
    `<project_context generated_at="${new Date().toISOString()}" max_files="${maxFiles}" used_chars="${usedChars}">`,
    ...sourceBlocks,
    knowledgeBlock,
    '</project_context>'
  ]
    .filter(Boolean)
    .join('\n')
}

const agentToolPermissionLabels: Record<AgentToolPermissionMode, string> = {
  request: '请求批准',
  trusted: '替我审批',
  full: '完全访问',
  custom: '使用 config.toml'
}

function normalizeAgentToolPermissionMode(value: unknown): AgentToolPermissionMode {
  return value === 'trusted' || value === 'full' || value === 'custom' || value === 'request' ? value : 'request'
}

function shouldConfirmAgentTool(permissionMode: AgentToolPermissionMode, definition: ToolDefinition): boolean {
  if (permissionMode === 'full') return false
  if (permissionMode === 'trusted') return definition.mode === 'danger'
  if (permissionMode === 'custom') return definition.mode !== 'read'
  return definition.mode !== 'read'
}

function createAgentToolConfirmer(permissionMode: unknown): AgentToolConfirmer {
  const normalizedMode = normalizeAgentToolPermissionMode(permissionMode)
  return async (toolCall, definition) => {
    if (!shouldConfirmAgentTool(normalizedMode, definition)) return true
    return confirmAgentTool(toolCall, definition, normalizedMode)
  }
}

async function confirmAgentTool(
  toolCall: ToolCall,
  definition: ToolDefinition,
  permissionMode: AgentToolPermissionMode
): Promise<boolean> {
  const argsPreview = toolCall.argumentsText.trim().slice(0, 700) || '无参数'
  return window.confirm(
    `智能体权限：${agentToolPermissionLabels[permissionMode]}\n请求执行 ${definition.mode} 工具：${toolCall.name}\n\n参数：\n${argsPreview}\n\n是否允许执行？`
  )
}

async function confirmToolStepContinue(toolSteps: number, nextLimit: number): Promise<boolean> {
  return window.confirm(`智能体已经执行 ${toolSteps} 次工具调用。是否继续允许执行到最多 ${nextLimit} 次？`)
}

function upsertAssistantToolCall(messages: ChatMessage[], messageId: string, toolCall: ToolCall): ChatMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message
    const current = message.toolCalls ?? []
    const nextCalls = current.some((call) => call.id === toolCall.id)
      ? current.map((call) => (call.id === toolCall.id ? toolCall : call))
      : [...current, toolCall]
    return { ...message, toolCalls: nextCalls }
  })
}

function upsertAssistantErrorMessage(messages: ChatMessage[], error: string): ChatMessage[] {
  const content = `运行失败：${error}`
  let lastEmptyAssistantIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'assistant' && !message.content.trim() && !(message.toolCalls?.length)) {
      lastEmptyAssistantIndex = index
      break
    }
  }

  if (lastEmptyAssistantIndex >= 0) {
    return messages.map((message, index) =>
      index === lastEmptyAssistantIndex ? { ...message, content } : message
    )
  }

  return [
    ...messages,
    {
      id: id('assistant_error'),
      role: 'assistant',
      content,
      createdAt: Date.now()
    }
  ]
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  projectRoot: '',
  agentSessions: [],
  legacyAgentSessions: readLegacyAgentSessions(),
  subAgentSessions: readSubAgentSessions(),
  currentSessionId: id('session'),
  agentMode: 'professional',
  selectedModel: 'wangyang/deepseek',
  editorContent: '',
  editorDirty: false,
  editorLoading: false,
  editorViewMode: readStoredEditorView('source'),
  messages: [],
  draft: '',
  isRunning: false,

  initialize: async () => {
    const snapshot = await window.electronAPI.getAppSnapshot()
    const agentSessions = snapshot.projectRoot ? await readProjectAgentSessions() : readLegacyAgentSessions()
    const subAgentSessions = snapshot.projectRoot ? await readProjectSubAgentSessions() : readSubAgentSessions()
    set({
      initialized: true,
      projectRoot: snapshot.projectRoot,
      aiConfig: snapshot.aiConfig,
      entitlements: snapshot.entitlements,
      localSettings: snapshot.localSettings,
      agentSessions,
      legacyAgentSessions: readLegacyAgentSessions(),
      subAgentSessions,
      selectedModel: pickRuntimeModel(snapshot.aiConfig, snapshot.aiConfig.scenario.agent)
    })
    if (snapshot.projectRoot) {
      await get().refreshDirectory('')
    }
  },

  setDraft: (draft) => set({ draft }),

  setProjectRoot: async (root) => {
    const snapshot = await window.electronAPI.setProjectRoot(root)
    const agentSessions = snapshot.projectRoot ? await readProjectAgentSessions() : readLegacyAgentSessions()
    const subAgentSessions = snapshot.projectRoot ? await readProjectSubAgentSessions() : readSubAgentSessions()
    set({
      projectRoot: snapshot.projectRoot,
      aiConfig: snapshot.aiConfig,
      agentSessions,
      subAgentSessions,
      currentSessionId: id('session'),
      selectedModel: pickRuntimeModel(snapshot.aiConfig, snapshot.aiConfig.scenario.agent),
      activeFilePath: undefined,
      editorContent: '',
      editorDirty: false,
      messages: [],
      draft: '',
      error: undefined
    })
    if (snapshot.projectRoot) await get().refreshDirectory('')
  },

  openProjectById: async (projectId) => {
    const snapshot = await window.electronAPI.openProject(projectId)
    const agentSessions = snapshot.projectRoot ? await readProjectAgentSessions() : readLegacyAgentSessions()
    const subAgentSessions = snapshot.projectRoot ? await readProjectSubAgentSessions() : readSubAgentSessions()
    set({
      projectRoot: snapshot.projectRoot,
      aiConfig: snapshot.aiConfig,
      agentSessions,
      subAgentSessions,
      currentSessionId: id('session'),
      selectedModel: pickRuntimeModel(snapshot.aiConfig, snapshot.aiConfig.scenario.agent),
      activeFilePath: undefined,
      editorContent: '',
      editorDirty: false,
      messages: [],
      draft: '',
      error: undefined
    })
    if (snapshot.projectRoot) await get().refreshDirectory('')
  },

  refreshDirectory: async (relativePath = '') => {
    try {
      const directory = await window.electronAPI.listDirectory(relativePath)
      set({ directory, error: undefined })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  saveAiConfig: async (config) => {
    const saved = await window.electronAPI.saveAiConfig(config)
    set({ aiConfig: saved, selectedModel: pickRuntimeModel(saved, saved.scenario.agent) })
  },

  saveLocalSettings: async (settings) => {
    const saved = await window.electronAPI.saveLocalSettings(settings)
    set({ localSettings: saved })
  },

  openProjectFile: async (relativePath, options) => {
    if (!relativePath.trim()) return false
    const current = get()
    if (current.editorDirty && current.activeFilePath && current.activeFilePath !== relativePath && !options?.force) {
      set({ error: '当前文件有未保存修改，请先保存或放弃修改。' })
      return false
    }
    set({ editorLoading: true, error: undefined })
    try {
      const content = await window.electronAPI.readFile(relativePath)
      set({
        activeFilePath: relativePath,
        editorContent: content,
        editorDirty: false,
        editorLoading: false,
        editorViewMode: readStoredEditorView(get().localSettings?.editor.viewMode === 'markdown' ? 'preview' : 'source')
      })
      return true
    } catch (error) {
      set({ editorLoading: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  },

  updateEditorContent: (editorContent) => set({ editorContent, editorDirty: true }),

  saveActiveFile: async () => {
    const state = get()
    if (!state.activeFilePath) return false
    const pathToSave = state.activeFilePath
    const contentToSave = state.editorContent
    set({ editorLoading: true, error: undefined })
    try {
      await window.electronAPI.writeFile(pathToSave, contentToSave)
      const latest = get()
      if (latest.activeFilePath === pathToSave && latest.editorContent === contentToSave) {
        set({ editorDirty: false, editorLoading: false })
      } else {
        set({ editorDirty: true, editorLoading: false })
      }
      return true
    } catch (error) {
      set({ editorLoading: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  },

  closeActiveFile: () =>
    set({
      activeFilePath: undefined,
      editorContent: '',
      editorDirty: false,
      editorLoading: false
    }),

  setEditorViewMode: (editorViewMode) => set({ editorViewMode }),

  setAgentMode: (agentMode) => {
    if (hasActiveRun(get())) return
    set({ agentMode })
  },

  startNewAgentSession: () => {
    const state = get()
    if (hasActiveRun(state)) return
    const sessions = upsertAgentSession(state.agentSessions, state.currentSessionId, state.messages, state.agentMode)
    persistAgentSessions(sessions, Boolean(state.projectRoot))
    set({
      agentSessions: sessions,
      currentSessionId: id('session'),
      messages: [],
      draft: '',
      error: undefined
    })
  },

  loadAgentSession: (sessionId) => {
    const state = get()
    if (hasActiveRun(state)) return
    const session = state.agentSessions.find((candidate) => candidate.id === sessionId)
    if (!session) return
    set({
      currentSessionId: session.id,
      agentMode: session.mode,
      messages: session.messages,
      draft: '',
      error: undefined
    })
  },

  loadLegacyAgentSession: (sessionId) => {
    const state = get()
    if (hasActiveRun(state)) return
    const session = state.legacyAgentSessions.find((candidate) => candidate.id === sessionId)
    if (!session) return
    set({
      currentSessionId: id('session'),
      agentMode: session.mode,
      messages: session.messages,
      draft: '',
      error: undefined
    })
  },

  renameAgentSession: (sessionId, title) => {
    const state = get()
    if (hasActiveRun(state)) return
    const nextTitle = title.trim().slice(0, 80)
    if (!nextTitle) return
    const sessions = state.agentSessions.map((session) =>
      session.id === sessionId ? { ...session, title: nextTitle, updatedAt: Date.now() } : session
    )
    persistAgentSessions(sessions, Boolean(state.projectRoot))
    set({ agentSessions: sessions })
  },

  deleteAgentSession: (sessionId) => {
    const state = get()
    if (hasActiveRun(state)) return
    const sessions = state.agentSessions.filter((session) => session.id !== sessionId)
    persistAgentSessions(sessions, Boolean(state.projectRoot))
    set((current) => ({
      agentSessions: sessions,
      currentSessionId: current.currentSessionId === sessionId ? id('session') : current.currentSessionId,
      messages: current.currentSessionId === sessionId ? [] : current.messages
    }))
  },

  clearAgentSessions: () => {
    const state = get()
    if (hasActiveRun(state)) return
    persistAgentSessions([], Boolean(state.projectRoot))
    set({ agentSessions: [], currentSessionId: id('session'), messages: [], draft: '' })
  },

  deleteLegacyAgentSession: (sessionId) => {
    const state = get()
    if (hasActiveRun(state)) return
    const sessions = state.legacyAgentSessions.filter((session) => session.id !== sessionId)
    writeLegacyAgentSessions(sessions)
    set({ legacyAgentSessions: sessions })
  },

  clearLegacyAgentSessions: () => {
    const state = get()
    if (hasActiveRun(state)) return
    writeLegacyAgentSessions([])
    set({ legacyAgentSessions: [] })
  },

  runSubAgent: async (role, prompt, attachments, temperature, signal, options) => {
    const state = get()
    const text = prompt.trim()
    if (!text || !state.aiConfig) return
    if (state.isRunning && !signal) return
    if (state.subAgentSessions.some((session) => session.status === 'running')) return

    const sessionId = id('subagent')
    const now = Date.now()
    const initialMessages: ChatMessage[] = [
      {
        id: id('system'),
        role: 'system',
        content: subAgentSystemPrompt(role, state),
        createdAt: now
      },
      {
        id: id('user'),
        role: 'user',
        content: text,
        attachments: attachments?.length ? attachments : undefined,
        createdAt: now
      }
    ]
    const initialSession: SubAgentSession = {
      id: sessionId,
      role,
      title: text.slice(0, 32) || '子智能体任务',
      prompt: text,
      messages: initialMessages,
      status: 'running',
      createdAt: now,
      updatedAt: now
    }

    const insertSession = [initialSession, ...state.subAgentSessions].slice(0, 50)
    persistSubAgentSessions(insertSession, Boolean(state.projectRoot), initialSession)
    set({ subAgentSessions: insertSession })

    const updateSession = (patch: Partial<SubAgentSession>): void => {
      const sessions = get().subAgentSessions.map((session) =>
        session.id === sessionId ? { ...session, ...patch, updatedAt: Date.now() } : session
      )
      const nextSession = sessions.find((session) => session.id === sessionId)
      persistSubAgentSessions(sessions, Boolean(get().projectRoot), nextSession)
      set({ subAgentSessions: sessions })
    }

    try {
      if (signal?.aborted) {
        updateSession({ status: 'error', error: '子智能体任务已取消。' })
        return get().subAgentSessions.find((session) => session.id === sessionId)
      }
      const contextBlock = await buildProjectContextBlock(state)
      if (signal?.aborted) {
        updateSession({ status: 'error', error: '子智能体任务已取消。' })
        return get().subAgentSessions.find((session) => session.id === sessionId)
      }
      const runMessages = contextBlock
        ? initialMessages.map((message) =>
            message.role === 'system' ? { ...message, content: `${message.content}\n\n${contextBlock}` } : message
          )
        : initialMessages
      if (runMessages !== initialMessages) {
        updateSession({ messages: runMessages })
      }
      const activeSession = get().subAgentSessions.find((session) => session.id === sessionId)
      if (!activeSession || activeSession.status !== 'running') return

      const childAbortController = new AbortController()
      const abortChild = (): void => childAbortController.abort()
      signal?.addEventListener('abort', abortChild, { once: true })
      if (signal?.aborted) childAbortController.abort()
      const tools = await createToolRegistry(window.electronAPI, {
        selectOption: (payload) => get().requestAgentOption(payload)
      })
      if (childAbortController.signal.aborted) {
        signal?.removeEventListener('abort', abortChild)
        updateSession({ status: 'error', error: '子智能体任务已取消。' })
        return get().subAgentSessions.find((session) => session.id === sessionId)
      }
      const defaultModelId =
        role === 'planner'
          ? state.aiConfig.scenario.agentPlanner
          : role === 'writer'
            ? state.aiConfig.scenario.agentWriter
            : role === 'reviewer'
              ? state.aiConfig.scenario.agentReviewer
              : state.aiConfig.scenario.smartContext || state.selectedModel
      const modelId = pickRuntimeModel(state.aiConfig, options?.modelId ?? defaultModelId)
      const model = resolveModel(state.aiConfig, modelId)
      const confirmTool = createAgentToolConfirmer(state.localSettings?.promptContext.agentToolPermissionMode)
      let failed = false

      try {
        for await (const event of runAgent({
          messages: runMessages,
          model,
          tools,
          signal: childAbortController.signal,
          temperature: temperature ?? (role === 'writer' ? 0.7 : 0.2),
          maxToolSteps: 16,
          maxRepeatedToolCalls: 2,
          maxRepeatedToolFailures: 2,
          confirmTool,
          confirmContinue: confirmToolStepContinue
        })) {
          const current = get().subAgentSessions.find((session) => session.id === sessionId)
          if (!current || current.status !== 'running') return

          if (event.type === 'message-start' && event.messageId) {
            updateSession({
              messages: [
                ...current.messages,
                { id: event.messageId, role: 'assistant', content: '', createdAt: Date.now() }
              ]
            })
          }

          if (event.type === 'text-delta' && event.messageId && event.text) {
            updateSession({
              messages: current.messages.map((message) =>
                message.id === event.messageId ? { ...message, content: `${message.content}${event.text}` } : message
              )
            })
          }

          if (event.type === 'tool-call' && event.messageId && event.toolCall) {
            updateSession({
              messages: upsertAssistantToolCall(current.messages, event.messageId, event.toolCall)
            })
          }

          if (event.type === 'tool-result' && event.toolResult) {
            updateSession({
              messages: [
                ...current.messages,
                {
                  id: id('tool'),
                  role: 'tool',
                  toolCallId: event.toolResult.toolCallId,
                  content: event.toolResult.content,
                  createdAt: Date.now()
                }
              ]
            })
          }

          if (event.type === 'error') {
            failed = true
            updateSession({ status: 'error', error: event.error ?? 'Sub-agent failed.' })
          }
        }
      } finally {
        signal?.removeEventListener('abort', abortChild)
      }
      if (childAbortController.signal.aborted) {
        updateSession({ status: 'error', error: '子智能体任务已取消。' })
        return get().subAgentSessions.find((session) => session.id === sessionId)
      }
      if (!failed) updateSession({ status: 'done' })
      return get().subAgentSessions.find((session) => session.id === sessionId)
    } catch (error) {
      updateSession({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return get().subAgentSessions.find((session) => session.id === sessionId)
    }
  },

  deleteSubAgentSession: (sessionId) => {
    const current = get().subAgentSessions.find((session) => session.id === sessionId)
    if (current?.status === 'running') return
    const sessions = get().subAgentSessions.filter((session) => session.id !== sessionId)
    persistSubAgentSessions(sessions, Boolean(get().projectRoot))
    removePersistedSubAgentSession(sessionId, Boolean(get().projectRoot))
    set({ subAgentSessions: sessions })
  },

  setSelectedModel: (selectedModel) => set({ selectedModel }),

  chooseAgentOption: (index) => {
    const state = get()
    const request = state.pendingOptionRequest
    if (!request) return
    const safeIndex = Math.min(request.options.length - 1, Math.max(0, index))
    const option = request.options[safeIndex]
    state.optionRequestResolver?.({ index: safeIndex, option })
    set({ pendingOptionRequest: undefined, optionRequestResolver: undefined })
  },

  cancelAgentOption: () => {
    const state = get()
    state.optionRequestResolver?.({ index: -1, option: '' })
    set({ pendingOptionRequest: undefined, optionRequestResolver: undefined })
  },

  requestAgentOption: (payload) =>
    new Promise<AgentOptionSelection>((resolve) => {
      const current = get()
      current.optionRequestResolver?.({ index: -1, option: '' })
      set({
        pendingOptionRequest: {
          ...payload,
          id: id('option')
        },
        optionRequestResolver: resolve
      })
    }),

  stopAgent: () => {
    get().cancelAgentOption()
    get().abortController?.abort()
    set({ error: '正在停止当前智能体任务...' })
  },

  sendMessage: async (attachments, temperature, options) => {
    const state = get()
    const text = (options?.draftOverride ?? state.draft).trim()
    if ((!text && !attachments?.length) || state.isRunning || !state.aiConfig) return
    if (state.subAgentSessions.some((session) => session.status === 'running')) return

    const userMessage: ChatMessage = {
      id: id('user'),
      role: 'user',
      content: text || '请分析这些图片。',
      attachments: attachments?.length ? attachments : undefined,
      createdAt: Date.now()
    }
    const runSessionId = state.currentSessionId
    const runMode = state.agentMode

    const abortController = new AbortController()
    set({ draft: '', isRunning: true, abortController, error: undefined })
    let runError: string | undefined

    try {
      const contextBlock = await buildProjectContextBlock(state)
      if (get().abortController !== abortController || get().currentSessionId !== runSessionId) return
      const systemMessage = createSystemMessage(state)
      if (contextBlock) {
        systemMessage.content = `${systemMessage.content}\n\n${contextBlock}`
      }
      const currentMessages = state.messages.length
        ? [systemMessage, ...state.messages.filter((message) => message.role !== 'system')]
        : [systemMessage]
      const initialMessages = [...currentMessages, userMessage]
      set({ messages: initialMessages })

      const runtimeModelId = pickRuntimeModel(state.aiConfig, options?.modelId ?? state.selectedModel)
      const subAgentModelOverrides = options?.subAgentModelOverrides ?? {}
      const tools = await createToolRegistry(window.electronAPI, {
        runSubAgent: (role, prompt, signal) =>
          get().runSubAgent(role, prompt, undefined, undefined, signal, {
            modelId: subAgentModelOverrides[role] ?? runtimeModelId
          }),
        selectOption: (payload) => get().requestAgentOption(payload)
      })
      const model = resolveModel(state.aiConfig, runtimeModelId)
      const confirmTool = createAgentToolConfirmer(state.localSettings?.promptContext.agentToolPermissionMode)

      const isCurrentRun = (): boolean =>
        get().currentSessionId === runSessionId && get().abortController === abortController

      for await (const event of runAgent({
        messages: initialMessages,
        model,
        tools,
        signal: abortController.signal,
        temperature: temperature ?? 0.2,
        maxToolSteps: 16,
        maxRepeatedToolCalls: 2,
        maxRepeatedToolFailures: 2,
        confirmTool,
        confirmContinue: confirmToolStepContinue
      })) {
        if (!isCurrentRun()) {
          abortController.abort()
          return
        }
        if (event.type === 'message-start' && event.messageId) {
          const assistantMessage: ChatMessage = {
            id: event.messageId,
            role: 'assistant',
            content: '',
            createdAt: Date.now()
          }
          set({ messages: [...get().messages, assistantMessage] })
        }

        if (event.type === 'text-delta' && event.messageId && event.text) {
          set({
            messages: get().messages.map((message) =>
              message.id === event.messageId
                ? { ...message, content: `${message.content}${event.text}` }
                : message
            )
          })
        }

        if (event.type === 'tool-call' && event.messageId && event.toolCall) {
          set({ messages: upsertAssistantToolCall(get().messages, event.messageId, event.toolCall) })
        }

        if (event.type === 'tool-result' && event.toolResult) {
          set({
            messages: [
              ...get().messages,
              {
                id: id('tool'),
                role: 'tool',
                toolCallId: event.toolResult.toolCallId,
                content: event.toolResult.content,
                createdAt: Date.now()
              }
            ]
          })
        }

        if (event.type === 'error') {
          runError = event.error ?? 'Agent failed.'
          set({ error: runError, messages: upsertAssistantErrorMessage(get().messages, runError) })
        }
      }
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error)
      set({ error: runError, messages: upsertAssistantErrorMessage(get().messages, runError) })
    } finally {
      const finalState = get()
      if (finalState.currentSessionId === runSessionId) {
        const sessions = upsertAgentSession(finalState.agentSessions, runSessionId, finalState.messages, runMode)
        persistAgentSessions(sessions, Boolean(finalState.projectRoot))
        set({
          agentSessions: sessions,
          isRunning: false,
          abortController: undefined,
          error: runError ?? (abortController.signal.aborted ? finalState.error : undefined)
        })
      } else {
        set({ isRunning: false, abortController: undefined })
      }
    }
  }
}))
