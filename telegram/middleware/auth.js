import { pool } from '../../database/connection.js'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('AUTH_MIDDLEWARE')

/**
 * AuthMiddleware - User authentication and management
 */
export class AuthMiddleware {
  constructor() {
    this.userCache = new Map()
  }

  /**
   * Authenticate user (create if not exists)
   */
  async authenticateUser(telegramId, userInfo = null) {
    try {
      // Check cache first
      if (this.userCache.has(telegramId)) {
        return {
          isAuthenticated: true,
          isNewUser: false,
          user: this.userCache.get(telegramId)
        }
      }

      // Check database
      let user = await this._getUserFromDatabase(telegramId)

      if (!user) {
        // Create new user
        user = await this._createUser(telegramId, userInfo)
        logger.info(`New user created: ${telegramId}`)

        this.userCache.set(telegramId, user)

        return {
          isAuthenticated: true,
          isNewUser: true,
          user
        }
      }

      // Update user info if provided
      if (userInfo) {
        await this._updateUserInfo(telegramId, userInfo)
      }

      this.userCache.set(telegramId, user)

      return {
        isAuthenticated: true,
        isNewUser: false,
        user
      }

    } catch (error) {
      logger.error('Authentication error:', error)

      // Allow through even with DB errors
      return {
        isAuthenticated: true,
        isNewUser: true,
        error: error.message
      }
    }
  }

  /**
   * Get user from database
   * @private
   */
  async _getUserFromDatabase(telegramId) {
    try {
      const result = await pool.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [telegramId]
      )

      return result.rows[0] || null

    } catch (error) {
      logger.error('Database query error:', error)
      return null
    }
  }

  /**
   * Create new user
   * @private
   */
  async _createUser(telegramId, userInfo) {
    try {
      const result = await pool.query(
        `INSERT INTO users (telegram_id, first_name, username, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING *`,
        [
          telegramId,
          userInfo?.first_name || null,
          userInfo?.username || null
        ]
      )

      return result.rows[0]

    } catch (error) {
      logger.error('User creation error:', error)
      throw error
    }
  }

  /**
   * Update user info
   * @private
   */
  async _updateUserInfo(telegramId, userInfo) {
    try {
      await pool.query(
        `UPDATE users 
         SET first_name = $1, username = $2, updated_at = NOW()
         WHERE telegram_id = $3`,
        [
          userInfo.first_name || null,
          userInfo.username || null,
          telegramId
        ]
      )

    } catch (error) {
      logger.error('User update error:', error)
    }
  }

  /**
   * Get user by telegram ID
   */
  async getUser(telegramId) {
    try {
      if (this.userCache.has(telegramId)) {
        return this.userCache.get(telegramId)
      }

      const user = await this._getUserFromDatabase(telegramId)
      if (user) {
        this.userCache.set(telegramId, user)
      }

      return user

    } catch (error) {
      logger.error('Get user error:', error)
      return null
    }
  }

  /**
   * Check if user is connected
   */
  async isUserConnected(telegramId) {
    try {
      const result = await pool.query(
        'SELECT is_connected FROM users WHERE telegram_id = $1',
        [telegramId]
      )

      return result.rows[0]?.is_connected || false

    } catch (error) {
      logger.error('Connection check error:', error)
      return false
    }
  }

  /**
   * Update user connection status
   */
  async updateConnectionStatus(telegramId, isConnected, phoneNumber = null) {
    try {
      await pool.query(
        `UPDATE users 
         SET is_connected = $1, 
             phone_number = COALESCE($2, phone_number),
             connection_status = $3,
             updated_at = NOW()
         WHERE telegram_id = $4`,
        [
          isConnected,
          phoneNumber,
          isConnected ? 'connected' : 'disconnected',
          telegramId
        ]
      )

      // Update cache
      if (this.userCache.has(telegramId)) {
        const user = this.userCache.get(telegramId)
        user.is_connected = isConnected
        user.phone_number = phoneNumber || user.phone_number
        user.connection_status = isConnected ? 'connected' : 'disconnected'
      }

    } catch (error) {
      logger.error('Update connection status error:', error)
    }
  }

  /**
   * Clear user cache
   */
  clearCache(telegramId = null) {
    if (telegramId) {
      this.userCache.delete(telegramId)
    } else {
      this.userCache.clear()
    }
  }
}