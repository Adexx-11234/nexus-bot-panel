// database/db.js - Complete database operations
import { pool } from "./connection.js"
import { logger } from "../utils/logger.js"

export const db = {
  // User operations
  async getOrCreateUser(telegramId, userInfo) {
    try {
      // Check if user exists
      let result = await pool.query(
        "SELECT * FROM users WHERE telegram_id = $1",
        [telegramId]
      )
      
      if (result.rows.length > 0) {
        return result.rows[0]
      }
      
      // Create new user
      result = await pool.query(
        `INSERT INTO users (telegram_id, username, first_name, last_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING *`,
        [
          telegramId,
          userInfo.username || null,
          userInfo.first_name || null,
          userInfo.last_name || null
        ]
      )
      
      return result.rows[0]
    } catch (error) {
      logger.error("Error getting or creating user:", error)
      throw error
    }
  },

  async getUserById(telegramId) {
    try {
      const result = await pool.query(
        "SELECT * FROM users WHERE telegram_id = $1",
        [telegramId]
      )
      return result.rows[0] || null
    } catch (error) {
      logger.error("Error getting user by ID:", error)
      return null
    }
  },

  async deleteUser(telegramId) {
    try {
      const result = await pool.query(
        "DELETE FROM users WHERE telegram_id = $1",
        [telegramId]
      )
      return result.rowCount > 0
    } catch (error) {
      logger.error("Error deleting user:", error)
      throw error
    }
  },

  // Session operations
  async getUserSession(telegramId) {
    try {
      const result = await pool.query(
        `SELECT s.*, u.username, u.first_name 
         FROM sessions s 
         JOIN users u ON s.user_id = u.id 
         WHERE s.telegram_id = $1`,
        [telegramId]
      )
      return result.rows[0] || null
    } catch (error) {
      logger.error("Error getting user session:", error)
      return null
    }
  },

  async getSessionByPhone(phoneNumber) {
    try {
      const result = await pool.query(
        "SELECT * FROM sessions WHERE phone_number = $1 AND is_connected = true",
        [phoneNumber]
      )
      return result.rows[0] || null
    } catch (error) {
      logger.error("Error getting session by phone:", error)
      return null
    }
  },

  async createSession(userId, sessionId, telegramId, phoneNumber) {
    try {
      const result = await pool.query(
        `INSERT INTO sessions (user_id, session_id, telegram_id, phone_number, is_connected, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, NOW(), NOW())
         RETURNING *`,
        [userId, sessionId, telegramId, phoneNumber]
      )
      return result.rows[0]
    } catch (error) {
      logger.error("Error creating session:", error)
      throw error
    }
  },

  async updateSessionStatus(sessionId, isConnected, phoneNumber = null) {
    try {
      let query = "UPDATE sessions SET is_connected = $2, updated_at = NOW()"
      let params = [sessionId, isConnected]
      
      if (phoneNumber) {
        query += ", phone_number = $3"
        params.push(phoneNumber)
      }
      
      query += " WHERE session_id = $1 RETURNING *"
      
      const result = await pool.query(query, params)
      return result.rows[0]
    } catch (error) {
      logger.error("Error updating session status:", error)
      throw error
    }
  },

  async deleteSession(sessionId) {
    try {
      const result = await pool.query(
        "DELETE FROM sessions WHERE session_id = $1",
        [sessionId]
      )
      return result.rowCount > 0
    } catch (error) {
      logger.error("Error deleting session:", error)
      throw error
    }
  },

  // WhatsApp user operations
  async getWhatsAppUser(jid) {
    try {
      const result = await pool.query(
        "SELECT * FROM whatsapp_users WHERE jid = $1",
        [jid]
      )
      return result.rows[0] || null
    } catch (error) {
      logger.error("Error getting WhatsApp user:", error)
      return null
    }
  },

  async createOrUpdateWhatsAppUser(jid, telegramId, phoneNumber) {
    try {
      const result = await pool.query(
        `INSERT INTO whatsapp_users (jid, telegram_id, phone, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (jid)
         DO UPDATE SET 
           telegram_id = $2,
           phone = $3,
           updated_at = NOW()
         RETURNING *`,
        [jid, telegramId, phoneNumber]
      )
      return result.rows[0]
    } catch (error) {
      logger.error("Error creating/updating WhatsApp user:", error)
      throw error
    }
  },

  // Message operations
  async storeMessage(messageData) {
    try {
      const { 
        id, fromJid, senderJid, timestamp, content, media, 
        mediaType, sessionId, userId, isViewOnce, fromMe, pushName 
      } = messageData

      // Try to update existing message first
      const updateResult = await pool.query(
        `UPDATE messages 
         SET content = COALESCE($1, content),
             media = COALESCE($2, media),
             media_type = COALESCE($3, media_type),
             push_name = COALESCE($4, push_name),
             is_deleted = false,
             updated_at = NOW()
         WHERE id = $5 AND session_id = $6
         RETURNING id`,
        [content, media, mediaType, pushName, id, sessionId]
      )

      if (updateResult.rows.length > 0) {
        return updateResult.rows[0].id
      }

      // Insert new message if update didn't affect any rows
      const insertResult = await pool.query(
        `INSERT INTO messages (
          id, from_jid, sender_jid, timestamp, content, media, 
          media_type, session_id, user_id, is_view_once, from_me, push_name, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        RETURNING id`,
        [id, fromJid, senderJid, timestamp, content, media, mediaType, sessionId, userId, isViewOnce, fromMe, pushName]
      )

      return insertResult.rows[0]?.id
    } catch (error) {
      logger.error("Error storing message:", error)
      throw error
    }
  },

  async findMessageById(messageId, sessionId = null) {
    try {
      const params = [messageId]
      let query = `
        SELECT id, from_jid, sender_jid, timestamp, content, media, media_type, 
               session_id, user_id, is_view_once, from_me, push_name, created_at
        FROM messages 
        WHERE id = $1
      `

      if (sessionId) {
        query += " AND session_id = $2"
        params.push(sessionId)
      }

      query += " ORDER BY timestamp DESC LIMIT 1"

      const result = await pool.query(query, params)
      
      if (result.rows.length === 0) {
        return null
      }

      const row = result.rows[0]
      return {
        id: row.id,
        fromJid: row.from_jid,
        senderJid: row.sender_jid,
        timestamp: this.normalizeTimestamp(row.timestamp),
        content: row.content,
        media: this.safeJsonParse(row.media),
        mediaType: row.media_type,
        sessionId: row.session_id,
        userId: row.user_id,
        isViewOnce: Boolean(row.is_view_once),
        fromMe: Boolean(row.from_me),
        pushName: row.push_name || 'Unknown',
        createdAt: row.created_at
      }
    } catch (error) {
      logger.error("Error finding message by ID:", error)
      return null
    }
  },

  async deleteMessageById(messageId, sessionId = null) {
    try {
      const params = [messageId]
      let query = "DELETE FROM messages WHERE id = $1"

      if (sessionId) {
        query += " AND session_id = $2"
        params.push(sessionId)
      }

      const result = await pool.query(query, params)
      return { success: true, rowsDeleted: result.rowCount }
    } catch (error) {
      logger.error("Error deleting message:", error)
      return { success: false, error: error.message }
    }
  },

  // Group operations
  async getGroupSettings(groupJid) {
    try {
      const result = await pool.query(
        `SELECT grouponly_enabled, public_mode, antilink_enabled, is_bot_admin
         FROM groups 
         WHERE jid = $1`,
        [groupJid]
      )
      
      if (result.rows.length === 0) {
        // Create group record if it doesn't exist
        await this.ensureGroupExists(groupJid)
        return {
          grouponly_enabled: false,
          public_mode: true,
          antilink_enabled: false,
          is_bot_admin: false
        }
      }
      
      return result.rows[0]
    } catch (error) {
      logger.error("Error getting group settings:", error)
      return {
        grouponly_enabled: false,
        public_mode: true,
        antilink_enabled: false,
        is_bot_admin: false
      }
    }
  },

  async ensureGroupExists(groupJid, groupName = null) {
    if (!groupJid) {
      logger.warn("Cannot ensure group exists - no groupJid provided")
      return null
    }

    try {
      const result = await pool.query(
        `INSERT INTO groups (jid, name, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (jid) 
         DO UPDATE SET 
           name = COALESCE($2, groups.name),
           updated_at = NOW()
         RETURNING id`,
        [groupJid, groupName]
      )

      return result.rows[0]
    } catch (error) {
      logger.error("Error ensuring group exists:", error)
      throw error
    }
  },

  // User settings operations
  async getWhatsAppUserByTelegramId(telegramId) {
    try {
      const result = await pool.query(
        `SELECT jid, telegram_id, antideleted_enabled, antiviewonce_enabled
         FROM whatsapp_users 
         WHERE telegram_id = $1 
         LIMIT 1`,
        [telegramId]
      )

      if (result.rows.length > 0) {
        return {
          jid: result.rows[0].jid,
          telegram_id: result.rows[0].telegram_id,
          antideleted_enabled: Boolean(result.rows[0].antideleted_enabled),
          antiviewonce_enabled: Boolean(result.rows[0].antiviewonce_enabled)
        }
      }

      return null
    } catch (error) {
      logger.error(`Error getting WhatsApp user by telegram_id ${telegramId}: ${error.message}`)
      return null
    }
  },

  async setUserAntiFeature(jid, telegramId, feature, enabled) {
    try {
      const validFeatures = ['antideleted_enabled', 'antiviewonce_enabled']
      if (!validFeatures.includes(feature)) {
        throw new Error(`Invalid feature: ${feature}`)
      }

      // Try to update existing record first
      const updateResult = await pool.query(
        `UPDATE whatsapp_users 
         SET ${feature} = $1, updated_at = NOW() 
         WHERE jid = $2 AND telegram_id = $3
         RETURNING id`,
        [enabled, jid, telegramId]
      )

      if (updateResult.rows.length > 0) {
        return true
      }

      // Insert new record if update didn't affect any rows
      const insertQuery = `
        INSERT INTO whatsapp_users (jid, telegram_id, ${feature}, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (jid, telegram_id) 
        DO UPDATE SET 
          ${feature} = EXCLUDED.${feature},
          updated_at = NOW()
      `
      
      await pool.query(insertQuery, [jid, telegramId, enabled])
      return true
    } catch (error) {
      logger.error(`Error setting ${feature}:`, error)
      throw error
    }
  },

  async getAntiDeletedUsers() {
    try {
      const result = await pool.query(
        `SELECT jid, telegram_id 
         FROM whatsapp_users 
         WHERE antideleted_enabled = true 
         AND jid IS NOT NULL 
         AND telegram_id IS NOT NULL`
      )
      
      return result.rows.filter(user => user.jid && user.jid.includes("@"))
    } catch (error) {
      logger.error("Error getting anti-deleted users:", error)
      return []
    }
  },

  async getAntiViewOnceUsers() {
    try {
      const result = await pool.query(
        `SELECT jid, telegram_id 
         FROM whatsapp_users 
         WHERE antiviewonce_enabled = true 
         AND jid IS NOT NULL 
         AND telegram_id IS NOT NULL`
      )
      
      return result.rows.filter(user => user.jid && user.jid.includes("@"))
    } catch (error) {
      logger.error("Error getting anti-viewonce users:", error)
      return []
    }
  },

  // Utility functions
  normalizeTimestamp(timestamp) {
    if (!timestamp) return Math.floor(Date.now() / 1000)
    
    if (typeof timestamp === 'string') {
      const parsed = parseInt(timestamp)
      return isNaN(parsed) ? Math.floor(Date.now() / 1000) : parsed
    }
    
    if (typeof timestamp === 'number') {
      return timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp
    }
    
    return Math.floor(Date.now() / 1000)
  },

  safeJsonParse(jsonString) {
    if (!jsonString) return null
    
    try {
      return typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString
    } catch (error) {
      logger.warn("Failed to parse JSON:", jsonString)
      return null
    }
  },

  // Health check
  async testConnection() {
    try {
      const result = await pool.query("SELECT NOW() as current_time")
      logger.info(`Database connection OK: ${result.rows[0].current_time}`)
      return true
    } catch (error) {
      logger.error(`Database connection failed: ${error.message}`)
      return false
    }
  }
}