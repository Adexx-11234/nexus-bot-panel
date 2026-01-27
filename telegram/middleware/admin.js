import { pool } from '../../config/database.js'
import { createComponentLogger } from '../../utils/logger.js'
import bcrypt from 'bcryptjs'
import dotenv from "dotenv"
dotenv.config()
const logger = createComponentLogger('ADMIN_MIDDLEWARE')

/**
 * AdminMiddleware - Admin verification and management
 */
export class AdminMiddleware {
  constructor() {
    this.adminCache = new Set()
    this.defaultAdminId = process.env.DEFAULT_ADMIN_ID
    this.adminSessions = new Map() // userId -> { createdAt, expiresAt }
    this.failedAttempts = new Map() // userId -> { count, lockedUntil }
    this.sessionTimeout = 30 * 60 * 1000 // 30 minutes
    this.lockoutDuration = 15 * 60 * 1000 // 15 minutes
    this.maxAttempts = 3
  }

  /**
   * Initialize default admin on startup
   */
  async initializeDefaultAdmin() {
    if (!this.defaultAdminId) {
      logger.warn('No DEFAULT_ADMIN_ID set in environment')
      return
    }

    try {
      const result = await pool.query(
        'SELECT is_admin FROM users WHERE telegram_id = $1',
        [this.defaultAdminId]
      )

      if (result.rows.length > 0) {
        if (!result.rows[0].is_admin) {
          await pool.query(
            'UPDATE users SET is_admin = true, updated_at = NOW() WHERE telegram_id = $1',
            [this.defaultAdminId]
          )
          logger.info(`Default admin ${this.defaultAdminId} updated`)
        }
      } else {
        logger.info(`Default admin ${this.defaultAdminId} not yet registered`)
      }

      this.adminCache.add(this.defaultAdminId)
    } catch (error) {
      logger.error('Error initializing default admin:', error)
    }
  }

  /**
   * Check if user is admin
   */
  async isAdmin(telegramId) {
    try {
      // Check default admin
      if (this.isDefaultAdmin(telegramId)) {
        return true
      }

      // Check cache
      if (this.adminCache.has(telegramId)) {
        return true
      }

      // Check database
      const result = await pool.query(
        'SELECT is_admin FROM users WHERE telegram_id = $1 AND is_admin = true',
        [telegramId]
      )

      const isAdmin = result.rows.length > 0

      if (isAdmin) {
        this.adminCache.add(telegramId)
      }

      return isAdmin

    } catch (error) {
      logger.error('Admin check error:', error)
      return false
    }
  }

  /**
   * Check if user is default admin
   */
  isDefaultAdmin(telegramId) {
    return String(this.defaultAdminId) === String(telegramId)
  }

  /**
   * Create admin session
   */
  createAdminSession(userId) {
    const now = Date.now()
    this.adminSessions.set(userId, {
      createdAt: now,
      expiresAt: now + this.sessionTimeout
    })
    logger.info(`Admin session created for user ${userId}`)
  }

  /**
   * Check if admin session is active
   */
  isAdminSessionActive(userId) {
    const session = this.adminSessions.get(userId)
    if (!session) return false

    if (Date.now() > session.expiresAt) {
      this.adminSessions.delete(userId)
      return false
    }

    // Extend session
    session.expiresAt = Date.now() + this.sessionTimeout
    return true
  }

  /**
   * Destroy admin session
   */
  destroyAdminSession(userId) {
    this.adminSessions.delete(userId)
    logger.info(`Admin session destroyed for user ${userId}`)
  }

  /**
   * Verify admin password
   */
  async verifyAdminPassword(userId, password) {
    try {
      const result = await pool.query(
        'SELECT admin_password FROM users WHERE telegram_id = $1 AND is_admin = true',
        [userId]
      )

      if (result.rows.length === 0) {
        return false
      }

      const hashedPassword = result.rows[0].admin_password
      if (!hashedPassword) {
        // No password set, check if it's default admin with env password
        if (this.isDefaultAdmin(userId) && process.env.ADMIN_PASSWORD) {
          return password === process.env.ADMIN_PASSWORD
        }
        return false
      }

      return await bcrypt.compare(password, hashedPassword)
    } catch (error) {
      logger.error('Password verification error:', error)
      return false
    }
  }

  /**
   * Record failed login attempt
   */
  recordFailedAttempt(userId) {
    const attempts = this.failedAttempts.get(userId) || { count: 0, lockedUntil: null }
    attempts.count++

    if (attempts.count >= this.maxAttempts) {
      attempts.lockedUntil = Date.now() + this.lockoutDuration
      attempts.count = 0
      this.failedAttempts.set(userId, attempts)
      logger.warn(`User ${userId} locked out after ${this.maxAttempts} failed attempts`)
      return { locked: true, attemptsLeft: 0 }
    }

    this.failedAttempts.set(userId, attempts)
    const attemptsLeft = this.maxAttempts - attempts.count
    return { locked: false, attemptsLeft }
  }

  /**
   * Check if user is locked out
   */
  isLockedOut(userId) {
    const attempts = this.failedAttempts.get(userId)
    if (!attempts || !attempts.lockedUntil) return false

    if (Date.now() < attempts.lockedUntil) {
      return true
    }

    // Lockout expired
    this.failedAttempts.delete(userId)
    return false
  }

  /**
   * Require admin with session check
   */
  async requireAdmin(userId) {
    if (this.isLockedOut(userId)) {
      return { authorized: false, reason: 'locked_out' }
    }

    const isAdmin = await this.isAdmin(userId)
    if (!isAdmin) {
      return { authorized: false, reason: 'not_admin' }
    }

    if (!this.isAdminSessionActive(userId)) {
      return { authorized: false, reason: 'session_expired' }
    }

    return { authorized: true }
  }

  /**
   * Create a new admin
   */
  async createAdmin(targetTelegramId, creatorId, password) {
    try {
      // Verify creator is default admin
      if (!this.isDefaultAdmin(creatorId)) {
        throw new Error('Only default admin can create admins')
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10)

      // Update user
      const result = await pool.query(
        `UPDATE users 
         SET is_admin = true, admin_password = $1, updated_at = NOW() 
         WHERE telegram_id = $2 
         RETURNING telegram_id, first_name, username`,
        [hashedPassword, targetTelegramId]
      )

      if (result.rows.length === 0) {
        throw new Error('User not found')
      }

      this.adminCache.add(targetTelegramId)
      logger.info(`New admin created: ${targetTelegramId} by ${creatorId}`)

      return { success: true, user: result.rows[0] }
    } catch (error) {
      logger.error('Create admin error:', error)
      throw error
    }
  }

  /**
   * Remove admin
   */
  async removeAdmin(identifier) {
    try {
      let telegramId = identifier

      // If username provided
      if (identifier.startsWith('@')) {
        const username = identifier.substring(1)
        const result = await pool.query(
          'SELECT telegram_id FROM users WHERE username = $1',
          [username]
        )
        if (result.rows.length === 0) {
          return { success: false, message: 'User not found' }
        }
        telegramId = result.rows[0].telegram_id
      }

      // Prevent removing default admin
      if (this.isDefaultAdmin(telegramId)) {
        return { success: false, message: 'Cannot remove default admin' }
      }

      // Remove admin status
      await pool.query(
        `UPDATE users 
         SET is_admin = false, admin_password = NULL, updated_at = NOW() 
         WHERE telegram_id = $1`,
        [telegramId]
      )

      this.adminCache.delete(telegramId)
      this.destroyAdminSession(telegramId)
      logger.info(`Admin removed: ${telegramId}`)

      return { success: true, message: 'Admin removed successfully' }
    } catch (error) {
      logger.error('Remove admin error:', error)
      return { success: false, message: 'Failed to remove admin' }
    }
  }

  /**
   * Get all admins
   */
  async getAllAdmins() {
    try {
      const result = await pool.query(
        `SELECT telegram_id, first_name, username, created_at 
         FROM users 
         WHERE is_admin = true 
         ORDER BY created_at ASC`
      )

      return result.rows.map(admin => ({
        ...admin,
        isDefault: this.isDefaultAdmin(admin.telegram_id)
      }))
    } catch (error) {
      logger.error('Get admins error:', error)
      return []
    }
  }

  /**
   * Get system health
   */
  async getSystemHealth() {
    try {
      const dbCheck = await pool.query('SELECT NOW()')
      const uptime = process.uptime()
      const memory = process.memoryUsage()

      return {
        status: 'healthy',
        database: dbCheck.rows.length > 0 ? 'connected' : 'disconnected',
        uptime: Math.floor(uptime),
        memory: {
          rss: Math.round(memory.rss / 1024 / 1024),
          heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memory.heapTotal / 1024 / 1024)
        },
        activeSessions: this.adminSessions.size
      }
    } catch (error) {
      logger.error('Health check error:', error)
      return {
        status: 'unhealthy',
        error: error.message
      }
    }
  }

  /**
   * Disconnect all users
   */
  async disconnectAllUsers(updateDatabase = false) {
    try {
      if (updateDatabase) {
        const result = await pool.query(
          `UPDATE users 
           SET is_connected = false, updated_at = NOW() 
           WHERE is_connected = true 
           RETURNING telegram_id`
        )
        logger.info(`Disconnected ${result.rows.length} users from database`)
        return { success: true, count: result.rows.length }
      }
      return { success: true, count: 0 }
    } catch (error) {
      logger.error('Disconnect all error:', error)
      throw error
    }
  }

  /**
   * Disconnect specific user
   */
  async disconnectSpecificUser(identifier) {
    try {
      let telegramId = identifier

      // If username provided
      if (identifier.startsWith('@')) {
        const username = identifier.substring(1)
        const result = await pool.query(
          'SELECT telegram_id FROM users WHERE username = $1',
          [username]
        )
        if (result.rows.length === 0) {
          return { success: false, message: 'User not found' }
        }
        telegramId = result.rows[0].telegram_id
      }

      await pool.query(
        `UPDATE users 
         SET is_connected = false, updated_at = NOW() 
         WHERE telegram_id = $1`,
        [telegramId]
      )

      logger.info(`User ${telegramId} disconnected`)
      return { success: true, message: 'User disconnected successfully' }
    } catch (error) {
      logger.error('Disconnect user error:', error)
      return { success: false, message: 'Failed to disconnect user' }
    }
  }

  /**
   * Set user as admin
   */
  async setAdmin(telegramId, isAdmin = true) {
    try {
      await pool.query(
        'UPDATE users SET is_admin = $1, updated_at = NOW() WHERE telegram_id = $2',
        [isAdmin, telegramId]
      )

      if (isAdmin) {
        this.adminCache.add(telegramId)
      } else {
        this.adminCache.delete(telegramId)
      }

      logger.info(`User ${telegramId} admin status set to: ${isAdmin}`)
      return true

    } catch (error) {
      logger.error('Set admin error:', error)
      return false
    }
  }

  /**
   * Clear admin cache
   */
  clearCache() {
    this.adminCache.clear()
  }
}