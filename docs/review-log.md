# Review Log

## Pending

- Feature: Local free mode + settings modal
- Reviewer: `019e87d4-83da-7402-84d2-72f43b7c7713`
- Status: first review failed; fixes applied; awaiting re-review

## Review 1

- Verdict: FAIL
- Required fixes:
  - Replace placeholder settings tabs with real interactive persisted configuration.
  - Validate and normalize MCP config before saving.

## Fixes Applied

- Added persisted `LocalSettings`.
- Added IPC for `getLocalSettings` and `saveLocalSettings`.
- Replaced prompts/editor/backup/system placeholder tabs with real forms.
- Added MCP config structure validation and normalization before save.
- `npm run build` passed after fixes.

## Review 1 Recheck

- Verdict: PASS

## Review 2

- Feature: Project file tree operations
- Verdict: FAIL
- Required fixes:
  - Render real entries for every file group, not only chapters.
  - Refresh the corresponding group after create, rename, or delete.
  - Reject empty/root paths in mutating IPC operations.
  - Reject path separators and `..` in create names.

## Fixes Applied

- Reworked `ProjectExplorer` to load each original-style group from its own directory.
- Added create, rename, delete, subfolder navigation, and back navigation for every group.
- Added UI validation for empty names, separators, and `..`.
- Added main-process guards for empty/root, absolute, and `..` paths.
- `npm run build` passed after fixes.

## Review 2 Recheck

- Verdict: PASS

## Review 3

- Feature: Search panel
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Content search, file-name search, and full-text ask handoff are wired end to end.
  - No login or membership gate was introduced.

## Review 4

- Feature: Agent chat panel parity
- Verdict: FAIL
- Required fixes:
  - Guard session switching/new/delete while the agent is running.
  - Bind a running request to the session id captured at send time.
  - Make abort stop tool-stage updates as well as LLM streaming.

## Fixes Applied

- Added run locks for session and mode mutations.
- Bound `sendMessage` to the run session id and abort controller identity.
- Added abort checks around tool execution in the agent loop.
- Disabled session and mode controls while running.
- `npm run build` passed after fixes.

## Review 4 Recheck

- Verdict: PASS

## Review 5

- Feature: Writing/editor surface
- Verdict: FAIL
- Required fixes:
  - Confirm before opening another file when the current editor has unsaved changes.
  - Keep `editorDirty` true if content changes while a save is in flight.

## Fixes Applied

- Added dirty-file switch guard with cancel, discard-and-open, and save-and-open choices.
- Made `openProjectFile` refuse dirty switches unless forced.
- Made `saveActiveFile` clear dirty only when saved content still matches the active editor.
- `npm run build` passed after fixes.

## Review 5 Recheck

- Verdict: PASS

## Review 6

- Feature: Project section data models and workflows
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - All ten project sections create structured local templates.
  - Smart context and cover brief actions create timestamped local markdown files.
  - No login or membership gate was introduced.

## Review 7

- Feature: MCP configuration and tool invocation UI
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - MCP config, list tools, call tool, and close/reload clients are wired end to end.
  - No login or membership gate was introduced.

## Review 8

- Feature: Smart Context generation workflow
- Verdict: FAIL
- Required fixes:
  - Only write the agent draft after the smart-context file is actually created.
  - Clamp `maxFiles`, limit per-file reads, and keep scan scope constrained.
  - Fix `build_smart_context` argument schema/parsing.

## Fixes Applied

- Made generated-file creation return the created entry or `undefined`.
- Added `maxFiles` clamp and 256KB per-file read limit.
- Removed whole-project fallback scan.
- Fixed tool schema and parsing.
- `npm run build` passed after fixes.

## Review 8 Recheck

- Verdict: PASS

## Review 9

- Feature: Sub-agent sessions and task routing
- Verdict: FAIL
- Required fixes:
  - Normalize stale persisted running sub-agent tasks after reload.
  - Add store-level guard against duplicate sub-agent runs.
  - Guard deletion of active running sub-agent tasks in store.

## Fixes Applied

- Restored stale `running` sub-agent tasks as interrupted `error` tasks.
- Added store-level running guards for run and delete.
- `npm run build` passed after fixes.

## Review 9 Recheck

- Verdict: PASS

## Review 10

- Feature: Image generation and asset workflows
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Image generation uses configured image model/API key, saves PNG plus Markdown manifest, and fails honestly without a key.
  - Non-text asset clicks no longer read binary files as UTF-8.
  - No login or membership gate was introduced.

## Review 11

- Feature: Cloud/local sync replacement
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Local project snapshots create and list backup history without cloud/login gates.
  - Recursive backup skips heavy directories and the backup root itself.

## Review 12

- Feature: Resizable workspace panes
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Three main workspace panes now use project/resizer/canvas/resizer/agent columns.
  - Left and right pane widths support pointer drag, `Ctrl/Cmd + ArrowLeft/ArrowRight`, viewport clamping, and local persistence.
  - No login or membership gate was introduced.

## Review 13

- Feature: Original-style project group directories
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Project groups now map to `rules`, `outline`, `chapters`, `roles`, `objects`, `records`, `inspirations`, `assets`, `.wangyang/skills`, and `others`.
  - Smart Context scanning uses `rules/outline/chapters/roles/objects/records/inspirations`.
  - No login or membership gate was introduced.

## Review 14

- Feature: Core Agent tool registry parity
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - All 29 reversed built-in tool names are registered.
  - File, search, smart-context, image, local knowledge, todo, history, and command tools execute through existing local IPC boundaries.
  - `run_command` is constrained to the current project root by omitting model-supplied `cwd`.
  - `call_sub_agent` validates role values before writing local task request files.

## Review 15

- Feature: Local full-feature wording
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Visible renderer/docs wording no longer references login, membership, VIP, cloud drive, upload, or cloud sync.
  - The former cloud-drive area is presented as local snapshots.

## Review 16

- Feature: Project tree real status and move/archive interactions
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Project title is derived from the configured project root instead of a hard-coded name.
  - Footer shows real MCP tool count and recursive chapter text character count.
  - File rows include move and archive actions, both using existing project-bound IPC operations.

## Review 17

- Feature: Editor interaction skeleton
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Editor toolbar includes Markdown formatting, undo/redo, source/preview, assistant, save, and close controls.
  - Find/replace works from preview by switching to source and restoring the target selection.
  - External disk changes are detected even while local edits are dirty, with confirmation before reload.
  - Smart Context record files are treated as read-only in the editor.

## Review 18

- Feature: Smart Context state skeleton
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Smart Context scans now record file character counts plus sha256 hashes.
  - Generation uses `idle`, `collecting`, and `committing` states with canceled, ready, and error state-file writes.
  - The ready state is written only after the local Smart Context record file has been created.
  - The generation entry point is guarded so collecting and committing phases cannot be re-entered.

## Review 19

- Feature: Agent composer interaction selectors
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - `/` opens a quick-command selector and inserts executable writing-agent prompts.
  - `@` opens project file search, inserts file references, and maintains removable attachment chips.
  - Context mode, prompt library, and thinking mode selections are folded into the outgoing agent request.
  - Enter and send-button paths both use the same composer send flow, while running-state clicks still stop the agent.

## Review 20

- Feature: Project-level agent history management
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Current project chat sessions read from and write to `.wangyang/agent-sessions.json`.
  - No-project fallback keeps using localStorage, while old localStorage sessions are isolated as legacy sessions.
  - History UI supports current/legacy tabs, preview, continue/restore, rename, delete confirmation, and clear-all.
  - Running-state guards prevent session mutations while an agent task is active.

## Review 21

- Feature: Agent solution and profile routing skeleton
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Agent pane now exposes separate local solution and current-agent selectors.
  - Outgoing prompts include current solution and current agent role instructions.
  - Main-agent requests continue through the primary chat, while planner/writer/reviewer/researcher profiles route to local sub-agent sessions.
  - Sub-agent running-state guards prevent draft loss when another sub-agent task is active.
  - Restored sessions synchronize the visible solution selector from their saved mode.

## Review 22

- Feature: Image attachment message path
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Chat messages now support image attachments with name, MIME type, size, and data URL.
  - OpenAI-compatible requests convert attached images into `text` plus `image_url` content parts.
  - Main chat and local sub-agent runs both pass image attachments through to the model request.
  - Composer image input enforces format, count, and size limits, shows removable thumbnail chips, and clears attachments after send.
  - Message rendering and history preview preserve image context.

## Review 23

- Feature: Agent tool confirmation and step continuation
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - `runAgent` now accepts tool-confirmation and step-continuation callbacks.
  - `write` and `danger` tools require confirmation before execution; rejected calls return a tool result and are marked as error.
  - Tool-step limits can be explicitly extended instead of always failing immediately.
  - Main chat and sub-agent runs both pass confirmation callbacks.
  - Tool cards update from running to success or error and display status in the message list.

## Review 24

- Feature: Agent model default and temperature controls
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Main chat, composer-routed sub-agents, and manual sub-agent tasks all pass the selected temperature to the agent runner.
  - Store-level defaults remain intact when no temperature is supplied.
  - The model line can restore the configured default agent model and shows current/default model information.
  - The settings panel exposes a 0.0-1.0 temperature slider.

## Review 25

- Feature: Agent context settings entry
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The agent settings panel exposes prompt-context toggles and max context file count.
  - Settings write back through `saveLocalSettings`.
  - Outgoing prompts honor automatic project-rules and Smart Context carry settings.

## Review 26

- Feature: Agent pane collapse integration
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Agent collapse state is owned by `App`, so closing the agent pane changes the workspace layout.
  - The collapsed right pane becomes a 42 px reopen rail while preserving the previous expanded width.
  - The agent resizer remains as a disabled 0 px grid placeholder to keep column placement correct.
  - Reopen restores the full `AgentWorkbench`.

## Review 27

- Feature: P1 tool state closure, first pass
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - `list_history_sessions` reads current project `.wangyang/agent-sessions.json` before legacy localStorage.
  - `update_chapter_status` merges with existing `.wangyang/chapter-status.json` content.
  - Project display names from `.wangyang/project.json` are consumed by the project tree.
  - Chapter status metadata is consumed by the chapter list and displayed as status pills.

## Review 28

- Feature: LLM model configuration runtime wiring
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Provider-prefixed model IDs now resolve to provider interface plus actual provider model name.
  - Chat requests fail with a clear missing API-key error instead of silently using a placeholder key.
  - Model settings validate non-empty model lists and normalize scenario model selections to available models.
  - The settings UI shows how model IDs resolve before they are sent to the provider.

## Review 29

- Feature: Local knowledge base management and tool wiring
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The Knowledge rail panel can add project-relative knowledge directories, bind the default project knowledge directory, toggle entries, and search enabled knowledge bases.
  - Knowledge configuration is persisted to `.wangyang/knowledge-bases.json`.
  - Search results can open source files and write concrete knowledge references into the agent draft.
  - `search_knowledge_base` and `semantic_search` read the same enabled knowledge-base configuration.
  - Fallback directories are used only when no knowledge-base configuration exists; configured-but-disabled knowledge bases stay disabled.

## Review 30

- Feature: Titlebar window actions
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The message button restores the right-side agent pane instead of being a dead icon.
  - The local snapshot button calls `createBackup`, disables during creation, and reports success or failure.
  - Closing the window checks `editorDirty`; unsaved content must be saved successfully before closing.
  - Clean editor state still closes directly through the existing window IPC.

## Review 31

- Feature: Agent system prompt and prompt-context wiring
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Main agent system prompts now include project root, current file, selected agent mode, tool strategy, and prompt-context settings.
  - Existing chat sessions refresh the current system prompt before each new request instead of keeping stale settings.
  - Sub-agent runs inherit the same project and prompt-context system instructions plus role-specific guidance.
  - Context trimming keeps system messages first, so refreshed instructions stay at the front of the model request.

## Review 32

- Feature: Prompt management and extended prompt-context settings
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Local settings now include custom prompt templates, default selected prompt, agent-memory update, auto-summary threshold, and context-window limit.
  - The settings modal can add, edit, enable, disable, delete, and choose default prompt templates.
  - The agent composer reads enabled local prompt templates and sorts the default selected template first.
  - System prompts include the extended context settings so saved configuration affects model requests.

## Review 33

- Feature: Automatic backup scheduling and retention
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Manual and scheduled backups prune old versions according to `backup.keepVersions`.
  - Pruning only removes directories under the configured backup root.
  - The main process starts, refreshes, and stops the auto-backup scheduler from app lifecycle, project-root changes, and settings saves.
  - Scheduler refresh uses a generation guard so concurrent refreshes cannot leave duplicate timers running.

## Review 34

- Feature: Real project-context package before agent runs
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Main and sub-agent runs append a bounded project context block to the hidden system message.
  - Context collection respects prompt settings for project rules, Smart Context, agent memory, max file count, window limit, and summary threshold.
  - Smart Context state supports both `recordPath` and legacy `contextPath`.
  - Main and sub-agent runs acquire running guards before asynchronous context collection, preventing duplicate sends.

## Review 35

- Feature: Skills and treasure-box rail local actions
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The Skills rail can create, import, refresh, list, and open local project skill files.
  - The treasure-box rail can export project Markdown, show project statistics, and create a batch-processing task file.
  - Those rail cards now dispatch real local actions instead of always writing a prompt draft.
  - Added compact rail styles for skill lists, toolbox actions, and statistics output.

## Review 36

- Feature: System theme runtime wiring
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - `localSettings.system.theme` now drives the Ant Design theme algorithm, root dataset, and app theme class.
  - Light mode has readable core panel, input, editor preview, welcome-state, quick-prompt, card, and stats styling.
  - Dark mode keeps the existing original-like dark shell.

## Review 37

- Feature: Model metadata and model capability display
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - `AiConfig` now carries model metadata for context window, image support, thinking support, price tier, deprecation, and default temperature.
  - Existing local stores merge default metadata when loaded.
  - Settings saves normalize metadata for every available model.
  - Settings and the agent composer expose model capability information.

## Review 38

- Feature: `call_sub_agent` tool runtime closure
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Main-agent tool registration injects the renderer sub-agent runner, while sub-agents keep a non-recursive tool registry.
  - `call_sub_agent` now returns a real sub-agent session id, status, reply, and error when the runner is available.
  - The file-queue fallback remains for runtimes without an injected runner.
  - Abort signals propagate from the main run into tool execution and sub-agent runs, so stopping the main task cancels a nested sub-agent.

## Review 39

- Feature: Help and project settings rail entries
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The lower help button opens a local help modal instead of writing a prompt draft.
  - The lower settings button opens project settings for project name and per-section directory mappings.
  - Settings persist to `.wangyang/project.json` and `.wangyang/section-dirs.json`.
  - Directory mapping changes refresh file groups and chapter statistics with stale async requests discarded.

## Review 40

- Feature: Advanced editor view modes, first pass
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The editor now supports source, preview, dual-pane, diff, and CSV table preview modes.
  - Line numbers can be toggled and remain synchronized with textarea scrolling.
  - Width mode now has a real normal/wide layout difference.
  - Existing save, find/replace, keyboard shortcuts, read-only Smart Context, and dark/light readability remain intact.

## Review 41

- Feature: System settings runtime closure, first pass
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Language settings synchronize to `document.documentElement.lang`.
  - Local app lock supports a PIN-based overlay without reintroducing login.
  - Diagnostics export writes a redacted JSON file under `.wangyang/diagnostics`.
  - Update checks explicitly report that the local rebuild has no remote update source.
## Review 42

- Feature: Structured todo state and agent task panel
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - `todo_write` persists structured tasks to `.wangyang/todos.json` and Markdown output.
  - Missing legacy `markdownPath` values remain on `.wangyang/todos.md`.
  - Custom Markdown todo paths are tracked and synchronized without stale output.
  - Todo statuses normalize to `pending`, `in_progress`, `completed`, or `cancelled`.

## Review 44

- Feature: Editor scenario-model AI actions
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - `sendMessage` accepts optional model and prompt overrides without changing default calls.
  - Editor continue, polish, summary, and final polish actions consume their configured scenario models.
  - AI actions send results to the agent conversation instead of overwriting editor content.

## Review 45

- Feature: Image edit model IPC, tool, and asset UI
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - `imageEdit` scenario is consumed by a main-process image edit service.
  - Renderer preload, IPC, and agent tool paths can call image editing.
  - Asset UI exposes generate and edit flows.
  - Source image paths are constrained to project-local PNG/JPG/JPEG/WebP files before reading.

## Review 46

- Feature: Interactive `create_options` tool flow
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - `create_options` pauses tool execution until the user selects an option in the agent panel.
  - Selection is returned as tool result and agent execution can continue.
  - Cancel/stop resolves pending option requests instead of leaving hung promises.
  - Main and manual sub-agent runs are guarded against overlapping option requests.

## Review 47

- Feature: Local full-book import and chapter splitting
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The full-book import button opens a real import dialog instead of only drafting an agent prompt.
  - Imported text is split by common chapter headings, with chunk fallback only when no heading exists.
  - Created chapter files use batch timestamps and `createEntry` no-overwrite behavior.

## Review 48

- Feature: Project export dialog and multi-format export
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Export opens a settings dialog instead of immediately producing a single Markdown file.
  - Markdown, TXT, and HTML exports are supported.
  - Export scope can be limited to chapters or include planning, outline, roles, settings, records, and inspirations.
  - HTML output escapes file paths and content.

## Review 49

- Feature: Project section visibility and ordering settings
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Section layout is persisted to `.wangyang/section-layout.json`.
  - The file tree loads and renders only visible sections, sorted by configured order.
  - Project settings can hide, restore, and reorder sections while keeping directory mapping editable.

## Review 50

- Feature: Local no-login capability semantics
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Local mode now reports `auth.loggedIn=false` and full local capabilities separately.
  - Legacy VIP/login fields are no longer used to express unlocked local features.
  - Settings UI reads `capabilities` with safe fallback for older entitlement shapes.

## Review 43

- Feature: LLM model configuration runtime wiring
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Saving model settings recalculates scenario models through configured providers.
  - Text and image scenarios no longer preserve a preferred model outside their scope.
  - AgentWorkbench shows the actual runtime model and blocks missing API keys or unsupported request formats before sending.
  - Manual sub-agent runs use the same runtime model status and validation.

## Review 51

- Feature: LLM model configuration effectiveness fixes
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Configured OpenAI-compatible providers now contribute their default `provider/model` entry automatically.
  - Main agent and researcher profiles use scenario models for actual runtime calls.
  - Chat-capable vision models are no longer excluded from text model scenarios.

## Review 52

- Feature: Request format support boundary
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Settings blocks configured non-OpenAI-compatible providers from being saved as usable runtimes.
  - Agent chat, image generation, and image editing now reject unsupported request formats consistently.

## Review 53

- Feature: System settings local constraints
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Auto update stays disabled because the local build has no update source.
  - App lock PIN is saved as a SHA-256 hash and legacy plaintext PINs are only read for migration.
  - Lock overlay Enter and button paths share the same hash-aware unlock logic.

## Review 54

- Feature: System file dialogs for import/export
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Full-book import can read selected TXT, Markdown, or HTML files with extension and 20 MB size checks.
  - Project export uses a system save dialog and can reveal the saved file in Explorer.

## Review 55

- Feature: Side-panel action routing
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Header and section more/settings buttons now open concrete settings or module actions.
  - Backup entries reveal their local folder and image search results open the image edit flow.
  - The intelligence panel more action now writes a specific smart-opening task instead of a generic placeholder.

## Review 56

- Feature: Asset row local actions
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Image asset rows now open the image edit flow with the selected source path.
  - Remaining draft actions are limited to AI-question/task composition paths.

## Review 57

- Feature: Smart context model generation
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Smart context generation now calls `scenario.smartContext` directly.
  - Empty model output and stream errors no longer produce a ready state.
  - Canceled stale runs no longer overwrite newer smart-context state.

## Review 58

- Feature: Navigation fallback action cleanup
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The navigation more fallback no longer writes a generic AI task for unhandled local actions.

## Review 59

- Feature: Editor recent files and external open
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Recent editor files are persisted in local storage and can be reopened with dirty-file confirmation.
  - Current project files can be opened through the system default application with project-root path constraints.

## Review 60

- Feature: Asset preview and non-text file actions
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Project image previews are served as bounded data URLs from project-relative paths.
  - Asset files now have preview, edit, external open, reveal, and copy-path actions instead of generic draft prompts.

## Review 61

- Feature: Advanced editor view persistence and shortcuts
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Advanced editor view, line numbers, and width mode persist across file switches.
  - Common editor shortcuts now cover save, find, source/preview/dual/diff/csv, line numbers, and width.

## Review 62

- Feature: Model settings dead-code cleanup and export format clarity
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The unused legacy `ModelSettings` component was removed.
  - The export dialog now explicitly marks PDF, DOCX, and EPUB as not connected yet instead of implying hidden support.

## Review 63

- Feature: Open project folder
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The project path area can open the current project root through the OS shell.
  - Missing project roots surface a main-process error instead of opening arbitrary paths.

## Review 64

- Feature: Project-level intelligence shortcuts
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The intelligence panel now exposes full-text Q&A, pure chat, and smart naming entry points.
  - Full-text Q&A switches to the search Q&A mode while pure chat explicitly avoids project/tool context.

## Review 65

- Feature: Responses API text model adapter
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Responses API text interfaces can be saved and are treated as runnable by the agent panel.
  - The shared LLM adapter now streams Responses text, function calls, tool outputs, and usage while keeping Claude unsupported.

## Review 66

- Feature: Bare model ID normalization and runtime fallback
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Settings save normalizes resolvable bare model names into `provider/model` IDs and rejects unresolved IDs.
  - Runtime model resolution can recover old bare-model configs by matching provider defaults or a single keyed text provider.

## Review 67

- Feature: Agent model selector controls actual runtime model
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The agent model selector now displays and overrides the active profile runtime model.
  - Main, profile-based sub-agents, and manual sub-agents pass the displayed model into execution.

## Review 68

- Feature: Project export PDF and DOCX formats
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Project export now offers PDF and real DOCX output in addition to Markdown, TXT, and HTML.
  - DOCX saves through binary IPC and PDF is generated by Electron `printToPDF`.

## Review 69

- Feature: Editor advanced view state closure
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The editor store now tracks `source`, `preview`, `dual`, `diff`, and `csv`.
  - Stored advanced view mode is reused when files open and all editor view switches update the shared store.

## Review 70

- Feature: Sidebar intelligence actions send concrete tasks
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Full-text Q&A submissions, search-result analysis, knowledge-result Q&A, smart naming, and smart-start actions now send agent tasks directly.
  - Pure chat and non-specific Q&A still prepare the composer instead of sending an incomplete task.

## Review 71

- Feature: Backup directory picker in settings
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Settings now opens a native directory chooser for backup location and can reset to the default project backup path.
  - Directory selection is exposed through preload IPC and does not disturb existing backup settings saves.

## Review 72

- Feature: System update setting affordance cleanup
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - System settings now show local-build update status instead of a disabled automatic-update switch.
  - The update check button is actionable and explains the local-build update path while keeping `autoUpdate` disabled internally.

## Review 73

- Feature: Claude Messages text model adapter
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Claude Messages API can be selected as a text model request format.
  - The shared LLM adapter maps Claude message history, tool use, tool results, text deltas, and usage into the same agent stream events.

## Review 74

- Feature: Project export EPUB format
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Project export now offers EPUB and removes the remaining EPUB not-connected note.
  - EPUB output is generated as a real EPUB zip with package metadata, nav, and chapter XHTML files.

## Review 75

- Feature: MCP HTTP and SSE transports
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - MCP stdio transport remains compatible with command, args, and merged environment handling.
  - MCP HTTP uses `StreamableHTTPClientTransport`, SSE uses `SSEClientTransport`, and configured headers are normalized and passed into transport request initialization.

## Review 76

- Feature: Agent model routing closure
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Project-root switches now synchronize the active agent runtime model with the newly loaded project AI config.
  - Main agent tool-triggered sub-agent calls inherit the current runtime model or the role-specific model overrides shown in the agent pane.

## Review 77

- Feature: Image model configuration boundary
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Image and image-edit scenarios now show configuration readiness for OpenAI-compatible Images API usage and disable unsuitable model choices in the settings UI.
  - Image runtime errors now report the selected model, interface, and unsupported request format in Chinese.

## Review 78

- Feature: Architecture and parity documentation sync
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Architecture docs now list the current IPC surface and all 30 registered built-in tools instead of the old core-subset wording.
  - Feature parity docs now reflect the current tool count and include image edit and sub-agent call coverage.

## Review 79

- Feature: Image service Chinese diagnostics
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Image generation/edit user-facing errors were localized to Chinese without changing the image API flow.
  - Path safety and unsupported-source diagnostics now include the project root, resolved target, source path, or extension needed to debug configuration mistakes.

## Review 80

- Feature: Agent model status dead-branch cleanup
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The unreachable unsupported-request-format branch was removed from the agent model readiness path.
  - Agent and manual sub-agent send guards now report the actionable missing-API-key state without suggesting an unimplemented text request format.

## Review 81

- Feature: Global UI interaction states
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Global thin scrollbars and WebKit scrollbar styling were added for dark UI parity.
  - Focus-visible, disabled, and active button/input states were tightened without affecting pane resizer dragging.

## Review 82

- Feature: Settings local-enabled status affordance
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The local full-feature enabled state is now rendered as a read-only status badge instead of a disabled primary button.
  - The entitlement and no-login local mode behavior is unchanged.

## Review 83

- Feature: Application window icon resource
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The original application icon is stored under the rebuild project resources folder and used by the main BrowserWindow.
  - The package metadata declares the icon as an extra packaged resource so `process.resourcesPath/icon.ico` resolves in packaged builds.

## Review 84

- Feature: Project settings section ordering controls
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Project settings now display sections in the current configured order and provide up/down controls for reordering.
  - Existing visibility, numeric order, directory mapping, and persisted layout file formats remain compatible.

## Review 85

- Feature: UI parity checklist sync
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - UI parity checklist now separates completed interaction, state, and screen coverage from still-unproven pixel-exact/icon-set items.
  - Remaining unchecked items are explicitly limited to original private icons and exhaustive pixel/state matching.

## Review 86

- Feature: LLM runtime model configuration repair
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Local runtime normalization now adds configured provider default models and routes scenarios away from unkeyed `wangyang/*` defaults.
  - Main and sub-agent sends resolve through the same usable-model selection path before calling the LLM runtime.
  - Settings model options include configured provider defaults, and saved AI config returns the actual normalized persisted value.

## Review 87

- Feature: Project lifecycle and template creation
- Verdict: PASS
- Verification:
  - `npm run build` passed after implementation and after both review fixes.
  - Project list, template creation, open, rename, and delete IPC paths are exposed through preload and persisted in the local store.
  - New template projects create the original-style directory structure plus `wangyang.json` and `.wangyang/solution.json`.
  - Delete-current-project now handles unsaved editor changes before clearing project state.
  - Physical project deletion is restricted to trusted template projects and rejects root directories, non-real directories, symlinks, junctions, and missing project markers.

## Review 88

- Feature: Project config file synchronization
- Verdict: PASS
- Verification:
  - `npm run build` passed after implementation and after both review fixes.
  - `wangyang.json` read/write IPC is exposed through shared IPC, preload, and main handlers.
  - File create, rename, move, and delete operations synchronize original-style grouped `relativePath` records.
  - Config sanitization filters `wangyang.json`, `.wangyang/*`, invalid groups, duplicates, and `.` / `..` path traversal segments while preserving supported metadata fields.

## Review 89

- Feature: Chinese Wang Yang branding and model display parity
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Review agent `019e8bb4-888d-7a32-a425-34f1c68f5056` passed a read-only check for visible old-brand, abbreviation, and fish-icon leftovers.
  - User-visible branding now renders as `王阳`, including the window title, welcome surfaces, guide text, cloud provider label, and generated icon preview.
  - Model display conversion renders internal `wangyang/*` and legacy `feelfish/*` as `王阳/*` in model lists, status rows, tooltips, and errors while preserving stored runtime ids.
  - Existing configured provider models such as `deepseek/*` and `openai/*` are left unchanged and remain selectable.
  - The enlarged titlebar minimize, maximize/restore, and close controls are present in the running app screenshot under `artifacts/wangyang-cn-visible.png`.

## Review 90

- Feature: Project agent resource library
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Review agent `019e8bc3-2ba3-7d70-bbe9-35a8a7c8e768` passed after two fixes.
  - Project agent files can be listed, created without overwriting, opened in the editor, applied to the composer, and deleted from the right-side agent panel.
  - Agent frontmatter now returns `name`, `description`, `tools`, `skills`, and `isBuiltIn`, including YAML block-list forms while preserving plain Markdown compatibility.
  - Skill creation now rejects an existing skill directory instead of silently writing into it.
  - The project agent panel adapts to the narrow right pane width.
  - Command execution IPC now keeps renderer-provided working directories inside the configured project root.

## Review 91

- Feature: One-click Windows launcher
- Verdict: PASS
- Verification:
  - Review agent `019e8bcb-40eb-71b0-a744-75b2ae80b073` passed.
  - `run.cmd` switches to its own folder, checks for `npm`, installs dependencies when Electron is missing, starts `npm run dev`, and pauses on failure.
  - Old-brand text scan found no matches in the launcher.

## Review 92

- Feature: Project-level sub-agent session persistence
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Sub-agent sessions are listed, written, and deleted through Electron IPC.
  - Project-backed sub-agent sessions are stored under `.wangyang/memory/sessions` as JSON plus Markdown summaries.
  - Startup, project-root switching, and project opening hydrate sub-agent sessions from the active project, while no-project mode keeps the legacy localStorage fallback.
  - Stale `running` project session files are normalized to interrupted `error` records on read.

## Review 93

- Feature: Original-style left project group shortcut rail
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Original bundle inspection found the side rail maps to file groups: `rules`, `outline`, `chapters`, `roles`, `objects`, `records`, `inspirations`, `assets`, `skills`, and `others`.
  - The second-row left workspace button now toggles an inline group shortcut rail instead of opening a floating menu.
  - Shortcut rail buttons show per-group entry counts and jump to/expand the corresponding project section.
  - Default workspace width was reset to leave room for the original-style 60 px group rail while preserving a roughly 222 px file tree when it is open.

## Review 94

- Feature: UI parity final visual-state pass
- Verdict: PASS
- Verification:
  - `npm run typecheck` passed.
  - `npm run build` passed.
  - The remaining UI parity checklist items were closed with clean-room implementation: an original-style local glyph set replaces the first-screen project/rail icons without copying private UI assets.
  - Scrollbar geometry now uses fixed global WebKit dimensions, hidden scrollbar buttons, a minimum thumb size, track edge styling, and hover/active thumb states.
  - Native and Ant Design controls now share explicit hover, focus-visible, disabled, and transition states, with nested project-tree and rail controls inheriting the same icon-state behavior.

## Review 95

- Feature: Agent response style presets
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Prompt context settings now include a persisted response style preset.
  - The settings panel exposes four styles: senior editor, creative god, web-novel master, and Wangyang roast.
  - Main-agent and sub-agent system prompts receive the selected style while preserving the current task, agent mode, tool rules, and safety boundaries.
  - Existing local settings merge the new field from defaults, so old store files continue loading without migration.

## Review 96

- Feature: Exposed default Wangyang response style
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - The default response style preset is now Wangyang for both normalized local settings and settings-modal fallback data.
  - The agent mode bar exposes a compact response-style selector between the info icon and settings button.
  - The selector persists through the existing prompt-context settings path, so it changes style only and keeps task behavior unchanged.

## Review 97

- Feature: Light theme low-contrast text sweep
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Light-theme muted/faint tokens were darkened to readable Morandi text colors.
  - Agent settings, context labels, floating panels, history, sub-agent output, project-agent cards, popups, welcome cards, editor empty states, and helper text now receive explicit readable light-theme text overrides.
  - Electron remote-debug DOM audit confirmed the context-setting labels use `rgb(81, 72, 63)` / `rgb(101, 92, 81)` instead of the previous pale blue-gray.
  - Final screenshot artifact: `artifacts/light-contrast-agent-settings-final.png`.

## Review 98

- Feature: Tool trace visual hierarchy
- Verdict: PASS
- Verification:
  - `npm run build` passed.
  - Assistant prose cards now keep the primary visual weight with stronger border/background/shadow.
  - Tool result messages are rendered as secondary dashed log blocks with smaller type, muted color, no shadow, and left indentation.
  - Inline tool-call rows are compact status logs with muted background, smaller status/code text, and no card shadow.
  - Electron remote-debug CSS audit confirmed assistant messages remain prominent while tool traces use lower-emphasis computed styles.
  - Screenshot artifact: `artifacts/tool-message-hierarchy.png`.
