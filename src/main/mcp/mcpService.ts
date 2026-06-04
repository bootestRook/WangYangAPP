import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpConfig, McpToolInfo } from '../../shared/types'

interface ClientRecord {
  client: Client
  transport: Transport
}

const clients = new Map<string, ClientRecord>()

function normalizeParameters(schema: unknown): McpToolInfo['parameters'] {
  if (schema && typeof schema === 'object') {
    return schema as McpToolInfo['parameters']
  }
  return { type: 'object', properties: {}, additionalProperties: true }
}

function uniqueToolName(serverName: string, toolName: string, used: Set<string>): string {
  if (!used.has(toolName)) return toolName
  return `${serverName}_${toolName}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function createTransport(serverName: string, config: McpConfig): Transport {
  const server = config.mcpServers[serverName]
  const type = server.type ?? 'stdio'

  if (type === 'stdio') {
    if (!server.command) {
      throw new Error(`MCP server command is missing: ${serverName}`)
    }
    return new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: {
        ...process.env,
        ...(config.commandEnv ?? {}),
        ...(server.env ?? {})
      } as Record<string, string>
    })
  }

  if (!server.url?.trim()) {
    throw new Error(`MCP server URL is missing: ${serverName}`)
  }

  const requestInit = Object.keys(server.headers ?? {}).length
    ? { headers: server.headers }
    : undefined
  const url = new URL(server.url)

  if (type === 'sse') {
    return new SSEClientTransport(url, { requestInit })
  }
  return new StreamableHTTPClientTransport(url, { requestInit })
}

async function getClient(serverName: string, config: McpConfig): Promise<ClientRecord> {
  const existing = clients.get(serverName)
  if (existing) return existing

  const server = config.mcpServers[serverName]
  if (!server || server.disabled || config.disabled?.[serverName]) {
    throw new Error(`MCP server is disabled or missing: ${serverName}`)
  }

  const transport = createTransport(serverName, config)
  const client = new Client(
    { name: 'wangyang', version: '0.1.0' },
    { capabilities: {} }
  )
  await client.connect(transport)
  const record = { client, transport }
  clients.set(serverName, record)
  return record
}

export async function listMcpTools(config: McpConfig): Promise<McpToolInfo[]> {
  const used = new Set<string>()
  const output: McpToolInfo[] = []

  for (const serverName of Object.keys(config.mcpServers)) {
    const server = config.mcpServers[serverName]
    if (server.disabled || config.disabled?.[serverName]) continue
    const record = await getClient(serverName, config)
    const result = await record.client.listTools()
    for (const tool of result.tools ?? []) {
      const finalName = uniqueToolName(serverName, tool.name, used)
      used.add(finalName)
      output.push({
        serverName,
        toolName: tool.name,
        finalName,
        description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
        parameters: normalizeParameters(tool.inputSchema),
        transport: server.type ?? 'stdio'
      })
    }
  }

  return output
}

export async function callMcpTool(
  config: McpConfig,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const record = await getClient(serverName, config)
  return record.client.callTool({ name: toolName, arguments: args })
}

export async function closeAllMcpClients(): Promise<void> {
  const records = [...clients.values()]
  clients.clear()
  await Promise.allSettled(records.map((record) => record.client.close()))
}
