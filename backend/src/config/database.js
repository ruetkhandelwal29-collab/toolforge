import pg from 'pg'
import { env } from './env.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL; free tier cert may not match
  max: 5,                  // Low cap — Supabase transaction pooler multiplexes; large local pools waste quota
  idleTimeoutMillis: 10000, // Release idle connections after 10 s (before Supabase drops them at ~30 s)
  connectionTimeoutMillis: 8000,
})

pool.on('error', (err) => {
  // Suppress noisy "terminated unexpectedly" events — they're handled per-query via retry
  if (!err.message?.includes('terminated')) {
    console.error('Unexpected PG pool error:', err.message)
  }
})

/**
 * Execute a SQL query. On first connection-drop error, releases the broken
 * client back to the pool and retries once with a fresh connection.
 */
export async function query(text, params) {
  const start = Date.now()
  try {
    const res = await pool.query(text, params)
    const duration = Date.now() - start
    if (env.NODE_ENV === 'development') {
      console.log('DB query:', { text: text.substring(0, 60), duration, rows: res.rowCount })
    }
    return res
  } catch (err) {
    const isConnectionDrop =
      err.message?.includes('terminated') ||
      err.message?.includes('ECONNRESET') ||
      err.code === 'ECONNRESET'

    if (isConnectionDrop) {
      // One automatic retry with a fresh pool connection
      if (env.NODE_ENV === 'development') {
        console.warn('DB connection dropped — retrying query once…')
      }
      const res = await pool.query(text, params)
      const duration = Date.now() - start
      if (env.NODE_ENV === 'development') {
        console.log('DB query (retry ok):', { text: text.substring(0, 60), duration, rows: res.rowCount })
      }
      return res
    }
    throw err
  }
}

export async function getClient() {
  return pool.connect()
}

