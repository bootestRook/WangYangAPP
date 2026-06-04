import {
  AtSign,
  BookOpen,
  Bot,
  Box,
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  FileText,
  Image as ImageIcon,
  Info,
  Lightbulb,
  List,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { displayModelId, displayProviderId } from '../../core/models/modelDisplay'
import { isConfiguredRuntimeModel, normalizeKnownModelAlias, pickRuntimeModel } from '../../core/models/modelConfig'
import type {
  AgentFileInfo,
  AgentMode,
  AgentToolPermissionMode,
  AiConfig,
  ChatAttachment,
  ChatMessage,
  ProjectEntry,
  PromptTemplate,
  ResponseStylePreset,
  SubAgentRole,
  ToolCall
} from '../../shared/types'
import { useAppStore } from '../stores/useAppStore'

const quickPrompts = [
  {
    title: '智能开篇',
    body: '通过对话帮助您快速构建小说前几章，定义主要角色和创作规则',
    prompt: '请通过提问的方式帮我完成小说开篇设计，包括核心卖点、主角、开场冲突、前三章目标和创作规则。'
  },
  {
    title: '创建角色',
    body: '通过对话帮助您设计立体有趣的角色，包括外貌、性格、背景等',
    prompt: '请帮我创建一个立体角色。请依次补全外貌、性格、欲望、弱点、背景、关系网和可用于剧情推进的秘密。'
  },
  {
    title: '世界观构建',
    body: '帮助您构建完整的故事世界，包括地理、历史、文化等设定',
    prompt: '请帮我构建故事世界观，包括地理、历史、势力、文化、规则限制、冲突来源和可写成章节的事件。'
  },
  {
    title: '剧情讨论',
    body: '帮助我讨论剧情，规划后续可能的剧情走向，给我灵感',
    prompt: '请和我讨论当前剧情，指出可加强的矛盾、悬念和人物动机，并给出三个后续走向方案。'
  }
]

const agentModes: Array<{ value: AgentMode; label: string; prompt: string }> = [
  { value: 'professional', label: '专业辅助', prompt: '请切换为专业辅助模式，优先给出结构化、可执行的小说创作建议。' },
  { value: 'planning', label: '规划辅助', prompt: '请切换为规划辅助模式，帮助我拆解项目目标、章节安排和下一步任务。' },
  { value: 'writing', label: '写作辅助', prompt: '请切换为写作辅助模式，优先输出可直接放入正文的内容。' },
  { value: 'adventure', label: '冒险模式', prompt: '请切换为冒险模式，主动提出大胆但合理的剧情推进方案。' }
]

const subAgentRoles: Array<{ value: SubAgentRole; label: string; prompt: string }> = [
  { value: 'planner', label: '规划子智能体', prompt: '请拆解当前小说项目的下一步规划，并列出优先级。' },
  { value: 'writer', label: '写作子智能体', prompt: '请根据当前上下文续写一段可直接使用的正文。' },
  { value: 'reviewer', label: '审查子智能体', prompt: '请审查当前章节的逻辑、节奏、人物动机和伏笔问题。' },
  { value: 'researcher', label: '资料子智能体', prompt: '请整理当前题材需要的资料要点，并说明可用于哪些章节。' }
]

const responseStyleOptions: Array<{ value: ResponseStylePreset; label: string; title: string }> = [
  { value: 'senior-editor', label: '资深编辑', title: '资深编辑：专业克制，先判断后理由。' },
  { value: 'creative-god', label: '创意之神', title: '天马行空的创意之神：大胆高能，给脑洞、反转和分支。' },
  { value: 'web-novel-master', label: '网文大神', title: '无敌网文大神：重视爽点、钩子、升级线和追读。' },
  { value: 'wangyang-roast', label: '王阳', title: '王阳：没好脾气，恶意揣测用户，嘴欠毒舌，火力对准文本和方案。' },
  { value: 'wangyang-yujie', label: '御姐王阳', title: '御姐王阳：成熟冷静、掌控感强，优雅强势地给判断和步骤。' },
  { value: 'wangyang-loli', label: '萝莉王阳', title: '萝莉王阳：童趣活泼、跳脱清脆，把复杂任务拆成小块。' },
  { value: 'wangyang-tsundere', label: '傲娇王阳', title: '傲娇王阳：嘴硬别扭，先不情愿地吐槽，再认真给方案。' },
  { value: 'wangyang-madam', label: '老鸨王阳', title: '老鸨王阳：市井老练、精明油滑，按卖相和客群包装方案。' },
  { value: 'wangyang-gay', label: 'gay王阳', title: 'gay王阳：外放自信、审美敏锐，俏皮有舞台感地挑气质。' },
  { value: 'wangyang-simp', label: '舔狗王阳', title: '舔狗王阳：卑微殷勤、热切讨好，用低姿态把活接住。' }
]

function normalizeResponseStylePreset(value: unknown): ResponseStylePreset {
  return responseStyleOptions.some((option) => option.value === value) ? (value as ResponseStylePreset) : 'wangyang-roast'
}

function splitDisplayedUserContent(content: string): { visible: string; context?: string } {
  const marker = '\n\n用户需求：\n'
  const markerIndex = content.lastIndexOf(marker)
  if (markerIndex < 0) return { visible: content }

  const context = content.slice(0, markerIndex).trim()
  const visible = content.slice(markerIndex + marker.length).trim()
  return {
    visible: visible || content,
    context: context || undefined
  }
}

type ComposerPanel = 'none' | 'mention' | 'slash' | 'prompts' | 'thinking' | 'permissions'
type ContextMode = 'none' | 'project' | 'current-file' | 'smart-context'
type ThinkingMode = 'fast' | 'balanced' | 'deep'
type AgentSolutionId = 'professional' | 'planning' | 'adventure'
type AgentProfileId = 'main' | 'planner' | 'writer' | 'reviewer' | 'researcher'
type AgentModelOverrides = Partial<Record<AgentProfileId, string>>
type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
type TodoItem = {
  id: string
  title: string
  status: TodoStatus
  markdownPath?: string
  createdAt: number
  updatedAt: number
}

const AGENT_MODEL_OVERRIDES_KEY = 'wangyang.agent.modelOverrides'

function normalizeTodoStatus(value: unknown): TodoStatus {
  if (value === 'in_progress' || value === 'completed' || value === 'cancelled' || value === 'pending') return value
  if (value === 'done') return 'completed'
  if (value === 'todo') return 'pending'
  return 'pending'
}

function modelProviderId(modelId: string): string {
  return modelId.split('/').filter(Boolean)[0] ?? ''
}

function modelNameFromId(modelId: string): string {
  const parts = modelId.split('/').filter(Boolean)
  return parts.length > 1 ? parts.slice(1).join('/') : modelId
}

function readAgentModelOverrides(): AgentModelOverrides {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AGENT_MODEL_OVERRIDES_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).filter(([profile, model]) => {
        return ['main', 'planner', 'writer', 'reviewer', 'researcher'].includes(profile) && typeof model === 'string'
      })
      .map(([profile, model]) => [profile, normalizeKnownModelAlias(model as string)])
    ) as AgentModelOverrides
  } catch {
    return {}
  }
}

function defaultRuntimeModelForProfile(config: AiConfig | undefined, selectedModel: string, profile: AgentProfileId): string {
  if (!config) return selectedModel
  if (profile === 'main') return config.scenario.agent || selectedModel
  if (profile === 'planner') return config.scenario.agentPlanner || selectedModel
  if (profile === 'writer') return config.scenario.agentWriter || selectedModel
  if (profile === 'reviewer') return config.scenario.agentReviewer || selectedModel
  if (profile === 'researcher') return config.scenario.smartContext || selectedModel
  return selectedModel
}

function runtimeModelForProfile(
  config: AiConfig | undefined,
  selectedModel: string,
  profile: AgentProfileId,
  overrides: AgentModelOverrides
): string {
  const override = overrides[profile]
  if (!config) return override ?? selectedModel
  const defaultModel = defaultRuntimeModelForProfile(config, selectedModel, profile)
  const preferred = override && config.availableModels.includes(override) ? override : defaultModel
  return pickRuntimeModel(config, preferred)
}

function profileForSubAgentRole(role: SubAgentRole): AgentProfileId {
  if (role === 'planner') return 'planner'
  if (role === 'writer') return 'writer'
  if (role === 'reviewer') return 'reviewer'
  return 'researcher'
}

function runtimeModelStatus(config: AiConfig | undefined, modelId: string) {
  const provider = config?.interfaces[modelProviderId(modelId)]
  const requestFormat = provider?.requestFormat ?? 'openai'
  const hasApiKey = Boolean(provider?.apiKey?.trim())
  return {
    providerLabel: provider?.label ?? displayProviderId(modelProviderId(modelId) || 'unknown'),
    modelName: modelNameFromId(modelId),
    requestFormat,
    hasApiKey,
    isReady: Boolean(config && isConfiguredRuntimeModel(config, modelId))
  }
}

const contextOptions: Array<{ value: ContextMode; label: string; instruction: string }> = [
  { value: 'none', label: '无上下文', instruction: '' },
  {
    value: 'project',
    label: '项目全文',
    instruction: '请先按需使用 list_project_files、read_file_content、search_in_files 等工具读取项目资料后再回答。'
  },
  {
    value: 'current-file',
    label: '当前文件',
    instruction: '请优先读取并参考当前打开文件。'
  },
  {
    value: 'smart-context',
    label: '智能上下文',
    instruction: '请优先读取 .wangyang/smart-context-state.json 以及状态文件指向的智能上下文记录，再继续回答。'
  }
]

const thinkingModes: Array<{ value: ThinkingMode; label: string; description: string; instruction: string }> = [
  { value: 'fast', label: '快速', description: '直接给出结果，少做展开。', instruction: '请快速给出直接、可执行的回答。' },
  {
    value: 'balanced',
    label: '思考',
    description: '先判断任务，再给出结构化结果。',
    instruction: '请先判断任务目标和必要工具，再给出结构化、可落地的回答。'
  },
  {
    value: 'deep',
    label: '深度思考',
    description: '适合规划、审查、复杂剧情推演。',
    instruction: '请进行更完整的推理，明确假设、风险、取舍和下一步动作。'
  }
]

const permissionModes: Array<{
  value: AgentToolPermissionMode
  label: string
  shortLabel: string
  description: string
}> = [
  {
    value: 'request',
    label: '请求批准',
    shortLabel: '请求批准',
    description: '读取项目可直接执行；联网、写入、子智能体和本地命令会先询问。'
  },
  {
    value: 'trusted',
    label: '替我审批',
    shortLabel: '替我审批',
    description: '允许常规读取、联网、写入和子智能体；仅本地命令等危险操作询问。'
  },
  {
    value: 'full',
    label: '完全访问',
    shortLabel: '完全访问',
    description: '不弹确认，允许智能体直接执行所有已注册工具。'
  },
  {
    value: 'custom',
    label: '使用 config.toml',
    shortLabel: '自定义',
    description: '预留给 config.toml 策略；当前按“请求批准”执行。'
  }
]

function normalizeAgentToolPermissionMode(value: unknown): AgentToolPermissionMode {
  return value === 'trusted' || value === 'full' || value === 'custom' || value === 'request' ? value : 'request'
}

const slashCommands = [
  {
    label: '/总结当前章节',
    description: '读取当前打开文件并生成摘要、人物变化和伏笔。',
    icon: BookOpen,
    text: '请读取当前打开文件，整理章节摘要、人物状态变化、关键伏笔和下一章衔接建议。'
  },
  {
    label: '/续写当前章节',
    description: '基于当前文件续写正文。',
    icon: Sparkles,
    text: '请读取当前打开文件，保持原有风格和人物动机，续写一段约 800 字的正文。'
  },
  {
    label: '/润色改写',
    description: '对当前草稿进行润色、扩写或改写。',
    icon: FileText,
    text: '请对我接下来提供的文本进行润色，保留剧情信息，增强画面感、节奏和人物表达。'
  },
  {
    label: '/项目巡检',
    description: '扫描项目结构并指出缺口。',
    icon: Search,
    text: '请列出当前项目结构，检查规划、大纲、章节、角色、设定、记录、灵感、资产是否存在明显缺口，并给出优先级。'
  },
  {
    label: '/创建智能上下文',
    description: '生成或更新智能上下文记录。',
    icon: Brain,
    text: '请基于项目内容创建或更新智能上下文，先检查 .wangyang/smart-context-state.json，再按需要写回记录分组。'
  },
  {
    label: '/调用子智能体',
    description: '把任务拆给本地子智能体。',
    icon: Bot,
    text: '请把这个任务拆成规划、写作、审查、资料四类子任务，并说明应该调用哪个子智能体优先处理。'
  }
]

const promptLibrary = [
  {
    title: '章节审查',
    body: '检查逻辑、节奏、人物动机、伏笔和爽点。',
    text: '请审查当前章节，重点检查逻辑漏洞、节奏拖沓、人物动机、伏笔回收和读者期待，并按严重程度列出修改建议。'
  },
  {
    title: '三幕式规划',
    body: '把当前故事拆成阶段目标和章节推进。',
    text: '请把当前故事拆成三幕式结构，列出每一幕的目标、冲突升级、关键反转、人物变化和章节安排。'
  },
  {
    title: '角色弧光',
    body: '为角色补全欲望、缺陷、选择和变化。',
    text: '请为这个角色设计完整弧光，包括表层目标、深层欲望、致命缺陷、关键选择、关系变化和结局状态。'
  },
  {
    title: '爽点强化',
    body: '增强期待、压迫、反转和释放。',
    text: '请分析当前剧情的爽点结构，指出期待建立、压迫升级、反转触发和情绪释放可以强化的地方。'
  }
]

function configuredPromptItems(prompts: PromptTemplate[], defaultSelectedPromptId: string) {
  const enabled = prompts.filter((prompt) => prompt.enabled && prompt.text.trim())
  const selected = enabled.find((prompt) => prompt.id === defaultSelectedPromptId)
  const ordered = selected ? [selected, ...enabled.filter((prompt) => prompt.id !== selected.id)] : enabled
  return ordered.map((prompt) => ({
    title: prompt.title.trim() || '未命名提示词',
    body: prompt.body.trim() || '来自提示词管理。',
    text: prompt.text
  }))
}

const maxImageAttachments = 4
const maxImageAttachmentBytes = 5 * 1024 * 1024
const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const agentProfiles: Record<
  AgentProfileId,
  { label: string; description: string; instruction: string; subAgentRole?: SubAgentRole }
> = {
  main: {
    label: '主智能体',
    description: '负责对话、调度工具和承接完整任务。',
    instruction: '你是当前方案的主智能体，需要根据任务主动选择工具、整理上下文并给出可执行结果。'
  },
  planner: {
    label: '规划智能体',
    description: '拆解目标、章节结构和执行顺序。',
    instruction: '你是规划智能体，请优先输出目标拆解、依赖关系、章节安排和下一步动作。',
    subAgentRole: 'planner'
  },
  writer: {
    label: '写作智能体',
    description: '生成可直接使用的正文或片段。',
    instruction: '你是写作智能体，请保持上下文一致，输出可直接放入作品的中文正文。',
    subAgentRole: 'writer'
  },
  reviewer: {
    label: '审查智能体',
    description: '检查逻辑、节奏、人物和伏笔问题。',
    instruction: '你是审查智能体，请优先找出问题、风险和修改建议，不要只做泛泛评价。',
    subAgentRole: 'reviewer'
  },
  researcher: {
    label: '资料智能体',
    description: '整理题材资料和可落地用法。',
    instruction: '你是资料智能体，请整理与当前题材相关的资料要点，并说明可以怎样用于章节。',
    subAgentRole: 'researcher'
  }
}

const agentSolutions: Array<{
  id: AgentSolutionId
  label: string
  mode: AgentMode
  description: string
  primaryAgent: AgentProfileId
  agents: AgentProfileId[]
  prompt: string
}> = [
  {
    id: 'professional',
    label: '专业辅助',
    mode: 'professional',
    description: '管理项目、创建文件、编辑内容和调用工具。',
    primaryAgent: 'main',
    agents: ['main', 'planner', 'writer', 'reviewer', 'researcher'],
    prompt: '请切换为专业辅助方案，优先给出结构化、可执行的小说创作建议。'
  },
  {
    id: 'planning',
    label: '智能规划',
    mode: 'planning',
    description: '更偏规划、拆解、章节安排和长期上下文。',
    primaryAgent: 'planner',
    agents: ['planner', 'main', 'reviewer', 'researcher'],
    prompt: '请切换为智能规划方案，先拆解目标、上下文和下一步任务，再输出执行顺序。'
  },
  {
    id: 'adventure',
    label: '游戏冒险',
    mode: 'adventure',
    description: '更偏大胆剧情推进、选择分支和冲突升级。',
    primaryAgent: 'writer',
    agents: ['writer', 'main', 'planner', 'reviewer'],
    prompt: '请切换为游戏冒险方案，主动给出大胆但合理的剧情推进、选择分支和冲突升级方案。'
  }
]

function roleLabel(role: string, assistantLabel = '智能体'): string {
  if (role === 'user') return '你'
  if (role === 'assistant') return assistantLabel
  return '工具'
}

function fileMeta(entry: ProjectEntry): string {
  if (entry.type === 'directory') return '文件夹'
  const size = entry.size ?? 0
  if (size < 1024) return `${size} B`
  return `${Math.ceil(size / 1024)} KB`
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function timestampAgentName(): string {
  return `智能体-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`
}

type ConversationTurn = {
  id: string
  user?: ChatMessage
  events: ChatMessage[]
  processMessages: ChatMessage[]
  finalAssistant?: ChatMessage
  toolCallCount: number
  toolResultCount: number
  hasProcess: boolean
  hasError: boolean
}

function pickFinalAssistant(events: ChatMessage[]): ChatMessage | undefined {
  return [...events]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content.trim() && !(message.toolCalls?.length))
}

function buildConversationTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: Array<{ id: string; user?: ChatMessage; events: ChatMessage[] }> = []
  let current: { id: string; user?: ChatMessage; events: ChatMessage[] } | undefined

  const pushCurrent = (): void => {
    if (!current) return
    if (current.user || current.events.length) turns.push(current)
  }

  for (const message of messages) {
    if (message.role === 'user') {
      pushCurrent()
      current = { id: message.id, user: message, events: [] }
      continue
    }

    if (!current) current = { id: message.id, events: [] }
    current.events.push(message)
  }

  pushCurrent()

  return turns.map((turn) => {
    const finalAssistant = pickFinalAssistant(turn.events)
    const processMessages = turn.events.filter((message) => message !== finalAssistant)
    const toolCallCount = turn.events.reduce((count, message) => count + (message.toolCalls?.length ?? 0), 0)
    const toolResultCount = turn.events.filter((message) => message.role === 'tool').length
    const hasProcess = processMessages.some(
      (message) => message.role === 'tool' || Boolean(message.toolCalls?.length) || Boolean(message.content.trim())
    )
    return {
      ...turn,
      finalAssistant,
      processMessages,
      toolCallCount,
      toolResultCount,
      hasProcess,
      hasError: Boolean(finalAssistant?.content.trim().startsWith('运行失败：'))
    }
  })
}

function toolStatusLabel(toolCall: ToolCall): string {
  if (toolCall.status === 'running') return '执行中'
  if (toolCall.status === 'success') return '完成'
  return '失败'
}

function compactTraceText(text: string, maxChars = 1200): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n... ${text.length - maxChars} chars hidden`
}

interface AgentWorkbenchProps {
  onCollapse?: () => void
}

export function AgentWorkbench({ onCollapse }: AgentWorkbenchProps) {
  const messages = useAppStore((state) => state.messages)
  const draft = useAppStore((state) => state.draft)
  const setDraft = useAppStore((state) => state.setDraft)
  const projectRoot = useAppStore((state) => state.projectRoot)
  const openProjectFile = useAppStore((state) => state.openProjectFile)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const isRunning = useAppStore((state) => state.isRunning)
  const agentSessions = useAppStore((state) => state.agentSessions)
  const legacyAgentSessions = useAppStore((state) => state.legacyAgentSessions)
  const subAgentSessions = useAppStore((state) => state.subAgentSessions)
  const currentSessionId = useAppStore((state) => state.currentSessionId)
  const agentMode = useAppStore((state) => state.agentMode)
  const setAgentMode = useAppStore((state) => state.setAgentMode)
  const startNewAgentSession = useAppStore((state) => state.startNewAgentSession)
  const loadAgentSession = useAppStore((state) => state.loadAgentSession)
  const loadLegacyAgentSession = useAppStore((state) => state.loadLegacyAgentSession)
  const renameAgentSession = useAppStore((state) => state.renameAgentSession)
  const deleteAgentSession = useAppStore((state) => state.deleteAgentSession)
  const clearAgentSessions = useAppStore((state) => state.clearAgentSessions)
  const deleteLegacyAgentSession = useAppStore((state) => state.deleteLegacyAgentSession)
  const clearLegacyAgentSessions = useAppStore((state) => state.clearLegacyAgentSessions)
  const runSubAgent = useAppStore((state) => state.runSubAgent)
  const deleteSubAgentSession = useAppStore((state) => state.deleteSubAgentSession)
  const pendingOptionRequest = useAppStore((state) => state.pendingOptionRequest)
  const chooseAgentOption = useAppStore((state) => state.chooseAgentOption)
  const cancelAgentOption = useAppStore((state) => state.cancelAgentOption)
  const stopAgent = useAppStore((state) => state.stopAgent)
  const aiConfig = useAppStore((state) => state.aiConfig)
  const selectedModel = useAppStore((state) => state.selectedModel)
  const setSelectedModel = useAppStore((state) => state.setSelectedModel)
  const activeFilePath = useAppStore((state) => state.activeFilePath)
  const localSettings = useAppStore((state) => state.localSettings)
  const saveLocalSettings = useAppStore((state) => state.saveLocalSettings)
  const [showHistory, setShowHistory] = useState(false)
  const [showSubAgents, setShowSubAgents] = useState(false)
  const [showAgentFiles, setShowAgentFiles] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTodos, setShowTodos] = useState(false)
  const [todoItems, setTodoItems] = useState<TodoItem[]>([])
  const [projectAgents, setProjectAgents] = useState<AgentFileInfo[]>([])
  const [projectAgentsLoading, setProjectAgentsLoading] = useState(false)
  const [isClosed, setIsClosed] = useState(false)
  const [subAgentRole, setSubAgentRole] = useState<SubAgentRole>('planner')
  const [subAgentPrompt, setSubAgentPrompt] = useState(subAgentRoles[0].prompt)
  const [composerPanel, setComposerPanel] = useState<ComposerPanel>('none')
  const [contextMode, setContextMode] = useState<ContextMode>('project')
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('balanced')
  const [attachments, setAttachments] = useState<ProjectEntry[]>([])
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [fileCandidates, setFileCandidates] = useState<ProjectEntry[]>([])
  const [fileLoading, setFileLoading] = useState(false)
  const [imageAttachments, setImageAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string>()
  const [historyTab, setHistoryTab] = useState<'current' | 'legacy'>('current')
  const [previewSessionId, setPreviewSessionId] = useState<string>()
  const [renameSessionId, setRenameSessionId] = useState<string>()
  const [renameTitle, setRenameTitle] = useState('')
  const [selectedSolutionId, setSelectedSolutionId] = useState<AgentSolutionId>('professional')
  const [selectedAgentId, setSelectedAgentId] = useState<AgentProfileId>('main')
  const [modelOverrides, setModelOverrides] = useState<AgentModelOverrides>(readAgentModelOverrides)
  const [agentTemperature, setAgentTemperature] = useState(0.2)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const agentScrollRef = useRef<HTMLDivElement>(null)
  const userMessageRefs = useRef<Record<string, HTMLElement | null>>({})
  const lastAutoScrolledUserIdRef = useRef<string | undefined>(undefined)

  const visibleMessages = messages.filter((message) => message.role !== 'system')
  const conversationTurns = useMemo(() => buildConversationTurns(visibleMessages), [visibleMessages])
  const latestUserMessageId = useMemo(() => {
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      if (visibleMessages[index].role === 'user') return visibleMessages[index].id
    }
    return undefined
  }, [visibleMessages])
  const hasMessages = conversationTurns.length > 0
  const historySessions = historyTab === 'current' ? agentSessions : legacyAgentSessions
  const previewSession = historySessions.find((session) => session.id === previewSessionId)
  const selectedSolution =
    agentSolutions.find((solution) => solution.id === selectedSolutionId) ?? agentSolutions[0]
  const selectedAgentProfile = agentProfiles[selectedAgentId] ?? agentProfiles.main
  const selectedResponseStyle = normalizeResponseStylePreset(localSettings?.promptContext.responseStylePreset)
  const selectedResponseStyleOption =
    responseStyleOptions.find((option) => option.value === selectedResponseStyle) ?? responseStyleOptions[0]
  const assistantResponseLabel = selectedResponseStyleOption.label
  const defaultActiveRuntimeModel = defaultRuntimeModelForProfile(aiConfig, selectedModel, selectedAgentId)
  const activeRuntimeModel = runtimeModelForProfile(aiConfig, selectedModel, selectedAgentId, modelOverrides)
  const activeRuntimeModelHasOverride = activeRuntimeModel !== defaultActiveRuntimeModel
  const selectedModelMetadata = aiConfig?.modelMetadata[activeRuntimeModel]
  const activeRuntimeModelStatus = runtimeModelStatus(aiConfig, activeRuntimeModel)
  const manualSubAgentProfile = profileForSubAgentRole(subAgentRole)
  const manualSubAgentModel = runtimeModelForProfile(aiConfig, selectedModel, manualSubAgentProfile, modelOverrides)
  const manualSubAgentModelStatus = runtimeModelStatus(aiConfig, manualSubAgentModel)
  const subAgentRuntimeModels = useMemo(
    () => ({
      planner: runtimeModelForProfile(aiConfig, selectedModel, 'planner', modelOverrides),
      writer: runtimeModelForProfile(aiConfig, selectedModel, 'writer', modelOverrides),
      reviewer: runtimeModelForProfile(aiConfig, selectedModel, 'reviewer', modelOverrides),
      researcher: runtimeModelForProfile(aiConfig, selectedModel, 'researcher', modelOverrides)
    }),
    [aiConfig, modelOverrides, selectedModel]
  )
  const selectableAgents = selectedSolution.agents.map((agentId) => ({ id: agentId, ...agentProfiles[agentId] }))
  const subAgentRunning = subAgentSessions.some((session) => session.status === 'running')
  const thinkingOption = useMemo(
    () => thinkingModes.find((mode) => mode.value === thinkingMode) ?? thinkingModes[1],
    [thinkingMode]
  )
  const selectedPermissionMode = normalizeAgentToolPermissionMode(
    localSettings?.promptContext.agentToolPermissionMode
  )
  const selectedPermissionOption =
    permissionModes.find((mode) => mode.value === selectedPermissionMode) ?? permissionModes[0]
  const defaultPrompt = localSettings?.promptContext.defaultAssistedPrompt.trim()
  const allPrompts = useMemo(
    () => [
      ...configuredPromptItems(
        localSettings?.promptContext.prompts ?? [],
        localSettings?.promptContext.defaultSelectedPromptId ?? ''
      ),
      ...(defaultPrompt ? [{ title: '默认辅助提示词', body: '来自提示词和上下文配置。', text: defaultPrompt }] : []),
      ...promptLibrary
    ],
    [defaultPrompt, localSettings?.promptContext.defaultSelectedPromptId, localSettings?.promptContext.prompts]
  )

  useEffect(() => {
    if (!isRunning || !latestUserMessageId || lastAutoScrolledUserIdRef.current === latestUserMessageId) return

    const container = agentScrollRef.current
    const target = userMessageRefs.current[latestUserMessageId]
    if (!container || !target) return

    lastAutoScrolledUserIdRef.current = latestUserMessageId
    window.requestAnimationFrame(() => {
      const scrollContainer = agentScrollRef.current
      const messageNode = userMessageRefs.current[latestUserMessageId]
      if (!scrollContainer || !messageNode) return

      const containerRect = scrollContainer.getBoundingClientRect()
      const messageRect = messageNode.getBoundingClientRect()
      const preferredOffset = Math.min(84, Math.max(24, scrollContainer.clientHeight * 0.14))
      const nextTop = scrollContainer.scrollTop + messageRect.top - containerRect.top - preferredOffset

      scrollContainer.scrollTo({
        top: Math.max(0, nextTop),
        behavior: 'smooth'
      })
    })
  }, [isRunning, latestUserMessageId])

  const refreshProjectAgents = async (): Promise<void> => {
    if (!projectRoot) {
      setProjectAgents([])
      return
    }
    setProjectAgentsLoading(true)
    try {
      setProjectAgents(await window.electronAPI.listAgents())
      setAttachmentError(undefined)
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '刷新项目智能体失败')
    } finally {
      setProjectAgentsLoading(false)
    }
  }

  const createProjectAgentFile = async (): Promise<void> => {
    if (!projectRoot) {
      setAttachmentError('请先配置项目根目录。')
      return
    }
    try {
      const created = await window.electronAPI.createAgent(timestampAgentName())
      await refreshProjectAgents()
      openProjectFile(created.relativePath)
      setShowAgentFiles(true)
      setAttachmentError(undefined)
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '创建项目智能体失败')
    }
  }

  const useProjectAgentFile = async (agent: AgentFileInfo): Promise<void> => {
    try {
      const content = await window.electronAPI.readAgentContent(agent.id)
      const metadata = [
        agent.description ? `说明：${agent.description}` : '',
        agent.tools?.length ? `可用工具：${agent.tools.join('、')}` : '',
        agent.skills?.length ? `关联技能：${agent.skills.join('、')}` : ''
      ]
        .filter(Boolean)
        .join('\n')
      const instruction = `请按项目智能体「${agent.name}」执行：${metadata ? `\n${metadata}` : ''}\n\n${content.trim()}\n\n任务：`
      setDraft(draft.trim() ? `${draft.trimEnd()}\n\n${instruction}` : instruction)
      setShowAgentFiles(false)
      setAttachmentError(undefined)
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '读取项目智能体失败')
    }
  }

  const deleteProjectAgentFile = async (agent: AgentFileInfo): Promise<void> => {
    if (!window.confirm(`确定删除项目智能体「${agent.name}」吗？`)) return
    try {
      await window.electronAPI.deleteAgent(agent.id)
      await refreshProjectAgents()
      setAttachmentError(undefined)
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '删除项目智能体失败')
    }
  }

  useEffect(() => {
    if (showTodos) void refreshTodos()
  }, [showTodos])

  useEffect(() => {
    if (showAgentFiles) void refreshProjectAgents()
  }, [projectRoot, showAgentFiles])

  useEffect(() => {
    window.localStorage.setItem(AGENT_MODEL_OVERRIDES_KEY, JSON.stringify(modelOverrides))
  }, [modelOverrides])

  const appendDraft = (text: string): void => {
    setDraft(draft ? `${draft}${text}` : text.trimStart())
  }

  const appendInstruction = (text: string): void => {
    setDraft(draft.trim() ? `${draft.trimEnd()}\n${text}` : text)
    setComposerPanel('none')
  }

  const replaceTrailingTrigger = (trigger: string, text: string): void => {
    const base = draft.endsWith(trigger) ? draft.slice(0, -trigger.length) : draft
    const spacer = base && !/[\s\n]$/.test(base) ? ' ' : ''
    setDraft(`${base}${spacer}${text}`)
  }

  const setRuntimeModelForProfile = (profile: AgentProfileId, model: string): void => {
    setModelOverrides((current) => ({ ...current, [profile]: model }))
    setSelectedModel(model)
  }

  const resetRuntimeModelForProfile = (profile: AgentProfileId): void => {
    setModelOverrides((current) => {
      const next = { ...current }
      delete next[profile]
      return next
    })
    setSelectedModel(defaultRuntimeModelForProfile(aiConfig, selectedModel, profile))
  }

  const addAttachment = (entry: ProjectEntry): void => {
    setAttachments((current) =>
      current.some((item) => item.relativePath === entry.relativePath) ? current : [...current, entry].slice(0, 8)
    )
    replaceTrailingTrigger('@', `@${entry.relativePath} `)
    setComposerPanel('none')
  }

  const removeAttachment = (relativePath: string): void => {
    setAttachments((current) => current.filter((entry) => entry.relativePath !== relativePath))
  }

  const removeImageAttachment = (attachmentId: string): void => {
    setImageAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
  }

  const addImageFiles = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return
    setAttachmentError(undefined)
    const selected = [...files]
    const remainingSlots = maxImageAttachments - imageAttachments.length
    if (remainingSlots <= 0) {
      setAttachmentError(`最多添加 ${maxImageAttachments} 张图片。`)
      return
    }

    const accepted: ChatAttachment[] = []
    for (const file of selected.slice(0, remainingSlots)) {
      if (!allowedImageTypes.has(file.type)) {
        setAttachmentError('仅支持 PNG、JPEG、WebP 或 GIF 图片。')
        continue
      }
      if (file.size > maxImageAttachmentBytes) {
        setAttachmentError('单张图片不能超过 5MB。')
        continue
      }
      const dataUrl = await readImageAsDataUrl(file)
      accepted.push({
        id: `image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'image',
        name: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl
      })
    }

    if (selected.length > remainingSlots) {
      setAttachmentError(`最多添加 ${maxImageAttachments} 张图片，已忽略多余图片。`)
    }
    if (accepted.length) {
      setImageAttachments((current) => [...current, ...accepted].slice(0, maxImageAttachments))
    }
  }

  const composeOutgoingDraft = (): string => {
    const userText = draft.trim() || (imageAttachments.length ? '请分析我附加的图片，并结合当前上下文回答。' : '')
    if (!userText) return ''
    const contextInstruction = contextOptions.find((option) => option.value === contextMode)?.instruction
    const blocks: string[] = [
      `当前智能方案：${selectedSolution.label}。${selectedSolution.description}`,
      `当前智能体：${selectedAgentProfile.label}。${selectedAgentProfile.instruction}`
    ]

    if (contextInstruction) {
      if (contextMode === 'current-file' && activeFilePath) {
        blocks.push(`${contextInstruction}\n当前打开文件：${activeFilePath}`)
      } else if (contextMode !== 'current-file') {
        blocks.push(contextInstruction)
      }
    }

    if (localSettings?.promptContext.autoCarryProjectRules && contextMode !== 'project') {
      blocks.push('如任务涉及设定、风格或创作规则，请优先读取 rules 目录中的项目规则。')
    }

    if (localSettings?.promptContext.autoCarrySmartContext && contextMode !== 'smart-context') {
      blocks.push('如需要长期上下文，请优先读取 .wangyang/smart-context-state.json 指向的智能上下文记录。')
    }

    if (attachments.length) {
      blocks.push(`请优先参考这些项目文件或目录：\n${attachments.map((entry) => `- ${entry.relativePath}`).join('\n')}`)
    }

    if (thinkingOption.instruction) {
      blocks.push(thinkingOption.instruction)
    }

    return blocks.length ? `${blocks.join('\n\n')}\n\n用户需求：\n${userText}` : userText
  }

  const sendComposerMessage = async (): Promise<void> => {
    if (isRunning) {
      stopAgent()
      return
    }
    if (subAgentRunning) return
    const nextDraft = composeOutgoingDraft()
    if (!nextDraft) return
    if (!activeRuntimeModelStatus.isReady) {
      setAttachmentError(
        `当前实际调用模型 ${displayModelId(activeRuntimeModel)} 的接口 ${activeRuntimeModelStatus.providerLabel} 未配置 API Key。`
      )
      return
    }
    if (selectedAgentProfile.subAgentRole) {
      setDraft('')
      setComposerPanel('none')
      setAttachments([])
      setImageAttachments([])
      setAttachmentError(undefined)
      setShowSubAgents(true)
      await runSubAgent(selectedAgentProfile.subAgentRole, nextDraft, imageAttachments, agentTemperature, undefined, {
        modelId: activeRuntimeModel
      })
      return
    }
    setDraft(nextDraft)
    setComposerPanel('none')
    setAttachments([])
    setImageAttachments([])
    setAttachmentError(undefined)
    await sendMessage(imageAttachments, agentTemperature, {
      modelId: activeRuntimeModel,
      subAgentModelOverrides: subAgentRuntimeModels
    })
  }

  const runManualSubAgent = async (): Promise<void> => {
    if (!subAgentPrompt.trim() || subAgentRunning || isRunning) return
    if (!manualSubAgentModelStatus.isReady) {
      setAttachmentError(
        `当前子智能体模型 ${displayModelId(manualSubAgentModel)} 的接口 ${manualSubAgentModelStatus.providerLabel} 未配置 API Key。`
      )
      return
    }
    setAttachmentError(undefined)
    await runSubAgent(subAgentRole, subAgentPrompt, undefined, agentTemperature, undefined, {
      modelId: manualSubAgentModel
    })
  }

  const switchSolution = (solutionId: AgentSolutionId): void => {
    const solution = agentSolutions.find((item) => item.id === solutionId) ?? agentSolutions[0]
    setSelectedSolutionId(solution.id)
    setSelectedAgentId(solution.primaryAgent)
    setAgentMode(solution.mode)
    if (!draft.trim()) {
      setDraft(solution.prompt)
    }
  }

  const startRenameSession = (sessionId: string, title: string): void => {
    setRenameSessionId(sessionId)
    setRenameTitle(title)
  }

  const commitRenameSession = (): void => {
    if (!renameSessionId) return
    renameAgentSession(renameSessionId, renameTitle)
    setRenameSessionId(undefined)
    setRenameTitle('')
  }

  const confirmDeleteSession = (sessionId: string): void => {
    if (!window.confirm('确定删除这条会话记录？')) return
    if (historyTab === 'legacy') {
      deleteLegacyAgentSession(sessionId)
    } else {
      deleteAgentSession(sessionId)
    }
    if (previewSessionId === sessionId) setPreviewSessionId(undefined)
  }

  const confirmClearSessions = (): void => {
    const label = historyTab === 'legacy' ? '旧版会话' : '当前项目会话'
    if (!window.confirm(`确定清空${label}？`)) return
    if (historyTab === 'legacy') {
      clearLegacyAgentSessions()
    } else {
      clearAgentSessions()
    }
    setPreviewSessionId(undefined)
    setRenameSessionId(undefined)
  }

  const updatePromptContext = (patch: Partial<NonNullable<typeof localSettings>['promptContext']>): void => {
    if (!localSettings) return
    void saveLocalSettings({
      ...localSettings,
      promptContext: {
        ...localSettings.promptContext,
        ...patch
      }
    })
  }

  const writeTodos = async (items: TodoItem[]): Promise<void> => {
    const normalized = items.map((item) => ({
      ...item,
      status: normalizeTodoStatus(item.status),
      markdownPath: item.markdownPath || '.wangyang/todos.md'
    }))
    await window.electronAPI.writeFile('.wangyang/todos.json', `${JSON.stringify(normalized, null, 2)}\n`)
    const markdownPaths = new Set(['.wangyang/todos.md', ...normalized.map((item) => item.markdownPath || '.wangyang/todos.md')])
    for (const path of markdownPaths) {
      const scoped = normalized.filter((item) => (item.markdownPath || '.wangyang/todos.md') === path || path === '.wangyang/todos.md')
      const markdown = `# Project Todo\n\n${scoped
        .map((item) => `- [${item.status === 'completed' ? 'x' : ' '}] [${item.status}] ${item.title}`)
        .join('\n')}\n`
      await window.electronAPI.writeFile(path, markdown)
    }
    setTodoItems(normalized)
  }

  const refreshTodos = async (): Promise<void> => {
    try {
      const raw = await window.electronAPI.readFile('.wangyang/todos.json')
      const parsed = JSON.parse(raw) as TodoItem[]
      setTodoItems(
        Array.isArray(parsed)
          ? parsed
              .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
              .map((item) => ({
                ...item,
                status: normalizeTodoStatus(item.status),
                markdownPath: item.markdownPath || '.wangyang/todos.md'
              }))
          : []
      )
    } catch {
      setTodoItems([])
    }
  }

  const updateTodoStatus = async (id: string, status: TodoStatus): Promise<void> => {
    const next = todoItems.map((item) => (item.id === id ? { ...item, status, updatedAt: Date.now() } : item))
    await writeTodos(next)
  }

  useEffect(() => {
    if (composerPanel !== 'mention') return
    let alive = true
    setFileLoading(true)
    const query = fileSearchQuery.trim()

    ;(async () => {
      try {
        const listing = query
          ? await window.electronAPI.searchFiles(query, 80)
          : (await window.electronAPI.listDirectory('')).entries
        if (alive) setFileCandidates(listing.slice(0, 80))
      } catch {
        if (alive) setFileCandidates([])
      } finally {
        if (alive) setFileLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [composerPanel, fileSearchQuery])

  useEffect(() => {
    const solution = agentSolutions.find((item) => item.mode === agentMode)
    if (!solution || solution.id === selectedSolutionId) return
    setSelectedSolutionId(solution.id)
    if (!solution.agents.includes(selectedAgentId)) {
      setSelectedAgentId(solution.primaryAgent)
    }
  }, [agentMode, selectedAgentId, selectedSolutionId])

  const renderComposerPanel = () => {
    if (composerPanel === 'mention') {
      return (
        <div className="composer-popup mention-popup">
          <header>
            <strong>引用项目文件</strong>
            <button onClick={() => setComposerPanel('none')}>
              <X size={13} />
            </button>
          </header>
          <div className="popup-search">
            <Search size={14} />
            <input
              value={fileSearchQuery}
              placeholder="搜索文件或目录"
              onChange={(event) => setFileSearchQuery(event.target.value)}
            />
          </div>
          <div className="popup-list">
            {fileLoading ? <p>正在读取...</p> : null}
            {!fileLoading && fileCandidates.length
              ? fileCandidates.map((entry) => (
                  <button key={entry.relativePath} onClick={() => addAttachment(entry)}>
                    {entry.type === 'directory' ? <BookOpen size={14} /> : <FileText size={14} />}
                    <span>{entry.relativePath}</span>
                    <em>{fileMeta(entry)}</em>
                  </button>
                ))
              : null}
            {!fileLoading && !fileCandidates.length ? <p>暂无匹配文件</p> : null}
          </div>
        </div>
      )
    }

    if (composerPanel === 'slash') {
      return (
        <div className="composer-popup slash-popup">
          <header>
            <strong>快速命令</strong>
            <button onClick={() => setComposerPanel('none')}>
              <X size={13} />
            </button>
          </header>
          <div className="popup-list">
            {slashCommands.map((command) => {
              const Icon = command.icon
              return (
                <button
                  key={command.label}
                  onClick={() => {
                    replaceTrailingTrigger('/', command.text)
                    setComposerPanel('none')
                  }}
                >
                  <Icon size={14} />
                  <span>
                    <strong>{command.label}</strong>
                    <small>{command.description}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )
    }

    if (composerPanel === 'prompts') {
      return (
        <div className="composer-popup prompts-popup">
          <header>
            <strong>我的提示词</strong>
            <button onClick={() => setComposerPanel('none')}>
              <X size={13} />
            </button>
          </header>
          <div className="popup-list">
            {allPrompts.map((prompt) => (
              <button key={prompt.title} onClick={() => appendInstruction(prompt.text)}>
                <Lightbulb size={14} />
                <span>
                  <strong>{prompt.title}</strong>
                  <small>{prompt.body}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )
    }

    if (composerPanel === 'thinking') {
      return (
        <div className="composer-popup thinking-popup">
          <header>
            <strong>思考模式</strong>
            <button onClick={() => setComposerPanel('none')}>
              <X size={13} />
            </button>
          </header>
          <div className="popup-list">
            {thinkingModes.map((mode) => (
              <button
                className={thinkingMode === mode.value ? 'active' : ''}
                key={mode.value}
                onClick={() => {
                  setThinkingMode(mode.value)
                  setComposerPanel('none')
                }}
              >
                <Brain size={14} />
                <span>
                  <strong>{mode.label}</strong>
                  <small>{mode.description}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )
    }

    if (composerPanel === 'permissions') {
      return (
        <div className="composer-popup permission-popup">
          <header>
            <strong>智能体工具权限</strong>
            <button onClick={() => setComposerPanel('none')}>
              <X size={13} />
            </button>
          </header>
          <div className="popup-list">
            {permissionModes.map((mode) => (
              <button
                className={selectedPermissionMode === mode.value ? 'active' : ''}
                key={mode.value}
                disabled={!localSettings}
                onClick={() => {
                  updatePromptContext({ agentToolPermissionMode: mode.value })
                  setComposerPanel('none')
                }}
              >
                <Shield size={14} />
                <span>
                  <strong>{mode.label}</strong>
                  <small>{mode.description}</small>
                </span>
                {selectedPermissionMode === mode.value ? <Check size={14} /> : null}
              </button>
            ))}
          </div>
        </div>
      )
    }

    return null
  }

  const renderMessageAttachments = (message: ChatMessage) =>
    message.attachments?.length ? (
      <div className="message-attachments">
        {message.attachments.map((attachment) => (
          <figure key={attachment.id}>
            <img src={attachment.dataUrl} alt={attachment.name} />
            <figcaption>{attachment.name}</figcaption>
          </figure>
        ))}
      </div>
    ) : null

  const renderToolCalls = (toolCalls: ToolCall[] | undefined) =>
    toolCalls?.length ? (
      <div className="tool-call-list">
        {toolCalls.map((toolCall) => (
          <div className="tool-call" key={toolCall.id}>
            <Box size={14} />
            <span>{toolCall.name || 'pending_tool'}</span>
            <em>{toolStatusLabel(toolCall)}</em>
            <code>{compactTraceText(toolCall.argumentsText || '{}', 360)}</code>
          </div>
        ))}
      </div>
    ) : null

  const renderProcessMessage = (message: ChatMessage, index: number) => {
    if (message.role === 'assistant') {
      return (
        <div className="agent-process-step" key={`${message.id}-${index}`}>
          <header>
            <Bot size={13} />
            <span>中间输出</span>
          </header>
          {message.content.trim() ? <pre>{compactTraceText(message.content)}</pre> : null}
          {renderToolCalls(message.toolCalls)}
        </div>
      )
    }

    if (message.role === 'tool') {
      return (
        <div className="agent-process-step tool-result" key={`${message.id}-${index}`}>
          <header>
            <Wrench size={13} />
            <span>工具结果</span>
            {message.toolCallId ? <code>{message.toolCallId}</code> : null}
          </header>
          <pre>{compactTraceText(message.content)}</pre>
        </div>
      )
    }

    return null
  }

  const renderTurnProcess = (turn: ConversationTurn, isActiveTurn: boolean) => {
    if (!turn.finalAssistant && !isActiveTurn && !turn.hasProcess) return null
    const traceTitle = isActiveTurn ? '正在处理' : turn.hasError ? '运行失败' : '已处理'
    const traceMeta = turn.hasError
      ? '请求未完成'
      : turn.toolCallCount
        ? `已运行 ${turn.toolCallCount} 个工具${turn.toolResultCount ? ` · ${turn.toolResultCount} 个结果` : ''}`
        : '直接回复'
    return (
      <details className="agent-process codex-trace" open={isActiveTurn}>
        <summary>
          <span className="trace-heading">
            {isActiveTurn ? <RefreshCw size={13} /> : <Clock3 size={13} />}
            <strong>{traceTitle}</strong>
            {isActiveTurn ? '正在处理' : '处理过程'}
          </span>
          <em className="trace-meta">
            <strong>{traceMeta}</strong>
            {turn.toolCallCount ? `${turn.toolCallCount} 个工具调用` : '无工具调用'}
            {turn.toolResultCount ? ` / ${turn.toolResultCount} 个结果` : ''}
          </em>
          <ChevronDown size={14} />
        </summary>
        <div className="agent-process-body">
          {turn.processMessages.length ? (
            turn.processMessages.map(renderProcessMessage)
          ) : (
            <p className="agent-process-empty">本轮没有调用工具，模型直接生成最终回复。</p>
          )}
        </div>
      </details>
    )
  }

  const renderAssistantFinal = (message: ChatMessage) => (
    <article className="agent-message assistant" key={message.id}>
      <header>
        <span>{assistantResponseLabel}</span>
      </header>
      <pre>{message.content}</pre>
      {renderMessageAttachments(message)}
    </article>
  )

  const renderUserMessage = (message: ChatMessage) => {
    const displayed = splitDisplayedUserContent(message.content)

    return (
      <article
        className="agent-message user"
        key={message.id}
        ref={(node) => {
          userMessageRefs.current[message.id] = node
        }}
      >
        <header>
          <span>用户</span>
        </header>
        <pre>{displayed.visible}</pre>
        {displayed.context ? (
          <details className="agent-user-context">
            <summary>已附加智能体上下文</summary>
            <pre>{displayed.context}</pre>
          </details>
        ) : null}
        {renderMessageAttachments(message)}
      </article>
    )
  }

  if (isClosed && !onCollapse) {
    return (
      <button className="agent-reopen" onClick={() => setIsClosed(false)}>
        <Bot size={18} />
        <span>打开智能体</span>
      </button>
    )
  }

  return (
    <div className="agent-workbench">
      <header className="agent-header">
        <div>
          <Bot size={16} />
          <strong>智能体</strong>
        </div>
        <button className={showHistory ? 'history-button active' : 'history-button'} onClick={() => setShowHistory((value) => !value)}>
          <Clock3 size={14} />
          <span>历史会话</span>
        </button>
        <button className="ghost-icon" title="关闭" onClick={() => (onCollapse ? onCollapse() : setIsClosed(true))}>
          <X size={15} />
        </button>
      </header>

      <div className="agent-modebar">
        <select value={selectedSolutionId} disabled={isRunning} onChange={(event) => switchSolution(event.target.value as AgentSolutionId)}>
          {agentSolutions.map((solution) => (
            <option key={solution.id} value={solution.id}>
              {solution.label}
            </option>
          ))}
        </select>
        <span className="agent-solution-meter">⚡ 0</span>
        <Info size={13} />
        <select
          className="response-style-select"
          value={selectedResponseStyle}
          disabled={isRunning || !localSettings}
          title={`${selectedResponseStyleOption.title} 只改变说话风格，不改变任务。`}
          onChange={(event) => updatePromptContext({ responseStylePreset: event.target.value as ResponseStylePreset })}
        >
          {responseStyleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button className={showSettings ? 'ghost-icon active' : 'ghost-icon'} onClick={() => setShowSettings((value) => !value)}>
          <Settings size={13} />
        </button>
      </div>

      <div className="agent-market-tip">
        <span>当前智能方案不满意？</span>
        <button onClick={() => setShowSettings(true)}>前往智能市场看看</button>
      </div>

      <div className="agent-scroll" ref={agentScrollRef}>
        {pendingOptionRequest ? (
          <div className="floating-panel option-panel">
            <header>
              <strong>{pendingOptionRequest.title}</strong>
              <button onClick={cancelAgentOption}>
                <X size={13} />
                <span>取消</span>
              </button>
            </header>
            {pendingOptionRequest.question ? <p>{pendingOptionRequest.question}</p> : null}
            <div className="option-list">
              {pendingOptionRequest.options.map((option, index) => (
                <button key={`${pendingOptionRequest.id}-${index}`} onClick={() => chooseAgentOption(index)}>
                  <span>{index + 1}</span>
                  <strong>{option}</strong>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {showHistory ? (
          <div className="floating-panel history-panel">
            <header>
              <strong>历史会话</strong>
              <div>
                <button disabled={isRunning || !historySessions.length} onClick={confirmClearSessions}>
                  <Trash2 size={13} />
                  清空
                </button>
                <button disabled={isRunning} onClick={startNewAgentSession}>
                  <Plus size={14} />
                  新会话
                </button>
              </div>
            </header>

            <div className="history-tabs">
              <button className={historyTab === 'current' ? 'active' : ''} onClick={() => setHistoryTab('current')}>
                当前项目
              </button>
              <button className={historyTab === 'legacy' ? 'active' : ''} onClick={() => setHistoryTab('legacy')}>
                旧版
              </button>
            </div>

            {historySessions.length ? (
              historySessions.slice(0, 30).map((session) => (
                <div className="history-row expanded" key={session.id}>
                  <div className={session.id === currentSessionId && historyTab === 'current' ? 'active history-main' : 'history-main'}>
                    <span>{agentModes.find((mode) => mode.value === session.mode)?.label ?? '智能体'}</span>
                    {renameSessionId === session.id && historyTab === 'current' ? (
                      <input
                        value={renameTitle}
                        onChange={(event) => setRenameTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRenameSession()
                          if (event.key === 'Escape') setRenameSessionId(undefined)
                        }}
                      />
                    ) : (
                      <em>{session.title}</em>
                    )}
                    <p>{new Date(session.updatedAt).toLocaleString()}</p>
                  </div>
                  <div className="history-actions">
                    <button
                      title={historyTab === 'legacy' ? '恢复旧版会话' : '切换继续'}
                      disabled={isRunning}
                      onClick={() => (historyTab === 'legacy' ? loadLegacyAgentSession(session.id) : loadAgentSession(session.id))}
                    >
                      {historyTab === 'legacy' ? <RotateCcw size={13} /> : <Clock3 size={13} />}
                    </button>
                    <button title="预览" onClick={() => setPreviewSessionId(previewSessionId === session.id ? undefined : session.id)}>
                      <Eye size={13} />
                    </button>
                    {historyTab === 'current' ? (
                      <button
                        title={renameSessionId === session.id ? '保存名称' : '重命名'}
                        disabled={isRunning}
                        onClick={() =>
                          renameSessionId === session.id ? commitRenameSession() : startRenameSession(session.id, session.title)
                        }
                      >
                        <Pencil size={13} />
                      </button>
                    ) : null}
                    <button title="删除会话" disabled={isRunning} onClick={() => confirmDeleteSession(session.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p>暂无历史会话</p>
            )}

            {previewSession ? (
              <article className="history-preview">
                <header>
                  <strong>预览</strong>
                  <button onClick={() => setPreviewSessionId(undefined)}>
                    <X size={12} />
                  </button>
                </header>
                <em>{previewSession.title}</em>
                <pre>
                  {previewSession.messages
                    .filter((message) => message.role !== 'system')
                    .slice(-6)
                    .map((message) => {
                      const imageNames = message.attachments?.map((attachment) => attachment.name).join('、')
                      return `${roleLabel(message.role, assistantResponseLabel)}：${message.content}${imageNames ? `\n[图片：${imageNames}]` : ''}`
                    })
                    .join('\n\n') || '暂无消息'}
                </pre>
              </article>
            ) : null}
          </div>
        ) : null}

        {showAgentFiles ? (
          <div className="floating-panel agent-file-panel">
            <header>
              <strong>项目智能体</strong>
              <div>
                <button disabled={projectAgentsLoading || !projectRoot} onClick={() => void refreshProjectAgents()}>
                  <RefreshCw size={12} />
                  刷新
                </button>
                <button disabled={!projectRoot} onClick={() => void createProjectAgentFile()}>
                  <Plus size={13} />
                  新建
                </button>
              </div>
            </header>
            <p className="panel-note">保存在项目内 .wangyang/agents，可作为专用角色提示词套用到当前对话。</p>
            {!projectRoot ? <p className="panel-empty">请先配置项目根目录</p> : null}
            {projectRoot && projectAgentsLoading ? <p className="panel-empty">正在加载项目智能体...</p> : null}
            {projectRoot && !projectAgentsLoading && !projectAgents.length ? <p className="panel-empty">暂无项目智能体</p> : null}
            <div className="agent-file-list">
              {projectAgents.map((agent) => (
                <article className="agent-file-row" key={agent.id}>
                  <button title={agent.relativePath} onClick={() => void useProjectAgentFile(agent)}>
                    <Bot size={14} />
                    <span>
                      <strong>
                        {agent.name}
                        {agent.isBuiltIn ? <em>内置</em> : null}
                      </strong>
                      <small>{agent.description || agent.relativePath}</small>
                      {agent.tools?.length || agent.skills?.length ? (
                        <small>
                          {[agent.tools?.length ? `工具 ${agent.tools.length}` : '', agent.skills?.length ? `技能 ${agent.skills.length}` : '']
                            .filter(Boolean)
                            .join(' / ')}
                        </small>
                      ) : null}
                    </span>
                  </button>
                  <div>
                    <button title="打开编辑" onClick={() => openProjectFile(agent.relativePath)}>
                      <Pencil size={12} />
                    </button>
                    <button title="删除" onClick={() => void deleteProjectAgentFile(agent)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {showTodos ? (
          <div className="floating-panel todo-panel">
            <header>
              <strong>任务</strong>
              <button onClick={() => void refreshTodos()}>
                <RefreshCw size={12} />
              </button>
            </header>
            {!todoItems.length ? <p>暂无任务</p> : null}
            {todoItems.map((todo) => (
              <article className={`todo-item ${todo.status}`} key={todo.id}>
                <strong>{todo.title}</strong>
                <select
                  value={todo.status}
                  onChange={(event) => void updateTodoStatus(todo.id, event.target.value as TodoStatus)}
                >
                  <option value="pending">pending</option>
                  <option value="in_progress">in_progress</option>
                  <option value="completed">completed</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </article>
            ))}
          </div>
        ) : null}

        {showSettings ? (
          <div className="floating-panel settings-panel">
            <strong>本地方案设置</strong>
            <p className="panel-note">
              {selectedSolution.label} / {selectedAgentProfile.label}：{selectedAgentProfile.description}
            </p>
            <label className="agent-setting-row">
              <span>当前智能体</span>
              <select
                value={selectedAgentId}
                disabled={isRunning}
                onChange={(event) => setSelectedAgentId(event.target.value as AgentProfileId)}
                title={selectedAgentProfile.description}
              >
                {selectableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="agent-panel-shortcuts">
              <button className={showTodos ? 'active' : ''} onClick={() => setShowTodos((value) => !value)}>
                <List size={13} />
                <span>任务</span>
              </button>
              <button className={showSubAgents ? 'active' : ''} onClick={() => setShowSubAgents((value) => !value)}>
                <Bot size={13} />
                <span>子智能体</span>
              </button>
              <button className={showAgentFiles ? 'active' : ''} onClick={() => setShowAgentFiles((value) => !value)}>
                <FileText size={13} />
                <span>智能体库</span>
              </button>
            </div>
            {agentSolutions.map((solution) => (
              <button
                className={selectedSolutionId === solution.id ? 'solution-button active' : 'solution-button'}
                key={solution.id}
                onClick={() => switchSolution(solution.id)}
              >
                <Sparkles size={14} />
                <span>
                  <strong>{solution.label}</strong>
                  <small>{solution.description}</small>
                </span>
              </button>
            ))}
            <label className="temperature-control">
              <span>
                温度
                <em>{agentTemperature.toFixed(1)}</em>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={agentTemperature}
                onChange={(event) => setAgentTemperature(Number(event.target.value))}
              />
            </label>
            {localSettings ? (
              <div className="context-settings">
                <strong>上下文设置</strong>
                <label>
                  <input
                    type="checkbox"
                    checked={localSettings.promptContext.autoCarryProjectRules}
                    onChange={(event) => updatePromptContext({ autoCarryProjectRules: event.target.checked })}
                  />
                  <span>自动携带项目规则</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={localSettings.promptContext.autoCarrySmartContext}
                    onChange={(event) => updatePromptContext({ autoCarrySmartContext: event.target.checked })}
                  />
                  <span>自动携带智能上下文</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={localSettings.promptContext.smartContextAutoUpdate}
                    onChange={(event) => updatePromptContext({ smartContextAutoUpdate: event.target.checked })}
                  />
                  <span>智能上下文自动更新</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={localSettings.promptContext.agentMemoryAutoUpdate}
                    onChange={(event) => updatePromptContext({ agentMemoryAutoUpdate: event.target.checked })}
                  />
                  <span>Agent Memory 自动更新</span>
                </label>
                <label>
                  <span>自动摘要阈值</span>
                  <input
                    type="number"
                    min={10}
                    max={95}
                    value={localSettings.promptContext.autoSummaryThresholdPercent}
                    onChange={(event) =>
                      updatePromptContext({ autoSummaryThresholdPercent: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  <span>上下文窗口</span>
                  <input
                    type="number"
                    min={4096}
                    max={256000}
                    step={1024}
                    value={localSettings.promptContext.maxContextWindowLimit}
                    onChange={(event) => updatePromptContext({ maxContextWindowLimit: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>最大上下文文件</span>
                  <input
                    type="number"
                    min={1}
                    max={80}
                    value={localSettings.promptContext.maxContextFiles}
                    onChange={(event) => updatePromptContext({ maxContextFiles: Number(event.target.value) })}
                  />
                </label>
              </div>
            ) : null}
            <strong>智能体工具</strong>
            <button onClick={() => setDraft('请列出当前项目的文件结构，并指出每个分组下一步可以做什么。')}>项目结构检查</button>
            <button onClick={() => setDraft('请搜索项目中和“关键词”相关的文件与正文内容，并汇总结果。')}>搜索项目内容</button>
            <button onClick={() => setDraft('请读取当前章节文件，并给出续写建议。')}>章节续写辅助</button>
            <button onClick={() => setDraft('请基于项目内容创建智能上下文，并写入记录分组。')}>创建智能上下文</button>
          </div>
        ) : null}

        {showSubAgents ? (
          <div className="floating-panel sub-agent-panel">
            <header>
              <strong>子智能体</strong>
              <span>{subAgentSessions.length}</span>
            </header>
            <select
              value={subAgentRole}
              onChange={(event) => {
                const role = event.target.value as SubAgentRole
                setSubAgentRole(role)
                setSubAgentPrompt(subAgentRoles.find((item) => item.value === role)?.prompt ?? '')
              }}
            >
              {subAgentRoles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <select
              value={manualSubAgentModel}
              onChange={(event) => setRuntimeModelForProfile(manualSubAgentProfile, event.target.value)}
              title={`当前子智能体实际调用模型：${displayModelId(manualSubAgentModel)}`}
            >
              {(aiConfig?.availableModels ?? [manualSubAgentModel]).map((model) => (
                <option key={model} value={model}>
                  {displayModelId(model)}
                </option>
              ))}
            </select>
            <textarea value={subAgentPrompt} onChange={(event) => setSubAgentPrompt(event.target.value)} />
            <span
              className={manualSubAgentModelStatus.isReady ? 'model-status ready' : 'model-status blocked'}
              title={[
                `实际调用模型：${displayModelId(manualSubAgentModel)}`,
                `接口：${manualSubAgentModelStatus.providerLabel}`,
                `实际模型名：${manualSubAgentModelStatus.modelName}`,
                `请求格式：${manualSubAgentModelStatus.requestFormat}`,
                manualSubAgentModelStatus.hasApiKey ? 'API Key 已配置' : 'API Key 未配置'
              ].join(' / ')}
            >
              {manualSubAgentModelStatus.isReady ? '可用' : '未配置'} · {displayModelId(manualSubAgentModel)}
            </span>
            <button
              disabled={!subAgentPrompt.trim() || isRunning || subAgentSessions.some((session) => session.status === 'running')}
              onClick={() => void runManualSubAgent()}
            >
              <Plus size={14} />
              运行子任务
            </button>
            <div className="sub-agent-list">
              {subAgentSessions.slice(0, 6).map((session) => (
                <article key={session.id}>
                  <header>
                    <span>{subAgentRoles.find((role) => role.value === session.role)?.label ?? session.role}</span>
                    <button disabled={session.status === 'running'} onClick={() => deleteSubAgentSession(session.id)}>
                      <Trash2 size={12} />
                    </button>
                  </header>
                  <strong>{session.title}</strong>
                  <em>{session.status === 'running' ? '运行中' : session.status === 'done' ? '已完成' : '失败'}</em>
                  <pre>
                    {session.error ??
                      (session.messages
                        .filter((message) => message.role === 'assistant')
                        .map((message) => message.content)
                        .join('\n')
                        .slice(0, 600) ||
                        '等待输出')}
                  </pre>
                </article>
              ))}
              {!subAgentSessions.length ? <p>暂无子智能体任务</p> : null}
            </div>
          </div>
        ) : null}

        {!hasMessages ? (
          <div className="agent-empty">
            <Bot size={36} />
            <h2>欢迎使用王阳智能体</h2>
            <p>我可以帮助您管理小说项目、创建文件、编辑内容等</p>

            <h3>快速开始</h3>
            <p className="subtle">选择以下提示词模板快速开始对话</p>

            <div className="quick-prompts">
              {quickPrompts.map((prompt) => (
                <button
                  className="quick-prompt"
                  key={prompt.title}
                  onClick={() => setDraft(prompt.prompt)}
                >
                  <Lightbulb size={17} />
                  <div>
                    <strong>{prompt.title}</strong>
                    <span>{prompt.body}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="agent-message-list">
            {conversationTurns.map((turn, index) => {
              const isActiveTurn = isRunning && index === conversationTurns.length - 1
              return (
                <section className="agent-turn" key={turn.id}>
                  {turn.user ? renderUserMessage(turn.user) : null}
                  {renderTurnProcess(turn, isActiveTurn)}
                  {turn.finalAssistant ? renderAssistantFinal(turn.finalAssistant) : null}
                </section>
              )
            })}
            {false ? (
              <>
            {visibleMessages.map((message) => (
              <article className={`agent-message ${message.role}`} key={message.id}>
                <header>
                  <span>{roleLabel(message.role, assistantResponseLabel)}</span>
                  {message.toolCallId ? <code>{message.toolCallId}</code> : null}
                </header>
                <pre>{message.content}</pre>
                {message.attachments?.length ? (
                  <div className="message-attachments">
                    {message.attachments.map((attachment) => (
                      <figure key={attachment.id}>
                        <img src={attachment.dataUrl} alt={attachment.name} />
                        <figcaption>{attachment.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
                {message.toolCalls?.length ? (
                  <div className="tool-call-list">
                    {message.toolCalls.map((toolCall) => (
                      <div className="tool-call" key={toolCall.id}>
                        <Box size={14} />
                        <span>{toolCall.name || 'pending_tool'}</span>
                        <em>{toolCall.status === 'running' ? '执行中' : toolCall.status === 'success' ? '已完成' : '已拒绝/失败'}</em>
                        <code>{toolCall.argumentsText}</code>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
              </>
            ) : null}
          </div>
        )}
      </div>

      <footer className="agent-composer">
        {renderComposerPanel()}

        <div className="model-line">
          <select value={activeRuntimeModel} onChange={(event) => setRuntimeModelForProfile(selectedAgentId, event.target.value)}>
            {(aiConfig?.availableModels ?? [activeRuntimeModel]).map((model) => (
              <option key={model} value={model}>
                {displayModelId(model)}
              </option>
            ))}
          </select>
          <button
            className="default-tag"
            title={`恢复 ${selectedAgentProfile.label} 默认模型：${displayModelId(defaultActiveRuntimeModel)}`}
            onClick={() => resetRuntimeModelForProfile(selectedAgentId)}
          >
            {activeRuntimeModelHasOverride ? '覆盖' : '默认'}
          </button>
          <span
            className="model-info"
            title={[
              `当前实际模型：${displayModelId(activeRuntimeModel)}`,
              `当前智能体：${selectedAgentProfile.label}`,
              `默认模型：${displayModelId(defaultActiveRuntimeModel)}`,
              activeRuntimeModelHasOverride ? '当前使用本地覆盖模型' : '当前使用场景默认模型',
              selectedModelMetadata ? `上下文：${selectedModelMetadata.maxContextWindow}` : '',
              selectedModelMetadata?.supportImage ? '支持图片' : '纯文本',
              selectedModelMetadata?.supportThinking ? '支持 thinking' : '',
              selectedModelMetadata?.deprecated ? '已弃用' : ''
            ]
              .filter(Boolean)
              .join('；')}
          >
            <Info size={13} />
          </span>
          <span
            className={activeRuntimeModelStatus.isReady ? 'model-status ready' : 'model-status blocked'}
            title={[
              `实际调用模型：${displayModelId(activeRuntimeModel)}`,
              `接口：${activeRuntimeModelStatus.providerLabel}`,
              `实际模型名：${activeRuntimeModelStatus.modelName}`,
              `请求格式：${activeRuntimeModelStatus.requestFormat}`,
              activeRuntimeModelStatus.hasApiKey ? 'API Key 已配置' : 'API Key 未配置'
            ].join(' / ')}
          >
            {activeRuntimeModelStatus.isReady ? '可用' : '未配置'} · {displayModelId(activeRuntimeModel)}
          </span>
          <button className="plus-button" title="新会话" disabled={isRunning} onClick={startNewAgentSession}>
            <Plus size={15} />
          </button>
        </div>

        <div className="context-line">
          <select value={contextMode} onChange={(event) => setContextMode(event.target.value as ContextMode)}>
            {contextOptions.map((option) => (
              <option key={option.value} value={option.value} disabled={option.value === 'current-file' && !activeFilePath}>
                {option.label}
              </option>
            ))}
          </select>
          {activeFilePath ? (
            <button title={activeFilePath} onClick={() => setContextMode('current-file')}>
              <FileText size={13} />
              <span>{activeFilePath}</span>
            </button>
          ) : null}
          {attachments.map((entry) => (
            <button className="attachment-chip" key={entry.relativePath} title={entry.relativePath} onClick={() => removeAttachment(entry.relativePath)}>
              <Paperclip size={12} />
              <span>{entry.name}</span>
              <X size={11} />
            </button>
          ))}
          {imageAttachments.map((attachment) => (
            <button className="image-chip" key={attachment.id} title={attachment.name} onClick={() => removeImageAttachment(attachment.id)}>
              <img src={attachment.dataUrl} alt="" />
              <span>{attachment.name}</span>
              <X size={11} />
            </button>
          ))}
          {attachmentError ? <span className="attachment-error">{attachmentError}</span> : null}
        </div>

        <textarea
          value={draft}
          placeholder="请输入你的需求（Enter 发送，Shift + Enter 换行，/ 快速选择技能或自定义提示词，@ 快速输入文件路径）"
          onChange={(event) => {
            const value = event.target.value
            setDraft(value)
            if (value.endsWith('/')) {
              setComposerPanel('slash')
            } else if (value.endsWith('@')) {
              setFileSearchQuery('')
              setComposerPanel('mention')
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendComposerMessage()
            }
          }}
        />

        <div className="composer-actions">
          <input
            ref={imageInputRef}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={(event) => {
              void addImageFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <button
            className={`permission-button permission-${selectedPermissionMode}${
              composerPanel === 'permissions' ? ' active' : ''
            }`}
            disabled={!localSettings}
            title={`智能体工具权限：${selectedPermissionOption.label}。${selectedPermissionOption.description}`}
            onClick={() => setComposerPanel((panel) => (panel === 'permissions' ? 'none' : 'permissions'))}
          >
            <Shield size={14} />
            <span>{selectedPermissionOption.shortLabel}</span>
            <ChevronDown size={13} />
          </button>
          <button
            className={composerPanel === 'mention' ? 'square-tool active' : 'square-tool'}
            title="引用文件"
            onClick={() => {
              setFileSearchQuery('')
              setComposerPanel((panel) => (panel === 'mention' ? 'none' : 'mention'))
            }}
          >
            <AtSign size={15} />
          </button>
          <button className="square-tool" title="添加图片" onClick={() => imageInputRef.current?.click()}>
            <ImageIcon size={15} />
          </button>
          <button
            className={composerPanel === 'slash' ? 'square-tool active' : 'square-tool'}
            title="快速命令"
            onClick={() => setComposerPanel((panel) => (panel === 'slash' ? 'none' : 'slash'))}
          >
            <Wrench size={15} />
          </button>
          <button
            className={composerPanel === 'prompts' ? 'prompt-button active' : 'prompt-button'}
            onClick={() => setComposerPanel((panel) => (panel === 'prompts' ? 'none' : 'prompts'))}
          >
            我的提示词
          </button>
          <button
            className={thinkingMode === 'fast' ? 'think-button' : 'think-button active'}
            onClick={() => setComposerPanel((panel) => (panel === 'thinking' ? 'none' : 'thinking'))}
          >
            <Brain size={15} />
            <span>{thinkingOption.label}</span>
            <ChevronDown size={13} />
          </button>
          <button
            className="send-round"
            disabled={
              !isRunning &&
              ((!draft.trim() && !imageAttachments.length) || subAgentRunning)
            }
            onClick={() => {
              if (isRunning) stopAgent()
              else void sendComposerMessage()
            }}
          >
            {isRunning ? <Square size={15} /> : <Send size={15} />}
          </button>
        </div>
      </footer>
    </div>
  )
}
