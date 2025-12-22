import express from 'express'
import { SessionController } from '../controllers/session-controller.js'
import { AuthController } from '../controllers/auth-controller.js'
import { createComponentLogger } from '../../utils/logger.js'

const router = express.Router()
const sessionController = new SessionController()
const authController = new AuthController()
const logger = createComponentLogger('API_ROUTES')

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const userId = req.user.userId
    const profile = await authController.getUserProfile(userId)

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' })
    }

    res.json({
      success: true,
      profile
    })

  } catch (error) {
    logger.error('Get profile error:', error)
    res.status(500).json({ error: 'Failed to get profile' })
  }
})

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const userId = req.user.userId
    const { firstName } = req.body

    const result = await authController.updateProfile(userId, { firstName })

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json({
      success: true,
      profile: result.profile
    })

  } catch (error) {
    logger.error('Update profile error:', error)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// Change password
router.post('/change-password', async (req, res) => {
  try {
    const userId = req.user.userId
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' })
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' })
    }

    const result = await authController.changePassword(userId, currentPassword, newPassword)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json({
      success: true,
      message: 'Password changed successfully'
    })

  } catch (error) {
    logger.error('Change password error:', error)
    res.status(500).json({ error: 'Failed to change password' })
  }
})

// Get system statistics (admin only or own stats)
router.get('/system-stats', async (req, res) => {
  try {
    const userId = req.user.userId
    const stats = await sessionController.getSystemStats(userId)

    res.json({
      success: true,
      stats
    })

  } catch (error) {
    logger.error('Get system stats error:', error)
    res.status(500).json({ error: 'Failed to get system stats' })
  }
})

export default router