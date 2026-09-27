import { GeminiProvider } from './GeminiProvider.js'
import { OpenAIProvider } from './OpenAIProvider.js'

const REGISTRY = {
  gemini: GeminiProvider,
  openai: OpenAIProvider,
}

export function getProvider(providerName) {
  const Provider = REGISTRY[providerName]
  if (!Provider) {
    throw new Error(`Unknown AI provider: "${providerName}". Available: ${Object.keys(REGISTRY).join(', ')}`)
  }
  return new Provider()
}

export function registerProvider(name, ProviderClass) {
  REGISTRY[name] = ProviderClass
}

export function listProviders() {
  return Object.keys(REGISTRY)
}
