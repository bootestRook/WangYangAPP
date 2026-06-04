import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AiConfig,
  AppSnapshot,
  DirectoryListing,
  FetchUrlResult,
  ImageGenerationResult,
  LocalSettings,
  McpConfig,
  McpToolInfo,
  ModelInterfaceConfig,
  AgentFileInfo,
  ProjectConfig,
  ProjectCreateInput,
  ProjectInfo,
  ProjectBackupInfo,
  ProjectEntry,
  RunCommandResult,
  SearchMatch,
  SkillInfo,
  SmartContextDraft,
  SmartContextGenerationResult,
  SubAgentSession
} from '../shared/types'

const api = {
  getAppSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke(IPC.getAppSnapshot),
  getProjects: (): Promise<ProjectInfo[]> => ipcRenderer.invoke(IPC.getProjects),
  createProject: (input: ProjectCreateInput): Promise<ProjectInfo> =>
    ipcRenderer.invoke(IPC.createProject, input),
  openProject: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke(IPC.openProject, id),
  renameProject: (id: string, name: string): Promise<ProjectInfo> =>
    ipcRenderer.invoke(IPC.renameProject, id, name),
  deleteProject: (id: string, deleteFiles?: boolean): Promise<{ deleted: string; root: string; filesDeleted: boolean }> =>
    ipcRenderer.invoke(IPC.deleteProject, id, deleteFiles),
  readProjectConfig: (): Promise<ProjectConfig> => ipcRenderer.invoke(IPC.readProjectConfig),
  writeProjectConfig: (config: ProjectConfig): Promise<ProjectConfig> =>
    ipcRenderer.invoke(IPC.writeProjectConfig, config),
  listSkills: (): Promise<SkillInfo[]> => ipcRenderer.invoke(IPC.listSkills),
  listSkillDirectory: (skillName: string): Promise<ProjectEntry[]> =>
    ipcRenderer.invoke(IPC.listSkillDirectory, skillName),
  createSkill: (name: string, content?: string): Promise<SkillInfo> =>
    ipcRenderer.invoke(IPC.createSkill, name, content),
  deleteSkill: (name: string): Promise<{ deleted: string }> =>
    ipcRenderer.invoke(IPC.deleteSkill, name),
  listAgents: (): Promise<AgentFileInfo[]> => ipcRenderer.invoke(IPC.listAgents),
  readAgentContent: (agentId: string): Promise<string> =>
    ipcRenderer.invoke(IPC.readAgentContent, agentId),
  writeAgentContent: (agentId: string, content: string): Promise<AgentFileInfo> =>
    ipcRenderer.invoke(IPC.writeAgentContent, agentId, content),
  createAgent: (agentId: string, content?: string): Promise<AgentFileInfo> =>
    ipcRenderer.invoke(IPC.createAgent, agentId, content),
  deleteAgent: (agentId: string): Promise<{ deleted: string }> =>
    ipcRenderer.invoke(IPC.deleteAgent, agentId),
  listSubAgentSessions: (): Promise<SubAgentSession[]> =>
    ipcRenderer.invoke(IPC.listSubAgentSessions),
  writeSubAgentSession: (session: SubAgentSession): Promise<SubAgentSession> =>
    ipcRenderer.invoke(IPC.writeSubAgentSession, session),
  deleteSubAgentSessionFile: (sessionId: string): Promise<{ deleted: string }> =>
    ipcRenderer.invoke(IPC.deleteSubAgentSession, sessionId),
  setProjectRoot: (projectRoot: string): Promise<AppSnapshot> =>
    ipcRenderer.invoke(IPC.setProjectRoot, projectRoot),
  listDirectory: (relativePath = ''): Promise<DirectoryListing> =>
    ipcRenderer.invoke(IPC.listDirectory, relativePath),
  readFile: (relativePath: string): Promise<string> => ipcRenderer.invoke(IPC.readFile, relativePath),
  writeFile: (relativePath: string, content: string): Promise<{ relativePath: string; bytes: number }> =>
    ipcRenderer.invoke(IPC.writeFile, relativePath, content),
  createEntry: (
    relativePath: string,
    type: 'file' | 'directory',
    content?: string
  ): Promise<{ name: string; relativePath: string; type: 'file' | 'directory' }> =>
    ipcRenderer.invoke(IPC.createEntry, relativePath, type, content),
  renameEntry: (
    relativePath: string,
    nextName: string
  ): Promise<{ name: string; relativePath: string; type: 'file' | 'directory' }> =>
    ipcRenderer.invoke(IPC.renameEntry, relativePath, nextName),
  deleteEntry: (relativePath: string): Promise<{ deleted: string }> =>
    ipcRenderer.invoke(IPC.deleteEntry, relativePath),
  moveEntry: (
    relativePath: string,
    targetRelativePath: string
  ): Promise<{ name: string; relativePath: string; type: 'file' | 'directory' }> =>
    ipcRenderer.invoke(IPC.moveEntry, relativePath, targetRelativePath),
  searchInFiles: (query: string, limit?: number): Promise<SearchMatch[]> =>
    ipcRenderer.invoke(IPC.searchInFiles, query, limit),
  searchFiles: (query: string, limit?: number): Promise<ProjectEntry[]> =>
    ipcRenderer.invoke(IPC.searchFiles, query, limit),
  openTextFile: (): Promise<{ path: string; name: string; content: string } | undefined> =>
    ipcRenderer.invoke(IPC.openTextFile),
  saveTextFile: (defaultName: string, content: string): Promise<{ path: string } | undefined> =>
    ipcRenderer.invoke(IPC.saveTextFile, defaultName, content),
  saveBinaryFile: (defaultName: string, base64: string): Promise<{ path: string } | undefined> =>
    ipcRenderer.invoke(IPC.saveBinaryFile, defaultName, base64),
  savePdfFromHtml: (defaultName: string, html: string): Promise<{ path: string } | undefined> =>
    ipcRenderer.invoke(IPC.savePdfFromHtml, defaultName, html),
  selectDirectory: (defaultPath?: string): Promise<{ path: string } | undefined> =>
    ipcRenderer.invoke(IPC.selectDirectory, defaultPath),
  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.showItemInFolder, filePath),
  openProjectPathExternal: (relativePath: string): Promise<{ path: string; error?: string }> =>
    ipcRenderer.invoke(IPC.openProjectPathExternal, relativePath),
  showProjectPathInFolder: (relativePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.showProjectPathInFolder, relativePath),
  openProjectFolder: (): Promise<{ path: string; error?: string }> =>
    ipcRenderer.invoke(IPC.openProjectFolder),
  readProjectFileDataUrl: (relativePath: string): Promise<{ dataUrl: string; mime: string; size: number }> =>
    ipcRenderer.invoke(IPC.readProjectFileDataUrl, relativePath),
  buildSmartContext: (maxFiles?: number): Promise<SmartContextDraft> =>
    ipcRenderer.invoke(IPC.buildSmartContext, maxFiles),
  generateSmartContext: (maxFiles?: number): Promise<SmartContextGenerationResult> =>
    ipcRenderer.invoke(IPC.generateSmartContext, maxFiles),
  generateImage: (prompt: string, size?: string): Promise<ImageGenerationResult> =>
    ipcRenderer.invoke(IPC.generateImage, prompt, size),
  editImage: (sourcePath: string, prompt: string, size?: string): Promise<ImageGenerationResult> =>
    ipcRenderer.invoke(IPC.editImage, sourcePath, prompt, size),
  createBackup: (): Promise<ProjectBackupInfo> => ipcRenderer.invoke(IPC.createBackup),
  listBackups: (): Promise<ProjectBackupInfo[]> => ipcRenderer.invoke(IPC.listBackups),
  getAiConfig: (): Promise<AiConfig> => ipcRenderer.invoke(IPC.getAiConfig),
  saveAiConfig: (config: AiConfig): Promise<AiConfig> => ipcRenderer.invoke(IPC.saveAiConfig, config),
  listRemoteModels: (provider: ModelInterfaceConfig): Promise<string[]> =>
    ipcRenderer.invoke(IPC.listRemoteModels, provider),
  getMcpConfig: (): Promise<McpConfig> => ipcRenderer.invoke(IPC.getMcpConfig),
  saveMcpConfig: (config: McpConfig): Promise<McpConfig> => ipcRenderer.invoke(IPC.saveMcpConfig, config),
  getLocalSettings: (): Promise<LocalSettings> => ipcRenderer.invoke(IPC.getLocalSettings),
  saveLocalSettings: (settings: LocalSettings): Promise<LocalSettings> =>
    ipcRenderer.invoke(IPC.saveLocalSettings, settings),
  listMcpTools: (): Promise<McpToolInfo[]> => ipcRenderer.invoke(IPC.listMcpTools),
  callMcpTool: (
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> => ipcRenderer.invoke(IPC.callMcpTool, serverName, toolName, args),
  closeMcpClients: (): Promise<void> => ipcRenderer.invoke(IPC.closeMcpClients),
  fetchUrlContent: (url: string, timeoutMs?: number): Promise<FetchUrlResult> =>
    ipcRenderer.invoke(IPC.fetchUrlContent, url, timeoutMs),
  runCommand: (command: string, cwd?: string): Promise<RunCommandResult> =>
    ipcRenderer.invoke(IPC.runCommand, command, cwd),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
  toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowToggleMaximize),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose)
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronApi = typeof api
