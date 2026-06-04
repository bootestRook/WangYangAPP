import type { AiConfig, ModelInterfaceConfig, ModelMetadata, ScenarioConfig } from '../../shared/types'

export const BUILTIN_INTERFACE: ModelInterfaceConfig = {
  id: 'wangyang',
  label: '王阳云',
  apiUrl: 'https://llm.wangyang.local',
  apiKey: '',
  isBuiltIn: true,
  requestFormat: 'openai',
  defaultModel: 'deepseek'
}

export const providerPresets: ModelInterfaceConfig[] = [
  BUILTIN_INTERFACE,
  {
    id: 'openai',
    label: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    requestFormat: 'openai',
    defaultModel: 'gpt-4o-mini'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    requestFormat: 'openai',
    defaultModel: 'deepseek-chat'
  },
  {
    id: 'dashscope',
    label: 'DashScope',
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    requestFormat: 'openai',
    defaultModel: 'qwen-plus-latest'
  },
  {
    id: 'kimi',
    label: 'Kimi',
    apiUrl: 'https://api.kimi.com/v1',
    apiKey: '',
    requestFormat: 'openai',
    defaultModel: 'kimi-latest'
  },
  {
    id: 'bigmodel',
    label: 'BigModel',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    requestFormat: 'openai',
    defaultModel: 'glm-4-flash'
  },
  {
    id: 'volcengine',
    label: 'Volcengine Ark',
    apiUrl: 'https://ark.cn-beijing.volces.com/api/paas/v4',
    apiKey: '',
    requestFormat: 'openai',
    defaultModel: ''
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    apiUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    requestFormat: 'claude',
    defaultModel: 'claude-sonnet-4-5'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    apiUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    requestFormat: 'openai',
    defaultModel: 'openai/gpt-4o-mini'
  },
  {
    id: 'aihubmix',
    label: 'AiHubMix',
    apiUrl: 'https://aihubmix.com/v1',
    apiKey: '',
    requestFormat: 'openai',
    defaultModel: 'gpt-4o-mini',
    defaultHeaders: {
      'APP-Code': 'LHON5516'
    }
  }
]

export const defaultAvailableModels = [
  'wangyang/auto',
  'wangyang/deepseek',
  'wangyang/qwen3.5-plus',
  'wangyang/kimi',
  'wangyang/GLM-latest',
  'wangyang/GLM-5',
  'wangyang/qwen3.5-flash',
  'wangyang/qwen-max-latest',
  'wangyang/qwen-plus-latest',
  'wangyang/qwen-flash-latest',
  'wangyang/GLM-Flash',
  'wangyang/deepseek-v3.2',
  'wangyang/wan-t2i',
  'wangyang/qwen-image-edit-plus',
  'openai/gpt-4o-mini',
  'deepseek/deepseek-chat'
]

export const defaultScenarioConfig: ScenarioConfig = {
  writing: 'wangyang/deepseek',
  modification: 'wangyang/deepseek',
  summary: 'wangyang/qwen-flash-latest',
  smartContext: 'wangyang/qwen-plus-latest',
  agent: 'wangyang/deepseek',
  agentPlanner: 'wangyang/deepseek',
  agentWriter: 'wangyang/deepseek',
  agentPolisher: 'wangyang/deepseek',
  agentReviewer: 'wangyang/deepseek',
  image: 'wangyang/wan-t2i',
  imageEdit: 'wangyang/qwen-image-edit-plus'
}

export const defaultModelMetadata: Record<string, ModelMetadata> = Object.fromEntries(
  defaultAvailableModels.map((modelId) => {
    const isImageModel = modelId.includes('wan-t2i') || modelId.includes('image')
    const isVisionCapable = isImageModel || modelId.includes('gpt-4o')
    const isDeprecated = modelId.includes('qwen3.5') || modelId.includes('GLM-latest')
    const contextWindow = modelId.includes('flash')
      ? 32000
      : modelId.includes('gpt-4o')
        ? 128000
        : modelId.includes('qwen-max') || modelId.includes('qwen-plus')
          ? 128000
          : 64000
    return [
      modelId,
      {
        id: modelId,
        label: modelId,
        maxContextWindow: contextWindow,
        supportImage: isVisionCapable,
        supportThinking: modelId.includes('deepseek') || modelId.includes('qwen') || modelId.includes('GLM'),
        priceTier: isImageModel ? 'medium' : modelId.includes('flash') ? 'low' : 'unknown',
        deprecated: isDeprecated,
        defaultTemperature: isImageModel ? 0.8 : modelId.includes('writer') ? 0.7 : 0.2
      } satisfies ModelMetadata
    ]
  })
)

export const defaultAiConfig: AiConfig = {
  interfaces: Object.fromEntries(providerPresets.map((provider) => [provider.id, provider])),
  availableModels: defaultAvailableModels,
  modelMetadata: defaultModelMetadata,
  scenario: defaultScenarioConfig
}
