# Local Free Mode

This rebuild is a local-first version. It does not expose login or membership checks in the UI.

All capability flags are enabled by default:

- Local base capabilities
- Local advanced capabilities
- Agent tools
- MCP
- Knowledge base
- Semantic search
- Image generation
- Sub-agents
- Local snapshot features

Cloud-only behavior from the original app must be reimplemented as either:

- Local project functionality
- MCP-backed functionality
- User-provided model/API-key functionality

The rebuild must not patch or bypass the original packaged app.
