import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import authRoutes from './routes/auth.js'
import sessionRoutes from './routes/session.js'
import apiRoutes from './routes/api.js'
import { authenticateToken } from './middleware/auth.js'
import { createComponentLogger } from '../utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const logger = createComponentLogger('WEB_INTERFACE')

export class WebInterface {
  constructor() {
    this.router = express.Router()
    this.setupRoutes()
  }

  setupRoutes() {
    // Serve static files
    this.router.use('/assets', express.static(path.join(__dirname, 'public/assets')))
    this.router.use('/css', express.static(path.join(__dirname, 'public/css')))
    this.router.use('/js', express.static(path.join(__dirname, 'public/js')))
    // FIX: Add images static route
    this.router.use('/images', express.static(path.join(__dirname, 'public/images')))

    // Public pages
    this.router.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'views/login.html'))
    })

    this.router.get('/login', (req, res) => {
      res.sendFile(path.join(__dirname, 'views/login.html'))
    })

    this.router.get('/register', (req, res) => {
      res.sendFile(path.join(__dirname, 'views/register.html'))
    })

    // Protected pages
    this.router.get('/dashboard', authenticateToken, (req, res) => {
      res.sendFile(path.join(__dirname, 'views/dashboard.html'))
    })

    // API Routes
    this.router.use('/auth', authRoutes)
    this.router.use('/api/sessions', authenticateToken, sessionRoutes)
    this.router.use('/api', authenticateToken, apiRoutes)

    // 404 handler
    this.router.use((req, res) => {
      res.status(404).json({ error: 'Route not found' })
    })

    logger.info('Web interface routes configured')
  }
}

export default WebInterface