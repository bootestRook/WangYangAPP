# Feature Parity Plan

Goal: reproduce 王阳 UI, interaction logic, and usable local functionality module by module.

## Priority Order

1. First-screen navigation and panels
2. Project file tree and local file operations
3. Search panel
4. Agent chat panel
5. Writing/editor surface
6. Project sections: 规划 / 大纲 / 章节 / 角色 / 设定 / 记录 / 灵感 / 资产 / 技能 / 其他
7. Model configuration and provider settings
8. MCP configuration and tool invocation
9. Smart Context generation
10. Sub-agent sessions
11. Image generation
12. Cloud-only features where external APIs are available
13. Full original-source UI/logic gap audit

## Current Working Features

- Local free mode is enabled by default. Login and membership gates are not part of this rebuild.
- Local capability flags exposed by the app are all enabled: base capabilities, advanced capabilities, MCP, agent tools, knowledge base, semantic search, image generation, and sub-agents.
- Rail switches between 文件 / 搜索 / 技能 / 智能 / 快照 / 知识 / 百宝箱.
- 文件 panel lists real project entries for 规划 / 大纲 / 章节 / 角色 / 设定 / 记录 / 灵感 / 资产 / 技能 / 其他.
- File groups support create file, create folder, rename, move, archive, delete, enter folder, and return to parent folder.
- 搜索 panel calls the main-process project search and displays real matches.
- 搜索 panel supports content search, file/folder name search, and a full-text question handoff into the agent input.
- 知识 panel supports local knowledge-base registration, project knowledge binding, enable/disable toggles, and local knowledge search with source-file open actions.
- Agent tools include project file/folder name search.
- Settings include MCP config editing plus MCP tool listing and manual tool invocation for stdio, Streamable HTTP, and SSE transports.
- Agent chat can send messages through configured OpenAI Chat Completions, OpenAI Responses API, or Claude Messages text interfaces.
- Agent chat has project-level session history under `.wangyang/agent-sessions.json`, plus isolated legacy localStorage sessions with preview, restore, rename, delete, and clear controls.
- Agent chat supports mode selection and run cancellation without login or membership checks.
- Agent pane has local solution/profile routing: 专业辅助 / 智能规划 / 游戏冒险 solutions can select main, planning, writing, review, or research agents; sub-agent profiles route to local sub-agent sessions.
- Agent composer supports `/` quick commands, `@` project file references, removable attachment chips, image attachments with OpenAI-compatible `image_url` delivery, context mode selection, prompt library insertion, thinking mode selection, and unified Enter/send behavior.
- Agent model controls support restoring the default agent model, showing current/default model resolution, applying a temperature value to main and sub-agent runs, and forwarding the visible runtime model into tool-triggered sub-agent calls.
- Model runtime wiring resolves provider-prefixed IDs such as `openai/gpt-4o-mini` to the configured provider plus actual model name, normalizes resolvable bare model IDs, validates non-empty model lists, and reports missing API keys clearly.
- Agent settings expose prompt-context controls for project rules, Smart Context carry, Smart Context auto-update, and max context file count.
- Agent tool calls now show running/success/error status, require confirmation before `write` and `danger` tools execute, and can request explicit continuation when tool-step limits are reached.
- Center canvas opens project files for editing, supports save, autosave, preview/source mode, Markdown toolbar actions, find/replace, external-change reload prompts, read-only smart-context records, close confirmation, and writing-assist handoff.
- Project sections create structured local templates under original-style directories: rules, outline, chapters, roles, objects, records, inspirations, assets, .wangyang/skills, and others.
- Records and assets include local smart-context and cover-brief generation workflows.
- Smart Context generation scans bounded writing-section files, records character counts and sha256 hashes, writes `.wangyang/smart-context-state.json`, creates a read-only local Smart Context record, supports cancel during collection, and hands the update prompt to the agent.
- Sub-agent panel supports local planner, writer, reviewer, and researcher task sessions with project-level persistence under `.wangyang/memory/sessions`, plus model/tool routing.
- Image generation and image editing use configured OpenAI-compatible image models to save PNG assets plus Markdown manifests under `assets/generated`; settings show image-model readiness and block unsuitable image scenario choices.
- 快照 provides local project snapshots with backup history under `.wangyang/backups` or the configured backup directory.
- The three main workspace panes support original-style width resizing by dragging the vertical dividers, keyboard quick resize with `Ctrl/Cmd + ArrowLeft/ArrowRight`, and local width persistence.
- The right agent pane can collapse into a narrow reopen rail and restore without losing the previous pane width.
- Built-in tools now register all 30 reversed tool names, including local file operations, project search, smart context, todo/options helpers, image generation and editing, local knowledge search, full-text QA material collection, history sessions, sub-agent calls, and project-root shell commands.
- Knowledge tools read `.wangyang/knowledge-bases.json`; semantic search uses enabled knowledge bases before falling back to project keyword search.
- Project-level tool state is partially closed: project renames are reflected from `.wangyang/project.json`, chapter statuses are merged and shown in the chapter tree, and history listing reads current project sessions before legacy sessions.
- Window minimize, maximize, and close are wired through Electron IPC.

## Known Gaps

- Original cloud APIs will be replaced with local-first equivalents or user-provided API keys.
- Custom icon assets are approximated with lucide icons.
- Some original cloud marketplace/social behaviors are intentionally local-first equivalents in this rebuild.
- A dedicated source-diff agent is auditing original UI logic against rebuild for remaining missing interactions and feature gaps.
