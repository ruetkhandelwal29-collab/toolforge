import { env } from '../config/env.js'

export function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err)
  const status = err.status ?? err.statusCode ?? 500
  const message = env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : err.message ?? 'Internal server error'
  res.status(status).json({ error: message })
}
