import { App as AntApp } from 'antd'
import {
  Bold,
  BookOpen,
  Bot,
  Code2,
  Edit3,
  Eye,
  Heading1,
  Heading2,
  Italic,
  Lightbulb,
  List,
  ListOrdered,
  MonitorUp,
  Quote,
  Redo2,
  RefreshCw,
  Replace,
  Save,
  Search,
  Undo2,
  Users,
  Wand2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { displayModelId } from '../../core/models/modelDisplay'
import { useAppStore } from '../stores/useAppStore'

const projectIconUrl = new URL('../../../resources/icon-preview.png', import.meta.url).href
const RECENT_EDITOR_FILES_KEY = 'wangyang.editor.recent-files'
const ADVANCED_EDITOR_VIEW_KEY = 'wangyang.editor.advanced-view'
const EDITOR_LINE_NUMBERS_KEY = 'wangyang.editor.line-numbers'
const EDITOR_WIDTH_MODE_KEY = 'wangyang.editor.width-mode'
const MAX_RECENT_EDITOR_FILES = 12

const cards = [
  {
    icon: Bot,
    title: '智能体助手',
    body: '适合一开始用来智能开篇或者创作过程中辅助创作。通过对话的方式获得创作灵感和建议。',
    action: '智能开篇'
  },
  {
    icon: Edit3,
    title: '辅助创作助手',
    body: '日常写文就靠它了！在任意文件中使用快捷键，可以快速获得润色、扩写、改写等功能。',
    kbd: 'Ctrl + K'
  },
  {
    icon: Users,
    title: '角色与设定',
    body: '前期可以定义角色和设定来辅助创作，后期可以新建智能上下文自动提取小说内容。'
  }
]

type AdvancedEditorView = 'source' | 'preview' | 'dual' | 'diff' | 'csv'
type EditorWidthMode = 'normal' | 'wide'
type EditorAiScenario = 'writing' | 'modification' | 'summary' | 'agentPolisher'

function fileName(path: string): string {
  return path.split('/').pop() || path
}

function readRecentEditorFiles(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_EDITOR_FILES_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeRecentEditorFiles(files: string[]): void {
  window.localStorage.setItem(RECENT_EDITOR_FILES_KEY, JSON.stringify(files.slice(0, MAX_RECENT_EDITOR_FILES)))
}

function readAdvancedEditorView(fallback: AdvancedEditorView): AdvancedEditorView {
  const stored = window.localStorage.getItem(ADVANCED_EDITOR_VIEW_KEY)
  return stored === 'source' || stored === 'preview' || stored === 'dual' || stored === 'diff' || stored === 'csv'
    ? stored
    : fallback
}

function readBooleanSetting(key: string, fallback: boolean): boolean {
  const stored = window.localStorage.getItem(key)
  if (stored === 'true') return true
  if (stored === 'false') return false
  return fallback
}

function readWidthMode(): EditorWidthMode {
  return window.localStorage.getItem(EDITOR_WIDTH_MODE_KEY) === 'wide' ? 'wide' : 'normal'
}

function countText(text: string): { chars: number; words: number; lines: number } {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return {
    chars: text.replace(/\s/g, '').length,
    words,
    lines: text ? text.split(/\r?\n/).length : 0
  }
}

function promptExcerpt(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[内容过长，已截取前 ${maxChars} 字]`
}

function isSmartContextPath(path?: string): boolean {
  return Boolean(path && path.includes('records/') && fileName(path).includes('智能上下文'))
}

function renderPreview(text: string) {
  if (!text.trim()) return <p className="preview-empty">暂无内容</p>
  return text.split(/\n{2,}/).map((block, index) => {
    const trimmed = block.trim()
    if (trimmed.startsWith('### ')) return <h3 key={index}>{trimmed.slice(4)}</h3>
    if (trimmed.startsWith('## ')) return <h2 key={index}>{trimmed.slice(3)}</h2>
    if (trimmed.startsWith('# ')) return <h1 key={index}>{trimmed.slice(2)}</h1>
    if (/^[-*]\s/m.test(trimmed)) {
      return (
        <ul key={index}>
          {trimmed.split(/\r?\n/).map((line) => (
            <li key={line}>{line.replace(/^[-*]\s/, '')}</li>
          ))}
        </ul>
      )
    }
    return <p key={index}>{trimmed}</p>
  })
}

function parseCsvRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  const delimiter = lines.some((line) => line.includes('\t')) ? '\t' : ','
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()))
}

function renderCsvPreview(text: string) {
  const rows = parseCsvRows(text)
  if (!rows.length) return <p className="preview-empty">暂无 CSV 内容</p>
  const [head, ...body] = rows
  return (
    <div className="csv-preview">
      <table>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={`${cell}-${index}`}>{cell || `列 ${index + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {head.map((_, cellIndex) => (
                <td key={cellIndex}>{row[cellIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderDiffPreview(before: string, after: string) {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const max = Math.max(beforeLines.length, afterLines.length)
  const rows = Array.from({ length: max }, (_, index) => {
    const left = beforeLines[index] ?? ''
    const right = afterLines[index] ?? ''
    return { index, left, right, changed: left !== right }
  })
  if (!rows.some((row) => row.changed)) return <p className="preview-empty">暂无差异</p>
  return (
    <div className="diff-preview">
      {rows
        .filter((row) => row.changed)
        .map((row) => (
          <div className="diff-row" key={row.index}>
            <span>{row.index + 1}</span>
            <pre className="removed">{row.left || ' '}</pre>
            <pre className="added">{row.right || ' '}</pre>
          </div>
        ))}
    </div>
  )
}

export function WritingCanvas() {
  const { message, modal } = AntApp.useApp()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const lastDiskContentRef = useRef('')
  const activeFilePath = useAppStore((state) => state.activeFilePath)
  const editorContent = useAppStore((state) => state.editorContent)
  const editorDirty = useAppStore((state) => state.editorDirty)
  const editorLoading = useAppStore((state) => state.editorLoading)
  const editorViewMode = useAppStore((state) => state.editorViewMode)
  const aiConfig = useAppStore((state) => state.aiConfig)
  const localSettings = useAppStore((state) => state.localSettings)
  const isRunning = useAppStore((state) => state.isRunning)
  const setDraft = useAppStore((state) => state.setDraft)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const openProjectFile = useAppStore((state) => state.openProjectFile)
  const updateEditorContent = useAppStore((state) => state.updateEditorContent)
  const saveActiveFile = useAppStore((state) => state.saveActiveFile)
  const closeActiveFile = useAppStore((state) => state.closeActiveFile)
  const setEditorViewMode = useAppStore((state) => state.setEditorViewMode)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [externalChange, setExternalChange] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(null)
  const [advancedView, setAdvancedView] = useState<AdvancedEditorView>(() => readAdvancedEditorView(editorViewMode))
  const [showLineNumbers, setShowLineNumbers] = useState(() => readBooleanSetting(EDITOR_LINE_NUMBERS_KEY, false))
  const [lineScrollTop, setLineScrollTop] = useState(0)
  const [widthMode, setWidthMode] = useState<EditorWidthMode>(() => readWidthMode())
  const [recentFiles, setRecentFiles] = useState<string[]>(() => readRecentEditorFiles())
  const stats = useMemo(() => countText(editorContent), [editorContent])
  const lineNumbers = useMemo(() => editorContent.split(/\r?\n/).map((_, index) => index + 1), [editorContent])
  const autosave = localSettings?.editor.autosave ?? true
  const readOnlySmartContext = isSmartContextPath(activeFilePath)

  useEffect(() => {
    if (!activeFilePath || readOnlySmartContext || !editorDirty || !autosave) return
    const timer = window.setTimeout(() => {
      void saveActiveFile().then((saved) => {
        if (saved) {
          lastDiskContentRef.current = editorContent
          setExternalChange(false)
        }
      })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [activeFilePath, autosave, editorContent, editorDirty, readOnlySmartContext, saveActiveFile])

  useEffect(() => {
    lastDiskContentRef.current = editorContent
    setExternalChange(false)
    setLineScrollTop(0)
    if (activeFilePath) {
      setRecentFiles((current) => {
        const next = [activeFilePath, ...current.filter((path) => path !== activeFilePath)].slice(0, MAX_RECENT_EDITOR_FILES)
        writeRecentEditorFiles(next)
        return next
      })
    }
  }, [activeFilePath])

  useEffect(() => {
    if (!activeFilePath) return
    const timer = window.setInterval(() => {
      void window.electronAPI
        .readFile(activeFilePath)
        .then((latest) => {
          if (latest !== lastDiskContentRef.current) {
            lastDiskContentRef.current = latest
            setExternalChange(true)
          }
        })
        .catch(() => undefined)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [activeFilePath])

  useEffect(() => {
    if (editorViewMode !== 'source' || !pendingSelection) return
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(pendingSelection.start, pendingSelection.end)
      setPendingSelection(null)
    })
  }, [editorViewMode, pendingSelection])

  useEffect(() => {
    setAdvancedView(readAdvancedEditorView(editorViewMode))
  }, [activeFilePath, editorViewMode])

  const startWithPrompt = (prompt: string, autoSend = false): void => {
    setDraft(prompt)
    if (autoSend) {
      setTimeout(() => {
        void sendMessage()
      }, 0)
    }
  }

  const switchEditorView = (view: AdvancedEditorView): void => {
    setAdvancedView(view)
    window.localStorage.setItem(ADVANCED_EDITOR_VIEW_KEY, view)
    setEditorViewMode(view)
  }

  const toggleLineNumbers = (): void => {
    setShowLineNumbers((value) => {
      const next = !value
      window.localStorage.setItem(EDITOR_LINE_NUMBERS_KEY, String(next))
      return next
    })
  }

  const toggleWidthMode = (): void => {
    setWidthMode((mode) => {
      const next = mode === 'normal' ? 'wide' : 'normal'
      window.localStorage.setItem(EDITOR_WIDTH_MODE_KEY, next)
      return next
    })
  }

  const save = async (): Promise<void> => {
    if (readOnlySmartContext) {
      message.info('智能上下文文件为只读')
      return
    }
    const saved = await saveActiveFile()
    if (saved) {
      lastDiskContentRef.current = editorContent
      setExternalChange(false)
      message.success('已保存')
    }
  }

  const loadLatestFromDisk = async (): Promise<void> => {
    if (!activeFilePath) return
    const loaded = await openProjectFile(activeFilePath, { force: true })
    if (loaded) {
      try {
        lastDiskContentRef.current = await window.electronAPI.readFile(activeFilePath)
      } catch {
        lastDiskContentRef.current = editorContent
      }
      setExternalChange(false)
      message.success('已重新载入')
    }
  }

  const reloadFromDisk = async (): Promise<void> => {
    if (!activeFilePath) return
    if (editorDirty) {
      modal.confirm({
        title: '重新载入',
        content: '当前文件有未保存修改。重新载入会丢弃这些修改。',
        okText: '重新载入',
        cancelText: '取消',
        onOk: () => {
          void loadLatestFromDisk()
        }
      })
      return
    }
    await loadLatestFromDisk()
  }

  useEffect(() => {
    if (!activeFilePath) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void save()
        return
      }
      if (key === 'f') {
        event.preventDefault()
        setFindOpen(true)
        return
      }
      if (event.shiftKey && key === 'l') {
        event.preventDefault()
        toggleLineNumbers()
        return
      }
      if (event.shiftKey && key === 'w') {
        event.preventDefault()
        toggleWidthMode()
        return
      }
      const viewByKey: Record<string, AdvancedEditorView> = {
        '1': 'source',
        '2': 'preview',
        '3': 'dual',
        '4': 'diff',
        '5': 'csv'
      }
      const view = viewByKey[key]
      if (view) {
        event.preventDefault()
        switchEditorView(view)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const openRecentFile = async (relativePath: string): Promise<void> => {
    if (!relativePath || relativePath === activeFilePath) return
    const doOpen = async () => {
      const opened = await openProjectFile(relativePath, { force: true })
      if (!opened) {
        setRecentFiles((current) => {
          const next = current.filter((path) => path !== relativePath)
          writeRecentEditorFiles(next)
          return next
        })
      }
    }

    if (editorDirty) {
      modal.confirm({
        title: '切换文件',
        content: '当前文件有未保存修改。切换到最近文件会丢弃这些修改。',
        okText: '切换',
        cancelText: '取消',
        onOk: () => {
          void doOpen()
        }
      })
      return
    }

    await doOpen()
  }

  const openExternalEditor = async (): Promise<void> => {
    if (!activeFilePath) return
    const result = await window.electronAPI.openProjectPathExternal(activeFilePath)
    if (result.error) message.error(result.error)
    else message.success('已用系统默认程序打开')
  }

  const applyToSelection = (before: string, after = '', placeholder = ''): void => {
    if (readOnlySmartContext) {
      message.info('智能上下文文件为只读')
      return
    }
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = textarea.value.slice(start, end)
    const inserted = `${before}${selected || placeholder}${after}`
    const next = `${textarea.value.slice(0, start)}${inserted}${textarea.value.slice(end)}`
    updateEditorContent(next)
    window.requestAnimationFrame(() => {
      textarea.focus()
      const cursorStart = start + before.length
      const cursorEnd = cursorStart + (selected || placeholder).length
      textarea.setSelectionRange(cursorStart, cursorEnd)
    })
  }

  const applyLinePrefix = (prefix: string): void => {
    if (readOnlySmartContext) {
      message.info('智能上下文文件为只读')
      return
    }
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = textarea.value
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEnd = value.indexOf('\n', end)
    const rangeEnd = lineEnd === -1 ? value.length : lineEnd
    const block = value.slice(lineStart, rangeEnd)
    const nextBlock = block
      .split(/\r?\n/)
      .map((line) => `${prefix}${line}`)
      .join('\n')
    updateEditorContent(`${value.slice(0, lineStart)}${nextBlock}${value.slice(rangeEnd)}`)
    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(lineStart, lineStart + nextBlock.length)
    })
  }

  const execNativeEdit = (command: 'undo' | 'redo'): void => {
    const textarea = textareaRef.current
    if (!textarea || readOnlySmartContext) return
    textarea.focus()
    document.execCommand(command)
    updateEditorContent(textarea.value)
  }

  const findNext = (): void => {
    const query = findQuery.trim()
    if (!query) return
    const textarea = textareaRef.current
    const value = textarea?.value ?? editorContent
    const start = textarea?.selectionEnd ?? 0
    let index = value.toLowerCase().indexOf(query.toLowerCase(), start)
    if (index === -1) index = value.toLowerCase().indexOf(query.toLowerCase(), 0)
    if (index === -1) {
      message.info('未找到')
      return
    }
    switchEditorView('source')
    if (!textarea) {
      setPendingSelection({ start: index, end: index + query.length })
      return
    }
    setPendingSelection({ start: index, end: index + query.length })
    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(index, index + query.length)
    })
  }

  const replaceCurrent = (): void => {
    if (readOnlySmartContext) {
      message.info('智能上下文文件为只读')
      return
    }
    const textarea = textareaRef.current
    const query = findQuery.trim()
    if (!query) return
    if (!textarea) {
      findNext()
      return
    }
    const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
    if (selected.toLowerCase() !== query.toLowerCase()) {
      findNext()
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    updateEditorContent(`${textarea.value.slice(0, start)}${replaceText}${textarea.value.slice(end)}`)
    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start, start + replaceText.length)
    })
  }

  const replaceAll = (): void => {
    if (readOnlySmartContext) {
      message.info('智能上下文文件为只读')
      return
    }
    const query = findQuery.trim()
    if (!query) return
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const next = editorContent.replace(new RegExp(escaped, 'gi'), replaceText)
    updateEditorContent(next)
  }

  const closeFile = (): void => {
    if (!editorDirty) {
      closeActiveFile()
      return
    }
    modal.confirm({
      title: '关闭文件',
      content: '当前文件有未保存修改，确定关闭吗？',
      okText: '关闭',
      cancelText: '继续编辑',
      onOk: closeActiveFile
    })
  }

  const askAssistant = (): void => {
    const textarea = textareaRef.current
    const selected = textarea?.value.slice(textarea.selectionStart, textarea.selectionEnd).trim()
    if (selected) {
      setDraft(`请润色并改写下面这段内容，保留原意并增强画面感：\n\n${selected}`)
      return
    }
    setDraft(`请基于当前文件 ${activeFilePath ?? ''} 给出续写、润色或结构优化建议。`)
  }

  const runEditorAiScenario = async (scenario: EditorAiScenario): Promise<void> => {
    if (!activeFilePath || !aiConfig) return
    if (isRunning) {
      message.info('智能体正在运行，请稍后再试')
      return
    }
    const textarea = textareaRef.current
    const selected = textarea?.value.slice(textarea.selectionStart, textarea.selectionEnd).trim()
    const source = selected || editorContent
    if (!source.trim()) {
      message.info('当前文件没有可处理内容')
      return
    }

    const modelId = aiConfig.scenario[scenario]
    const scope = selected ? '选中文本' : `当前文件：${activeFilePath}`
    const sourceBlock = promptExcerpt(source)
    const prompts: Record<EditorAiScenario, string> = {
      writing: `请基于${scope}继续写作，保持人物动机、叙事风格和上下文连续。输出可直接放入正文的内容，不要解释过程。\n\n${sourceBlock}`,
      modification: `请润色和改写${scope}，保留原意，增强画面感、节奏、人物表达和中文可读性。请先给出改写正文，再列出关键修改点。\n\n${sourceBlock}`,
      summary: `请总结${scope}，整理章节摘要、人物变化、关键伏笔、冲突推进和后续衔接建议。\n\n${sourceBlock}`,
      agentPolisher: `请作为终稿精修助手处理${scope}，重点检查表达重复、节奏拖沓、逻辑跳跃、语气不一致和可删除句子。输出精修稿和简短修改说明。\n\n${sourceBlock}`
    }

    setDraft(prompts[scenario])
    await sendMessage(undefined, scenario === 'writing' ? 0.7 : 0.2, {
      modelId,
      draftOverride: prompts[scenario]
    })
  }

  const renderSourceEditor = () => (
    <div className={showLineNumbers ? 'source-editor-shell with-lines' : 'source-editor-shell'}>
      {showLineNumbers ? (
        <div className="line-number-gutter" aria-hidden="true">
          <div style={{ transform: `translateY(${-lineScrollTop}px)` }}>
            {lineNumbers.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={editorContent}
        readOnly={readOnlySmartContext}
        spellCheck={localSettings?.editor.spellcheck ?? false}
        style={{
          fontFamily: localSettings?.editor.fontFamily,
          fontSize: localSettings?.editor.fontSize,
          lineHeight: localSettings?.editor.lineHeight
        }}
        onChange={(event) => {
          if (!readOnlySmartContext) updateEditorContent(event.target.value)
        }}
        onScroll={(event) => {
          if (showLineNumbers) setLineScrollTop(event.currentTarget.scrollTop)
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            event.stopPropagation()
            void save()
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault()
            event.stopPropagation()
            askAssistant()
          }
        }}
      />
    </div>
  )

  if (activeFilePath) {
    return (
      <div className="writing-canvas editor-canvas">
        <header className="editor-top">
          <div className="editor-toolbar">
            <div className="editor-file-title">
              <BookOpen size={16} />
              <div>
                <strong>{fileName(activeFilePath)}</strong>
                <span>{activeFilePath}</span>
              </div>
            </div>
            <div className="editor-actions">
              <select
                aria-label="最近文件"
                className="editor-recent-select"
                value=""
                onChange={(event) => {
                  const path = event.target.value
                  event.target.value = ''
                  void openRecentFile(path)
                }}
              >
                <option value="">最近文件</option>
                {recentFiles.map((path) => (
                  <option disabled={path === activeFilePath} key={path} value={path}>
                    {fileName(path)} - {path}
                  </option>
                ))}
              </select>
              <button title="用系统默认程序打开" onClick={() => void openExternalEditor()}>
                <MonitorUp size={15} />
              </button>
              <button title="撤销" disabled={readOnlySmartContext} onClick={() => execNativeEdit('undo')}>
                <Undo2 size={15} />
              </button>
              <button title="重做" disabled={readOnlySmartContext} onClick={() => execNativeEdit('redo')}>
                <Redo2 size={15} />
              </button>
              <button title="一级标题" disabled={readOnlySmartContext} onClick={() => applyLinePrefix('# ')}>
                <Heading1 size={15} />
              </button>
              <button title="二级标题" disabled={readOnlySmartContext} onClick={() => applyLinePrefix('## ')}>
                <Heading2 size={15} />
              </button>
              <button title="加粗" disabled={readOnlySmartContext} onClick={() => applyToSelection('**', '**', '加粗文本')}>
                <Bold size={15} />
              </button>
              <button title="斜体" disabled={readOnlySmartContext} onClick={() => applyToSelection('*', '*', '斜体文本')}>
                <Italic size={15} />
              </button>
              <button title="引用" disabled={readOnlySmartContext} onClick={() => applyLinePrefix('> ')}>
                <Quote size={15} />
              </button>
              <button title="无序列表" disabled={readOnlySmartContext} onClick={() => applyLinePrefix('- ')}>
                <List size={15} />
              </button>
              <button title="有序列表" disabled={readOnlySmartContext} onClick={() => applyLinePrefix('1. ')}>
                <ListOrdered size={15} />
              </button>
              <button className={findOpen ? 'active' : ''} title="查找替换" onClick={() => setFindOpen((value) => !value)}>
                <Search size={15} />
              </button>
              <button className={advancedView === 'source' ? 'active' : ''} onClick={() => switchEditorView('source')}>
                <Code2 size={15} />
                源码
              </button>
              <button className={advancedView === 'preview' ? 'active' : ''} onClick={() => switchEditorView('preview')}>
                <Eye size={15} />
                预览
              </button>
              <button className={advancedView === 'dual' ? 'active' : ''} onClick={() => switchEditorView('dual')}>
                <BookOpen size={15} />
                双栏
              </button>
              <button className={advancedView === 'diff' ? 'active' : ''} onClick={() => switchEditorView('diff')}>
                <Replace size={15} />
                差异
              </button>
              <button className={advancedView === 'csv' ? 'active' : ''} onClick={() => switchEditorView('csv')}>
                <List size={15} />
                CSV
              </button>
              <button className={showLineNumbers ? 'active' : ''} onClick={toggleLineNumbers}>
                <ListOrdered size={15} />
                行号
              </button>
              <button
                className={widthMode === 'wide' ? 'active' : ''}
                onClick={toggleWidthMode}
              >
                <RefreshCw size={15} />
                宽度
              </button>
              <button onClick={askAssistant}>
                <Wand2 size={15} />
                辅助
              </button>
              <button disabled={isRunning} title={aiConfig?.scenario.writing ? displayModelId(aiConfig.scenario.writing) : undefined} onClick={() => void runEditorAiScenario('writing')}>
                <Edit3 size={15} />
                续写
              </button>
              <button disabled={isRunning} title={aiConfig?.scenario.modification ? displayModelId(aiConfig.scenario.modification) : undefined} onClick={() => void runEditorAiScenario('modification')}>
                <Wand2 size={15} />
                润色
              </button>
              <button disabled={isRunning} title={aiConfig?.scenario.summary ? displayModelId(aiConfig.scenario.summary) : undefined} onClick={() => void runEditorAiScenario('summary')}>
                <BookOpen size={15} />
                摘要
              </button>
              <button disabled={isRunning} title={aiConfig?.scenario.agentPolisher ? displayModelId(aiConfig.scenario.agentPolisher) : undefined} onClick={() => void runEditorAiScenario('agentPolisher')}>
                <Lightbulb size={15} />
                精修
              </button>
              <button disabled={!editorDirty || editorLoading || readOnlySmartContext} onClick={() => void save()}>
                <Save size={15} />
                保存
              </button>
              <button onClick={closeFile}>
                <X size={15} />
              </button>
            </div>
          </div>

          {externalChange ? (
            <div className="editor-alert">
              <span>磁盘文件已有更新</span>
              <button onClick={() => void reloadFromDisk()}>
                <RefreshCw size={13} />
                重新载入
              </button>
            </div>
          ) : null}

          {readOnlySmartContext ? <div className="editor-alert">智能上下文文件为只读</div> : null}

          {findOpen ? (
            <div className="editor-findbar">
              <input
                value={findQuery}
                onChange={(event) => setFindQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') findNext()
                }}
                placeholder="查找"
              />
              <input value={replaceText} onChange={(event) => setReplaceText(event.target.value)} placeholder="替换为" />
              <button onClick={findNext}>
                <Search size={13} />
                下一个
              </button>
              <button disabled={readOnlySmartContext} onClick={replaceCurrent}>
                <Replace size={13} />
                替换
              </button>
              <button disabled={readOnlySmartContext} onClick={replaceAll}>全部替换</button>
            </div>
          ) : null}
        </header>

        <section className={widthMode === 'wide' ? 'editor-body wide' : 'editor-body'}>
          {advancedView === 'source' ? renderSourceEditor() : null}
          {advancedView === 'preview' ? <article className="editor-preview">{renderPreview(editorContent)}</article> : null}
          {advancedView === 'dual' ? (
            <div className="dual-editor">
              {renderSourceEditor()}
              <article className="editor-preview">{renderPreview(editorContent)}</article>
            </div>
          ) : null}
          {advancedView === 'diff' ? renderDiffPreview(lastDiskContentRef.current, editorContent) : null}
          {advancedView === 'csv' ? renderCsvPreview(editorContent) : null}
        </section>

        <footer className="editor-status">
          <span>{readOnlySmartContext ? '只读' : editorDirty ? '未保存' : '已保存'}</span>
          <span>{autosave ? '自动保存开启' : '自动保存关闭'}</span>
          {externalChange ? <span>磁盘有更新</span> : null}
          <span>{stats.chars} 字</span>
          <span>{stats.words} 词</span>
          <span>{stats.lines} 行</span>
        </footer>
      </div>
    )
  }

  return (
    <div className="writing-canvas">
      <div className="welcome-stack">
        <img className="brand-mark" src={projectIconUrl} alt="" aria-hidden="true" draggable={false} />
        <h1>开始你的创作之旅</h1>
        <p>选择一个文件开始创作，或使用下面的工具来辅助你的写作过程</p>

        <div className="welcome-cards">
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <button
                className="welcome-card"
                key={card.title}
                onClick={() =>
                  startWithPrompt(
                    card.title === '智能体助手'
                      ? '请帮我智能开篇，先询问小说类型、主角、世界观和创作规则。'
                      : card.title === '辅助创作助手'
                        ? '请作为辅助创作助手，帮我润色、扩写或改写当前章节。'
                        : '请帮我创建角色与设定，包括角色关系、性格、背景和关键冲突。'
                  )
                }
              >
                <Icon size={22} />
                <div>
                  <h2>{card.title}</h2>
                  <p>{card.body}</p>
                </div>
                {card.action ? (
                  <span
                    className="green-chip"
                    onClick={(event) => {
                      event.stopPropagation()
                      startWithPrompt('请帮我智能开篇，先设计小说开头和前三章方向。', true)
                    }}
                  >
                    {card.action}
                  </span>
                ) : null}
                {card.kbd ? (
                  <div className="shortcut-chip">
                    <span>快捷键</span>
                    <kbd>{card.kbd}</kbd>
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="guide-tip">
          <Lightbulb size={14} />
          <span>
            提示：访问 <b>王阳创作指南</b> 获取更多创作建议
          </span>
        </div>
      </div>
      <BookOpen className="canvas-watermark" size={200} />
    </div>
  )
}
