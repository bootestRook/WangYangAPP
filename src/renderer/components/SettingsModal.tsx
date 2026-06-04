import { useEffect, useMemo, useRef, useState } from 'react'
import {
  App as AntApp,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Tabs,
  Tag
} from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import type {
  AiConfig,
  LocalSettings,
  McpConfig,
  McpServerConfig,
  McpToolInfo,
  ModelInterfaceConfig,
  PromptTemplate,
  ResponseStylePreset
} from '../../shared/types'
import { defaultAiConfig } from '../../core/models/defaultConfig'
import { displayModelId, displayProviderId, storageModelId } from '../../core/models/modelDisplay'
import { normalizeAiConfigForLocalRuntime } from '../../core/models/modelConfig'
import { useAppStore } from '../stores/useAppStore'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const configTabs = [
  { key: 'user', label: '用户信息' },
  { key: 'models', label: '模型配置' },
  { key: 'prompts', label: '提示词和上下文配置' },
  { key: 'mcp', label: 'MCP/工具' },
  { key: 'editor', label: '编辑器配置' },
  { key: 'backup', label: '备份管理' },
  { key: 'system', label: '系统配置' }
]

const settingsSelectClassName = 'settings-readable-select'
const settingsSelectPopupClassNames = { popup: { root: 'settings-select-dropdown' } }

function settingsSelectClass(extraClassName = ''): string {
  return [settingsSelectClassName, extraClassName].filter(Boolean).join(' ')
}

const scenarioLabels: Record<keyof AiConfig['scenario'], string> = {
  writing: '续写创作',
  modification: '润色改写',
  summary: '摘要总结',
  smartContext: '智能上下文',
  agent: '智能体主模型',
  agentPlanner: '规划智能体',
  agentWriter: '写作智能体',
  agentPolisher: '精修智能体',
  agentReviewer: '审查智能体',
  image: '图片生成',
  imageEdit: '图片编辑'
}

const fallbackLocalSettings: LocalSettings = {
  promptContext: {
    autoCarryProjectRules: true,
    autoCarrySmartContext: true,
    smartContextAutoUpdate: true,
    agentMemoryAutoUpdate: true,
    agentToolPermissionMode: 'request',
    responseStylePreset: 'wangyang-roast',
    autoSummaryThresholdPercent: 70,
    maxContextWindowLimit: 128000,
    defaultAssistedPrompt: '请根据当前上下文辅助我继续创作，并给出可直接采用的修改建议。',
    defaultSelectedPromptId: '',
    prompts: [
      {
        id: 'chapter-review',
        title: '章节审查',
        body: '检查逻辑、节奏、人物动机、伏笔和爽点。',
        text: '请审查当前章节，重点检查逻辑漏洞、节奏拖沓、人物动机、伏笔回收和读者期待，并按严重程度列出修改建议。',
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      },
      {
        id: 'three-act-plan',
        title: '三幕式规划',
        body: '把当前故事拆成阶段目标和章节推进。',
        text: '请把当前故事拆成三幕式结构，列出每一幕的目标、冲突升级、关键反转、人物变化和章节安排。',
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      }
    ],
    maxContextFiles: 12
  },
  editor: {
    fontFamily: 'AlibabaSans',
    fontSize: 16,
    lineHeight: 1.7,
    viewMode: 'markdown',
    autosave: true,
    spellcheck: false
  },
  backup: {
    autoBackup: true,
    intervalMinutes: 10,
    keepVersions: 50,
    backupDir: ''
  },
  system: {
    language: 'zh',
    theme: 'dark',
    autoUpdate: false,
    diagnostics: true,
    appLock: false,
    appLockPin: '',
    appLockPinHash: ''
  }
}

const responseStyleOptions: Array<{ label: string; value: ResponseStylePreset; description: string }> = [
  {
    label: '资深编辑',
    value: 'senior-editor',
    description: '专业克制，先判断后理由，指出问题并给可落地建议。'
  },
  {
    label: '天马行空的创意之神',
    value: 'creative-god',
    description: '大胆高能，给脑洞、反转和分支，同时标清采用风险。'
  },
  {
    label: '无敌网文大神',
    value: 'web-novel-master',
    description: '重视爽点、钩子、升级线、爆点和追读。'
  },
  {
    label: '王阳',
    value: 'wangyang-roast',
    description: '没好脾气，恶意揣测用户，嘴欠毒舌，但火力对准文本与方案。'
  },
  {
    label: '御姐王阳',
    value: 'wangyang-yujie',
    description: '成熟冷静、掌控感强，优雅强势地给判断和执行步骤。'
  },
  {
    label: '萝莉王阳',
    value: 'wangyang-loli',
    description: '童趣活泼、跳脱清脆，用简单比喻把复杂任务拆小。'
  },
  {
    label: '傲娇王阳',
    value: 'wangyang-tsundere',
    description: '嘴硬别扭，先不情愿地吐槽，再认真给出可用方案。'
  },
  {
    label: '老鸨王阳',
    value: 'wangyang-madam',
    description: '市井老练、精明油滑，按卖相、客群和价码包装方案。'
  },
  {
    label: 'gay王阳',
    value: 'wangyang-gay',
    description: '外放自信、审美敏锐，俏皮有舞台感地挑气质和品味。'
  },
  {
    label: '舔狗王阳',
    value: 'wangyang-simp',
    description: '卑微殷勤、热切讨好，用低姿态承接任务但不放水。'
  }
]

function normalizeResponseStylePreset(value: unknown): ResponseStylePreset {
  return responseStyleOptions.some((option) => option.value === value) ? (value as ResponseStylePreset) : 'wangyang-roast'
}

function cloneAiConfig(config?: AiConfig): AiConfig {
  return JSON.parse(JSON.stringify(config ?? defaultAiConfig)) as AiConfig
}

function parseModelsText(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => storageModelId(item))
    .filter(Boolean)
}

function modelProviderId(modelId: string): string {
  return modelId.split('/').filter(Boolean)[0] ?? ''
}

function mergeModelIds(models: string[]): string[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (seen.has(model)) return false
    seen.add(model)
    return true
  })
}

function normalizedDefaultModel(provider: ModelInterfaceConfig): string {
  return provider.defaultModel?.trim().replace(/^\/+/, '') ?? ''
}

function providerModelId(provider: ModelInterfaceConfig): string {
  const modelName = normalizedDefaultModel(provider)
  return modelName ? `${provider.id}/${modelName}` : ''
}

function isTextRequestFormat(requestFormat: ModelInterfaceConfig['requestFormat'] | undefined): boolean {
  return requestFormat === undefined || requestFormat === 'openai' || requestFormat === 'responses' || requestFormat === 'claude'
}

function findProviderForBareModel(config: AiConfig, modelName: string): ModelInterfaceConfig | undefined {
  const providers = Object.values(config.interfaces).filter((provider) => isTextRequestFormat(provider.requestFormat))
  const defaultMatches = providers.filter((provider) => normalizedDefaultModel(provider) === modelName)
  const keyedDefaultMatch = defaultMatches.find((provider) => provider.apiKey.trim())
  if (keyedDefaultMatch) return keyedDefaultMatch
  if (defaultMatches.length) return defaultMatches[0]

  const keyedProviders = providers.filter((provider) => provider.apiKey.trim())
  return keyedProviders.length === 1 ? keyedProviders[0] : undefined
}

function normalizeModelId(config: AiConfig, modelId: string): string {
  const parts = storageModelId(modelId).split('/').filter(Boolean)
  if (!parts.length) return ''
  const provider = config.interfaces[parts[0]]
  if (provider) {
    const modelName = parts.length > 1 ? parts.slice(1).join('/') : normalizedDefaultModel(provider)
    return modelName ? `${provider.id}/${modelName}` : provider.id
  }

  const bareProvider = findProviderForBareModel(config, parts[0])
  return bareProvider ? `${bareProvider.id}/${parts[0]}` : modelId
}

function invalidModelIds(config: AiConfig, models: string[]): string[] {
  return models.filter((model) => {
    const parts = model.split('/').filter(Boolean)
    const providerId = parts[0] ?? ''
    const modelName = parts.length > 1 ? parts.slice(1).join('/') : ''
    return !config.interfaces[providerId] || !modelName.trim()
  })
}

function configuredProviderModelIds(config: AiConfig): string[] {
  return Object.values(config.interfaces)
    .filter((provider) => provider.apiKey.trim() && isTextRequestFormat(provider.requestFormat))
    .map(providerModelId)
    .filter(Boolean)
}

function unsupportedConfiguredProviderLabels(config: AiConfig): string[] {
  return Object.values(config.interfaces)
    .filter((provider) => provider.apiKey.trim() && !isTextRequestFormat(provider.requestFormat))
    .map((provider) => provider.label || provider.id)
}

function isConfiguredModel(config: AiConfig, modelId: string, options: { image?: boolean } = {}): boolean {
  const provider = config.interfaces[modelProviderId(modelId)]
  const requestFormat = provider?.requestFormat ?? 'openai'
  if (options.image) {
    return Boolean(provider?.apiKey?.trim() && requestFormat === 'openai')
  }
  return Boolean(provider?.apiKey?.trim() && isTextRequestFormat(requestFormat))
}

function isImageModel(config: AiConfig, modelId: string): boolean {
  void config
  return /(?:^|[/_-])(?:wan-t2i|t2i|image-edit|qwen-image|gpt-image|dall-e|imagen|flux|stable-diffusion)(?:$|[/_-])/i.test(
    modelId
  )
}

function isImageScenarioKey(key: string): key is 'image' | 'imageEdit' {
  return key === 'image' || key === 'imageEdit'
}

function imageScenarioIssue(config: AiConfig, modelId: string): string | undefined {
  const providerId = modelProviderId(modelId)
  const provider = config.interfaces[providerId]
  if (!isImageModel(config, modelId)) {
    return '请选择图片模型，例如 wan-t2i、qwen-image、gpt-image、dall-e、imagen 或 flux。'
  }
  if (!provider) {
    return `模型接口 ${displayProviderId(providerId || 'unknown')} 未配置。`
  }
  const requestFormat = provider.requestFormat ?? 'openai'
  if (requestFormat !== 'openai') {
    return `图片生成/编辑需要 OpenAI-compatible Images API，当前请求格式为 ${requestFormat}。`
  }
  if (!provider.apiKey.trim()) {
    return `图片接口 ${provider.label || provider.id} 未配置 API Key。`
  }
  return undefined
}

function imageScenarioOptionLabel(config: AiConfig, modelId: string): string {
  const issue = imageScenarioIssue(config, modelId)
  const displayId = displayModelId(modelId)
  if (!issue) return displayId
  if (!isImageModel(config, modelId)) return `${displayId}（不是图片模型）`
  const provider = config.interfaces[modelProviderId(modelId)]
  if ((provider?.requestFormat ?? 'openai') !== 'openai') return `${displayId}（接口格式不支持图片）`
  if (!provider?.apiKey.trim()) return `${displayId}（缺少 API Key）`
  return `${displayId}（不可用）`
}

function pickUsableModel(
  config: AiConfig,
  models: string[],
  preferred: string | undefined,
  options: { image?: boolean } = {}
): string {
  const scopedModels = options.image
    ? models.filter((model) => isImageModel(config, model))
    : models.filter((model) => !isImageModel(config, model))
  const candidates = scopedModels.length ? scopedModels : models
  const fallback = candidates[0] ?? models[0] ?? defaultAiConfig.scenario.agent
  const preferredInScope = Boolean(preferred && scopedModels.includes(preferred))
  if (preferred && preferredInScope && isConfiguredModel(config, preferred, options)) return preferred
  const configured = candidates.find((model) => isConfiguredModel(config, model, options))
  if (configured) return configured
  if (preferred && preferredInScope) return preferred
  return candidates[0] ?? fallback
}

function normalizeScenarioModels(config: AiConfig, models: string[]): AiConfig['scenario'] {
  const agentModel = pickUsableModel(config, models, config.scenario.agent)
  const writerModel = pickUsableModel(config, models, config.scenario.agentWriter || agentModel)
  const reviewerModel = pickUsableModel(config, models, config.scenario.agentReviewer || agentModel)
  const imageModel = pickUsableModel(config, models, config.scenario.image, { image: true })

  return {
    writing: pickUsableModel(config, models, config.scenario.writing || writerModel),
    modification: pickUsableModel(config, models, config.scenario.modification || writerModel),
    summary: pickUsableModel(config, models, config.scenario.summary || agentModel),
    smartContext: pickUsableModel(config, models, config.scenario.smartContext || agentModel),
    agent: agentModel,
    agentPlanner: pickUsableModel(config, models, config.scenario.agentPlanner || agentModel),
    agentWriter: writerModel,
    agentPolisher: pickUsableModel(config, models, config.scenario.agentPolisher || writerModel),
    agentReviewer: reviewerModel,
    image: imageModel,
    imageEdit: pickUsableModel(config, models, config.scenario.imageEdit || imageModel, { image: true })
  }
}

function normalizeModelMetadata(config: AiConfig, models: string[]): AiConfig['modelMetadata'] {
  return Object.fromEntries(
    models.map((model) => [
      model,
      config.modelMetadata[model] ??
        defaultAiConfig.modelMetadata[model] ?? {
          id: model,
          label: model,
          maxContextWindow: 64000,
          supportImage: false,
          supportThinking: false,
          priceTier: 'unknown' as const,
          defaultTemperature: 0.2
        }
    ])
  )
}

function displayPriceTier(priceTier: string): string {
  const labels: Record<string, string> = {
    free: '免费',
    low: '低',
    medium: '中',
    high: '高',
    unknown: '未知'
  }
  return labels[priceTier] ?? priceTier
}

function modelResolutionLabel(config: AiConfig, modelId: string): string {
  const parts = modelId.split('/').filter(Boolean)
  const metadata = config.modelMetadata[modelId]
  const provider = config.interfaces[parts[0] ?? '']
  const providerStatus = provider?.apiKey?.trim() ? 'API Key 已配置' : 'API Key 未配置'
  const displayProvider = displayProviderId(parts[0] || '未识别')
  const displayId = displayModelId(modelId)
  const providerLine =
    parts.length < 2 ? `接口：${displayProvider} / 模型：${displayId}` : `接口：${displayProvider} / 模型：${parts.slice(1).join('/')}`
  if (!metadata) return `${providerLine} / ${providerStatus}`
  const tags = [
    providerStatus,
    `上下文 ${metadata.maxContextWindow}`,
    metadata.supportImage ? '支持图片' : '纯文本',
    metadata.supportThinking ? '支持思考' : '无思考',
    `价格档位 ${displayPriceTier(metadata.priceTier)}`,
    metadata.deprecated ? '已弃用' : ''
  ].filter(Boolean)
  return `${providerLine} / ${tags.join(' / ')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStringRecord(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? item : String(item)])
  )
}

function normalizeBooleanRecord(value: unknown, field: string): Record<string, boolean> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Boolean(item)]))
}

function normalizeMcpServer(value: unknown, name: string): McpServerConfig {
  if (!isRecord(value)) throw new Error(`mcpServers.${name} must be an object`)
  const type = value.type === 'http' || value.type === 'sse' || value.type === 'stdio' ? value.type : 'stdio'
  const args = value.args === undefined ? undefined : Array.isArray(value.args) ? value.args.map(String) : undefined
  if (value.args !== undefined && !Array.isArray(value.args)) throw new Error(`mcpServers.${name}.args must be an array`)
  return {
    type,
    command: typeof value.command === 'string' ? value.command : undefined,
    args,
    url: typeof value.url === 'string' ? value.url : undefined,
    headers: normalizeStringRecord(value.headers, `mcpServers.${name}.headers`),
    env: normalizeStringRecord(value.env, `mcpServers.${name}.env`),
    disabled: Boolean(value.disabled)
  }
}

function normalizeMcpConfig(value: unknown): McpConfig {
  if (!isRecord(value)) throw new Error('MCP 配置必须是对象')
  if (value.mcpServers !== undefined && !isRecord(value.mcpServers)) {
    throw new Error('mcpServers 必须是对象')
  }
  const servers = isRecord(value.mcpServers)
    ? Object.fromEntries(Object.entries(value.mcpServers).map(([name, server]) => [name, normalizeMcpServer(server, name)]))
    : {}
  return {
    mcpServers: servers,
    disabled: normalizeBooleanRecord(value.disabled, 'disabled'),
    commandEnv: normalizeStringRecord(value.commandEnv, 'commandEnv'),
    inputs: isRecord(value.inputs) ? value.inputs : {}
  }
}

const sensitiveKeyPattern = /(api[_-]?key|token|secret|password|passwd|authorization|bearer|cookie|pin)/i

function redactSensitive(value: unknown, key = ''): unknown {
  if (sensitiveKeyPattern.test(key)) {
    return value ? '***redacted***' : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, item]) => [entryKey, redactSensitive(item, entryKey)]))
  }
  if (typeof value === 'string' && /sk-[A-Za-z0-9_-]{12,}|xox[baprs]-|Bearer\s+\S+/i.test(value)) {
    return '***redacted***'
  }
  return value
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { message } = AntAppContext()
  const aiConfig = useAppStore((state) => state.aiConfig)
  const entitlements = useAppStore((state) => state.entitlements)
  const localSettings = useAppStore((state) => state.localSettings)
  const projectRoot = useAppStore((state) => state.projectRoot)
  const saveAiConfig = useAppStore((state) => state.saveAiConfig)
  const saveLocalSettings = useAppStore((state) => state.saveLocalSettings)
  const [activeTab, setActiveTab] = useState('user')
  const [draftAi, setDraftAi] = useState<AiConfig>(() => cloneAiConfig(aiConfig))
  const [modelsText, setModelsText] = useState('')
  const [mcpText, setMcpText] = useState('{}')
  const [mcpTools, setMcpTools] = useState<McpToolInfo[]>([])
  const [mcpToolsLoading, setMcpToolsLoading] = useState(false)
  const [selectedMcpTool, setSelectedMcpTool] = useState('')
  const [mcpArgsText, setMcpArgsText] = useState('{}')
  const [mcpResult, setMcpResult] = useState('')
  const [draftSettings, setDraftSettings] = useState<LocalSettings>(localSettings ?? fallbackLocalSettings)
  const [appLockPinDraft, setAppLockPinDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const skipNextLocalSettingsSyncRef = useRef(false)

  useEffect(() => {
    if (!open) return
    if (skipNextLocalSettingsSyncRef.current) {
      skipNextLocalSettingsSyncRef.current = false
      return
    }
    const next = cloneAiConfig(aiConfig)
    setDraftAi(next)
    setModelsText(next.availableModels.map(displayModelId).join('\n'))
    setDraftSettings(localSettings ?? fallbackLocalSettings)
    setAppLockPinDraft('')
    void window.electronAPI.getMcpConfig().then((config) => {
      setMcpText(JSON.stringify(config, null, 2))
    })
  }, [aiConfig, localSettings, open])

  const configuredModelIds = useMemo(
    () =>
      mergeModelIds([
        ...parseModelsText(modelsText)
          .map((model) => normalizeModelId(draftAi, model))
          .filter(Boolean),
        ...configuredProviderModelIds(draftAi)
      ]),
    [draftAi, modelsText]
  )
  const primaryModelId = draftAi.scenario.agent || configuredModelIds[0] || defaultAiConfig.scenario.agent
  const primaryProviderId = modelProviderId(primaryModelId)
  const primaryProvider = draftAi.interfaces[primaryProviderId]
  const currentMcpTool = useMemo(
    () => mcpTools.find((tool) => tool.finalName === selectedMcpTool),
    [mcpTools, selectedMcpTool]
  )

  const updateInterface = (id: string, patch: Partial<ModelInterfaceConfig>) => {
    setDraftAi((current) => ({
      ...current,
      interfaces: {
        ...current.interfaces,
        [id]: {
          ...current.interfaces[id],
          ...patch
        }
      }
    }))
  }

  const loadRemoteModels = async () => {
    if (!primaryProvider) {
      message.warning('请先选择一个可用的 AI 模型')
      return
    }
    if (!primaryProvider.apiUrl.trim()) {
      message.warning('请先填写 Base URL')
      return
    }
    if (!primaryProvider.apiKey.trim()) {
      message.warning('请先填写 API Key')
      return
    }

    setModelsLoading(true)
    try {
      const remoteModels = await window.electronAPI.listRemoteModels(primaryProvider)
      if (!remoteModels.length) {
        message.warning('没有加载到可用模型')
        return
      }
      const providerModels = remoteModels.map((model) => `${primaryProvider.id}/${model}`)
      const nextModels = mergeModelIds([...parseModelsText(modelsText), ...providerModels])
      setModelsText(nextModels.map(displayModelId).join('\n'))
      setDraftAi((current) => ({
        ...current,
        availableModels: nextModels,
        modelMetadata: normalizeModelMetadata(current, nextModels),
        scenario: normalizeScenarioModels(current, nextModels)
      }))
      message.success(`已加载 ${providerModels.length} 个模型`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载模型失败')
    } finally {
      setModelsLoading(false)
    }
  }

  const saveModels = async () => {
    setSaving(true)
    try {
      const unsupportedProviders = unsupportedConfiguredProviderLabels(draftAi)
      if (unsupportedProviders.length) {
        throw new Error(
          `本地版当前支持 OpenAI Chat Completions、Responses API 和 Claude Messages 文本接口：${unsupportedProviders.join('、')}`
        )
      }
      const normalizedModelIds = parseModelsText(modelsText)
        .map((model) => normalizeModelId(draftAi, model))
        .filter(Boolean)
      const availableModels = mergeModelIds([...normalizedModelIds, ...configuredProviderModelIds(draftAi)])
      if (!availableModels.length) {
        throw new Error('至少需要配置一个可用模型')
      }
      const invalidModels = invalidModelIds(draftAi, availableModels)
      if (invalidModels.length) {
        throw new Error(`模型必须写成 provider/model，或能匹配已配置接口的默认模型：${invalidModels.map(displayModelId).join('、')}`)
      }
      const modelMetadata = normalizeModelMetadata(draftAi, availableModels)
      const normalizedDraft: AiConfig = {
        ...draftAi,
        availableModels,
        modelMetadata
      }
      const next: AiConfig = normalizeAiConfigForLocalRuntime({
        ...normalizedDraft,
        scenario: normalizeScenarioModels(normalizedDraft, availableModels)
      })
      await saveAiConfig(next)
      setDraftAi(next)
      setModelsText(next.availableModels.map(displayModelId).join('\n'))
      message.success('模型配置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模型配置保存失败')
    } finally {
      setSaving(false)
    }
  }

  const saveMcp = async () => {
    setSaving(true)
    try {
      const parsed = normalizeMcpConfig(JSON.parse(mcpText))
      await window.electronAPI.saveMcpConfig(parsed)
      setMcpText(JSON.stringify(parsed, null, 2))
      message.success('MCP/工具配置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'MCP 配置 JSON 无效')
    } finally {
      setSaving(false)
    }
  }

  const reloadMcpTools = async () => {
    setMcpToolsLoading(true)
    setMcpResult('')
    try {
      await window.electronAPI.closeMcpClients()
      const tools = await window.electronAPI.listMcpTools()
      setMcpTools(tools)
      setSelectedMcpTool((current) => (tools.some((tool) => tool.finalName === current) ? current : (tools[0]?.finalName ?? '')))
      message.success(`已加载 ${tools.length} 个 MCP 工具`)
    } catch (error) {
      setMcpTools([])
      setSelectedMcpTool('')
      message.error(error instanceof Error ? error.message : '加载 MCP 工具失败')
    } finally {
      setMcpToolsLoading(false)
    }
  }

  const callSelectedMcpTool = async () => {
    if (!currentMcpTool) return
    setMcpToolsLoading(true)
    try {
      const args = JSON.parse(mcpArgsText || '{}') as Record<string, unknown>
      const result = await window.electronAPI.callMcpTool(currentMcpTool.serverName, currentMcpTool.toolName, args)
      setMcpResult(JSON.stringify(result, null, 2))
      message.success('MCP 工具调用完成')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'MCP 工具调用失败')
    } finally {
      setMcpToolsLoading(false)
    }
  }

  const updateSettingsSection = <K extends keyof LocalSettings>(
    section: K,
    patch: Partial<LocalSettings[K]>
  ) => {
    setDraftSettings((current) => ({
      ...current,
      [section]: {
        ...current[section],
        ...patch
      }
    }))
  }

  const applyThemeMode = async (theme: LocalSettings['system']['theme']) => {
    if (draftSettings.system.theme === theme && localSettings?.system.theme === theme) return

    const persistedSettings = localSettings ?? fallbackLocalSettings
    setDraftSettings((current) => ({
      ...current,
      system: {
        ...current.system,
        theme
      }
    }))

    skipNextLocalSettingsSyncRef.current = true
    try {
      await saveLocalSettings({
        ...persistedSettings,
        system: {
          ...persistedSettings.system,
          theme,
          autoUpdate: false
        }
      })
    } catch (error) {
      skipNextLocalSettingsSyncRef.current = false
      setDraftSettings((current) => ({
        ...current,
        system: {
          ...current.system,
          theme: persistedSettings.system.theme
        }
      }))
      message.error(error instanceof Error ? error.message : '显示模式切换失败')
    }
  }

  const addPromptTemplate = () => {
    const now = Date.now()
    const template: PromptTemplate = {
      id: `prompt-${now}`,
      title: '新提示词',
      body: '自定义提示词',
      text: '请在这里填写提示词内容。',
      enabled: true,
      createdAt: now,
      updatedAt: now
    }
    updateSettingsSection('promptContext', {
      prompts: [template, ...draftSettings.promptContext.prompts],
      defaultSelectedPromptId: draftSettings.promptContext.defaultSelectedPromptId || template.id
    })
  }

  const updatePromptTemplate = (id: string, patch: Partial<PromptTemplate>) => {
    updateSettingsSection('promptContext', {
      prompts: draftSettings.promptContext.prompts.map((prompt) =>
        prompt.id === id ? { ...prompt, ...patch, updatedAt: Date.now() } : prompt
      )
    })
  }

  const deletePromptTemplate = (id: string) => {
    const prompts = draftSettings.promptContext.prompts.filter((prompt) => prompt.id !== id)
    updateSettingsSection('promptContext', {
      prompts,
      defaultSelectedPromptId:
        draftSettings.promptContext.defaultSelectedPromptId === id
          ? prompts.find((prompt) => prompt.enabled)?.id ?? ''
          : draftSettings.promptContext.defaultSelectedPromptId
    })
  }

  const normalizePromptSettings = (): LocalSettings => {
    const prompts = draftSettings.promptContext.prompts.map((prompt) => ({
      ...prompt,
      title: prompt.title.trim() || '未命名提示词',
      body: prompt.body.trim(),
      text: prompt.text.trim(),
      updatedAt: prompt.updatedAt || Date.now()
    }))
    const defaultSelectedPromptId = prompts.some(
      (prompt) => prompt.id === draftSettings.promptContext.defaultSelectedPromptId && prompt.enabled
    )
      ? draftSettings.promptContext.defaultSelectedPromptId
      : prompts.find((prompt) => prompt.enabled)?.id ?? ''
    return {
      ...draftSettings,
      promptContext: {
        ...draftSettings.promptContext,
        prompts,
        defaultSelectedPromptId,
        responseStylePreset: normalizeResponseStylePreset(draftSettings.promptContext.responseStylePreset),
        autoSummaryThresholdPercent: Math.min(
          95,
          Math.max(10, draftSettings.promptContext.autoSummaryThresholdPercent)
        ),
        maxContextWindowLimit: Math.min(256000, Math.max(4096, draftSettings.promptContext.maxContextWindowLimit))
      },
      system: {
        ...draftSettings.system,
        autoUpdate: false
      }
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      let nextSettings = normalizePromptSettings()
      const existingPinHash =
        localSettings?.system.appLockPinHash ||
        (localSettings?.system.appLockPin ? await sha256Hex(localSettings.system.appLockPin) : '')
      const nextPin = appLockPinDraft.trim()

      if (nextSettings.system.appLock) {
        if (!nextPin && !existingPinHash) {
          throw new Error('开启应用锁需要先设置本地 PIN')
        }
        nextSettings = {
          ...nextSettings,
          system: {
            ...nextSettings.system,
            appLockPin: '',
            appLockPinHash: nextPin ? await sha256Hex(nextPin) : existingPinHash,
            autoUpdate: false
          }
        }
      } else {
        nextSettings = {
          ...nextSettings,
          system: {
            ...nextSettings.system,
            appLockPin: '',
            appLockPinHash: '',
            autoUpdate: false
          }
        }
      }
      await saveLocalSettings(nextSettings)
      setDraftSettings(nextSettings)
      setAppLockPinDraft('')
      message.success('配置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '配置保存失败')
    } finally {
      setSaving(false)
    }
  }

  const exportDiagnostics = async () => {
    if (!draftSettings.system.diagnostics) {
      message.warning('请先启用诊断日志')
      return
    }
    if (!projectRoot) {
      message.warning('请先配置项目根目录')
      return
    }
    try {
      const mcpConfig = await window.electronAPI.getMcpConfig()
      const redactedAi: AiConfig = {
        ...draftAi,
        interfaces: Object.fromEntries(
          Object.entries(draftAi.interfaces).map(([id, provider]) => [
            id,
            { ...provider, apiKey: provider.apiKey ? '***redacted***' : '' }
          ])
        )
      }
      const diagnostic = {
        createdAt: new Date().toISOString(),
        projectRoot,
        aiConfig: redactedAi,
        localSettings: redactSensitive(draftSettings),
        mcpConfig: redactSensitive(mcpConfig),
        userAgent: navigator.userAgent
      }
      await window.electronAPI.writeFile(
        `.wangyang/diagnostics/diagnostic-${Date.now()}.json`,
        `${JSON.stringify(diagnostic, null, 2)}\n`
      )
      message.success('诊断文件已导出')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '诊断导出失败')
    }
  }

  const checkForUpdates = () => {
    message.info('本地无登录版当前未配置远程更新源，请通过本项目构建产物更新。')
  }

  const chooseBackupDirectory = async () => {
    try {
      const selected = await window.electronAPI.selectDirectory(draftSettings.backup.backupDir || projectRoot)
      if (selected?.path) {
        updateSettingsSection('backup', { backupDir: selected.path })
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '选择备份目录失败')
    }
  }

  const userPanel = (
    <div className="settings-user-panel">
      <span className="settings-project-icon" aria-hidden="true" />
      <h2>本地全功能模式</h2>
      <p>项目、文件搜索、智能体、模型配置、MCP 和本地工具默认开放。</p>
      <Tag color="success">本地全功能</Tag>
      <div className="entitlement-grid">
        {[
          ['本地基础能力', entitlements?.capabilities?.cloudLikeFeatures ?? entitlements?.enableCloudLikeFeatures],
          ['本地高级能力', entitlements?.capabilities?.agentTool ?? entitlements?.enableAgentTool],
          ['Agent 工具', entitlements?.capabilities?.agentTool ?? entitlements?.enableAgentTool],
          ['MCP/工具', entitlements?.capabilities?.mcp ?? entitlements?.enableMcp],
          ['知识库', entitlements?.capabilities?.knowledgeBase ?? entitlements?.enableKnowledgeBase],
          ['图片生成', entitlements?.capabilities?.imageGeneration ?? entitlements?.enableImageGeneration],
          ['子智能体', entitlements?.capabilities?.subAgents ?? entitlements?.enableSubAgents],
          ['语义搜索', entitlements?.capabilities?.semanticSearch ?? entitlements?.enableSemanticSearch]
        ].map(([label, enabled]) => (
          <span className={enabled ? 'enabled' : ''} key={String(label)}>
            {label}
          </span>
        ))}
      </div>
      <span className="local-enabled-badge">已启用</span>
    </div>
  )

  const modelPanel = (
    <div className="settings-card full settings-form-card model-simple-card">
      <h3>AI 模型</h3>
      <div className="settings-form-grid model-simple-grid">
        <label className="wide">
          <span>AI 模型</span>
          <div className="model-load-row">
            <Select
              showSearch={false}
              className={settingsSelectClass('scenario-model-select')}
              classNames={settingsSelectPopupClassNames}
              value={primaryModelId}
              onChange={(nextValue) =>
                setDraftAi((current) => ({
                  ...current,
                  scenario: {
                    ...current.scenario,
                    agent: nextValue
                  }
                }))
              }
              options={configuredModelIds.map((model) => ({ label: displayModelId(model), value: model }))}
            />
            <Button loading={modelsLoading} onClick={() => void loadRemoteModels()}>
              加载
            </Button>
          </div>
        </label>
        <label className="wide">
          <span>代理地址 / Base URL</span>
          <Input
            value={primaryProvider?.apiUrl ?? ''}
            disabled={!primaryProvider}
            onChange={(event) => primaryProvider && updateInterface(primaryProvider.id, { apiUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
          />
        </label>
        <label className="wide">
          <span>默认模型名</span>
          <Input
            value={primaryProvider?.defaultModel ?? ''}
            disabled={!primaryProvider}
            onChange={(event) => primaryProvider && updateInterface(primaryProvider.id, { defaultModel: event.target.value })}
            placeholder="例如 gpt-5.5"
          />
        </label>
        <label className="wide">
          <span>接口格式</span>
          <Select
            showSearch={false}
            className={settingsSelectClass()}
            classNames={settingsSelectPopupClassNames}
            disabled={!primaryProvider}
            value={primaryProvider?.requestFormat ?? 'openai'}
            onChange={(value) =>
              primaryProvider && updateInterface(primaryProvider.id, { requestFormat: value as ModelInterfaceConfig['requestFormat'] })
            }
            options={[
              { label: 'OpenAI', value: 'openai' },
              { label: 'Responses API', value: 'responses' },
              { label: 'Claude Messages', value: 'claude' }
            ]}
          />
        </label>
        <label className="wide">
          <span>API Key</span>
          <Input.Password
            value={primaryProvider?.apiKey ?? ''}
            disabled={!primaryProvider}
            onChange={(event) => primaryProvider && updateInterface(primaryProvider.id, { apiKey: event.target.value })}
            placeholder="留空则保留当前 Key"
          />
        </label>
      </div>
      <p className="settings-muted">API Key 保存在本机配置中，不会显示在项目文件里。场景模型会继续使用下方的分工配置。</p>

      <h3>场景模型</h3>
      <div className="scenario-grid">
        {Object.entries(draftAi.scenario).map(([key, value]) => {
          const isImageScenario = isImageScenarioKey(key)
          const imageIssue = isImageScenario ? imageScenarioIssue(draftAi, value) : undefined
          const options = configuredModelIds.map((model) =>
            isImageScenario
              ? {
                  label: imageScenarioOptionLabel(draftAi, model),
                  value: model,
                  disabled: Boolean(imageScenarioIssue(draftAi, model))
                }
              : { label: displayModelId(model), value: model }
          )
          return (
            <label className={isImageScenario ? 'has-scenario-note' : undefined} key={key}>
              <span>{scenarioLabels[key as keyof AiConfig['scenario']] ?? key}</span>
              <Select
                showSearch={false}
                className={settingsSelectClass('scenario-model-select')}
                classNames={settingsSelectPopupClassNames}
                value={value}
                onChange={(nextValue) =>
                  setDraftAi((current) => ({
                    ...current,
                    scenario: {
                      ...current.scenario,
                      [key as keyof AiConfig['scenario']]: nextValue
                    }
                  }))
                }
                options={options}
              />
              {isImageScenario ? (
                <small className={imageIssue ? 'scenario-note warning' : 'scenario-note'}>
                  {imageIssue ?? '图片生成/编辑将通过 OpenAI-compatible Images API 调用。'}
                </small>
              ) : null}
            </label>
          )
        })}
      </div>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveModels()}>
        保存模型配置
      </Button>
    </div>
  )

  const mcpPanel = (
    <div className="settings-split mcp-settings-split">
      <section className="settings-card full">
        <h3>MCP/工具</h3>
        <p className="settings-muted">配置 MCP server、禁用状态和命令环境变量。保存后会重建 MCP client。</p>
        <Input.TextArea
          className="json-editor"
          rows={20}
          value={mcpText}
          onChange={(event) => setMcpText(event.target.value)}
        />
        <div className="settings-action-row">
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveMcp()}>
            保存 MCP/工具配置
          </Button>
          <Button loading={mcpToolsLoading} onClick={() => void reloadMcpTools()}>
            重载工具
          </Button>
        </div>
      </section>

      <section className="settings-card full mcp-tool-card">
        <header>
          <h3>工具调用</h3>
          <Button size="small" loading={mcpToolsLoading} onClick={() => void reloadMcpTools()}>
            刷新
          </Button>
        </header>
        <Select
          showSearch={false}
          className={settingsSelectClass()}
          classNames={settingsSelectPopupClassNames}
          value={selectedMcpTool || undefined}
          placeholder="选择 MCP 工具"
          onChange={setSelectedMcpTool}
          options={mcpTools.map((tool) => ({
            label: `${tool.finalName} (${tool.serverName})`,
            value: tool.finalName
          }))}
        />
        {currentMcpTool ? (
          <div className="mcp-tool-detail">
            <strong>{currentMcpTool.finalName}</strong>
            <span>{currentMcpTool.description}</span>
            <code>{JSON.stringify(currentMcpTool.parameters, null, 2)}</code>
          </div>
        ) : (
        <p className="settings-muted">暂无工具。请先配置 MCP server 后点击刷新。</p>
        )}
        <h3>调用参数 JSON</h3>
        <Input.TextArea rows={7} value={mcpArgsText} onChange={(event) => setMcpArgsText(event.target.value)} />
        <Button type="primary" disabled={!currentMcpTool} loading={mcpToolsLoading} onClick={() => void callSelectedMcpTool()}>
          调用工具
        </Button>
        <h3>调用结果</h3>
        <pre className="mcp-result">{mcpResult || '暂无结果'}</pre>
      </section>
    </div>
  )

  const selectedResponseStyle =
    responseStyleOptions.find((option) => option.value === normalizeResponseStylePreset(draftSettings.promptContext.responseStylePreset)) ??
    responseStyleOptions[0]

  const promptsPanel = (
    <div className="settings-card full settings-form-card">
      <h3>提示词和上下文配置</h3>
      <label className="settings-inline-label">
        <span>智能体回复风格</span>
        <Select
          showSearch={false}
          className={settingsSelectClass()}
          classNames={settingsSelectPopupClassNames}
          value={normalizeResponseStylePreset(draftSettings.promptContext.responseStylePreset)}
          onChange={(value) => updateSettingsSection('promptContext', { responseStylePreset: value })}
          options={responseStyleOptions.map((option) => ({ label: option.label, value: option.value }))}
        />
      </label>
      <p className="settings-muted">{selectedResponseStyle.description} 只改变说话风格，不改变智能体要做的事。</p>
      <div className="settings-form-grid">
        <label>
          <span>自动携带项目规则、角色和设定</span>
          <Switch
            checked={draftSettings.promptContext.autoCarryProjectRules}
            onChange={(value) => updateSettingsSection('promptContext', { autoCarryProjectRules: value })}
          />
        </label>
        <label>
          <span>自动携带智能上下文</span>
          <Switch
            checked={draftSettings.promptContext.autoCarrySmartContext}
            onChange={(value) => updateSettingsSection('promptContext', { autoCarrySmartContext: value })}
          />
        </label>
        <label>
          <span>智能上下文自动更新</span>
          <Switch
            checked={draftSettings.promptContext.smartContextAutoUpdate}
            onChange={(value) => updateSettingsSection('promptContext', { smartContextAutoUpdate: value })}
          />
        </label>
        <label>
          <span>Agent Memory 自动更新</span>
          <Switch
            checked={draftSettings.promptContext.agentMemoryAutoUpdate}
            onChange={(value) => updateSettingsSection('promptContext', { agentMemoryAutoUpdate: value })}
          />
        </label>
        <label>
          <span>自动摘要阈值（%）</span>
          <InputNumber
            min={10}
            max={95}
            value={draftSettings.promptContext.autoSummaryThresholdPercent}
            onChange={(value) =>
              updateSettingsSection('promptContext', { autoSummaryThresholdPercent: Number(value ?? 70) })
            }
          />
        </label>
        <label>
          <span>上下文窗口上限</span>
          <InputNumber
            min={4096}
            max={256000}
            step={1024}
            value={draftSettings.promptContext.maxContextWindowLimit}
            onChange={(value) =>
              updateSettingsSection('promptContext', { maxContextWindowLimit: Number(value ?? 128000) })
            }
          />
        </label>
        <label>
          <span>最多携带上下文文件数</span>
          <InputNumber
            min={1}
            max={100}
            value={draftSettings.promptContext.maxContextFiles}
            onChange={(value) => updateSettingsSection('promptContext', { maxContextFiles: Number(value ?? 1) })}
          />
        </label>
      </div>
      <h3>辅助创作默认提示词</h3>
      <Input.TextArea
        rows={8}
        value={draftSettings.promptContext.defaultAssistedPrompt}
        onChange={(event) => updateSettingsSection('promptContext', { defaultAssistedPrompt: event.target.value })}
      />
      <div className="prompt-management-header">
        <h3>提示词管理</h3>
        <Button size="small" onClick={addPromptTemplate}>
          新增提示词
        </Button>
      </div>
      <label className="settings-inline-label">
        <span>默认选中提示词</span>
        <Select
          allowClear
          showSearch={false}
          className={settingsSelectClass()}
          classNames={settingsSelectPopupClassNames}
          value={draftSettings.promptContext.defaultSelectedPromptId || undefined}
          onChange={(value) => updateSettingsSection('promptContext', { defaultSelectedPromptId: value ?? '' })}
          options={draftSettings.promptContext.prompts
            .filter((prompt) => prompt.enabled)
            .map((prompt) => ({ label: prompt.title || '未命名提示词', value: prompt.id }))}
        />
      </label>
      <div className="prompt-template-list">
        {draftSettings.promptContext.prompts.map((prompt) => (
          <article className={prompt.enabled ? 'prompt-template-card enabled' : 'prompt-template-card'} key={prompt.id}>
            <header>
              <Input
                value={prompt.title}
                onChange={(event) => updatePromptTemplate(prompt.id, { title: event.target.value })}
                placeholder="提示词名称"
              />
              <Switch
                checked={prompt.enabled}
                onChange={(value) => updatePromptTemplate(prompt.id, { enabled: value })}
              />
              <Button danger size="small" onClick={() => deletePromptTemplate(prompt.id)}>
                删除
              </Button>
            </header>
            <Input
              value={prompt.body}
              onChange={(event) => updatePromptTemplate(prompt.id, { body: event.target.value })}
              placeholder="用途说明"
            />
            <Input.TextArea
              rows={4}
              value={prompt.text}
              onChange={(event) => updatePromptTemplate(prompt.id, { text: event.target.value })}
              placeholder="提示词正文"
            />
          </article>
        ))}
        {!draftSettings.promptContext.prompts.length ? (
          <div className="settings-muted">暂无提示词，点击“新增提示词”创建。</div>
        ) : null}
      </div>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveSettings()}>
        保存提示词和上下文配置
      </Button>
    </div>
  )

  const editorPanel = (
    <div className="settings-card full settings-form-card">
      <h3>编辑器配置</h3>
      <div className="settings-form-grid">
        <label>
          <span>字体</span>
          <Select
          showSearch={false}
            className={settingsSelectClass()}
            classNames={settingsSelectPopupClassNames}
            value={draftSettings.editor.fontFamily}
            onChange={(value) => updateSettingsSection('editor', { fontFamily: value })}
            options={[
              { label: 'AlibabaSans', value: 'AlibabaSans' },
              { label: '方圆体', value: 'AlimamaFangYuanTi' },
              { label: '霞鹜文楷', value: 'LXGWWenKaiGB' },
              { label: '系统默认', value: 'system-ui' }
            ]}
          />
        </label>
        <label>
          <span>字号</span>
          <InputNumber
            min={12}
            max={36}
            value={draftSettings.editor.fontSize}
            onChange={(value) => updateSettingsSection('editor', { fontSize: Number(value ?? 16) })}
          />
        </label>
        <label>
          <span>行高</span>
          <InputNumber
            min={1}
            max={3}
            step={0.1}
            value={draftSettings.editor.lineHeight}
            onChange={(value) => updateSettingsSection('editor', { lineHeight: Number(value ?? 1.7) })}
          />
        </label>
        <label>
          <span>默认编辑模式</span>
          <Select
          showSearch={false}
            className={settingsSelectClass()}
            classNames={settingsSelectPopupClassNames}
            value={draftSettings.editor.viewMode}
            onChange={(value) => updateSettingsSection('editor', { viewMode: value })}
            options={[
              { label: 'Markdown', value: 'markdown' },
              { label: '源码', value: 'source' }
            ]}
          />
        </label>
        <label>
          <span>自动保存</span>
          <Switch checked={draftSettings.editor.autosave} onChange={(value) => updateSettingsSection('editor', { autosave: value })} />
        </label>
        <label>
          <span>拼写检查</span>
          <Switch checked={draftSettings.editor.spellcheck} onChange={(value) => updateSettingsSection('editor', { spellcheck: value })} />
        </label>
      </div>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveSettings()}>
        保存编辑器配置
      </Button>
    </div>
  )

  const backupPanel = (
    <div className="settings-card full settings-form-card">
      <h3>备份管理</h3>
      <div className="settings-form-grid">
        <label>
          <span>自动备份</span>
          <Switch checked={draftSettings.backup.autoBackup} onChange={(value) => updateSettingsSection('backup', { autoBackup: value })} />
        </label>
        <label>
          <span>备份间隔（分钟）</span>
          <InputNumber
            min={1}
            max={1440}
            value={draftSettings.backup.intervalMinutes}
            onChange={(value) => updateSettingsSection('backup', { intervalMinutes: Number(value ?? 10) })}
          />
        </label>
        <label>
          <span>保留版本数</span>
          <InputNumber
            min={1}
            max={500}
            value={draftSettings.backup.keepVersions}
            onChange={(value) => updateSettingsSection('backup', { keepVersions: Number(value ?? 50) })}
          />
        </label>
        <label className="wide">
          <span>备份目录</span>
          <div className="settings-path-row">
            <Input
              value={draftSettings.backup.backupDir}
              placeholder="留空时使用项目内 .wangyang/backups"
              onChange={(event) => updateSettingsSection('backup', { backupDir: event.target.value })}
            />
            <Button onClick={() => void chooseBackupDirectory()}>选择</Button>
            <Button onClick={() => updateSettingsSection('backup', { backupDir: '' })}>默认</Button>
          </div>
        </label>
      </div>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveSettings()}>
        保存备份配置
      </Button>
    </div>
  )

  const systemPanel = (
    <div className="settings-card full settings-form-card">
      <h3>系统配置</h3>
      <div className="settings-form-grid">
        <label>
          <span>语言</span>
          <Select
          showSearch={false}
            className={settingsSelectClass()}
            classNames={settingsSelectPopupClassNames}
            value={draftSettings.system.language}
            onChange={(value) => updateSettingsSection('system', { language: value })}
            options={[
              { label: '中文', value: 'zh' },
              { label: 'English', value: 'en' },
              { label: '日本语', value: 'ja' },
              { label: '繁體中文', value: 'zh-TW' }
            ]}
          />
        </label>
        <label>
          <span>显示模式</span>
          <div className="settings-theme-toggle" role="group" aria-label="显示模式">
            {[
              { label: '日间模式', value: 'light' },
              { label: '夜间模式', value: 'dark' }
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                className={draftSettings.system.theme === option.value ? 'active' : ''}
                aria-pressed={draftSettings.system.theme === option.value}
                onClick={() => void applyThemeMode(option.value as LocalSettings['system']['theme'])}
              >
                {option.label}
              </button>
            ))}
          </div>
        </label>
        <label>
          <span>更新方式</span>
          <div className="settings-readonly-value">本地构建产物</div>
        </label>
        <label>
          <span>诊断日志</span>
          <Switch checked={draftSettings.system.diagnostics} onChange={(value) => updateSettingsSection('system', { diagnostics: value })} />
        </label>
        <label>
          <span>应用锁</span>
          <Switch checked={draftSettings.system.appLock} onChange={(value) => updateSettingsSection('system', { appLock: value })} />
        </label>
        <label>
          <span>本地 PIN</span>
          <Input.Password
            value={appLockPinDraft}
            disabled={!draftSettings.system.appLock}
            placeholder="留空保持现有 PIN，输入新 PIN 后保存"
            onChange={(event) => setAppLockPinDraft(event.target.value)}
          />
        </label>
      </div>
      <div className="settings-action-row">
        <Button title="Check for updates" onClick={checkForUpdates}>Check updates</Button>
        <Button onClick={() => void exportDiagnostics()}>导出诊断</Button>
      </div>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveSettings()}>
        保存系统配置
      </Button>
    </div>
  )

  return (
    <Modal
      className="settings-modal"
      title="配置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={1240}
      centered
      destroyOnClose={false}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={configTabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          children:
            tab.key === 'user'
              ? userPanel
              : tab.key === 'models'
                ? modelPanel
                : tab.key === 'mcp'
                  ? mcpPanel
                  : tab.key === 'prompts'
                    ? promptsPanel
                    : tab.key === 'editor'
                      ? editorPanel
                      : tab.key === 'backup'
                        ? backupPanel
                        : systemPanel
        }))}
      />
    </Modal>
  )
}

function AntAppContext() {
  const app = AntApp.useApp()
  return app
}
