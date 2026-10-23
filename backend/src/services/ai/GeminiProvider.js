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
    const doCall = async (targetModel) => {
      const interaction = await this._client.interactions.create({
        model: targetModel,
        input: prompt,
        store: false,
      })
      return {
        text: interaction.output_text ?? '',
        tokens_used: interaction.usage?.total_tokens ?? 0,
      }
    }

    const requestedModel = model || 'gemini-3.8-flash'
    try {
      return await doCall(requestedModel)
    } catch (err) {
      const is503OrHighDemand =
        err.status === 503 ||
        err.statusCode === 503 ||
        err.message?.includes('503') ||
        err.message?.includes('high demand') ||
        err.message?.includes('UNAVAILABLE') ||
        err.message?.includes('overloaded')
      if (is503OrHighDemand && requestedModel !== 'gemini-3.5-flash-lite') {
        console.warn(`Gemini model "${requestedModel}" experiencing high demand (503). Retrying with gemini-3.5-flash-lite…`)
        return await doCall('gemini-3.5-flash-lite')
      }
      const isNetworkErr = err.name === 'APIConnectionError' || err.message?.includes('fetch failed') || err.message?.includes('timeout')
      if (isNetworkErr) {
        console.warn('Gemini request encountered transient network issue, retrying in 1.5s…')
        await new Promise(r => setTimeout(r, 1500))
        return await doCall(requestedModel)
      }
      throw err
    }
  }
}
