# 王阳

王阳本地 AI 写作与智能体桌面应用。

This project uses the reverse-analysis notes only as architecture input. It does not copy bundled proprietary source, UI assets, or private configuration values from the installed application.

## Stack

- Electron 35
- Electron Vite
- React 19
- Zustand
- OpenAI-compatible LLM client
- MCP stdio client
- Local project file tools

## Commands

```bash
npm install
npm run dev
npm run build
npm start
```

`npm run build` only compiles the project. It does not open an Electron window.

Use one of these to run the app:

```bash
npm run dev
npm start
```

If Electron was installed without its Windows binary, repair it with:

```bash
npm run fix:electron
```

## Current Scope

Implemented:

- Electron main/preload/renderer split
- Local JSON config store
- AI provider/model configuration
- OpenAI-compatible streaming chat client
- Agent tool-calling loop
- Built-in project/file/network/command tools
- MCP stdio list/call bridge
- Smart Context prompt builder
- Usable desktop UI shell

Not yet fully implemented:

- Claude request conversion
- Full 27-tool behavior parity
- Image generation
- Cloud semantic search
- Full-text QA
- Sub-agent session persistence
- Project template import
- Rich editor and writing workflow

## Important Paths

- `src/main`: Electron main process, IPC, local system capabilities
- `src/preload`: Secure bridge exposed as `window.electronAPI`
- `src/core/models`: Model/provider configuration
- `src/core/llm`: LLM request wrapper
- `src/core/agent`: Agent runtime loop
- `src/core/tools`: Built-in tool registry
- `src/core/mcp`: Renderer-side MCP tool adapter
- `src/renderer`: React UI
- `docs/architecture.md`: Architecture notes and reconstruction roadmap
