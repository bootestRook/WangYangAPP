import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron'
import { mkdir, readFile as readExternalFile, stat as statExternalFile, writeFile as writeExternalFile } from 'node:fs/promises'
import path from 'node:path'
import { refreshBackupScheduler } from './backup/backupScheduler'
import { createProjectBackup, listProjectBackups } from './backup/backupService'
import { runCommand } from './command/runCommand'
import {
  createProjectEntry,
  deleteProjectEntry,
  listDirectory,
  moveProjectEntry,
  readProjectFile,
  renameProjectEntry,
  searchProjectFiles,
  searchInFiles,
  writeProjectFile
} from './fs/projectService'
import { readProjectConfig, writeProjectConfig } from './fs/projectConfigService'
import {
  createAgent,
  createSkill,
  deleteAgent,
  deleteSkill,
  listAgents,
  listSkillDirectory,
  listSkills,
  readAgentContent,
  writeAgentContent
} from './fs/skillAgentService'
import {
  deleteSubAgentSession,
  listSubAgentSessions,
  writeSubAgentSession
} from './fs/subAgentSessionService'
import { buildSmartContextDraft, generateSmartContext } from './fs/smartContextService'
import { editProjectImage, generateProjectImage } from './image/imageGenerationService'
import { callMcpTool, closeAllMcpClients, listMcpTools } from './mcp/mcpService'
import { fetchUrlContent } from './network/fetchUrlContent'
import { jsonStore } from './store'
import { IPC } from '../shared/ipc'
import type { AiConfig, LocalSettings, McpConfig, ModelInterfaceConfig, ProjectConfig, ProjectCreateInput, SubAgentSession } from '../shared/types'

const TEXT_IMPORT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.html', '.htm'])
const MAX_TEXT_IMPORT_BYTES = 20 * 1024 * 1024

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index, all) => value && all.indexOf(value) === index)
}

function versionedModelBaseUrl(apiUrl: string): string | undefined {
  const base = apiUrl.replace(/\/+$/, '')
  if (/\/(?:v\d+|compatible-mode\/v\d+|api\/paas\/v\d+)$/i.test(base)) return undefined
  return `${base}/v1`
}

function modelEndpointCandidates(apiUrl: string): string[] {
  const base = apiUrl.replace(/\/+$/, '')
  const versioned = versionedModelBaseUrl(base)
  return uniqueStrings([`${base}/models`, versioned ? `${versioned}/models` : ''])
}

function remoteModelHeaders(provider: ModelInterfaceConfig): Record<string, string> {
  const requestFormat = provider.requestFormat ?? 'openai'
  const headers: Record<string, string> = {
    ...(provider.defaultHeaders ?? {}),
    'content-type': 'application/json'
  }
  if (requestFormat === 'claude') {
    headers['x-api-key'] = provider.apiKey
    headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01'
  } else {
    headers.authorization = `Bearer ${provider.apiKey}`
  }
  return headers
}

async function listRemoteProviderModels(provider: ModelInterfaceConfig): Promise<string[]> {
  const apiUrl = provider.apiUrl.trim()
  const apiKey = provider.apiKey.trim()
  if (!apiUrl) throw new Error('请先填写 Base URL')
  if (!apiKey) throw new Error('请先填写 API Key')

  let lastError = ''
  for (const url of modelEndpointCandidates(apiUrl)) {
    try {
      const response = await fetch(url, { headers: remoteModelHeaders({ ...provider, apiUrl, apiKey }) })
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`.trim()
        continue
      }
      const payload = (await response.json()) as { data?: Array<{ id?: unknown }> }
      const models = uniqueStrings(
        (payload.data ?? [])
          .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
          .filter(Boolean)
      )
      if (models.length) return models
      lastError = '接口没有返回模型列表'
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(lastError || '加载模型失败')
}
const IMAGE_PREVIEW_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
}
const MAX_IMAGE_PREVIEW_BYTES = 15 * 1024 * 1024

type SaveFilter = { name: string; extensions: string[] }

function resolveCommandCwd(projectRoot: string, requestedCwd?: string): string {
  if (!projectRoot.trim()) return requestedCwd?.trim() ? path.resolve(requestedCwd) : ''
  const root = path.resolve(projectRoot)
  const requested = requestedCwd?.trim() ? path.resolve(requestedCwd) : root
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  return requested === root || requested.startsWith(rootWithSep) ? requested : root
}

function resolveInsideProject(root: string, relativePath: string): string {
  if (!root.trim()) throw new Error('Project root is not configured.')
  const resolvedRoot = path.resolve(root)
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || path.isAbsolute(normalized) || normalized.split('/').some((segment) => segment === '..')) {
    throw new Error('Project path must be relative and stay inside the project root.')
  }
  const target = path.resolve(resolvedRoot, normalized)
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`
  if (target !== resolvedRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`Path escapes project root: ${relativePath}`)
  }
  return target
}

async function chooseSavePath(
  event: IpcMainInvokeEvent,
  defaultName: string,
  filters: SaveFilter[]
): Promise<string | undefined> {
  const snapshot = await jsonStore.snapshot()
  const window = BrowserWindow.fromWebContents(event.sender)
  const safeDefaultName = defaultName.trim() || 'wangyang-export'
  const defaultPath = snapshot.projectRoot
    ? path.join(snapshot.projectRoot, '.wangyang', 'exports', safeDefaultName)
    : safeDefaultName
  const options = {
    defaultPath,
    filters: [...filters, { name: 'All files', extensions: ['*'] }]
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? undefined : result.filePath
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.handle(IPC.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IPC.getAppSnapshot, () => jsonStore.snapshot())

  ipcMain.handle(IPC.getProjects, () => jsonStore.getProjects())

  ipcMain.handle(IPC.createProject, async (_event, input: ProjectCreateInput) => {
    const project = await jsonStore.createProject(input)
    void refreshBackupScheduler()
    return project
  })

  ipcMain.handle(IPC.openProject, async (_event, id: string) => {
    await jsonStore.openProject(id)
    void refreshBackupScheduler()
    return jsonStore.snapshot()
  })

  ipcMain.handle(IPC.renameProject, async (_event, id: string, name: string) => jsonStore.renameProject(id, name))

  ipcMain.handle(IPC.deleteProject, async (_event, id: string, deleteFiles?: boolean) => {
    const result = await jsonStore.deleteProject(id, Boolean(deleteFiles))
    void refreshBackupScheduler()
    return result
  })

  ipcMain.handle(IPC.readProjectConfig, async () => {
    const snapshot = await jsonStore.snapshot()
    return readProjectConfig(snapshot.projectRoot)
  })

  ipcMain.handle(IPC.writeProjectConfig, async (_event, config: ProjectConfig) => {
    const snapshot = await jsonStore.snapshot()
    return writeProjectConfig(snapshot.projectRoot, config)
  })

  ipcMain.handle(IPC.listSkills, async () => {
    const snapshot = await jsonStore.snapshot()
    return listSkills(snapshot.projectRoot)
  })

  ipcMain.handle(IPC.listSkillDirectory, async (_event, skillName: string) => {
    const snapshot = await jsonStore.snapshot()
    return listSkillDirectory(snapshot.projectRoot, skillName)
  })

  ipcMain.handle(IPC.createSkill, async (_event, name: string, content?: string) => {
    const snapshot = await jsonStore.snapshot()
    return createSkill(snapshot.projectRoot, name, content)
  })

  ipcMain.handle(IPC.deleteSkill, async (_event, name: string) => {
    const snapshot = await jsonStore.snapshot()
    return deleteSkill(snapshot.projectRoot, name)
  })

  ipcMain.handle(IPC.listAgents, async () => {
    const snapshot = await jsonStore.snapshot()
    return listAgents(snapshot.projectRoot)
  })

  ipcMain.handle(IPC.readAgentContent, async (_event, agentId: string) => {
    const snapshot = await jsonStore.snapshot()
    return readAgentContent(snapshot.projectRoot, agentId)
  })

  ipcMain.handle(IPC.writeAgentContent, async (_event, agentId: string, content: string) => {
    const snapshot = await jsonStore.snapshot()
    return writeAgentContent(snapshot.projectRoot, agentId, content)
  })

  ipcMain.handle(IPC.createAgent, async (_event, agentId: string, content?: string) => {
    const snapshot = await jsonStore.snapshot()
    return createAgent(snapshot.projectRoot, agentId, content)
  })

  ipcMain.handle(IPC.deleteAgent, async (_event, agentId: string) => {
    const snapshot = await jsonStore.snapshot()
    return deleteAgent(snapshot.projectRoot, agentId)
  })

  ipcMain.handle(IPC.listSubAgentSessions, async () => {
    const snapshot = await jsonStore.snapshot()
    return listSubAgentSessions(snapshot.projectRoot)
  })

  ipcMain.handle(IPC.writeSubAgentSession, async (_event, session: SubAgentSession) => {
    const snapshot = await jsonStore.snapshot()
    return writeSubAgentSession(snapshot.projectRoot, session)
  })

  ipcMain.handle(IPC.deleteSubAgentSession, async (_event, sessionId: string) => {
    const snapshot = await jsonStore.snapshot()
    return deleteSubAgentSession(snapshot.projectRoot, sessionId)
  })

  ipcMain.handle(IPC.setProjectRoot, async (_event, projectRoot: string) => {
    await jsonStore.setProjectRoot(projectRoot)
    void refreshBackupScheduler()
    return jsonStore.snapshot()
  })

  ipcMain.handle(IPC.listDirectory, async (_event, relativePath = '') => {
    const snapshot = await jsonStore.snapshot()
    return listDirectory(snapshot.projectRoot, relativePath)
  })

  ipcMain.handle(IPC.readFile, async (_event, relativePath: string) => {
    const snapshot = await jsonStore.snapshot()
    if (!snapshot.projectRoot) return ''
    return readProjectFile(snapshot.projectRoot, relativePath)
  })

  ipcMain.handle(IPC.writeFile, async (_event, relativePath: string, content: string) => {
    const snapshot = await jsonStore.snapshot()
    return writeProjectFile(snapshot.projectRoot, relativePath, content)
  })

  ipcMain.handle(
    IPC.createEntry,
    async (_event, relativePath: string, type: 'file' | 'directory', content?: string) => {
      const snapshot = await jsonStore.snapshot()
      return createProjectEntry(snapshot.projectRoot, relativePath, type, content)
    }
  )

  ipcMain.handle(IPC.renameEntry, async (_event, relativePath: string, nextName: string) => {
    const snapshot = await jsonStore.snapshot()
    return renameProjectEntry(snapshot.projectRoot, relativePath, nextName)
  })

  ipcMain.handle(IPC.deleteEntry, async (_event, relativePath: string) => {
    const snapshot = await jsonStore.snapshot()
    return deleteProjectEntry(snapshot.projectRoot, relativePath)
  })

  ipcMain.handle(IPC.moveEntry, async (_event, relativePath: string, targetRelativePath: string) => {
    const snapshot = await jsonStore.snapshot()
    return moveProjectEntry(snapshot.projectRoot, relativePath, targetRelativePath)
  })

  ipcMain.handle(IPC.searchInFiles, async (_event, query: string, limit?: number) => {
    const snapshot = await jsonStore.snapshot()
    return searchInFiles(snapshot.projectRoot, query, limit)
  })

  ipcMain.handle(IPC.searchFiles, async (_event, query: string, limit?: number) => {
    const snapshot = await jsonStore.snapshot()
    return searchProjectFiles(snapshot.projectRoot, query, limit)
  })

  ipcMain.handle(IPC.openTextFile, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'Text documents', extensions: ['txt', 'md', 'markdown', 'html', 'htm'] }
      ]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return undefined
    const filePath = result.filePaths[0]
    const extension = path.extname(filePath).toLowerCase()
    if (!TEXT_IMPORT_EXTENSIONS.has(extension)) {
      throw new Error('Only TXT, Markdown, and HTML files can be imported as full-book text.')
    }
    const meta = await statExternalFile(filePath)
    if (!meta.isFile()) throw new Error('Selected import path is not a file.')
    if (meta.size > MAX_TEXT_IMPORT_BYTES) {
      throw new Error('Import file is too large. Please choose a text file under 20 MB.')
    }
    return {
      path: filePath,
      name: path.basename(filePath),
      content: await readExternalFile(filePath, 'utf8')
    }
  })

  ipcMain.handle(IPC.saveTextFile, async (event, defaultName: string, content: string) => {
    const snapshot = await jsonStore.snapshot()
    const window = BrowserWindow.fromWebContents(event.sender)
    const safeDefaultName = defaultName.trim() || 'wangyang-export.md'
    const defaultPath = snapshot.projectRoot
      ? path.join(snapshot.projectRoot, '.wangyang', 'exports', safeDefaultName)
      : safeDefaultName
    const result = window
      ? await dialog.showSaveDialog(window, {
          defaultPath,
          filters: [
            { name: 'Markdown', extensions: ['md', 'markdown'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'HTML', extensions: ['html', 'htm'] },
            { name: 'All files', extensions: ['*'] }
          ]
        })
      : await dialog.showSaveDialog({
          defaultPath,
          filters: [
            { name: 'Markdown', extensions: ['md', 'markdown'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'HTML', extensions: ['html', 'htm'] },
            { name: 'All files', extensions: ['*'] }
          ]
        })
    if (result.canceled || !result.filePath) return undefined
    await mkdir(path.dirname(result.filePath), { recursive: true })
    await writeExternalFile(result.filePath, content, 'utf8')
    return { path: result.filePath }
  })

  ipcMain.handle(IPC.saveBinaryFile, async (event, defaultName: string, base64: string) => {
    const extension = path.extname(defaultName).toLowerCase()
    const filters =
      extension === '.docx'
        ? [{ name: 'Word document', extensions: ['docx'] }]
        : extension === '.pdf'
          ? [{ name: 'PDF', extensions: ['pdf'] }]
          : extension === '.epub'
            ? [{ name: 'EPUB', extensions: ['epub'] }]
          : [{ name: 'Binary file', extensions: [extension.replace(/^\./, '') || '*'] }]
    const filePath = await chooseSavePath(event, defaultName, filters)
    if (!filePath) return undefined
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeExternalFile(filePath, Buffer.from(base64, 'base64'))
    return { path: filePath }
  })

  ipcMain.handle(IPC.savePdfFromHtml, async (event, defaultName: string, html: string) => {
    const filePath = await chooseSavePath(event, defaultName, [{ name: 'PDF', extensions: ['pdf'] }])
    if (!filePath) return undefined

    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true
      }
    })

    try {
      await pdfWindow.loadURL('about:blank')
      await pdfWindow.webContents.executeJavaScript(
        `document.open(); document.write(${JSON.stringify(html)}); document.close();`
      )
      const buffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4'
      })
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeExternalFile(filePath, buffer)
      return { path: filePath }
    } finally {
      if (!pdfWindow.isDestroyed()) {
        pdfWindow.destroy()
      }
    }
  })

  ipcMain.handle(IPC.selectDirectory, async (event, defaultPath?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      defaultPath: defaultPath?.trim() || undefined,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths[0] ? undefined : { path: result.filePaths[0] }
  })

  ipcMain.handle(IPC.showItemInFolder, (_event, filePath: string) => {
    if (filePath.trim()) shell.showItemInFolder(filePath)
  })

  ipcMain.handle(IPC.openProjectPathExternal, async (_event, relativePath: string) => {
    const snapshot = await jsonStore.snapshot()
    const fullPath = resolveInsideProject(snapshot.projectRoot, relativePath)
    const error = await shell.openPath(fullPath)
    return { path: fullPath, error: error || undefined }
  })

  ipcMain.handle(IPC.showProjectPathInFolder, async (_event, relativePath: string) => {
    const snapshot = await jsonStore.snapshot()
    shell.showItemInFolder(resolveInsideProject(snapshot.projectRoot, relativePath))
  })

  ipcMain.handle(IPC.openProjectFolder, async () => {
    const snapshot = await jsonStore.snapshot()
    if (!snapshot.projectRoot.trim()) throw new Error('Project root is not configured.')
    const fullPath = path.resolve(snapshot.projectRoot)
    const error = await shell.openPath(fullPath)
    return { path: fullPath, error: error || undefined }
  })

  ipcMain.handle(IPC.readProjectFileDataUrl, async (_event, relativePath: string) => {
    const snapshot = await jsonStore.snapshot()
    const fullPath = resolveInsideProject(snapshot.projectRoot, relativePath)
    const extension = path.extname(fullPath).toLowerCase()
    const mime = IMAGE_PREVIEW_MIME[extension]
    if (!mime) throw new Error('Only PNG, JPG, WebP, GIF, and SVG files can be previewed.')
    const meta = await statExternalFile(fullPath)
    if (!meta.isFile()) throw new Error('Preview target is not a file.')
    if (meta.size > MAX_IMAGE_PREVIEW_BYTES) throw new Error('Image is too large to preview.')
    const buffer = await readExternalFile(fullPath)
    return {
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      mime,
      size: meta.size
    }
  })

  ipcMain.handle(IPC.buildSmartContext, async (_event, maxFiles?: unknown) => {
    const snapshot = await jsonStore.snapshot()
    return buildSmartContextDraft(snapshot.projectRoot, maxFiles)
  })

  ipcMain.handle(IPC.generateSmartContext, async (_event, maxFiles?: unknown) => {
    const snapshot = await jsonStore.snapshot()
    return generateSmartContext(snapshot.projectRoot, snapshot.aiConfig, maxFiles)
  })

  ipcMain.handle(IPC.generateImage, async (_event, prompt: string, size?: string) => {
    const snapshot = await jsonStore.snapshot()
    return generateProjectImage(snapshot.projectRoot, snapshot.aiConfig, prompt, size)
  })

  ipcMain.handle(IPC.editImage, async (_event, sourcePath: string, prompt: string, size?: string) => {
    const snapshot = await jsonStore.snapshot()
    return editProjectImage(snapshot.projectRoot, snapshot.aiConfig, sourcePath, prompt, size)
  })

  ipcMain.handle(IPC.createBackup, async () => {
    const snapshot = await jsonStore.snapshot()
    return createProjectBackup(snapshot.projectRoot, snapshot.localSettings)
  })

  ipcMain.handle(IPC.listBackups, async () => {
    const snapshot = await jsonStore.snapshot()
    return listProjectBackups(snapshot.projectRoot, snapshot.localSettings)
  })

  ipcMain.handle(IPC.getAiConfig, () => jsonStore.snapshot().then((snapshot) => snapshot.aiConfig))

  ipcMain.handle(IPC.saveAiConfig, async (_event, config: AiConfig) => {
    return jsonStore.setAiConfig(config)
  })

  ipcMain.handle(IPC.listRemoteModels, async (_event, provider: ModelInterfaceConfig) => {
    return listRemoteProviderModels(provider)
  })

  ipcMain.handle(IPC.getMcpConfig, () => jsonStore.snapshot().then((snapshot) => snapshot.mcpConfig))

  ipcMain.handle(IPC.saveMcpConfig, async (_event, config: McpConfig) => {
    await jsonStore.setMcpConfig(config)
    await closeAllMcpClients()
    return config
  })

  ipcMain.handle(IPC.getLocalSettings, () =>
    jsonStore.snapshot().then((snapshot) => snapshot.localSettings)
  )

  ipcMain.handle(IPC.saveLocalSettings, async (_event, settings: LocalSettings) => {
    await jsonStore.setLocalSettings(settings)
    void refreshBackupScheduler()
    return settings
  })

  ipcMain.handle(IPC.listMcpTools, async () => {
    const snapshot = await jsonStore.snapshot()
    return listMcpTools(snapshot.mcpConfig)
  })

  ipcMain.handle(
    IPC.callMcpTool,
    async (_event, serverName: string, toolName: string, args: Record<string, unknown>) => {
      const snapshot = await jsonStore.snapshot()
      return callMcpTool(snapshot.mcpConfig, serverName, toolName, args)
    }
  )

  ipcMain.handle(IPC.closeMcpClients, () => closeAllMcpClients())
  ipcMain.handle(IPC.fetchUrlContent, (_event, url: string, timeoutMs?: number) =>
    fetchUrlContent(url, timeoutMs)
  )
  ipcMain.handle(IPC.runCommand, async (_event, command: string, cwd?: string) => {
    const snapshot = await jsonStore.snapshot()
    return runCommand(command, resolveCommandCwd(snapshot.projectRoot, cwd), snapshot.mcpConfig.commandEnv ?? {})
  })
}
