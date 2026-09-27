import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import { globalLimiter } from './middleware/rateLimiter.js'
import { errorHandler } from './middleware/errorHandler.js'
import authRoutes from './routes/auth.js'
import categoryRoutes from './routes/categories.js'
import toolRoutes from './routes/tools.js'
import executeRoutes from './routes/execute.js'
import favoriteRoutes from './routes/favorites.js'
import userRoutes from './routes/users.js'
import creatorRoutes from './routes/creators.js'
import reviewRoutes from './routes/reviews.js'
import adminRoutes from './routes/admin.js'

const app = express()
app.use(helmet())
app.use(cors({
  origin: [env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))
if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'))
app.use(globalLimiter)
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))
app.use('/api/auth',       authRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/tools',      toolRoutes)
app.use('/api/execute',    executeRoutes)
app.use('/api/favorites',  favoriteRoutes)
app.use('/api/users',      userRoutes)
app.use('/api/creators',   creatorRoutes)
app.use('/api/reviews',    reviewRoutes)
app.use('/api/admin',      adminRoutes)
app.use('/{*path}', (req, res) => res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` }))
app.use(errorHandler)
export default app
