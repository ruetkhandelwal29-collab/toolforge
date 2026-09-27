import { AIProviderBase } from './AIProviderBase.js'

export class OpenAIProvider extends AIProviderBase {
  get name() { return 'openai' }
  async run({ model, prompt, config = {} }) {
    throw new Error('OpenAI provider is not yet configured. Coming soon.')
  }
}
