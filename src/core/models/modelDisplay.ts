const brandedProviderPattern = /^(?:wangyang|feelfish)(?=\/|$)/i
const brandedProviderInputPattern = /^王阳(?=\/|$)/

export function displayProviderId(providerId: string): string {
  return brandedProviderPattern.test(providerId) ? '王阳' : providerId
}

export function displayModelId(modelId: string): string {
  return modelId.replace(brandedProviderPattern, '王阳')
}

export function storageModelId(modelId: string): string {
  return modelId.trim().replace(brandedProviderInputPattern, 'wangyang').replace(brandedProviderPattern, 'wangyang')
}
