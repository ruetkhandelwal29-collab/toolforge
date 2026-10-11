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
    const doCall = async () => {
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

    try {
      return await doCall()
    } catch (err) {
      const isNetworkErr = err.name === 'APIConnectionError' || err.message?.includes('fetch failed') || err.message?.includes('timeout')
      if (isNetworkErr) {
        console.warn('Gemini request encountered transient network issue, retrying in 1.5s…')
        await new Promise(r => setTimeout(r, 1500))
        return await doCall()
      }
      throw err
    }
  }
}
