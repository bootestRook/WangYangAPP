export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  attachments?: ChatAttachment[]
  name?: string
  toolCallId?: string
  toolCalls?: ToolCall[]
  createdAt: number
}

export interface ChatAttachment {
  id: string
  type: 'image'
  name: string
  mimeType: string
  size: number
  dataUrl: string
}

export interface ToolCall {
  id: string
  name: string
  argumentsText: string
  argumentsJson?: Record<string, unknown>
  status: 'running' | 'success' | 'error'
}

export interface ToolResult {
  toolCallId: string
  name: string
  content: string
  isSuccess: boolean
  displayContent?: string
  raw?: unknown
}

export interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: string[]
  description?: string
  additionalProperties?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
  mode: 'read' | 'write' | 'network' | 'danger' | 'agent'
}

export interface ModelInterfaceConfig {
  id: string
  label: string
  apiUrl: string
  apiKey: string
  isBuiltIn?: boolean
  requestFormat?: 'openai' | 'responses' | 'claude'
  defaultModel?: string
  defaultHeaders?: Record<string, string>
}

export interface ScenarioConfig {
  writing: string
  modification: string
  summary: string
  smartContext: string
  agent: string
  agentPlanner: string
  agentWriter: string
  agentPolisher: string
  agentReviewer: string
  image: string
  imageEdit: string
}

export interface AiConfig {
  interfaces: Record<string, ModelInterfaceConfig>
  availableModels: string[]
  modelMetadata: Record<string, ModelMetadata>
  scenario: ScenarioConfig
}

export interface ModelMetadata {
  id: string
  label?: string
  maxContextWindow: number
  supportImage: boolean
  supportThinking: boolean
  priceTier: 'free' | 'low' | 'medium' | 'high' | 'unknown'
  deprecated?: boolean
  defaultTemperature?: number
}

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  type?: 'stdio' | 'http' | 'sse'
  disabled?: boolean
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
  disabled?: Record<string, boolean>
  commandEnv?: Record<string, string>
  inputs?: Record<string, unknown>
}

export type ResponseStylePreset =
  | 'senior-editor'
  | 'creative-god'
  | 'web-novel-master'
  | 'wangyang-roast'
  | 'wangyang-yujie'
  | 'wangyang-loli'
  | 'wangyang-tsundere'
  | 'wangyang-madam'
  | 'wangyang-gay'
  | 'wangyang-simp'

export type AgentToolPermissionMode = 'request' | 'trusted' | 'full' | 'custom'

export interface PromptContextConfig {
  autoCarryProjectRules: boolean
  autoCarrySmartContext: boolean
  smartContextAutoUpdate: boolean
  agentMemoryAutoUpdate: boolean
  agentToolPermissionMode: AgentToolPermissionMode
  responseStylePreset: ResponseStylePreset
  autoSummaryThresholdPercent: number
  maxContextWindowLimit: number
  defaultAssistedPrompt: string
  defaultSelectedPromptId: string
  prompts: PromptTemplate[]
  maxContextFiles: number
}

export interface PromptTemplate {
  id: string
  title: string
  body: string
  text: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface EditorConfig {
  fontFamily: string
  fontSize: number
  lineHeight: number
  viewMode: 'markdown' | 'source'
  autosave: boolean
  spellcheck: boolean
}

export interface BackupConfig {
  autoBackup: boolean
  intervalMinutes: number
  keepVersions: number
  backupDir: string
}

export interface SystemConfig {
  language: 'zh' | 'en' | 'ja' | 'zh-TW'
  theme: 'dark' | 'light'
  autoUpdate: boolean
  diagnostics: boolean
  appLock: boolean
  appLockPin: string
  appLockPinHash: string
}

export interface LocalSettings {
  promptContext: PromptContextConfig
  editor: EditorConfig
  backup: BackupConfig
  system: SystemConfig
}

export interface McpToolInfo {
  serverName: string
  toolName: string
  finalName: string
  description: string
  parameters: JsonSchema
  transport: string
}

export interface ProjectEntry {
  name: string
  relativePath: string
  type: 'file' | 'directory'
  size?: number
  updatedAt?: number
}

export interface DirectoryListing {
  root: string
  relativePath: string
  entries: ProjectEntry[]
}

export type ProjectTemplateType = 'basic' | 'analysis'

export interface ProjectInfo {
  id: string
  name: string
  root: string
  projectType: ProjectTemplateType
  language: string
  createdAt: number
  updatedAt: number
  lastOpenedAt?: number
}

export interface ProjectCreateInput {
  name: string
  parentPath: string
  projectType: ProjectTemplateType
  language?: string
}

export type ProjectConfigValue = string | number | boolean | null | ProjectConfigValue[] | { [key: string]: ProjectConfigValue }

export type ProjectConfig = Record<string, ProjectConfigValue>

export interface SkillInfo {
  name: string
  relativePath: string
  entryPath: string
  description?: string
  updatedAt?: number
}

export interface AgentFileInfo {
  id: string
  name: string
  relativePath: string
  description?: string
  tools?: string[]
  skills?: string[]
  isBuiltIn?: boolean
  updatedAt?: number
}

export interface SearchMatch {
  file: string
  line: number
  preview: string
}

export interface SmartContextDraft {
  projectName: string
  files: Array<{ path: string; chars: number; hash: string }>
  prompt: string
  createdAt: number
}

export interface SmartContextGenerationResult extends SmartContextDraft {
  content: string
  model: string
}

export interface ImageGenerationResult {
  relativePath: string
  manifestPath: string
  prompt: string
  model: string
  size: string
  operation?: 'generate' | 'edit'
  sourcePath?: string
  createdAt: number
}

export interface ProjectBackupInfo {
  id: string
  path: string
  createdAt: number
  files: number
  bytes: number
}

export interface FetchUrlResult {
  url: string
  finalUrl: string
  status: number
  contentType: string
  text: string
}

export interface RunCommandResult {
  stdout: string
  stderr: string
  code: number | null
  error?: string
}

export interface AgentRunEvent {
  type:
    | 'message-start'
    | 'text-delta'
    | 'tool-call'
    | 'tool-result'
    | 'usage'
    | 'done'
    | 'error'
  messageId?: string
  text?: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  error?: string
}

export type AgentMode = 'professional' | 'planning' | 'writing' | 'adventure'
export type SubAgentRole = 'planner' | 'writer' | 'reviewer' | 'researcher'

export interface AgentSession {
  id: string
  title: string
  mode: AgentMode
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface SubAgentSession {
  id: string
  role: SubAgentRole
  title: string
  prompt: string
  messages: ChatMessage[]
  status: 'running' | 'done' | 'error'
  error?: string
  createdAt: number
  updatedAt: number
}

export interface AppSnapshot {
  projectRoot: string
  aiConfig: AiConfig
  mcpConfig: McpConfig
  localSettings: LocalSettings
  entitlements: Entitlements
}

export interface Entitlements {
  mode: 'local-free'
  auth: {
    loggedIn: false
    userId?: string
  }
  capabilities: {
    cloudLikeFeatures: true
    agentTool: true
    semanticSearch: true
    knowledgeBase: true
    imageGeneration: true
    subAgents: true
    mcp: true
  }
  isLoggedIn?: false
  isVip?: false
  isProVip?: false
  enableCloudLikeFeatures?: true
  enableAgentTool?: true
  enableSemanticSearch?: true
  enableKnowledgeBase?: true
  enableImageGeneration?: true
  enableSubAgents?: true
  enableMcp?: true
}
