import { pool } from '../../config/database.js'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('USER_SERVICE')

export class UserService {
  constructor() {
    this.pool = pool
  }

  async createWebUser({ phoneNumber, passwordHash, firstName = null }) {
    const client = await this.pool.connect()
    
    try {
      await client.query('BEGIN')

      // Generate unique numeric ID for web users (simple incrementing numbers)
      const userId = await this._generateWebUserId()

      // Insert user
      const userResult = await client.query(`
        INSERT INTO users (
          telegram_id, phone_number, first_name, source, 
          is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, 'web', true, NOW(), NOW())
        RETURNING *
      `, [userId, phoneNumber, firstName])

      const user = userResult.rows[0]

      // Insert auth credentials
      await client.query(`
        INSERT INTO web_users_auth (user_id, password_hash, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
      `, [user.id, passwordHash])

      await client.query('COMMIT')

      logger.info(`Web user created: ${user.id} (telegram_id: ${userId}, phone: ${phoneNumber})`)

      return {
        id: user.id,
        telegramId: user.telegram_id,
        phoneNumber: user.phone_number,
        firstName: user.first_name,
        source: user.source,
        isConnected: user.is_connected,
        connectionStatus: user.connection_status,
        createdAt: user.created_at
      }

    } catch (error) {
      await client.query('ROLLBACK')
      logger.error('Create web user error:', error)
      return null
    } finally {
      client.release()
    }
  }

  async getUserByPhone(phoneNumber) {
    try {
      const result = await this.pool.query(`
        SELECT * FROM users 
        WHERE phone_number = $1 AND source = 'web'
        LIMIT 1
      `, [phoneNumber])

      if (result.rows.length === 0) {
        return null
      }

      const user = result.rows[0]

      return {
        id: user.id,
        telegramId: user.telegram_id,
        phoneNumber: user.phone_number,
        firstName: user.first_name,
        username: user.username,
        sessionId: user.session_id,
        isConnected: user.is_connected,
        connectionStatus: user.connection_status,
        source: user.source,
        isActive: user.is_active,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      }

    } catch (error) {
      logger.error('Get user by phone error:', error)
      return null
    }
  }

  async getUserById(userId) {
    try {
      const result = await this.pool.query(`
        SELECT * FROM users WHERE id = $1
      `, [userId])

      if (result.rows.length === 0) {
        return null
      }

      const user = result.rows[0]

      return {
        id: user.id,
        telegramId: user.telegram_id,
        phoneNumber: user.phone_number,
        firstName: user.first_name,
        username: user.username,
        sessionId: user.session_id,
        isConnected: user.is_connected,
        connectionStatus: user.connection_status,
        reconnectAttempts: user.reconnect_attempts,
        source: user.source,
        isActive: user.is_active,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      }

    } catch (error) {
      logger.error('Get user by ID error:', error)
      return null
    }
  }

  async getUserAuth(userId) {
    try {
      const result = await this.pool.query(`
        SELECT password_hash, created_at, updated_at 
        FROM web_users_auth 
        WHERE user_id = $1
      `, [userId])

      if (result.rows.length === 0) {
        return null
      }

      return {
        passwordHash: result.rows[0].password_hash,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at
      }

    } catch (error) {
      logger.error('Get user auth error:', error)
      return null
    }
  }

  async updateUser(userId, updates) {
    try {
      const allowedFields = ['first_name', 'phone_number', 'username']
      const setParts = []
      const values = [userId]
      let paramIndex = 2

      for (const [key, value] of Object.entries(updates)) {
        const dbKey = this._camelToSnake(key)
        if (allowedFields.includes(dbKey)) {
          setParts.push(`${dbKey} = $${paramIndex++}`)
          values.push(value)
        }
      }

      if (setParts.length === 0) {
        return false
      }

      const query = `
        UPDATE users 
        SET ${setParts.join(', ')}, updated_at = NOW() 
        WHERE id = $1
      `

      const result = await this.pool.query(query, values)

      return result.rowCount > 0

    } catch (error) {
      logger.error('Update user error:', error)
      return false
    }
  }

  async updateUserAuth(userId, newPasswordHash) {
    try {
      const result = await this.pool.query(`
        UPDATE web_users_auth 
        SET password_hash = $1, updated_at = NOW() 
        WHERE user_id = $2
      `, [newPasswordHash, userId])

      return result.rowCount > 0

    } catch (error) {
      logger.error('Update user auth error:', error)
      return false
    }
  }

  async deactivateUser(userId) {
    try {
      const result = await this.pool.query(`
        UPDATE users 
        SET is_active = false, updated_at = NOW() 
        WHERE id = $1
      `, [userId])

      return result.rowCount > 0

    } catch (error) {
      logger.error('Deactivate user error:', error)
      return false
    }
  }

  async getUserByTelegramId(telegramId) {
    try {
      const result = await this.pool.query(`
        SELECT * FROM users WHERE telegram_id = $1
      `, [telegramId])

      if (result.rows.length === 0) {
        return null
      }

      const user = result.rows[0]

      return {
        id: user.id,
        telegramId: user.telegram_id,
        phoneNumber: user.phone_number,
        firstName: user.first_name,
        username: user.username,
        sessionId: user.session_id,
        isConnected: user.is_connected,
        connectionStatus: user.connection_status,
        source: user.source,
        isActive: user.is_active,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      }

    } catch (error) {
      logger.error('Get user by telegram ID error:', error)
      return null
    }
  }

  async _generateWebUserId() {
    try {
      // Get the highest telegram_id from web users and increment
      const result = await this.pool.query(`
        SELECT MAX(telegram_id) as max_id 
        FROM users 
        WHERE source = 'web'
      `)

      let nextId
      if (result.rows[0].max_id) {
        nextId = parseInt(result.rows[0].max_id) + 1
      } else {
        // Start web user IDs from 1000000000 to differentiate from regular Telegram IDs
        nextId = 1000000000
      }

      // Verify it doesn't exist (collision check)
      const existsCheck = await this.pool.query(`
        SELECT telegram_id FROM users WHERE telegram_id = $1
      `, [nextId])

      if (existsCheck.rows.length > 0) {
        // If collision, try next number
        return await this._generateWebUserId()
      }

      return nextId

    } catch (error) {
      logger.error('Generate web user ID error:', error)
      throw error
    }
  }

  _camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
  }
}