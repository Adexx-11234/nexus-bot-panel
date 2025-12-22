import express from 'express'
import { AuthController } from '../controllers/auth-controller.js'
import { authRateLimit } from '../middleware/rate-limit.js'
import { createComponentLogger } from '../../utils/logger.js'

const router = express.Router()
const authController = new AuthController()
const logger = createComponentLogger('AUTH_ROUTES')

// Register new web user
router.post('/register', authRateLimit, async (req, res) => {
  try {
    const { phoneNumber, password, firstName } = req.body

    if (!phoneNumber || !password) {
      return res.status(400).json({ error: 'Phone number and password are required' })
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    const result = await authController.register(phoneNumber, password, firstName)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    // Set auth cookie
    res.cookie('auth_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'strict'
    })

    res.json({
      success: true,
      token: result.token,
      user: result.user
    })

  } catch (error) {
    logger.error('Registration error:', error)
    res.status(500).json({ error: 'Registration failed' })
  }
})

// Login existing web user
router.post('/login', authRateLimit, async (req, res) => {
  try {
    const { phoneNumber, password } = req.body

    if (!phoneNumber || !password) {
      return res.status(400).json({ error: 'Phone number and password are required' })
    }

    const result = await authController.login(phoneNumber, password)

    if (!result.success) {
      return res.status(401).json({ error: result.error })
    }

    // Set auth cookie
    res.cookie('auth_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'strict'
    })

    res.json({
      success: true,
      token: result.token,
      user: result.user
    })

  } catch (error) {
    logger.error('Login error:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('auth_token')
  res.json({ success: true, message: 'Logged out successfully' })
})

// Verify token
router.get('/verify', async (req, res) => {
  try {
    const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const result = await authController.verifyToken(token)

    if (!result.success) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    res.json({
      success: true,
      user: result.user
    })

  } catch (error) {
    logger.error('Token verification error:', error)
    res.status(500).json({ error: 'Verification failed' })
  }
})

export default router