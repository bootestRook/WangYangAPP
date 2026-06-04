import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { refreshBackupScheduler, stopBackupScheduler } from './backup/backupScheduler'
import { registerIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null

function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../../resources/icon.ico')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 2048,
    height: 1152,
    minWidth: 1100,
    minHeight: 720,
    title: '王阳',
    icon: appIconPath(),
    backgroundColor: '#f6f7f9',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.maximize()
}

app.whenReady().then(() => {
  registerIpcHandlers()
  void refreshBackupScheduler()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopBackupScheduler()
  if (process.platform !== 'darwin') app.quit()
})
