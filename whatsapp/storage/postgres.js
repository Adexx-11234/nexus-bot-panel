import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('POSTGRES_STORAGE')

/**
 * PostgreSQLStorage - Pure PostgreSQL operations
 * NO business logic, only database operations
 */
export class PostgreSQLStorage {
  constructor() {
    this.pool = null
    this.isConnected = false
    this._initConnection()
  }

  /**
   * Initialize PostgreSQL connection
   * @private
   */
  async _initConnection() {
    try {
      const { pool } = await import('../../config/database.js')
      this.pool = pool

      // Test connection
      const client = await this.pool.connect()
      await client.query('SELECT 1 as test')
      client.release()

      this.isConnected = true
      logger.info('PostgreSQL connected successfully')

    } catch (error) {
      this.isConnected = false
      logger.error('PostgreSQL connection failed:', error.message)
    }
  }

  /**
   * Save session (PURE operation)
   */
  async saveSession(sessionId, sessionData) {
    if (!this.isConnected) return false

    try {
      await this.pool.query(`
        INSERT INTO users (
          telegram_id, session_id, phone_number, is_connected,
          connection_status, reconnect_attempts, source, detected,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          session_id = EXCLUDED.session_id,
          phone_number = COALESCE(EXCLUDED.phone_number, users.phone_number),
          is_connected = EXCLUDED.is_connected,
          connection_status = EXCLUDED.connection_status,
          reconnect_attempts = EXCLUDED.reconnect_attempts,
          source = EXCLUDED.source,
          detected = EXCLUDED.detected,
          updated_at = NOW()
      `, [
        parseInt(sessionData.telegramId || sessionData.userId),
        sessionId,
        sessionData.phoneNumber,
        this._ensureBoolean(sessionData.isConnected),
        sessionData.connectionStatus || 'disconnected',
        parseInt(sessionData.reconnectAttempts || 0),
        sessionData.source || 'telegram',
        this._ensureBoolean(sessionData.detected !== false)
      ])

      return true

    } catch (error) {
      logger.error(`PostgreSQL save error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Get session (PURE operation)
   */
  async getSession(sessionId) {
    if (!this.isConnected) return null

    try {
      const result = await this.pool.query(
        'SELECT * FROM users WHERE session_id = $1',
        [sessionId]
      )

      if (!result.rows.length) return null

      const row = result.rows[0]
      return {
        sessionId: row.session_id,
        userId: row.telegram_id,
        telegramId: row.telegram_id,
        phoneNumber: row.phone_number,
        isConnected: row.is_connected,
        connectionStatus: row.connection_status || 'disconnected',
        reconnectAttempts: row.reconnect_attempts || 0,
        source: row.source || 'telegram',
        detected: row.detected !== false,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }

    } catch (error) {
      logger.error(`PostgreSQL get error for ${sessionId}:`, error.message)
      return null
    }
  }

  /**
   * Update session (PURE operation)
   */
  async updateSession(sessionId, updates) {
    if (!this.isConnected) return false

    try {
      const setParts = []
      const values = [sessionId]
      let paramIndex = 2

      // Allow clearing sessionId (for logout but keep user)
      if (updates.sessionId !== undefined) {
        setParts.push(`session_id = $${paramIndex++}`)
        values.push(updates.sessionId)
      }
      if (updates.isConnected !== undefined) {
        setParts.push(`is_connected = $${paramIndex++}`)
        values.push(Boolean(updates.isConnected))
      }
      if (updates.connectionStatus) {
        setParts.push(`connection_status = $${paramIndex++}`)
        values.push(updates.connectionStatus)
      }
      if (updates.phoneNumber !== undefined) {
        setParts.push(`phone_number = $${paramIndex++}`)
        values.push(updates.phoneNumber)
      }
      if (updates.reconnectAttempts !== undefined) {
        setParts.push(`reconnect_attempts = $${paramIndex++}`)
        values.push(updates.reconnectAttempts)
      }
      if (updates.source) {
        setParts.push(`source = $${paramIndex++}`)
        values.push(updates.source)
      }
      if (updates.detected !== undefined) {
        setParts.push(`detected = $${paramIndex++}`)
        values.push(Boolean(updates.detected))
      }

      if (setParts.length > 0) {
        const query = `
          UPDATE users
          SET ${setParts.join(', ')}, updated_at = NOW()
          WHERE session_id = $1
        `

        const result = await this.pool.query(query, values)
        return result.rowCount > 0
      }

      return false

    } catch (error) {
      logger.error(`PostgreSQL update error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Delete session but keep user record if web user has auth
   * (PURE operation)
   */
  async deleteSessionKeepUser(sessionId) {
    if (!this.isConnected) {
      return { updated: false, deleted: false, hadWebAuth: false }
    }

    try {
      const telegramId = parseInt(sessionId.replace('session_', ''))
      
      const userResult = await this.pool.query(
        'SELECT id, source, session_id FROM users WHERE telegram_id = $1',
        [telegramId]
      )

      if (userResult.rows.length === 0) {
        return { updated: false, deleted: false, hadWebAuth: false }
      }

      const user = userResult.rows[0]
      
      if (user.source === 'web') {
        // Check if web user has authentication
        const authCheck = await this.pool.query(
          'SELECT user_id FROM web_users_auth WHERE user_id = $1',
          [user.id]
        )

        const hadWebAuth = authCheck.rows.length > 0

        if (hadWebAuth) {
          // Has web auth - disconnect but KEEP phone_number
          const updateResult = await this.pool.query(
            `UPDATE users 
             SET session_id = NULL,
                 is_connected = false,
                 connection_status = 'disconnected',
                 updated_at = NOW()
             WHERE telegram_id = $1`,
            [telegramId]
          )
          logger.info(`Web user ${sessionId} has auth, kept record with phone`)
          return { updated: updateResult.rowCount > 0, deleted: false, hadWebAuth: true }
        } else {
          // No web auth - delete completely
          const deleteResult = await this.pool.query(
            'DELETE FROM users WHERE id = $1',
            [user.id]
          )
          logger.info(`Web user ${sessionId} has no auth, deleted completely`)
          return { updated: false, deleted: deleteResult.rowCount > 0, hadWebAuth: false }
        }
      } else {
        // Telegram user - disconnect and clear phone_number
        const updateResult = await this.pool.query(
          `UPDATE users 
           SET session_id = NULL,
               is_connected = false,
               connection_status = 'disconnected',
               phone_number = NULL,
               updated_at = NOW()
           WHERE telegram_id = $1`,
          [telegramId]
        )
        return { updated: updateResult.rowCount > 0, deleted: false, hadWebAuth: false }
      }

    } catch (error) {
      logger.error(`PostgreSQL deleteSessionKeepUser error for ${sessionId}:`, error.message)
      return { updated: false, deleted: false, hadWebAuth: false }
    }
  }

  /**
   * Cleanup orphaned session based on source (PURE operation)
   */
  async cleanupOrphanedSession(sessionId, source) {
    if (!this.isConnected) return false

    try {
      const telegramId = parseInt(sessionId.replace('session_', ''))
      
      if (source === 'web') {
        // Web user - just disconnect, keep record
        await this.pool.query(
          `UPDATE users 
           SET session_id = NULL,
               is_connected = false,
               connection_status = 'disconnected',
               updated_at = NOW()
           WHERE telegram_id = $1`,
          [telegramId]
        )
        logger.info(`Web user ${sessionId} orphan cleanup - disconnected`)
      } else {
        // Telegram user - delete completely
        await this.pool.query(
          'DELETE FROM users WHERE telegram_id = $1',
          [telegramId]
        )
        logger.info(`Telegram user ${sessionId} orphan cleanup - deleted`)
      }

      return true

    } catch (error) {
      logger.error(`PostgreSQL orphan cleanup error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Delete session (soft delete - PURE operation)
   */
  async deleteSession(sessionId) {
    if (!this.isConnected) return false

    try {
      const result = await this.pool.query(`
        UPDATE users
        SET session_id = NULL,
            is_connected = false,
            connection_status = 'disconnected',
            updated_at = NOW()
        WHERE session_id = $1
      `, [sessionId])

      return result.rowCount > 0

    } catch (error) {
      logger.error(`PostgreSQL delete error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Completely delete session (hard delete - PURE operation)
   */
  async completelyDeleteSession(sessionId) {
    if (!this.isConnected) return false

    try {
      const result = await this.pool.query(
        'DELETE FROM users WHERE session_id = $1',
        [sessionId]
      )

      return result.rowCount > 0

    } catch (error) {
      logger.error(`PostgreSQL complete delete error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Get all sessions (PURE operation)
   */
  async getAllSessions() {
    if (!this.isConnected) return []

    try {
      const result = await this.pool.query(`
        SELECT telegram_id, session_id, phone_number, is_connected,
               connection_status, reconnect_attempts, source, detected,
               created_at, updated_at
        FROM users
        WHERE session_id IS NOT NULL
        ORDER BY updated_at DESC
      `)

      return result.rows.map(row => ({
        sessionId: row.session_id,
        userId: row.telegram_id,
        telegramId: row.telegram_id,
        phoneNumber: row.phone_number,
        isConnected: row.is_connected,
        connectionStatus: row.connection_status || 'disconnected',
        reconnectAttempts: row.reconnect_attempts || 0,
        source: row.source || 'telegram',
        detected: row.detected !== false,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))

    } catch (error) {
      logger.error('PostgreSQL get all sessions error:', error.message)
      return []
    }
  }

  /**
   * Get undetected web sessions (PURE operation)
   */
  async getUndetectedWebSessions() {
    if (!this.isConnected) return []

    try {
      const result = await this.pool.query(`
        SELECT telegram_id, session_id, phone_number, is_connected,
               connection_status, source, detected, updated_at
        FROM users
        WHERE source = 'web'
          AND connection_status = 'connected'
          AND is_connected = true
          AND (detected IS NULL OR detected = false)
          AND session_id IS NOT NULL
        ORDER BY updated_at DESC
      `)

      return result.rows.map(row => ({
        sessionId: row.session_id,
        userId: row.telegram_id,
        telegramId: row.telegram_id,
        phoneNumber: row.phone_number,
        isConnected: row.is_connected,
        connectionStatus: row.connection_status,
        source: row.source,
        detected: row.detected || false,
        updatedAt: row.updated_at
      }))

    } catch (error) {
      logger.error('PostgreSQL get undetected web sessions error:', error.message)
      return []
    }
  }

  /**
   * Ensure boolean value (HELPER)
   * @private
   */
  _ensureBoolean(value) {
    if (value === null || value === undefined) return false
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return value.toLowerCase() === 'true'
    if (typeof value === 'number') return value !== 0
    return Boolean(value)
  }

  /**
   * Close connection
   */
  async close() {
    try {
      if (this.pool && this.isConnected) {
        await this.pool.end()
        this.isConnected = false
        logger.info('PostgreSQL connection closed')
      }
    } catch (error) {
      logger.error('PostgreSQL close error:', error.message)
    }
  }
}