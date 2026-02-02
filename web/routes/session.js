import express from 'express'
import { SessionController } from '../controllers/session-controller.js'
import { rateLimitMiddleware } from '../middleware/rate-limit.js'
import { createComponentLogger } from '../../utils/logger.js'

const router = express.Router()
const sessionController = new SessionController()
const logger = createComponentLogger('SESSION_ROUTES')

// Helper function to format time
const formatRetryTime = (seconds) => {
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`
  }
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`
}

// Get user's session status
router.get('/status', async (req, res) => {
  try {
    const userId = req.user.userId
    const status = await sessionController.getSessionStatus(userId)

    res.json({
      success: true,
      status
    })

  } catch (error) {
    logger.error('Get session status error:', error)
    res.status(500).json({ error: 'Failed to get session status' })
  }
})

// Create new WhatsApp session (5 requests per 5 minutes)
router.post('/create', rateLimitMiddleware(50, 300000, 'You can only create 50 sessions per 5 minutes.'), async (req, res) => {
  try {
    const userId = req.user.userId
    const { phoneNumber } = req.body

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' })
    }

    const result = await sessionController.createSession(userId, phoneNumber)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json({
      success: true,
      sessionId: result.sessionId,
      message: result.message
    })

  } catch (error) {
    logger.error('Create session error:', error)
    res.status(500).json({ error: 'Failed to create session' })
  }
})
// Get pairing code
router.get('/pairing-code', async (req, res) => {
  try {
    const userId = req.user.userId
    const pairingCode = await sessionController.getPairingCode(userId)

    if (!pairingCode) {
      return res.status(404).json({ error: 'No pairing code available' })
    }

    res.json({
      success: true,
      pairingCode
    })

  } catch (error) {
    logger.error('Get pairing code error:', error)
    res.status(500).json({ error: 'Failed to get pairing code' })
  }
})

// Disconnect session
router.post('/disconnect', async (req, res) => {
  try {
    const userId = req.user.userId
    const result = await sessionController.disconnectSession(userId)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json({
      success: true,
      message: 'Session disconnected successfully'
    })

  } catch (error) {
    logger.error('Disconnect session error:', error)
    res.status(500).json({ error: 'Failed to disconnect session' })
  }
})

// Get session statistics
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.userId
    const stats = await sessionController.getSessionStats(userId)

    res.json({
      success: true,
      stats
    })

  } catch (error) {
    logger.error('Get session stats error:', error)
    res.status(500).json({ error: 'Failed to get session stats' })
  }
})

// Reconnect session (10 requests per 5 minutes)
router.post('/reconnect', rateLimitMiddleware(50, 300000, 'You can only reconnect 50 times per 5 minutes.'), async (req, res) => {
  try {
    const userId = req.user.userId
    const result = await sessionController.reconnectSession(userId)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json({
      success: true,
      message: 'Reconnection initiated'
    })

  } catch (error) {
    logger.error('Reconnect session error:', error)
    res.status(500).json({ error: 'Failed to reconnect session' })
  }
})

export default router