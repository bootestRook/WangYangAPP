import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { App as AntdApp, ConfigProvider, Modal, message, theme } from 'antd'
import { Cloud, Maximize2, MessageSquare, Minus, Settings, X } from 'lucide-react'
import { AgentWorkbench } from './components/AgentWorkbench'
import { ProjectExplorer } from './components/ProjectExplorer'
import { SettingsModal } from './components/SettingsModal'
import { WritingCanvas } from './components/WritingCanvas'
import { useAppStore } from './stores/useAppStore'

type WorkspaceLayout = {
  projectWidth: number
  agentWidth: number
}

type ResizeTarget = keyof WorkspaceLayout

const WORKSPACE_LAYOUT_KEY = 'wangyang.workspace.layout.v3'
const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  projectWidth: 333,
  agentWidth: 399
}

const WORKSPACE_LIMITS = {
  projectMin: 190,
  projectMax: 560,
  agentMin: 320,
  agentMax: 660,
  centerMin: 520,
  handleWidth: 6,
  keyboardStep: 24
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function getInitialWorkspaceLayout(): WorkspaceLayout {
  if (typeof window === 'undefined') {
    return DEFAULT_WORKSPACE_LAYOUT
  }

  try {
    const stored = window.localStorage.getItem(WORKSPACE_LAYOUT_KEY)
    if (!stored) {
      return DEFAULT_WORKSPACE_LAYOUT
    }

    const parsed = JSON.parse(stored) as Partial<WorkspaceLayout>
    return {
      projectWidth:
        typeof parsed.projectWidth === 'number'
          ? parsed.projectWidth
          : DEFAULT_WORKSPACE_LAYOUT.projectWidth,
      agentWidth:
        typeof parsed.agentWidth === 'number' ? parsed.agentWidth : DEFAULT_WORKSPACE_LAYOUT.agentWidth
    }
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT
  }
}

function constrainWorkspaceLayout(layout: WorkspaceLayout, containerWidth: number): WorkspaceLayout {
  const maxSideWidth = Math.max(
    WORKSPACE_LIMITS.projectMin + WORKSPACE_LIMITS.agentMin,
    containerWidth - WORKSPACE_LIMITS.centerMin - WORKSPACE_LIMITS.handleWidth * 2
  )
  const safeProjectMax = Math.min(WORKSPACE_LIMITS.projectMax, maxSideWidth - WORKSPACE_LIMITS.agentMin)
  const projectWidth = clamp(
    layout.projectWidth,
    WORKSPACE_LIMITS.projectMin,
    Math.max(WORKSPACE_LIMITS.projectMin, safeProjectMax)
  )
  const safeAgentMax = Math.min(
    WORKSPACE_LIMITS.agentMax,
    maxSideWidth - projectWidth
  )
  const agentWidth = clamp(
    layout.agentWidth,
    WORKSPACE_LIMITS.agentMin,
    Math.max(WORKSPACE_LIMITS.agentMin, safeAgentMax)
  )

  return {
    projectWidth,
    agentWidth
  }
}

export function App() {
  const initialized = useAppStore((state) => state.initialized)
  const initialize = useAppStore((state) => state.initialize)
  const error = useAppStore((state) => state.error)
  const activeFilePath = useAppStore((state) => state.activeFilePath)
  const editorDirty = useAppStore((state) => state.editorDirty)
  const localSettings = useAppStore((state) => state.localSettings)
  const saveActiveFile = useAppStore((state) => state.saveActiveFile)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [agentCollapsed, setAgentCollapsed] = useState(false)
  const [projectCollapsed, setProjectCollapsed] = useState(false)
  const [backupCreating, setBackupCreating] = useState(false)
  const [appUnlocked, setAppUnlocked] = useState(true)
  const [appLockInput, setAppLockInput] = useState('')
  const workspaceRef = useRef<HTMLElement | null>(null)
  const [workspaceLayout, setWorkspaceLayout] = useState(getInitialWorkspaceLayout)
  const [resizeTarget, setResizeTarget] = useState<ResizeTarget | null>(null)
  const appLockCredential = localSettings?.system.appLockPinHash || localSettings?.system.appLockPin || ''

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(workspaceLayout))
  }, [workspaceLayout])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return
      }

      setWorkspaceLayout((current) =>
        constrainWorkspaceLayout(current, entry.contentRect.width)
      )
    })

    observer.observe(workspace)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (resizeTarget) {
      document.body.classList.add('workspace-resizing')
      return () => document.body.classList.remove('workspace-resizing')
    }

    document.body.classList.remove('workspace-resizing')
    return undefined
  }, [resizeTarget])

  useEffect(() => {
    document.documentElement.dataset.theme = localSettings?.system.theme ?? 'dark'
    document.documentElement.lang = localSettings?.system.language ?? 'zh'
  }, [localSettings?.system.language, localSettings?.system.theme])

  useEffect(() => {
    const shouldLock = Boolean(localSettings?.system.appLock && appLockCredential)
    setAppUnlocked(!shouldLock)
    setAppLockInput('')
  }, [appLockCredential, localSettings?.system.appLock])

  const updateWorkspaceLayout = useCallback((nextLayout: WorkspaceLayout) => {
    const containerWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth
    setWorkspaceLayout(constrainWorkspaceLayout(nextLayout, containerWidth))
  }, [])

  const handleResizePointerDown = useCallback(
    (target: ResizeTarget) => (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()

      const originX = event.clientX
      const originLayout = workspaceLayout

      setResizeTarget(target)

      const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
        const delta = moveEvent.clientX - originX
        const nextLayout =
          target === 'projectWidth'
            ? { ...originLayout, projectWidth: originLayout.projectWidth + delta }
            : { ...originLayout, agentWidth: originLayout.agentWidth - delta }

        updateWorkspaceLayout(nextLayout)
      }

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        setResizeTarget(null)
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp, { once: true })
    },
    [updateWorkspaceLayout, workspaceLayout]
  )

  const handleResizeKeyDown = useCallback(
    (target: ResizeTarget) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if ((!event.ctrlKey && !event.metaKey) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        return
      }

      event.preventDefault()

      const direction = event.key === 'ArrowRight' ? 1 : -1
      const amount = WORKSPACE_LIMITS.keyboardStep * direction
      const nextLayout =
        target === 'projectWidth'
          ? { ...workspaceLayout, projectWidth: workspaceLayout.projectWidth + amount }
          : { ...workspaceLayout, agentWidth: workspaceLayout.agentWidth - amount }

      updateWorkspaceLayout(nextLayout)
    },
    [updateWorkspaceLayout, workspaceLayout]
  )

  const toggleProjectPane = useCallback(() => {
    setProjectCollapsed((collapsed) => !collapsed)
  }, [])

  const createTitlebarBackup = useCallback(async () => {
    if (backupCreating) return
    setBackupCreating(true)
    try {
      const backup = await window.electronAPI.createBackup()
      message.success(`本地快照已创建：${backup.id}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建本地快照失败')
    } finally {
      setBackupCreating(false)
    }
  }, [backupCreating])

  const requestWindowClose = useCallback(() => {
    if (!editorDirty) {
      void window.electronAPI.closeWindow()
      return
    }

    Modal.confirm({
      title: '当前文件有未保存修改',
      content: activeFilePath
        ? `是否先保存「${activeFilePath}」后关闭窗口？`
        : '是否先保存当前内容后关闭窗口？',
      okText: '保存并关闭',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        const saved = await saveActiveFile()
        if (!saved) {
          message.error('保存失败，窗口未关闭')
          throw new Error('save failed')
        }
        await window.electronAPI.closeWindow()
      }
    })
  }, [activeFilePath, editorDirty, saveActiveFile])

  const tryUnlockApp = useCallback(async () => {
    const input = appLockInput.trim()
    if (!input) return

    const pinHash = localSettings?.system.appLockPinHash
    const legacyPin = localSettings?.system.appLockPin
    const matched = pinHash ? (await sha256Hex(input)) === pinHash : input === legacyPin
    if (matched) {
      setAppUnlocked(true)
      setAppLockInput('')
    } else {
      message.error('PIN 不正确')
    }
  }, [appLockInput, localSettings?.system.appLockPin, localSettings?.system.appLockPinHash])

  if (!initialized) {
    return <div className="loading">Loading workspace...</div>
  }

  const workspaceStyle = {
    '--project-pane-width': `${projectCollapsed ? 51 : workspaceLayout.projectWidth}px`,
    '--agent-pane-width': `${agentCollapsed ? 42 : workspaceLayout.agentWidth}px`
  } as CSSProperties
  const resizeTooltip = '拖拽调整宽度（Ctrl/Cmd + 左右箭头快速调整）'
  const isLightTheme = localSettings?.system.theme === 'light'
  const appLocked = Boolean(localSettings?.system.appLock && appLockCredential && !appUnlocked)
  const antdThemeToken = isLightTheme
    ? {
        colorTextBase: '#1F2937',
        colorText: '#1F2937',
        colorTextSecondary: '#4B5563',
        colorTextTertiary: '#6B7280',
        colorTextQuaternary: '#9CA3AF',
        colorTextPlaceholder: '#6B7280',
        colorTextDisabled: '#9CA3AF',
        colorBgBase: '#F6F8FC',
        colorBgLayout: '#F6F8FC',
        colorBgContainer: '#FFFFFF',
        colorBgElevated: '#FFFFFF',
        colorBgContainerDisabled: '#EEF2F7',
        colorFill: 'rgba(31, 41, 55, 0.08)',
        colorFillSecondary: 'rgba(31, 41, 55, 0.06)',
        colorFillTertiary: 'rgba(31, 41, 55, 0.04)',
        colorFillQuaternary: 'rgba(31, 41, 55, 0.03)',
        colorBorder: '#D6DEE9',
        colorBorderSecondary: '#E5EAF2',
        controlItemBgHover: 'rgba(31, 41, 55, 0.06)',
        controlItemBgActive: 'rgba(91, 141, 239, 0.14)',
        boxShadow: '0 16px 40px rgba(31, 41, 55, 0.12)',
        boxShadowSecondary: '0 8px 24px rgba(31, 41, 55, 0.08)'
      }
    : {
        colorTextBase: '#E7ECF3',
        colorText: '#E7ECF3',
        colorTextSecondary: '#AAB4C3',
        colorTextTertiary: '#7F8A9B',
        colorTextQuaternary: '#5F6B7A',
        colorTextPlaceholder: '#7F8A9B',
        colorTextDisabled: '#5F6B7A',
        colorBgBase: '#0E1117',
        colorBgLayout: '#0E1117',
        colorBgContainer: '#161C27',
        colorBgElevated: '#1A2130',
        colorBgContainerDisabled: '#131823',
        colorFill: 'rgba(255, 255, 255, 0.06)',
        colorFillSecondary: 'rgba(255, 255, 255, 0.04)',
        colorFillTertiary: 'rgba(255, 255, 255, 0.03)',
        colorFillQuaternary: 'rgba(255, 255, 255, 0.02)',
        colorBorder: '#273142',
        colorBorderSecondary: '#202938',
        controlItemBgHover: 'rgba(255, 255, 255, 0.04)',
        controlItemBgActive: 'rgba(91, 141, 239, 0.16)',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.32)',
        boxShadowSecondary: '0 8px 24px rgba(0, 0, 0, 0.24)'
      }

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#5B8DEF',
          colorPrimaryHover: '#77A2F4',
          colorPrimaryActive: '#3F73D8',
          colorSuccess: '#5FBF9F',
          colorWarning: '#D9A35F',
          colorError: '#D96B6B',
          colorInfo: '#63C7D8',
          ...antdThemeToken,
          colorTextLightSolid: '#F8FAFC',
          controlOutline: 'rgba(91, 141, 239, 0.32)',
          borderRadius: 6,
          fontFamily:
            '"Microsoft YaHei UI", "Microsoft YaHei", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        },
        components: {
          Button: {
            defaultBg: isLightTheme ? '#FFFFFF' : '#161C27',
            defaultBorderColor: isLightTheme ? '#D6DEE9' : '#273142',
            defaultColor: isLightTheme ? '#1F2937' : '#E7ECF3',
            primaryShadow: 'none',
            dangerShadow: 'none'
          },
          Input: {
            activeBorderColor: '#5B8DEF',
            activeShadow: '0 0 0 2px rgba(91, 141, 239, 0.22)',
            hoverBorderColor: '#3A465A'
          },
          Select: {
            optionActiveBg: isLightTheme ? 'rgba(31, 41, 55, 0.06)' : 'rgba(255, 255, 255, 0.04)',
            optionSelectedBg: 'rgba(91, 141, 239, 0.16)',
            optionSelectedColor: isLightTheme ? '#1F2937' : '#E7ECF3',
            selectorBg: isLightTheme ? '#FFFFFF' : '#161C27'
          },
          Modal: {
            contentBg: isLightTheme ? '#FFFFFF' : '#1A2130',
            headerBg: isLightTheme ? '#FFFFFF' : '#1A2130',
            titleColor: isLightTheme ? '#1F2937' : '#E7ECF3'
          },
          Tabs: {
            inkBarColor: '#5B8DEF',
            itemActiveColor: isLightTheme ? '#1F2937' : '#E7ECF3',
            itemHoverColor: isLightTheme ? '#1F2937' : '#E7ECF3',
            itemSelectedColor: '#5B8DEF',
            itemColor: isLightTheme ? '#4B5563' : '#AAB4C3'
          }
        }
      }}
    >
      <AntdApp>
        <main className={isLightTheme ? 'app-shell theme-light' : 'app-shell theme-dark'}>
          <header className="titlebar">
        <div className="titlebar-left" />
        <div className="window-title">王阳 - 感受创作的乐趣</div>
        <div className="window-actions">
          <span className="status-dot" />
          <button aria-label="打开配置" className="app-action" title="设置" onClick={() => setSettingsOpen(true)}>
            <Settings size={15} />
          </button>
          <button
            aria-label="创建本地快照"
            className="app-action"
            disabled={backupCreating}
            title="本地快照"
            onClick={() => void createTitlebarBackup()}
          >
            <Cloud size={15} />
          </button>
          <button
            aria-label="最小化窗口"
            className="window-control"
            title="最小化"
            onClick={() => void window.electronAPI.minimizeWindow()}
          >
            <Minus size={17} />
          </button>
          <button
            aria-label="最大化或还原窗口"
            className="window-control"
            title="最大化"
            onClick={() => void window.electronAPI.toggleMaximizeWindow()}
          >
            <Maximize2 size={16} />
          </button>
          <button aria-label="关闭窗口" className="window-control close" title="关闭" onClick={requestWindowClose}>
            <X size={17} />
          </button>
        </div>
        {error ? <div className="error-strip">{error}</div> : null}
          </header>

          <section
            ref={workspaceRef}
            className={`workspace-grid${resizeTarget ? ' resizing' : ''}${projectCollapsed ? ' project-collapsed' : ''}${agentCollapsed ? ' agent-collapsed' : ''}`}
            style={workspaceStyle}
          >
            <aside className="project-pane pane">
              <ProjectExplorer isSidebarCollapsed={projectCollapsed} onToggleSidebar={toggleProjectPane} />
            </aside>

            <button
              aria-label={resizeTooltip}
              className="pane-resizer project-resizer"
              disabled={projectCollapsed}
              onKeyDown={projectCollapsed ? undefined : handleResizeKeyDown('projectWidth')}
              onPointerDown={projectCollapsed ? undefined : handleResizePointerDown('projectWidth')}
              title={resizeTooltip}
              type="button"
            />

            <section className="canvas-pane pane">
              <WritingCanvas />
            </section>

            <button
              aria-label={resizeTooltip}
              className="pane-resizer agent-resizer"
              disabled={agentCollapsed}
              onKeyDown={agentCollapsed ? undefined : handleResizeKeyDown('agentWidth')}
              onPointerDown={agentCollapsed ? undefined : handleResizePointerDown('agentWidth')}
              title={resizeTooltip}
              type="button"
            />

            <aside className={agentCollapsed ? 'agent-pane pane collapsed' : 'agent-pane pane'}>
              {agentCollapsed ? (
                <button className="agent-reopen" onClick={() => setAgentCollapsed(false)}>
                  <MessageSquare size={18} />
                  <span>智能体</span>
                </button>
              ) : (
                <AgentWorkbench onCollapse={() => setAgentCollapsed(true)} />
              )}
            </aside>
          </section>
          {appLocked ? (
            <div className="app-lock-overlay">
              <div className="app-lock-card">
                <Settings size={24} />
                <strong>应用已锁定</strong>
                <input
                  type="password"
                  value={appLockInput}
                  onChange={(event) => setAppLockInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void tryUnlockApp()
                  }}
                  placeholder="输入本地 PIN"
                />
                <button onClick={() => void tryUnlockApp()}>
                  解锁
                </button>
              </div>
            </div>
          ) : null}
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </main>
      </AntdApp>
    </ConfigProvider>
  )
}
