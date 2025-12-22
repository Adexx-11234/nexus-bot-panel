import express from 'express'
import { SessionController } from '../controllers/session-controller.js'
import { rateLimitMiddleware } from '../middleware/rate-limit.js'
import { createComponentLogger } from '../../utils/logger.js'

const router = express.Router()
const sessionController = new SessionController()
const logger = createComponentLogger('SESSION_ROUTES')

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

// Create new WhatsApp session
router.post('/create', rateLimitMiddleware(5, 300000), async (req, res) => {
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

// Reconnect session
router.post('/reconnect', rateLimitMiddleware(10, 300000), async (req, res) => {
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