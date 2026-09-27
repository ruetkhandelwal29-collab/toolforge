import { z } from 'zod'
import dotenv from 'dotenv'
dotenv.config()

const envSchema = z.object({
  PORT:                      z.string().default('4000'),
  NODE_ENV:                  z.string().default('development'),
  FRONTEND_URL:              z.string().default('http://localhost:5173'),
  SUPABASE_URL:              z.string().min(1, 'SUPABASE_URL is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  SUPABASE_ANON_KEY:         z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  DATABASE_URL:              z.string().min(1, 'DATABASE_URL is required'),
  GEMINI_API_KEY:            z.string().min(1, 'GEMINI_API_KEY is required'),
  OPENAI_API_KEY:            z.string().optional(),
  PLATFORM_COMMISSION_RATE:  z.string().default('0.20'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('\u274c Invalid environment variables:')
  console.error(parsed.error.format())
  process.exit(1)
}

export const env = parsed.data
