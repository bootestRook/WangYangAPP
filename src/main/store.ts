import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defaultAiConfig } from '../core/models/defaultConfig'
import { normalizeAiConfigForLocalRuntime } from '../core/models/modelConfig'
import {
  createProjectFromTemplate,
  deleteProjectFiles,
  inferProjectFromRoot,
  normalizeProjectInfo,
  upsertProject
} from './fs/projectLifecycleService'
import type { AiConfig, AppSnapshot, Entitlements, LocalSettings, McpConfig, ProjectCreateInput, ProjectInfo } from '../shared/types'

interface StoreShape {
  projectRoot: string
  projects: ProjectInfo[]
  aiConfig: AiConfig
  mcpConfig: McpConfig
  localSettings: LocalSettings
}

type StoreCandidate = {
  parsed: Partial<StoreShape>
  sourcePath: string
  isLegacy: boolean
}

export const defaultLocalSettings: LocalSettings = {
  promptContext: {
    autoCarryProjectRules: true,
    autoCarrySmartContext: true,
    smartContextAutoUpdate: true,
    agentMemoryAutoUpdate: true,
    agentToolPermissionMode: 'request',
    responseStylePreset: 'wangyang-roast',
    autoSummaryThresholdPercent: 70,
    maxContextWindowLimit: 64000,
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

const defaultStore: StoreShape = {
  projectRoot: '',
  projects: [],
  aiConfig: defaultAiConfig,
  mcpConfig: { mcpServers: {}, disabled: {}, commandEnv: {}, inputs: {} },
  localSettings: defaultLocalSettings
}

export const localFreeEntitlements: Entitlements = {
  mode: 'local-free',
  auth: {
    loggedIn: false
  },
  capabilities: {
    cloudLikeFeatures: true,
    agentTool: true,
    semanticSearch: true,
    knowledgeBase: true,
    imageGeneration: true,
    subAgents: true,
    mcp: true
  },
  isLoggedIn: false,
  isVip: false,
  isProVip: false,
  enableCloudLikeFeatures: true,
  enableAgentTool: true,
  enableSemanticSearch: true,
  enableKnowledgeBase: true,
  enableImageGeneration: true,
  enableSubAgents: true,
  enableMcp: true
}

export class JsonStore {
  private filePath(): string {
    return path.join(app.getPath('userData'), 'wangyang-store.json')
  }

  private legacyFilePaths(): string[] {
    const legacyFileName = `${'feel'}${'fishx'}-store.json`
    const legacyAppName = `${'feel'}${'fishx'}-rebuild`
    return [
      path.join(app.getPath('userData'), legacyFileName),
      path.join(app.getPath('appData'), legacyAppName, legacyFileName)
    ]
  }

  private parseStoreRaw(raw: string): Partial<StoreShape> | undefined {
    try {
      return JSON.parse(raw) as Partial<StoreShape>
    } catch {
      return undefined
    }
  }

  private hasConfiguredProvider(parsed: Partial<StoreShape> | undefined): boolean {
    return Object.values(parsed?.aiConfig?.interfaces ?? {}).some((provider) => provider.apiKey.trim())
  }

  private async readStoreCandidateAt(sourcePath: string, isLegacy: boolean): Promise<StoreCandidate | undefined> {
    try {
      const parsed = this.parseStoreRaw(await readFile(sourcePath, 'utf8'))
      return parsed ? { parsed, sourcePath, isLegacy } : undefined
    } catch {
      return undefined
    }
  }

  private async readStoreCandidate(): Promise<StoreCandidate | undefined> {
    const current = await this.readStoreCandidateAt(this.filePath(), false)
    const legacyCandidates: StoreCandidate[] = []
    for (const legacyPath of this.legacyFilePaths()) {
      try {
        const candidate = await this.readStoreCandidateAt(legacyPath, true)
        if (candidate) legacyCandidates.push(candidate)
      } catch {
        // Try the next legacy location.
      }
    }

    const configuredLegacy = legacyCandidates.find((candidate) => this.hasConfiguredProvider(candidate.parsed))
    if (current && (this.hasConfiguredProvider(current.parsed) || !configuredLegacy)) return current
    return configuredLegacy ?? current ?? legacyCandidates[0]
  }

  private normalizeParsedStore(parsed: Partial<StoreShape>): StoreShape {
    const aiConfig = normalizeAiConfigForLocalRuntime({
      ...defaultAiConfig,
      ...parsed.aiConfig,
      interfaces: {
        ...defaultAiConfig.interfaces,
        ...(parsed.aiConfig?.interfaces ?? {})
      },
      modelMetadata: {
        ...defaultAiConfig.modelMetadata,
        ...(parsed.aiConfig?.modelMetadata ?? {})
      },
      scenario: {
        ...defaultAiConfig.scenario,
        ...(parsed.aiConfig?.scenario ?? {})
      }
    })

    const projects = Array.isArray(parsed.projects)
      ? parsed.projects
          .filter((project): project is ProjectInfo => Boolean(project && typeof project.root === 'string'))
          .map((project) => normalizeProjectInfo(project))
      : []

    return {
      ...defaultStore,
      ...parsed,
      projects,
      aiConfig,
      mcpConfig: {
        mcpServers: parsed.mcpConfig?.mcpServers ?? {},
        disabled: parsed.mcpConfig?.disabled ?? {},
        commandEnv: parsed.mcpConfig?.commandEnv ?? {},
        inputs: parsed.mcpConfig?.inputs ?? {}
      },
      localSettings: {
        promptContext: {
          ...defaultLocalSettings.promptContext,
          ...(parsed.localSettings?.promptContext ?? {})
        },
        editor: {
          ...defaultLocalSettings.editor,
          ...(parsed.localSettings?.editor ?? {})
        },
        backup: {
          ...defaultLocalSettings.backup,
          ...(parsed.localSettings?.backup ?? {})
        },
        system: {
          ...defaultLocalSettings.system,
          ...(parsed.localSettings?.system ?? {})
        }
      }
    }
  }

  async read(): Promise<StoreShape> {
    const candidate = await this.readStoreCandidate()
    const normalized = this.normalizeParsedStore(candidate?.parsed ?? defaultStore)
    const normalizedRaw = JSON.stringify(normalized, null, 2)
    const candidateRaw = JSON.stringify(candidate?.parsed ?? {}, null, 2)
    if (!candidate || candidate.isLegacy || candidate.sourcePath !== this.filePath() || candidateRaw !== normalizedRaw) {
      await this.write(normalized)
    }
    return normalized
  }

  async write(next: StoreShape): Promise<void> {
    await mkdir(path.dirname(this.filePath()), { recursive: true })
    await writeFile(this.filePath(), JSON.stringify(next, null, 2), 'utf8')
  }

  async snapshot(): Promise<AppSnapshot> {
    const current = await this.read()
    return {
      projectRoot: current.projectRoot,
      aiConfig: current.aiConfig,
      mcpConfig: current.mcpConfig,
      localSettings: current.localSettings,
      entitlements: localFreeEntitlements
    }
  }

  async setProjectRoot(projectRoot: string): Promise<void> {
    const current = await this.read()
    const trimmedRoot = projectRoot.trim()
    if (!trimmedRoot) {
      await this.write({ ...current, projectRoot: '' })
      return
    }
    let projects = current.projects
    try {
      const project = await inferProjectFromRoot(trimmedRoot)
      projects = upsertProject(projects, project)
    } catch {
      // A manually typed path may not exist yet; keep the root value for the UI error path.
    }
    await this.write({ ...current, projectRoot: trimmedRoot, projects })
  }

  async getProjects(): Promise<ProjectInfo[]> {
    const current = await this.read()
    return current.projects
  }

  async createProject(input: ProjectCreateInput): Promise<ProjectInfo> {
    const current = await this.read()
    const project = await createProjectFromTemplate(input)
    const projects = upsertProject(current.projects, project)
    await this.write({ ...current, projectRoot: project.root, projects })
    return project
  }

  async openProject(id: string): Promise<void> {
    const current = await this.read()
    const project = current.projects.find((item) => item.id === id)
    if (!project) throw new Error('项目不存在或已从列表移除。')
    const opened = { ...project, lastOpenedAt: Date.now(), updatedAt: Date.now() }
    await this.write({ ...current, projectRoot: opened.root, projects: upsertProject(current.projects, opened) })
  }

  async renameProject(id: string, name: string): Promise<ProjectInfo> {
    const current = await this.read()
    const trimmed = name.trim()
    if (!trimmed) throw new Error('项目名称不能为空。')
    const project = current.projects.find((item) => item.id === id)
    if (!project) throw new Error('项目不存在或已从列表移除。')
    const renamed = { ...project, name: trimmed, updatedAt: Date.now() }
    await this.write({ ...current, projects: upsertProject(current.projects, renamed) })
    return renamed
  }

  async deleteProject(id: string, deleteFiles = false): Promise<{ deleted: string; root: string; filesDeleted: boolean }> {
    const current = await this.read()
    const project = current.projects.find((item) => item.id === id)
    if (!project) throw new Error('项目不存在或已从列表移除。')
    if (deleteFiles) await deleteProjectFiles(project.root)
    const projects = current.projects.filter((item) => item.id !== id)
    const nextRoot = current.projectRoot && path.resolve(current.projectRoot) === path.resolve(project.root) ? '' : current.projectRoot
    await this.write({ ...current, projectRoot: nextRoot, projects })
    return { deleted: id, root: project.root, filesDeleted: deleteFiles }
  }

  async setAiConfig(aiConfig: AiConfig): Promise<AiConfig> {
    const current = await this.read()
    const normalized = normalizeAiConfigForLocalRuntime(aiConfig)
    await this.write({ ...current, aiConfig: normalized })
    return normalized
  }

  async setMcpConfig(mcpConfig: McpConfig): Promise<void> {
    const current = await this.read()
    await this.write({ ...current, mcpConfig })
  }

  async setLocalSettings(localSettings: LocalSettings): Promise<void> {
    const current = await this.read()
    await this.write({ ...current, localSettings })
  }
}

export const jsonStore = new JsonStore()
