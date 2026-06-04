import type { AiConfig, ModelInterfaceConfig, ModelMetadata, ScenarioConfig } from '../../shared/types'
import { defaultAiConfig } from './defaultConfig'

const LEGACY_BRAND_PROVIDER_ID = 'feelfish'
const BRAND_PROVIDER_ID = 'wangyang'
const unsupportedDefaultModelReplacements: Record<string, string> = {
  'wangyang/deepseek-v4-flash': 'wangyang/deepseek'
}

export function modelProviderId(modelId: string): string {
  return modelId.split('/').filter(Boolean)[0] ?? ''
}

export function normalizeKnownModelAlias(modelId: string): string {
  return migrateLegacyBrandModelId(modelId)
}

function migrateLegacyBrandModelId(modelId: string): string {
  const migrated = modelId.replace(/^feelfish(?=\/|$)/, BRAND_PROVIDER_ID)
  return unsupportedDefaultModelReplacements[migrated] ?? migrated
}

function migrateLegacyBrandInterfaces(
  interfaces: Record<string, ModelInterfaceConfig> | undefined
): Record<string, ModelInterfaceConfig> {
  const next = { ...(interfaces ?? {}) }
  const legacy = next[LEGACY_BRAND_PROVIDER_ID]
  delete next[LEGACY_BRAND_PROVIDER_ID]
  const current = next[BRAND_PROVIDER_ID]
  if (legacy && (!current || (!current.apiKey.trim() && legacy.apiKey.trim()))) {
    next[BRAND_PROVIDER_ID] = {
      ...legacy,
      id: BRAND_PROVIDER_ID,
      label: '王阳云',
      apiUrl: current?.apiUrl || defaultAiConfig.interfaces[BRAND_PROVIDER_ID]?.apiUrl || 'https://llm.wangyang.local'
    }
  }
  return next
}

function normalizeProviderDefaultModels(
  interfaces: Record<string, ModelInterfaceConfig>
): Record<string, ModelInterfaceConfig> {
  return Object.fromEntries(
    Object.entries(interfaces).map(([id, provider]) => {
      const defaultModel = normalizedDefaultModel(provider)
      const replacement = unsupportedDefaultModelReplacements[`${id}/${defaultModel}`]
      if (!replacement) return [id, provider]
      const [, ...replacementParts] = replacement.split('/').filter(Boolean)
      return [
        id,
        {
          ...provider,
          defaultModel: replacementParts.join('/')
        }
      ]
    })
  )
}

function migrateLegacyBrandMetadata(
  metadata: Record<string, ModelMetadata> | undefined
): Record<string, ModelMetadata> {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).map(([modelId, meta]) => {
      const nextModelId = migrateLegacyBrandModelId(modelId)
      return [
        nextModelId,
        {
          ...meta,
          id: migrateLegacyBrandModelId(meta.id),
          label: meta.label ? migrateLegacyBrandModelId(meta.label) : meta.label
        }
      ]
    })
  )
}

function migrateLegacyBrandScenario(scenario: Partial<ScenarioConfig> | undefined): Partial<ScenarioConfig> {
  return Object.fromEntries(
    Object.entries(scenario ?? {}).map(([key, modelId]) => [
      key,
      typeof modelId === 'string' ? migrateLegacyBrandModelId(modelId) : modelId
    ])
  ) as Partial<ScenarioConfig>
}

export function normalizedDefaultModel(provider: ModelInterfaceConfig): string {
  return provider.defaultModel?.trim().replace(/^\/+/, '') ?? ''
}

export function isTextRequestFormat(requestFormat: ModelInterfaceConfig['requestFormat'] | undefined): boolean {
  return requestFormat === undefined || requestFormat === 'openai' || requestFormat === 'responses' || requestFormat === 'claude'
}

export function isImageModelId(modelId: string): boolean {
  return /(?:^|[/_-])(?:wan-t2i|t2i|image-edit|qwen-image|gpt-image|dall-e|imagen|flux|stable-diffusion)(?:$|[/_-])/i.test(
    modelId
  )
}

export function mergeModelIds(models: string[]): string[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (!model || seen.has(model)) return false
    seen.add(model)
    return true
  })
}

export function providerModelId(provider: ModelInterfaceConfig): string {
  const modelName = normalizedDefaultModel(provider)
  return modelName ? `${provider.id}/${modelName}` : ''
}

export function configuredProviderModelIds(config: AiConfig): string[] {
  return Object.values(config.interfaces)
    .filter((provider) => provider.apiKey.trim() && isTextRequestFormat(provider.requestFormat))
    .map(providerModelId)
    .filter(Boolean)
}

function findProviderForBareModel(config: AiConfig, modelName: string): ModelInterfaceConfig | undefined {
  const providers = Object.values(config.interfaces).filter((provider) => isTextRequestFormat(provider.requestFormat))
  const defaultMatches = providers.filter((provider) => normalizedDefaultModel(provider) === modelName)
  const keyedDefaultMatch = defaultMatches.find((provider) => provider.apiKey.trim())
  if (keyedDefaultMatch) return keyedDefaultMatch
  if (defaultMatches.length) return defaultMatches[0]

  const keyedProviders = providers.filter((provider) => provider.apiKey.trim())
  return keyedProviders.length === 1 ? keyedProviders[0] : undefined
}

export function normalizeModelId(config: AiConfig, modelId: string): string {
  const parts = migrateLegacyBrandModelId(modelId).split('/').filter(Boolean)
  if (!parts.length) return ''
  const provider = config.interfaces[parts[0]]
  if (provider) {
    const modelName = parts.length > 1 ? parts.slice(1).join('/') : normalizedDefaultModel(provider)
    return modelName ? `${provider.id}/${modelName}` : provider.id
  }

  const bareProvider = findProviderForBareModel(config, parts[0])
  return bareProvider ? `${bareProvider.id}/${parts[0]}` : modelId
}

export function isConfiguredRuntimeModel(config: AiConfig, modelId: string, options: { image?: boolean } = {}): boolean {
  const provider = config.interfaces[modelProviderId(modelId)]
  const requestFormat = provider?.requestFormat ?? 'openai'
  if (options.image) {
    return Boolean(provider?.apiKey?.trim() && requestFormat === 'openai')
  }
  return Boolean(provider?.apiKey?.trim() && isTextRequestFormat(requestFormat))
}

export function pickRuntimeModel(config: AiConfig, preferred: string | undefined, options: { image?: boolean } = {}): string {
  const models = config.availableModels.length ? config.availableModels : defaultAiConfig.availableModels
  const normalizedPreferred = preferred ? normalizeModelId(config, preferred) : ''
  const scopedModels = options.image
    ? models.filter((model) => isImageModelId(model))
    : models.filter((model) => !isImageModelId(model))
  const candidates = scopedModels.length ? scopedModels : models
  const preferredInScope = Boolean(normalizedPreferred && candidates.includes(normalizedPreferred))

  if (normalizedPreferred && preferredInScope && isConfiguredRuntimeModel(config, normalizedPreferred, options)) {
    return normalizedPreferred
  }

  const configured = candidates.find((model) => isConfiguredRuntimeModel(config, model, options))
  if (configured) return configured

  if (normalizedPreferred && preferredInScope) return normalizedPreferred
  return candidates[0] ?? models[0] ?? defaultAiConfig.scenario.agent
}

function normalizeScenarioModels(config: AiConfig, models: string[]): ScenarioConfig {
  const agentModel = pickRuntimeModel({ ...config, availableModels: models }, config.scenario.agent)
  const writerModel = pickRuntimeModel({ ...config, availableModels: models }, config.scenario.agentWriter || agentModel)
  const reviewerModel = pickRuntimeModel({ ...config, availableModels: models }, config.scenario.agentReviewer || agentModel)
  const imageModel = pickRuntimeModel({ ...config, availableModels: models }, config.scenario.image, { image: true })

  return {
    writing: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.writing || writerModel),
    modification: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.modification || writerModel),
    summary: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.summary || agentModel),
    smartContext: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.smartContext || agentModel),
    agent: agentModel,
    agentPlanner: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.agentPlanner || agentModel),
    agentWriter: writerModel,
    agentPolisher: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.agentPolisher || writerModel),
    agentReviewer: reviewerModel,
    image: imageModel,
    imageEdit: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.imageEdit || imageModel, { image: true })
  }
}

function metadataForModel(config: AiConfig, modelId: string): ModelMetadata {
  return (
    config.modelMetadata[modelId] ??
    defaultAiConfig.modelMetadata[modelId] ?? {
      id: modelId,
      label: modelId,
      maxContextWindow: 64000,
      supportImage: isImageModelId(modelId),
      supportThinking: /deepseek|qwen|glm/i.test(modelId),
      priceTier: 'unknown',
      defaultTemperature: isImageModelId(modelId) ? 0.8 : 0.2
    }
  )
}

export function normalizeAiConfigForLocalRuntime(input: AiConfig): AiConfig {
  const migratedInput: AiConfig = {
    ...input,
    interfaces: migrateLegacyBrandInterfaces(input.interfaces),
    availableModels: (input.availableModels ?? []).map(migrateLegacyBrandModelId),
    modelMetadata: migrateLegacyBrandMetadata(input.modelMetadata),
    scenario: migrateLegacyBrandScenario(input.scenario) as ScenarioConfig
  }

  const merged: AiConfig = {
    ...defaultAiConfig,
    ...migratedInput,
    interfaces: {
      ...defaultAiConfig.interfaces,
      ...(migratedInput.interfaces ?? {})
    },
    modelMetadata: {
      ...defaultAiConfig.modelMetadata,
      ...(migratedInput.modelMetadata ?? {})
    },
    scenario: {
      ...defaultAiConfig.scenario,
      ...(migratedInput.scenario ?? {})
    }
  }
  merged.interfaces = normalizeProviderDefaultModels(merged.interfaces)
  delete merged.interfaces[LEGACY_BRAND_PROVIDER_ID]

  const normalizedListedModels = (merged.availableModels.length ? merged.availableModels : defaultAiConfig.availableModels)
    .map((model) => normalizeModelId(merged, model))
    .filter(Boolean)
  const availableModels = mergeModelIds([...normalizedListedModels, ...configuredProviderModelIds(merged)])
  const finalModels = availableModels.length ? availableModels : defaultAiConfig.availableModels

  const withModels: AiConfig = {
    ...merged,
    availableModels: finalModels,
    modelMetadata: Object.fromEntries(finalModels.map((model) => [model, metadataForModel(merged, model)]))
  }

  return {
    ...withModels,
    scenario: normalizeScenarioModels(withModels, finalModels)
  }
}
