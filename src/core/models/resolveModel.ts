import type { AiConfig, ModelInterfaceConfig } from '../../shared/types'

export interface ResolvedModel {
  modelId: string
  modelName: string
  interfaceId: string
  interfaceConfig: ModelInterfaceConfig
  requestFormat: NonNullable<ModelInterfaceConfig['requestFormat']>
}

function normalizedDefaultModel(interfaceConfig: ModelInterfaceConfig): string {
  return interfaceConfig.defaultModel?.trim().replace(/^\/+/, '') ?? ''
}

function supportsTextRequests(interfaceConfig: ModelInterfaceConfig): boolean {
  const requestFormat = interfaceConfig.requestFormat ?? 'openai'
  return requestFormat === 'openai' || requestFormat === 'responses' || requestFormat === 'claude'
}

function resolveBareModel(config: AiConfig, modelName: string): ModelInterfaceConfig | undefined {
  const interfaces = Object.values(config.interfaces).filter(supportsTextRequests)
  const defaultMatches = interfaces.filter((interfaceConfig) => normalizedDefaultModel(interfaceConfig) === modelName)
  const keyedDefaultMatch = defaultMatches.find((interfaceConfig) => interfaceConfig.apiKey.trim())
  if (keyedDefaultMatch) return keyedDefaultMatch
  if (defaultMatches.length) return defaultMatches[0]

  const keyedInterfaces = interfaces.filter((interfaceConfig) => interfaceConfig.apiKey.trim())
  return keyedInterfaces.length === 1 ? keyedInterfaces[0] : undefined
}

export function resolveModel(config: AiConfig, modelId: string): ResolvedModel {
  const parts = modelId.split('/').filter(Boolean)
  const [interfaceId] = parts
  const interfaceConfig = config.interfaces[interfaceId]
  if (interfaceConfig) {
    const modelName = parts.length > 1 ? parts.slice(1).join('/') : normalizedDefaultModel(interfaceConfig)
    if (!modelName) {
      throw new Error(
        `Model interface "${interfaceConfig.id}" has no default model. Use a model id like "${interfaceConfig.id}/your-model-name".`
      )
    }
    return {
      modelId: parts.length > 1 ? modelId : `${interfaceConfig.id}/${modelName}`,
      modelName,
      interfaceId: interfaceConfig.id,
      interfaceConfig,
      requestFormat: interfaceConfig.requestFormat ?? 'openai'
    }
  }

  const bareModelName = modelId.trim().replace(/^\/+/, '')
  const bareModelInterface = bareModelName ? resolveBareModel(config, bareModelName) : undefined
  if (bareModelInterface) {
    return {
      modelId: `${bareModelInterface.id}/${bareModelName}`,
      modelName: bareModelName,
      interfaceId: bareModelInterface.id,
      interfaceConfig: bareModelInterface,
      requestFormat: bareModelInterface.requestFormat ?? 'openai'
    }
  }

  throw new Error(`No model interface configured for "${interfaceId}". Use a model id like "openai/gpt-4o-mini".`)
}

export function buildDefaultHeaders(model: ResolvedModel): Record<string, string> {
  const headers: Record<string, string> = {
    ...(model.interfaceConfig.defaultHeaders ?? {})
  }

  if (model.interfaceConfig.apiUrl.includes('dashscope.aliyuncs.com')) {
    headers['x-dashscope-session-cache'] = 'enable'
  }

  if (model.interfaceId === 'wangyang') {
    headers['X-DashScope-DataInspection'] = JSON.stringify({ input: 'disable', output: 'disable' })
  }

  return headers
}
