import { query } from '../config/database.js'
import { getProvider } from './ai/ProviderRegistry.js'
import { creditService } from './CreditService.js'
import { z } from 'zod'

export function renderPrompt(template, inputs = {}, inputSchema = []) {
  if (!template || typeof template !== 'string') return ''

  const consumedKeys = new Set()
  const schemaMap = new Map((inputSchema || []).map(f => [f.name, f]))

  // 1. Replace double curly braces: {{ key }} or {{key}}
  let rendered = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    if (inputs[key] !== undefined && inputs[key] !== null && String(inputs[key]).trim() !== '') {
      consumedKeys.add(key)
      return String(inputs[key]).trim()
    }
    const field = schemaMap.get(key)
    if (field?.default !== undefined && field?.default !== null && String(field.default).trim() !== '') {
      consumedKeys.add(key)
      return String(field.default).trim()
    }
    // Omit unresolved placeholder so raw template syntax does not reach the AI provider
    return ''
  })

  // 2. Replace single curly braces if they match a known declared schema field or provided input: {key}
  rendered = rendered.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (schemaMap.has(key) || inputs[key] !== undefined) {
      if (inputs[key] !== undefined && inputs[key] !== null && String(inputs[key]).trim() !== '') {
        consumedKeys.add(key)
        return String(inputs[key]).trim()
      }
      const field = schemaMap.get(key)
      if (field?.default !== undefined && field?.default !== null && String(field.default).trim() !== '') {
        consumedKeys.add(key)
        return String(field.default).trim()
      }
      return ''
    }
    return match
  })

  // 3. Guarantee that every declared input field (or submitted input) that was NOT
  // consumed in the template placeholders is still provided to the AI provider.
  const unconsumedInputs = []

  // First check declared schema fields
  for (const field of inputSchema || []) {
    const key = field.name
    if (!consumedKeys.has(key) && inputs[key] !== undefined && inputs[key] !== null && String(inputs[key]).trim() !== '') {
      const label = field.label || key
      unconsumedInputs.push(`${label}: ${String(inputs[key]).trim()}`)
      consumedKeys.add(key)
    }
  }

  // Also include any extra inputs passed
  for (const [key, val] of Object.entries(inputs)) {
    if (!consumedKeys.has(key) && val !== undefined && val !== null && String(val).trim() !== '') {
      unconsumedInputs.push(`${key}: ${String(val).trim()}`)
      consumedKeys.add(key)
    }
  }

  if (unconsumedInputs.length > 0) {
    rendered = rendered.trim() + '\n\nUser Inputs:\n' + unconsumedInputs.map(item => `- ${item}`).join('\n')
  }

  return rendered.trim()
}

export function validateInputs(inputSchema = [], rawInputs = {}) {
  const shape = {}
  for (const field of inputSchema) {
    let validator
    if (field.type === 'number') {
      validator = z.coerce.number()
    } else if (field.type === 'boolean') {
      validator = z.boolean().default(false)
    } else if (field.type === 'select' && Array.isArray(field.options) && field.options.length > 0) {
      validator = z.enum(field.options, {
        errorMap: () => ({ message: `Invalid option for ${field.label || field.name}. Allowed: ${field.options.join(', ')}` })
      })
    } else {
      validator = z.string()
      if (field.required) {
        validator = validator.trim().min(1, `${field.label || field.name} is required`)
      } else {
        validator = validator.optional().or(z.literal(''))
      }
    }

    if (!field.required && field.type !== 'boolean') {
      validator = validator.optional()
    }
    shape[field.name] = validator
  }
  return z.object(shape).safeParse(rawInputs || {})
}

export class ToolExecutor {
  async execute(toolId, userId, rawInputs) {
    const toolResult = await query(
      `SELECT t.*, c.name AS category_name, p.username AS creator_username
       FROM tools t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN profiles p ON p.id = t.creator_id
       WHERE t.id = $1 AND t.is_published = TRUE AND t.is_approved = TRUE AND (p.is_active IS NULL OR p.is_active = TRUE)`,
      [toolId]
    )
    if (toolResult.rows.length === 0) {
      const err = new Error('Tool not found or not available')
      err.status = 404
      throw err
    }
    const tool = toolResult.rows[0]

    const schema = tool.input_schema ?? []
    const validation = validateInputs(schema, rawInputs)
    if (!validation.success) {
      const err = new Error('Invalid inputs: ' + (validation.error.issues ?? []).map(e => e.message).join(', '))
      err.status = 422
      throw err
    }
    const inputs = validation.data

    // Credit requirement check and atomic deduction
    const isPaid = tool.pricing_type === 'credits' || tool.pricing_type === 'paid'
    const creditCost = isPaid ? Math.max(Number(tool.credits_per_run) || 1, 1) : 0

    let creditDeduction = null
    if (creditCost > 0) {
      // Deduct credits BEFORE executing AI call. Throws 402 if insufficient.
      creditDeduction = await creditService.deductCredits(userId, creditCost, {
        toolId,
        creatorId: tool.creator_id,
      })
    }

    const prompt = renderPrompt(tool.prompt_template, inputs, schema)

    const runInsert = await query(
      `INSERT INTO tool_runs (tool_id, user_id, inputs, status, provider, model)
       VALUES ($1, $2, $3, 'running', $4, $5) RETURNING id`,
      [toolId, userId, JSON.stringify(inputs), tool.provider, tool.model]
    )
    const runId = runInsert.rows[0].id

    // Associate transaction with the created tool run
    if (creditDeduction?.transactionId) {
      await query(
        'UPDATE transactions SET tool_run_id = $1 WHERE id = $2',
        [runId, creditDeduction.transactionId]
      )
    }

    const start = Date.now()

    try {
      const provider = getProvider(tool.provider)
      const result = await provider.run({ model: tool.model, prompt, config: tool.config ?? {} })
      const duration = Date.now() - start
      const output = { text: result.text, image: result.image }

      await query(
        `UPDATE tool_runs SET status = 'completed', outputs = $1, tokens_used = $2, duration_ms = $3 WHERE id = $4`,
        [JSON.stringify(output), result.tokens_used ?? 0, duration, runId]
      )
      await query('UPDATE tools SET run_count = run_count + 1 WHERE id = $1', [toolId])

      return {
        runId,
        output: result.text || result.image,
        tokensUsed: result.tokens_used,
        creditsCharged: creditCost,
        remainingCredits: creditDeduction?.newBalance,
      }
    } catch (err) {
      await query(`UPDATE tool_runs SET status = 'failed', error_msg = $1 WHERE id = $2`, [err.message, runId])

      // Automatic refund on execution failure
      if (creditCost > 0) {
        await creditService.refundCredits(userId, creditCost, {
          toolId,
          toolRunId: runId,
          reason: err.message,
        })
      }

      throw err
    }
  }
}
