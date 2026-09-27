import { GoogleGenAI } from '@google/genai'
import { AIProviderBase } from './AIProviderBase.js'
import { env } from '../../config/env.js'

export class GeminiProvider extends AIProviderBase {
  constructor() {
    super()
    this._client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY })
  }
  get name() { return 'gemini' }
  async run({ model, prompt, config = {} }) {
    const interaction = await this._client.interactions.create({
      model: model || 'gemini-3.8-flash',
      input: prompt,
      store: false,
    })
    return {
      text: interaction.output_text ?? '',
      tokens_used: interaction.usage?.total_tokens ?? 0,
    }
  }
}
