// Database query utilities
// queries/index.js - Enhanced with Circuit Breaker-Aware Caching

import { pool, checkCircuitBreaker, circuitBreaker } from "../config/database.js"
import { logger } from "../utils/logger.js"

class QueryManager {
  constructor() {
    this.cache = new Map()
    this.cacheTimeout = 30 * 1000 // 30 seconds
    this.queryQueue = []
    this.isProcessing = false
    this.maxQueueSize = 50
    this.cleanupInterval = 15 * 1000 // 15 seconds
    this.maxCacheSize = 500
    
    // Group settings cache with longer TTL
    this.groupSettingsCache = new Map()
    this.groupSettingsTTL = 60 * 1000 // 60 seconds for group settings
    
    // Circuit breaker fallback cache - used when circuit is OPEN
    this.fallbackCache = new Map()
    this.fallbackCacheTTL = 5 * 60 * 1000 // 5 minutes for fallback data
    
    this.initCleanup()
  }

  initCleanup() {
    setInterval(() => {
      this.cleanExpiredCache()
    }, this.cleanupInterval)
  }

  cleanExpiredCache() {
    const now = Date.now()
    let removed = 0

    // Clean general cache
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.cache.delete(key)
        removed++
      }
    }

    // Clean group settings cache
    for (const [key, value] of this.groupSettingsCache.entries()) {
      if (now - value.timestamp > this.groupSettingsTTL) {
        this.groupSettingsCache.delete(key)
        removed++
      }
    }

    // Clean fallback cache
    for (const [key, value] of this.fallbackCache.entries()) {
      if (now - value.timestamp > this.fallbackCacheTTL) {
        this.fallbackCache.delete(key)
        removed++
      }
    }

    if (this.cache.size > this.maxCacheSize) {
      const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)
      const toRemove = entries.slice(0, this.cache.size - 100)
      toRemove.forEach(([key]) => this.cache.delete(key))
      removed += toRemove.length
    }

    if (removed > 0) {
      logger.debug(`[QueryManager] Cleaned ${removed} cache entries (remaining: ${this.cache.size + this.groupSettingsCache.size + this.fallbackCache.size})`)
    }
  }

  async execute(query, params = []) {
    // Check circuit breaker before executing
    if (!checkCircuitBreaker()) {
      logger.warn('[QueryManager] Circuit breaker is OPEN - query blocked')
      throw new Error('Database circuit breaker is open')
    }

    try {
      return await pool.query(query, params)
    } catch (error) {
      // Don't log timeout errors as ERROR if circuit breaker is handling it
      if (error.message?.includes('timeout') || error.code === 'CIRCUIT_OPEN') {
        logger.debug(`[QueryManager] Database timeout/circuit: ${error.message}`)
      } else {
        //logger.error(`[QueryManager] Database error: ${error.message}`)
        //logger.error(`[QueryManager] Query: ${query}`)
        //logger.error(`[QueryManager] Params: ${JSON.stringify(params)}`)
      }
      throw error
    }
  }

  async executeWithCache(cacheKey, query, params = [], ttl = this.cacheTimeout) {
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)
      if (Date.now() - cached.timestamp < ttl) {
        return cached.data
      }
      this.cache.delete(cacheKey)
    }

    // Check circuit breaker
    if (!checkCircuitBreaker()) {
      // Try to return fallback cache if available
      if (this.fallbackCache.has(cacheKey)) {
        const fallback = this.fallbackCache.get(cacheKey)
        logger.debug(`[QueryManager] Using fallback cache for: ${cacheKey}`)
        return fallback.data
      }
      throw new Error('Database circuit breaker is open and no fallback data available')
    }

    const result = await this.execute(query, params)

    if (this.cache.size < this.maxCacheSize) {
      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
        ttl: ttl,
      })

      // Also store in fallback cache for circuit breaker scenarios
      this.fallbackCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      })

      setTimeout(() => this.cache.delete(cacheKey), ttl)
    }

    return result
  }

  // Smart cache for group settings - returns cached or fetches and caches
  async getGroupSettingsCached(groupJid) {
    const cacheKey = `group_settings_${groupJid}`
    
    if (this.groupSettingsCache.has(cacheKey)) {
      const cached = this.groupSettingsCache.get(cacheKey)
      if (Date.now() - cached.timestamp < this.groupSettingsTTL) {
        return cached.data
      }
      this.groupSettingsCache.delete(cacheKey)
    }

    // If circuit is open, try fallback cache
    if (!checkCircuitBreaker()) {
      if (this.fallbackCache.has(cacheKey)) {
        const fallback = this.fallbackCache.get(cacheKey)
        logger.debug(`[QueryManager] Using fallback cache for group settings: ${groupJid}`)
        return fallback.data
      }
      // Return null to indicate cache miss
      return null
    }

    // If not cached, return null to indicate cache miss
    return null
  }

  // Update group settings cache
  setGroupSettingsCache(groupJid, settings) {
    const cacheKey = `group_settings_${groupJid}`
    this.groupSettingsCache.set(cacheKey, {
      data: settings,
      timestamp: Date.now()
    })
    // Also update fallback cache
    this.fallbackCache.set(cacheKey, {
      data: settings,
      timestamp: Date.now()
    })
  }

  // Invalidate group settings cache (called on updates)
  invalidateGroupSettings(groupJid) {
    const cacheKey = `group_settings_${groupJid}`
    this.groupSettingsCache.delete(cacheKey)
    // Don't delete fallback cache - keep it for circuit breaker scenarios
    logger.debug(`[QueryManager] Invalidated cache for group: ${groupJid}`)
  }

  invalidateCache(key) {
    if (key) {
      this.cache.delete(key)
      // Also check group settings cache
      if (key.startsWith('group_settings_')) {
        this.groupSettingsCache.delete(key)
      }
    }
  }

  invalidateCachePattern(pattern) {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    }
    for (const key of this.groupSettingsCache.keys()) {
      if (key.includes(pattern)) {
        this.groupSettingsCache.delete(key)
      }
    }
  }

  clearCache() {
    this.cache.clear()
    this.groupSettingsCache.clear()
    // Don't clear fallback cache - keep it for emergencies
  }

  getCacheStats() {
    return {
      generalCacheSize: this.cache.size,
      groupSettingsCacheSize: this.groupSettingsCache.size,
      fallbackCacheSize: this.fallbackCache.size,
      totalCacheSize: this.cache.size + this.groupSettingsCache.size + this.fallbackCache.size,
      maxSize: this.maxCacheSize,
      maxTimeout: this.cacheTimeout,
      groupSettingsTTL: this.groupSettingsTTL,
      fallbackCacheTTL: this.fallbackCacheTTL,
      circuitBreakerState: circuitBreaker.state
    }
  }
}

const queryManager = new QueryManager()

// ==========================================
// GROUP QUERIES - Enhanced with Circuit Breaker-Aware Caching
// ==========================================

export const GroupQueries = {
  async ensureGroupExists(groupJid, groupName = null) {
    if (!groupJid) return null

    // Check circuit breaker - if open, return cached or default
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, skipping ensureGroupExists for ${groupJid}`)
      return { id: null } // Return minimal valid response
    }

    try {
      const result = await queryManager.execute(
        `INSERT INTO groups (jid, name, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (jid) 
         DO UPDATE SET 
           name = COALESCE($2, groups.name),
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [groupJid, groupName],
      )
      
      // Invalidate cache when group is created/updated
      queryManager.invalidateGroupSettings(groupJid)
      
      return result.rows[0]
    } catch (error) {
      logger.error(`[GroupQueries] Error ensuring group exists: ${error.message}`)
      return { id: null }
    }
  },

  async getSettings(groupJid) {
    try {
      // Try cache first
      const cached = await queryManager.getGroupSettingsCached(groupJid)
      if (cached) return cached

      // Circuit breaker check
      if (!checkCircuitBreaker()) {
        logger.warn(`[GroupQueries] Circuit open, returning default settings for ${groupJid}`)
        return null
      }

      const result = await queryManager.execute(`SELECT * FROM groups WHERE jid = $1`, [groupJid])
      const settings = result.rows[0] || null
      
      // Cache the result
      if (settings) {
        queryManager.setGroupSettingsCache(groupJid, settings)
      }
      
      return settings
    } catch (error) {
      logger.error(`[GroupQueries] Error getting settings: ${error.message}`)
      return null
    }
  },

  async deleteGroup(groupJid) {
    // Skip if circuit is open
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, skipping deleteGroup for ${groupJid}`)
      return
    }

    try {
      await queryManager.execute(`DELETE FROM groups WHERE jid = $1`, [groupJid])
      queryManager.invalidateGroupSettings(groupJid)
    } catch (error) {
      logger.error(`[GroupQueries] Error deleting group: ${error.message}`)
      throw error
    }
  },

  async updateGroupMeta(groupJid, metadata = {}) {
    // Skip if circuit is open
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, skipping updateGroupMeta for ${groupJid}`)
      return
    }

    try {
      const { name, description, participantsCount, isBotAdmin } = metadata
      await queryManager.execute(
        `UPDATE groups 
         SET name = COALESCE($2, name),
             description = COALESCE($3, description),
             participants_count = COALESCE($4, participants_count),
             is_bot_admin = COALESCE($5, is_bot_admin),
             updated_at = CURRENT_TIMESTAMP
         WHERE jid = $1`,
        [groupJid, name, description, participantsCount, isBotAdmin],
      )
      
      // Invalidate cache after update
      queryManager.invalidateGroupSettings(groupJid)
    } catch (error) {
      logger.error(`[GroupQueries] Error updating group meta: ${error.message}`)
    }
  },

  async getGroupSettings(groupJid) {
    try {
      // Try cache first
      const cached = await queryManager.getGroupSettingsCached(groupJid)
      if (cached) {
        return {
          grouponly_enabled: cached.grouponly_enabled || false,
          public_mode: cached.public_mode !== false,
          antilink_enabled: cached.antilink_enabled || false,
          is_bot_admin: cached.is_bot_admin || false,
          anticall_enabled: cached.anticall_enabled || false,
          antiimage_enabled: cached.antiimage_enabled || false,
          antivideo_enabled: cached.antivideo_enabled || false,
          antiaudio_enabled: cached.antiaudio_enabled || false,
          antidocument_enabled: cached.antidocument_enabled || false,
          antisticker_enabled: cached.antisticker_enabled || false,
          antigroupmention_enabled: cached.antigroupmention_enabled || false,
          antidelete_enabled: cached.antidelete_enabled || false,
          antiviewonce_enabled: cached.antiviewonce_enabled || false,
          antibot_enabled: cached.antibot_enabled || false,
          antispam_enabled: cached.antispam_enabled || false,
          antiraid_enabled: cached.antiraid_enabled || false,
          autowelcome_enabled: cached.autowelcome_enabled || false,
          autokick_enabled: cached.autokick_enabled || false,
          welcome_enabled: cached.welcome_enabled || false,
          goodbye_enabled: cached.goodbye_enabled || false,
          telegram_id: cached.telegram_id,
          scheduled_close_time: cached.scheduled_close_time,
          scheduled_open_time: cached.scheduled_open_time,
          is_closed: cached.is_closed || false,
        }
      }

      // Circuit breaker check - return defaults if open
      if (!checkCircuitBreaker()) {
        logger.warn(`[GroupQueries] Circuit open, returning default settings for ${groupJid}`)
        return {
          grouponly_enabled: false,
          public_mode: true,
          antilink_enabled: false,
          is_bot_admin: false,
        }
      }

      const result = await queryManager.execute(
        `SELECT grouponly_enabled, public_mode, antilink_enabled, is_bot_admin,
                anticall_enabled, antiimage_enabled, antivideo_enabled,
                antiaudio_enabled, antidocument_enabled, antisticker_enabled, 
                antigroupmention_enabled, antidelete_enabled, antiviewonce_enabled,
                antibot_enabled, antispam_enabled, antiraid_enabled,
                autowelcome_enabled, autokick_enabled, welcome_enabled, goodbye_enabled,
                telegram_id, scheduled_close_time, scheduled_open_time, is_closed
         FROM groups WHERE jid = $1`,
        [groupJid],
      )

      if (result.rows.length === 0) {
        // Create default settings and cache them (only if circuit is closed)
        await this.ensureGroupExists(groupJid)
        const defaultSettings = {
          grouponly_enabled: false,
          public_mode: true,
          antilink_enabled: false,
          is_bot_admin: false,
        }
        queryManager.setGroupSettingsCache(groupJid, defaultSettings)
        return defaultSettings
      }

      // Cache the fetched settings
      queryManager.setGroupSettingsCache(groupJid, result.rows[0])
      
      return result.rows[0]
    } catch (error) {
      logger.error(`[GroupQueries] Error getting group settings: ${error.message}`)
      return {
        grouponly_enabled: false,
        public_mode: true,
        antilink_enabled: false,
        is_bot_admin: false,
      }
    }
  },

  async updateGroupSettings(groupJid, settings) {
    // Skip if circuit is open
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, skipping updateGroupSettings for ${groupJid}`)
      throw new Error('Database unavailable, settings not updated')
    }

    try {
      await this.ensureGroupExists(groupJid)

      const allowedFields = [
        "grouponly_enabled",
        "public_mode",
        "antilink_enabled",
        "is_bot_admin",
        "name",
        "description",
        "anticall_enabled",
        "antiimage_enabled",
        "antivideo_enabled",
        "antiaudio_enabled",
        "antidocument_enabled",
        "antisticker_enabled",
        "antigroupmention_enabled",
        "antidelete_enabled",
        "antiviewonce_enabled",
        "antibot_enabled",
        "antispam_enabled",
        "antiraid_enabled",
        "autowelcome_enabled",
        "autokick_enabled",
        "welcome_enabled",
        "goodbye_enabled",
        "telegram_id",
        "scheduled_close_time",
        "scheduled_open_time",
        "is_closed",
      ]

      const updates = []
      const values = [groupJid]
      let paramIndex = 2

      for (const [key, value] of Object.entries(settings)) {
        if (allowedFields.includes(key)) {
          updates.push(`${key} = $${paramIndex}`)
          values.push(value)
          paramIndex++
        }
      }

      if (updates.length === 0) {
        throw new Error("No valid fields to update")
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`)

      const query = `UPDATE groups SET ${updates.join(", ")} WHERE jid = $1 RETURNING *`
      const result = await queryManager.execute(query, values)
      
      // Invalidate cache after update
      queryManager.invalidateGroupSettings(groupJid)
      
      return result.rows[0]
    } catch (error) {
      logger.error(`[GroupQueries] Error updating group settings: ${error.message}`)
      throw error
    }
  },

  async upsertSettings(groupJid, settings = {}) {
    // Skip if circuit is open
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, skipping upsertSettings for ${groupJid}`)
      throw new Error('Database unavailable, settings not updated')
    }

    try {
      if (Object.keys(settings).length === 0) {
        const result = await queryManager.execute(
          `INSERT INTO groups (jid, updated_at)
           VALUES ($1, CURRENT_TIMESTAMP)
           ON CONFLICT (jid)
           DO UPDATE SET updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [groupJid],
        )
        queryManager.invalidateGroupSettings(groupJid)
        return result.rows[0]
      }

      const columns = Object.keys(settings)
      const values = Object.values(settings)
      const placeholders = columns.map((_, i) => `$${i + 2}`).join(", ")
      const updateSet = columns.map((col, i) => `${col} = $${i + 2}`).join(", ")

      const query = `
        INSERT INTO groups (jid, ${columns.join(", ")}, updated_at)
        VALUES ($1, ${placeholders}, CURRENT_TIMESTAMP)
        ON CONFLICT (jid)
        DO UPDATE SET ${updateSet}, updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `

      const result = await queryManager.execute(query, [groupJid, ...values])
      
      // Invalidate cache after upsert
      queryManager.invalidateGroupSettings(groupJid)
      
      return result.rows[0]
    } catch (error) {
      logger.error(`[GroupQueries] Error in upsertSettings: ${error.message}`)
      throw error
    }
  },

  async setScheduledCloseTime(groupJid, time) {
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, skipping setScheduledCloseTime`)
      throw new Error('Database unavailable')
    }

    try {
      const result = await queryManager.execute(
        `UPDATE groups 
         SET scheduled_close_time = $1, auto_schedule_enabled = true, updated_at = CURRENT_TIMESTAMP 
         WHERE jid = $2
         RETURNING scheduled_close_time, auto_schedule_enabled`,
        [time, groupJid],
      )
      
      queryManager.invalidateGroupSettings(groupJid)
      return result.rows[0]
    } catch (error) {
      logger.error(`[GroupQueries] Error setting scheduled close time: ${error.message}`)
      throw error
    }
  },

  async setScheduledOpenTime(groupJid, time) {
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, skipping setScheduledOpenTime`)
      throw new Error('Database unavailable')
    }

    try {
      const result = await queryManager.execute(
        `UPDATE groups 
         SET scheduled_open_time = $1, auto_schedule_enabled = true, updated_at = CURRENT_TIMESTAMP 
         WHERE jid = $2
         RETURNING scheduled_open_time, auto_schedule_enabled`,
        [time, groupJid],
      )
      
      queryManager.invalidateGroupSettings(groupJid)
      return result.rows[0]
    } catch (error) {
      logger.error(`[GroupQueries] Error setting scheduled open time: ${error.message}`)
      throw error
    }
  },

  async removeScheduledTimes(groupJid, type = "both") {
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, skipping removeScheduledTimes`)
      return false
    }

    try {
      let query
      if (type === "close") {
        query = `UPDATE groups SET scheduled_close_time = NULL WHERE jid = $1`
      } else if (type === "open") {
        query = `UPDATE groups SET scheduled_open_time = NULL WHERE jid = $1`
      } else {
        query = `UPDATE groups SET scheduled_close_time = NULL, scheduled_open_time = NULL, auto_schedule_enabled = false WHERE jid = $1`
      }

      await queryManager.execute(query, [groupJid])
      queryManager.invalidateGroupSettings(groupJid)
      return true
    } catch (error) {
      logger.error(`[GroupQueries] Error removing scheduled times: ${error.message}`)
      return false
    }
  },

  async getGroupsWithScheduledTimes() {
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, returning empty scheduled times list`)
      return []
    }

    try {
      const result = await queryManager.execute(
        `SELECT jid, scheduled_close_time, scheduled_open_time, is_closed, timezone
         FROM groups 
         WHERE auto_schedule_enabled = true 
           AND (scheduled_close_time IS NOT NULL OR scheduled_open_time IS NOT NULL)`,
      )
      return result.rows
    } catch (error) {
      logger.error(`[GroupQueries] Error getting groups with scheduled times: ${error.message}`)
      return []
    }
  },

  async getGroupSchedule(groupJid) {
    try {
      // Try to use cache first
      const cached = await queryManager.getGroupSettingsCached(groupJid)
      if (cached) {
        return {
          scheduled_close_time: cached.scheduled_close_time,
          scheduled_open_time: cached.scheduled_open_time,
          auto_schedule_enabled: cached.auto_schedule_enabled,
          is_closed: cached.is_closed,
          timezone: cached.timezone
        }
      }

      if (!checkCircuitBreaker()) {
        return null
      }

      const result = await queryManager.execute(
        `SELECT scheduled_close_time, scheduled_open_time, auto_schedule_enabled, is_closed, timezone
         FROM groups WHERE jid = $1`,
        [groupJid],
      )
      return result.rows[0] || null
    } catch (error) {
      logger.error(`[GroupQueries] Error getting group schedule: ${error.message}`)
      return null
    }
  },

  async setGroupOnly(groupJid, enabled) {
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, skipping setGroupOnly`)
      throw new Error('Database unavailable')
    }

    try {
      const result = await queryManager.execute(
        `INSERT INTO groups (jid, grouponly_enabled, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (jid)
         DO UPDATE SET grouponly_enabled = $2, updated_at = CURRENT_TIMESTAMP
         RETURNING grouponly_enabled`,
        [groupJid, enabled],
      )
      
      queryManager.invalidateGroupSettings(groupJid)
      return result.rows[0]?.grouponly_enabled || false
    } catch (error) {
      logger.error(`[GroupQueries] Error setting grouponly: ${error.message}`)
      throw error
    }
  },

  async isGroupOnlyEnabled(groupJid) {
    if (!groupJid) return false

    try {
      // Use cached settings
      const settings = await this.getGroupSettings(groupJid)
      return settings.grouponly_enabled === true
    } catch (error) {
      logger.error(`[GroupQueries] Error checking grouponly: ${error.message}`)
      return false
    }
  },

  async isPublicModeEnabled(groupJid) {
    try {
      const settings = await this.getGroupSettings(groupJid)
      return settings.public_mode
    } catch (error) {
      logger.error(`[GroupQueries] Error checking public mode: ${error.message}`)
      return true
    }
  },

  async setAntiCommand(groupJid, commandType, enabled) {
    if (!checkCircuitBreaker()) {
      logger.warn(`[GroupQueries] Circuit open, skipping setAntiCommand`)
      throw new Error('Database unavailable')
    }

    const columnName = `${commandType}_enabled`
    try {
      const result = await queryManager.execute(
        `INSERT INTO groups (jid, ${columnName}, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (jid)
         DO UPDATE SET ${columnName} = $2, updated_at = CURRENT_TIMESTAMP
         RETURNING ${columnName}`,
        [groupJid, enabled],
      )
      
      queryManager.invalidateGroupSettings(groupJid)
      return result.rows[0]?.[columnName] || false
    } catch (error) {
      logger.error(`[GroupQueries] Error setting ${commandType}: ${error.message}`)
      throw error
    }
  },

  async isAntiCommandEnabled(groupJid, commandType) {
    if (!groupJid) return false

    const columnName = `${commandType}_enabled`
    try {
      // Use cached settings
      const settings = await this.getGroupSettings(groupJid)
      return settings[columnName] === true
    } catch (error) {
      logger.error(`[GroupQueries] Error checking ${commandType}: ${error.message}`)
      return false
    }
  },

  async getEnabledAntiCommands(groupJid) {
    try {
      // Use cached settings
      const settings = await this.getGroupSettings(groupJid)
      
      if (!settings) return {}

      const enabled = {}

      Object.keys(settings).forEach((key) => {
        if (key.endsWith('_enabled') && settings[key] === true) {
          enabled[key.replace("_enabled", "")] = true
        }
      })

      return enabled
    } catch (error) {
      logger.error(`[GroupQueries] Error getting enabled anti-commands: ${error.message}`)
      return {}
    }
  },

  async logAdminPromotion(groupJid, userJid, promotedBy) {
    if (!checkCircuitBreaker()) {
      logger.debug(`[GroupQueries] Circuit open, skipping logAdminPromotion`)
      return
    }

    try {
      await queryManager.execute(
        `INSERT INTO admin_promotions (group_jid, user_jid, promoted_by, promoted_at) 
         VALUES ($1, $2, $3, NOW()) 
         ON CONFLICT (group_jid, user_jid) 
         DO UPDATE SET promoted_at = NOW(), promoted_by = $3`,
        [groupJid, userJid, promotedBy],
      )
    } catch (error) {
      logger.error(`[GroupQueries] Error logging admin promotion: ${error.message}`)
    }
  },

  async getUserPromoteTime(groupJid, userJid) {
    if (!checkCircuitBreaker()) {
      return null
    }

    try {
      const result = await queryManager.execute(
        `SELECT promoted_at FROM admin_promotions 
         WHERE group_jid = $1 AND user_jid = $2 
         ORDER BY promoted_at DESC LIMIT 1`,
        [groupJid, userJid],
      )
      return result.rows.length > 0 ? result.rows[0].promoted_at : null
    } catch (error) {
      logger.error(`[GroupQueries] Error getting user promote time: ${error.message}`)
      return null
    }
  },

  async logMemberAddition(groupJid, addedUserJid, addedByJid) {
    if (!checkCircuitBreaker()) {
      logger.debug(`[GroupQueries] Circuit open, skipping logMemberAddition`)
      return
    }

    try {
      await queryManager.execute(
        `INSERT INTO group_member_additions (group_jid, added_user_jid, added_by_jid) 
         VALUES ($1, $2, $3)`,
        [groupJid, addedUserJid, addedByJid],
      )
    } catch (error) {
      logger.error(`[GroupQueries] Error logging member addition: ${error.message}`)
    }
  },

  async setTagLimit(groupJid, limit) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      const result = await queryManager.execute(
        `INSERT INTO groups (jid, tag_limit, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (jid)
         DO UPDATE SET tag_limit = $2, updated_at = CURRENT_TIMESTAMP
         RETURNING tag_limit`,
        [groupJid, limit],
      )
      
      queryManager.invalidateGroupSettings(groupJid)
      return result.rows[0]?.tag_limit || limit
    } catch (error) {
      logger.error(`[GroupQueries] Error setting tag limit: ${error.message}`)
      throw error
    }
  },

  async getTagLimit(groupJid) {
    try {
      const cached = await queryManager.getGroupSettingsCached(groupJid)
      if (cached?.tag_limit) return cached.tag_limit

      if (!checkCircuitBreaker()) {
        return 5
      }

      const result = await queryManager.execute(`SELECT tag_limit FROM groups WHERE jid = $1`, [groupJid])
      return result.rows[0]?.tag_limit || 5
    } catch (error) {
      logger.error(`[GroupQueries] Error getting tag limit: ${error.message}`)
      return 5
    }
  },

  async setGroupClosed(groupJid, isClosed) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      const result = await queryManager.execute(
        `INSERT INTO groups (jid, is_closed, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (jid)
         DO UPDATE SET is_closed = $2, updated_at = CURRENT_TIMESTAMP
         RETURNING is_closed`,
        [groupJid, isClosed],
      )
      
      queryManager.invalidateGroupSettings(groupJid)
      return result.rows[0]?.is_closed || isClosed
    } catch (error) {
      logger.error(`[GroupQueries] Error setting group closed: ${error.message}`)
      throw error
    }
  },

  async getGroupClosed(groupJid) {
    try {
      const cached = await queryManager.getGroupSettingsCached(groupJid)
      if (cached) return cached.is_closed || false

      if (!checkCircuitBreaker()) {
        return false
      }

      const result = await queryManager.execute(`SELECT is_closed FROM groups WHERE jid = $1`, [groupJid])
      return result.rows[0]?.is_closed || false
    } catch (error) {
      logger.error(`[GroupQueries] Error getting group closed status: ${error.message}`)
      return false
    }
  },
}

// ==========================================
// VIP QUERIES
// ==========================================

export const VIPQueries = {
  async isVIP(telegramId) {
    if (!checkCircuitBreaker()) {
      return { isVIP: false, level: 0, isDefault: false }
    }

    try {
      const result = await queryManager.execute(
        `SELECT vip_level, is_default_vip FROM whatsapp_users WHERE telegram_id = $1`,
        [telegramId],
      )

      if (result.rows.length === 0) return { isVIP: false, level: 0, isDefault: false }

      const user = result.rows[0]
      return {
        isVIP: user.vip_level > 0 || user.is_default_vip,
        level: user.vip_level || 0,
        isDefault: user.is_default_vip || false,
      }
    } catch (error) {
      logger.error(`[VIPQueries] Error checking VIP status: ${error.message}`)
      return { isVIP: false, level: 0, isDefault: false }
    }
  },

  async getUserByTelegramId(telegramId) {
    if (!checkCircuitBreaker()) {
      return null
    }

    try {
      const result = await queryManager.execute(
        `SELECT telegram_id, first_name, phone_number, is_connected, connection_status 
         FROM users WHERE telegram_id = $1 LIMIT 1`,
        [telegramId],
      )
      return result.rows[0] || null
    } catch (error) {
      logger.error(`[VIPQueries] Error getting user by telegram ID: ${error.message}`)
      return null
    }
  },

  async ensureWhatsAppUser(telegramId, jid, phone = null) {
    if (!checkCircuitBreaker()) {
      logger.warn(`[VIPQueries] Circuit open, skipping ensureWhatsAppUser`)
      return false
    }

    try {
      await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, jid, phone, created_at, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id) DO UPDATE 
         SET jid = COALESCE(EXCLUDED.jid, whatsapp_users.jid), 
             phone = COALESCE(EXCLUDED.phone, whatsapp_users.phone),
             updated_at = CURRENT_TIMESTAMP`,
        [telegramId, jid, phone],
      )
      return true
    } catch (error) {
      logger.error(`[VIPQueries] Error ensuring whatsapp user: ${error.message}`)
      return false
    }
  },

  async promoteToVIP(telegramId, level = 1) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, vip_level, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET vip_level = $2, updated_at = CURRENT_TIMESTAMP
         RETURNING telegram_id, vip_level`,
        [telegramId, level],
      )
      return result.rows[0]
    } catch (error) {
      logger.error(`[VIPQueries] Error promoting to VIP: ${error.message}`)
      throw error
    }
  },

  async demoteVIP(telegramId) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      await queryManager.execute(
        `UPDATE whatsapp_users SET vip_level = 0, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = $1`,
        [telegramId],
      )
      return true
    } catch (error) {
      logger.error(`[VIPQueries] Error demoting VIP: ${error.message}`)
      throw error
    }
  },

  async setDefaultVIP(telegramId, isDefaultVIP = true, sessionManager = null) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")

      let jid = null
      const existingUser = await queryManager.execute("SELECT jid FROM whatsapp_users WHERE telegram_id = $1", [
        telegramId,
      ])

      if (existingUser.rows.length > 0) {
        jid = existingUser.rows[0].jid
      } else if (sessionManager) {
        const sessionId = `session_${telegramId}`
        const sock = sessionManager.getSession(sessionId)
        if (sock && sock.user && sock.user.id) {
          jid = sock.user.id
        }
      }

      if (!jid) {
        jid = `${telegramId}@s.whatsapp.net`
      }

      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, jid, is_default_vip, vip_level, created_at, updated_at)
         VALUES ($1, $2, $3, 99, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET
           jid = COALESCE(EXCLUDED.jid, whatsapp_users.jid),
           is_default_vip = EXCLUDED.is_default_vip,
           vip_level = 99,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [telegramId, jid, isDefaultVIP],
      )
      return result.rows[0]
    } catch (error) {
      logger.error(`[VIPQueries] Error setting default VIP: ${error.message}`)
      throw error
    }
  },

  async getUserByPhone(phone) {
    if (!checkCircuitBreaker()) {
      return null
    }

    try {
      const cleanPhone = phone.replace(/[@\s\-+]/g, "")
      const result = await queryManager.execute(
        `SELECT telegram_id, first_name, phone_number, is_connected, connection_status 
         FROM users 
         WHERE phone_number LIKE $1 
         ORDER BY updated_at DESC LIMIT 1`,
        [`%${cleanPhone}%`],
      )
      return result.rows[0] || null
    } catch (error) {
      logger.error(`[VIPQueries] Error getting user by phone: ${error.message}`)
      return null
    }
  },

  async claimUser(vipTelegramId, targetTelegramId, targetPhone = null, targetJid = null) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      const existing = await queryManager.execute(
        `SELECT vip_telegram_id FROM vip_owned_users 
         WHERE owned_telegram_id = $1 AND is_active = true`,
        [targetTelegramId],
      )

      if (existing.rows.length > 0) {
        return { success: false, error: "Already claimed by another VIP", ownedBy: existing.rows[0].vip_telegram_id }
      }

      const result = await queryManager.execute(
        `INSERT INTO vip_owned_users (vip_telegram_id, owned_telegram_id, owned_phone, owned_jid)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [vipTelegramId, targetTelegramId, targetPhone, targetJid],
      )

      await queryManager.execute(
        `UPDATE whatsapp_users 
         SET owned_by_telegram_id = $1, claimed_at = CURRENT_TIMESTAMP 
         WHERE telegram_id = $2`,
        [vipTelegramId, targetTelegramId],
      )

      return { success: true, id: result.rows[0].id }
    } catch (error) {
      logger.error(`[VIPQueries] Error claiming user: ${error.message}`)
      throw error
    }
  },

  async unclaimUser(targetTelegramId, vipTelegramId = null) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      let query, params

      if (vipTelegramId) {
        query = `UPDATE vip_owned_users SET is_active = false WHERE owned_telegram_id = $1 AND vip_telegram_id = $2`
        params = [targetTelegramId, vipTelegramId]
      } else {
        query = `UPDATE vip_owned_users SET is_active = false WHERE owned_telegram_id = $1`
        params = [targetTelegramId]
      }

      await queryManager.execute(query, params)
      await queryManager.execute(`UPDATE whatsapp_users SET owned_by_telegram_id = NULL WHERE telegram_id = $1`, [
        targetTelegramId,
      ])
      return true
    } catch (error) {
      logger.error(`[VIPQueries] Error unclaiming user: ${error.message}`)
      throw error
    }
  },

  async ownsUser(vipTelegramId, targetTelegramId) {
    if (!checkCircuitBreaker()) {
      return false
    }

    try {
      const result = await queryManager.execute(
        `SELECT id FROM vip_owned_users 
         WHERE vip_telegram_id = $1 AND owned_telegram_id = $2 AND is_active = true`,
        [vipTelegramId, targetTelegramId],
      )
      return result.rows.length > 0
    } catch (error) {
      logger.error(`[VIPQueries] Error checking ownership: ${error.message}`)
      return false
    }
  },

  async getOwnedUsers(vipTelegramId) {
    if (!checkCircuitBreaker()) {
      return []
    }

    try {
      const result = await queryManager.execute(
        `SELECT vou.*, wu.jid, wu.name, wu.phone 
         FROM vip_owned_users vou
         LEFT JOIN whatsapp_users wu ON vou.owned_telegram_id = wu.telegram_id
         WHERE vou.vip_telegram_id = $1 AND vou.is_active = true
         ORDER BY vou.claimed_at DESC`,
        [vipTelegramId],
      )
      return result.rows
    } catch (error) {
      logger.error(`[VIPQueries] Error getting owned users: ${error.message}`)
      return []
    }
  },

  async reassignUser(targetTelegramId, newVipTelegramId) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      await queryManager.execute(`UPDATE vip_owned_users SET is_active = false WHERE owned_telegram_id = $1`, [
        targetTelegramId,
      ])

      await queryManager.execute(
        `INSERT INTO vip_owned_users (vip_telegram_id, owned_telegram_id, claimed_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)`,
        [newVipTelegramId, targetTelegramId],
      )

      await queryManager.execute(`UPDATE whatsapp_users SET owned_by_telegram_id = $1 WHERE telegram_id = $2`, [
        newVipTelegramId,
        targetTelegramId,
      ])
      return true
    } catch (error) {
      logger.error(`[VIPQueries] Error reassigning user: ${error.message}`)
      throw error
    }
  },

  async logActivity(vipTelegramId, actionType, targetUserTelegramId = null, targetGroupJid = null, details = {}) {
    if (!checkCircuitBreaker()) {
      logger.debug(`[VIPQueries] Circuit open, skipping logActivity`)
      return
    }

    try {
      await queryManager.execute(
        `INSERT INTO vip_activity_log (vip_telegram_id, action_type, target_user_telegram_id, target_group_jid, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [vipTelegramId, actionType, targetUserTelegramId, targetGroupJid, JSON.stringify(details)],
      )

      if (actionType === "takeover" && targetUserTelegramId) {
        await queryManager.execute(
          `UPDATE vip_owned_users 
           SET last_used_at = CURRENT_TIMESTAMP, takeovers_count = takeovers_count + 1
           WHERE vip_telegram_id = $1 AND owned_telegram_id = $2`,
          [vipTelegramId, targetUserTelegramId],
        )
      }
    } catch (error) {
      logger.error(`[VIPQueries] Error logging activity: ${error.message}`)
    }
  },

  async getAllVIPs() {
    if (!checkCircuitBreaker()) {
      return []
    }

    try {
      const result = await queryManager.execute(
        `SELECT wu.telegram_id, wu.jid, wu.name, wu.phone, wu.vip_level, wu.is_default_vip,
                COUNT(vou.id) as owned_users_count, MAX(vou.last_used_at) as last_activity
         FROM whatsapp_users wu
         LEFT JOIN vip_owned_users vou ON wu.telegram_id = vou.vip_telegram_id AND vou.is_active = true
         WHERE wu.vip_level > 0 OR wu.is_default_vip = true
         GROUP BY wu.telegram_id
         ORDER BY wu.vip_level DESC, wu.telegram_id`,
      )
      return result.rows
    } catch (error) {
      logger.error(`[VIPQueries] Error getting all VIPs: ${error.message}`)
      return []
    }
  },

  async getVIPDetails(vipTelegramId) {
    if (!checkCircuitBreaker()) {
      return null
    }

    try {
      const vipInfo = await queryManager.execute(`SELECT * FROM whatsapp_users WHERE telegram_id = $1`, [vipTelegramId])

      const ownedUsers = await this.getOwnedUsers(vipTelegramId)

      const recentActivity = await queryManager.execute(
        `SELECT * FROM vip_activity_log 
         WHERE vip_telegram_id = $1 
         ORDER BY created_at DESC LIMIT 10`,
        [vipTelegramId],
      )

      return {
        vip: vipInfo.rows[0],
        ownedUsers,
        recentActivity: recentActivity.rows,
      }
    } catch (error) {
      logger.error(`[VIPQueries] Error getting VIP details: ${error.message}`)
      return null
    }
  },
}

// ==========================================
// WARNING QUERIES
// ==========================================

export const WarningQueries = {
  async addWarning(groupJid, userJid, warningType, reason = null) {
    if (!checkCircuitBreaker()) {
      logger.debug(`[WarningQueries] Circuit open, skipping addWarning`)
      return 1 // Return default warning count
    }

    try {
      const result = await queryManager.execute(
        `INSERT INTO warnings (user_jid, group_jid, warning_type, warning_count, reason, last_warning_at, created_at)
         VALUES ($1, $2, $3, 1, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (user_jid, group_jid, warning_type)
         DO UPDATE SET 
           warning_count = warnings.warning_count + 1,
           reason = COALESCE($4, warnings.reason),
           last_warning_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         RETURNING warning_count`,
        [userJid, groupJid, warningType, reason],
      )
      return result.rows[0]?.warning_count || 1
    } catch (error) {
      logger.error(`[WarningQueries] Error adding warning: ${error.message}`)
      return 1
    }
  },

  async resetUserWarnings(groupJid, userJid, warningType = null) {
    if (!checkCircuitBreaker()) {
      logger.debug(`[WarningQueries] Circuit open, skipping resetUserWarnings`)
      return 0
    }

    try {
      let query, params

      if (warningType) {
        query = `DELETE FROM warnings WHERE group_jid = $1 AND user_jid = $2 AND warning_type = $3`
        params = [groupJid, userJid, warningType]
      } else {
        query = `DELETE FROM warnings WHERE group_jid = $1 AND user_jid = $2`
        params = [groupJid, userJid]
      }

      const result = await queryManager.execute(query, params)
      return result.rowCount
    } catch (error) {
      logger.error(`[WarningQueries] Error resetting warnings: ${error.message}`)
      return 0
    }
  },

  async getWarningCount(groupJid, userJid, warningType) {
    try {
      const cacheKey = `warning_${groupJid}_${userJid}_${warningType}`
      
      // Try cache first
      if (queryManager.cache.has(cacheKey)) {
        const cached = queryManager.cache.get(cacheKey)
        if (Date.now() - cached.timestamp < 30000) {
          return cached.data
        }
      }

      if (!checkCircuitBreaker()) {
        // Try fallback cache
        if (queryManager.fallbackCache.has(cacheKey)) {
          return queryManager.fallbackCache.get(cacheKey).data
        }
        return 0
      }

      const result = await queryManager.execute(
        `SELECT warning_count FROM warnings
         WHERE group_jid = $1 AND user_jid = $2 AND warning_type = $3`,
        [groupJid, userJid, warningType],
      )
      
      const count = result.rows[0]?.warning_count || 0
      
      // Cache the result
      queryManager.cache.set(cacheKey, { data: count, timestamp: Date.now() })
      queryManager.fallbackCache.set(cacheKey, { data: count, timestamp: Date.now() })
      
      return count
    } catch (error) {
      logger.error(`[WarningQueries] Error getting warning count: ${error.message}`)
      return 0
    }
  },

  async getWarningStats(groupJid, warningType = null) {
    if (!checkCircuitBreaker()) {
      return { totalUsers: 0, totalWarnings: 0, avgWarnings: 0, maxWarnings: 0 }
    }

    try {
      let query, params

      if (warningType) {
        query = `
          SELECT 
            COUNT(DISTINCT user_jid) as total_users,
            SUM(warning_count) as total_warnings,
            AVG(warning_count) as avg_warnings,
            MAX(warning_count) as max_warnings
          FROM warnings
          WHERE group_jid = $1 AND warning_type = $2
        `
        params = [groupJid, warningType]
      } else {
        query = `
          SELECT 
            COUNT(DISTINCT user_jid) as total_users,
            SUM(warning_count) as total_warnings,
            AVG(warning_count) as avg_warnings,
            MAX(warning_count) as max_warnings
          FROM warnings
          WHERE group_jid = $1
        `
        params = [groupJid]
      }

      const result = await queryManager.execute(query, params)

      return {
        totalUsers: Number.parseInt(result.rows[0]?.total_users) || 0,
        totalWarnings: Number.parseInt(result.rows[0]?.total_warnings) || 0,
        avgWarnings: Number.parseFloat(result.rows[0]?.avg_warnings) || 0,
        maxWarnings: Number.parseInt(result.rows[0]?.max_warnings) || 0,
      }
    } catch (error) {
      logger.error(`[WarningQueries] Error getting warning stats: ${error.message}`)
      return { totalUsers: 0, totalWarnings: 0, avgWarnings: 0, maxWarnings: 0 }
    }
  },

  async getWarningList(groupJid, warningType = null, limit = 10) {
    if (!checkCircuitBreaker()) {
      return []
    }

    try {
      let query, params

      if (warningType) {
        query = `
          SELECT user_jid, warning_count, reason, last_warning_at
          FROM warnings
          WHERE group_jid = $1 AND warning_type = $2
          ORDER BY last_warning_at DESC LIMIT $3
        `
        params = [groupJid, warningType, limit]
      } else {
        query = `
          SELECT user_jid, warning_type, warning_count, reason, last_warning_at
          FROM warnings
          WHERE group_jid = $1
          ORDER BY last_warning_at DESC LIMIT $2
        `
        params = [groupJid, limit]
      }

      const result = await queryManager.execute(query, params)
      return result.rows
    } catch (error) {
      logger.error(`[WarningQueries] Error getting warning list: ${error.message}`)
      return []
    }
  },
}

// ==========================================
// VIOLATION QUERIES
// ==========================================

export const ViolationQueries = {
  async logViolation(
    groupJid,
    userJid,
    violationType,
    messageContent,
    detectedContent,
    actionTaken,
    warningNumber,
    messageId,
  ) {
    if (!checkCircuitBreaker()) {
      logger.debug(`[ViolationQueries] Circuit open, skipping logViolation`)
      return
    }

    try {
      await queryManager.execute(
        `INSERT INTO violations (
          user_jid, group_jid, violation_type, 
          message_content, detected_content, action_taken, 
          warning_number, message_id, violated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
        [
          userJid,
          groupJid,
          violationType,
          messageContent?.substring(0, 500),
          JSON.stringify(detectedContent || {}),
          actionTaken,
          warningNumber,
          messageId,
        ],
      )
    } catch (error) {
      logger.error(`[ViolationQueries] Error logging violation: ${error.message}`)
    }
  },

  async getViolationStats(groupJid, violationType = null, days = 30) {
    if (!checkCircuitBreaker()) {
      return []
    }

    try {
      let query, params

      if (violationType) {
        query = `
          SELECT 
            COUNT(*) as total_violations,
            COUNT(DISTINCT user_jid) as unique_violators,
            COUNT(*) FILTER (WHERE action_taken = 'kick') as kicks,
            COUNT(*) FILTER (WHERE action_taken = 'warning') as warnings
          FROM violations
          WHERE group_jid = $1 AND violation_type = $2
            AND violated_at > CURRENT_DATE - INTERVAL '${days} days'
        `
        params = [groupJid, violationType]
      } else {
        query = `
          SELECT 
            violation_type,
            COUNT(*) as total_violations,
            COUNT(DISTINCT user_jid) as unique_violators,
            COUNT(*) FILTER (WHERE action_taken = 'kick') as kicks
          FROM violations
          WHERE group_jid = $1
            AND violated_at > CURRENT_DATE - INTERVAL '${days} days'
          GROUP BY violation_type
          ORDER BY total_violations DESC
        `
        params = [groupJid]
      }

      const result = await queryManager.execute(query, params)
      return result.rows
    } catch (error) {
      logger.error(`[ViolationQueries] Error getting violation stats: ${error.message}`)
      return []
    }
  },
}

// ==========================================
// MESSAGE QUERIES  
// ==========================================

export const MessageQueries = {
  async storeMessage(messageData) {
    if (!checkCircuitBreaker()) {
      logger.debug(`[MessageQueries] Circuit open, skipping storeMessage`)
      return null
    }

    try {
      const {
        id,
        fromJid,
        senderJid,
        timestamp,
        content,
        media,
        mediaType,
        sessionId,
        userId,
        isViewOnce,
        fromMe,
        pushName,
      } = messageData

      const updateResult = await queryManager.execute(
        `UPDATE messages 
         SET content = COALESCE($1, content),
             media = COALESCE($2, media),
             media_type = COALESCE($3, media_type),
             push_name = COALESCE($4, push_name),
             is_deleted = false
         WHERE id = $5 AND session_id = $6
         RETURNING id`,
        [content, media, mediaType, pushName, id, sessionId],
      )

      if (updateResult.rows.length > 0) {
        return updateResult.rows[0].id
      }

      const insertResult = await queryManager.execute(
        `INSERT INTO messages (
          id, from_jid, sender_jid, timestamp, content, media, 
          media_type, session_id, user_id, is_view_once, from_me, push_name, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
        RETURNING id`,
        [id, fromJid, senderJid, timestamp, content, media, mediaType, sessionId, userId, isViewOnce, fromMe, pushName],
      )
      return insertResult.rows[0]?.id
    } catch (error) {
      // Silently fail for message storage during database issues
      if (!error.message?.includes('timeout') && error.code !== 'CIRCUIT_OPEN') {
        logger.error(`[MessageQueries] Error storing message: ${error.message}`)
      }
      return null
    }
  },

  async getRecentMessages(chatJid, sessionId, limit = 50) {
    if (!checkCircuitBreaker()) {
      return []
    }

    try {
      const result = await queryManager.execute(
        `SELECT * FROM messages
         WHERE from_jid = $1 AND session_id = $2 AND is_deleted = false
         ORDER BY timestamp DESC LIMIT $3`,
        [chatJid, sessionId, limit],
      )
      return result.rows
    } catch (error) {
      logger.error(`[MessageQueries] Error getting recent messages: ${error.message}`)
      return []
    }
  },

  async markDeleted(messageId, sessionId) {
    if (!checkCircuitBreaker()) {
      logger.debug(`[MessageQueries] Circuit open, skipping markDeleted`)
      return
    }

    try {
      await queryManager.execute(
        `UPDATE messages 
         SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND session_id = $2`,
        [messageId, sessionId],
      )
    } catch (error) {
      logger.error(`[MessageQueries] Error marking message deleted: ${error.message}`)
    }
  },

  async searchMessages(chatJid, sessionId, searchTerm, limit = 20) {
    if (!checkCircuitBreaker()) {
      return []
    }

    try {
      const result = await queryManager.execute(
        `SELECT * FROM messages
         WHERE from_jid = $1 AND session_id = $2 
           AND content ILIKE $3 AND is_deleted = false
         ORDER BY timestamp DESC LIMIT $4`,
        [chatJid, sessionId, `%${searchTerm}%`, limit],
      )
      return result.rows
    } catch (error) {
      logger.error(`[MessageQueries] Error searching messages: ${error.message}`)
      return []
    }
  },

  async findMessageById(messageId, sessionId = null) {
    if (!checkCircuitBreaker()) {
      return null
    }

    try {
      const params = [messageId]
      let queryText = `
        SELECT id, from_jid, sender_jid, timestamp, content, media, media_type, 
               session_id, user_id, is_view_once, from_me, push_name, created_at
        FROM messages WHERE id = $1
      `

      if (sessionId) {
        queryText += " AND session_id = $2"
        params.push(sessionId)
      }

      queryText += " ORDER BY timestamp DESC LIMIT 1"

      const result = await queryManager.execute(queryText, params)

      if (result.rows.length === 0) return null

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
        pushName: row.push_name || "Unknown",
        createdAt: row.created_at,
      }
    } catch (error) {
      logger.error(`[MessageQueries] Error finding message by ID: ${error.message}`)
      return null
    }
  },

  async deleteMessageById(messageId, sessionId = null) {
    if (!checkCircuitBreaker()) {
      logger.debug(`[MessageQueries] Circuit open, skipping deleteMessageById`)
      return { success: false, error: 'Database unavailable' }
    }

    try {
      const params = [messageId]
      let queryText = "DELETE FROM messages WHERE id = $1"

      if (sessionId) {
        queryText += " AND session_id = $2"
        params.push(sessionId)
      }

      const result = await queryManager.execute(queryText, params)
      return { success: true, rowsDeleted: result.rowCount }
    } catch (error) {
      logger.error(`[MessageQueries] Error deleting message: ${error.message}`)
      return { success: false, error: error.message }
    }
  },

  normalizeTimestamp(timestamp) {
    if (!timestamp) return Math.floor(Date.now() / 1000)

    if (typeof timestamp === "string") {
      const parsed = Number.parseInt(timestamp)
      return isNaN(parsed) ? Math.floor(Date.now() / 1000) : parsed
    }

    if (typeof timestamp === "number") {
      return timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp
    }

    return Math.floor(Date.now() / 1000)
  },

  safeJsonParse(jsonString) {
    if (!jsonString) return null

    try {
      return typeof jsonString === "string" ? JSON.parse(jsonString) : jsonString
    } catch (error) {
      return null
    }
  },
}

// ==========================================
// ANALYTICS QUERIES
// ==========================================

export const AnalyticsQueries = {
  async updateGroupAnalytics(groupJid, updates) {
    if (!checkCircuitBreaker()) {
      logger.debug(`[AnalyticsQueries] Circuit open, skipping updateGroupAnalytics`)
      return
    }

    try {
      const columns = Object.keys(updates)
      const values = Object.values(updates)
      const placeholders = columns.map((_, i) => `$${i + 3}`).join(", ")
      const updateSet = columns.map((col, i) => `${col} = ${col} + $${i + 3}`).join(", ")

      await queryManager.execute(
        `INSERT INTO group_analytics (group_jid, date, ${columns.join(", ")})
         VALUES ($1, $2, ${placeholders})
         ON CONFLICT (group_jid, date)
         DO UPDATE SET ${updateSet}`,
        [groupJid, new Date().toISOString().split("T")[0], ...values],
      )
    } catch (error) {
      // Silently fail for analytics during database issues
      if (!error.message?.includes('timeout') && error.code !== 'CIRCUIT_OPEN') {
        logger.error(`[AnalyticsQueries] Error updating analytics: ${error.message}`)
      }
    }
  },

  async getGroupAnalytics(groupJid, days = 30) {
    if (!checkCircuitBreaker()) {
      return []
    }

    try {
      const result = await queryManager.execute(
        `SELECT * FROM group_analytics
         WHERE group_jid = $1 AND date > CURRENT_DATE - INTERVAL '${days} days'
         ORDER BY date DESC`,
        [groupJid],
      )
      return result.rows
    } catch (error) {
      logger.error(`[AnalyticsQueries] Error getting analytics: ${error.message}`)
      return []
    }
  },
}

// ==========================================
// USER QUERIES
// ==========================================

export const UserQueries = {
  async getUserByTelegramId(telegramId) {
    if (!checkCircuitBreaker()) {
      return null
    }

    try {
      const result = await queryManager.execute(`SELECT * FROM users WHERE telegram_id = $1`, [telegramId])
      return result.rows[0] || null
    } catch (error) {
      logger.error(`[UserQueries] Error getting user by telegram_id: ${error.message}`)
      return null
    }
  },

  async getUserBySessionId(sessionId) {
    if (!checkCircuitBreaker()) {
      return null
    }

    try {
      const sessionIdMatch = sessionId.match(/session_(-?\d+)/)
      if (!sessionIdMatch) return null

      const telegramId = Number.parseInt(sessionIdMatch[1])
      const result = await queryManager.execute(`SELECT * FROM users WHERE telegram_id = $1`, [telegramId])
      return result.rows[0] || null
    } catch (error) {
      logger.error(`[UserQueries] Error getting user by session_id: ${error.message}`)
      return null
    }
  },

  async setBotMode(telegramId, mode) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")

      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, bot_mode, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET bot_mode = EXCLUDED.bot_mode, updated_at = CURRENT_TIMESTAMP
         RETURNING bot_mode`,
        [telegramId, mode],
      )

      queryManager.invalidateCache(`bot_mode_${telegramId}`)
      return result.rows[0]?.bot_mode || "public"
    } catch (error) {
      logger.error(`[UserQueries] Error setting bot mode: ${error.message}`)
      throw error
    }
  },

  async getBotMode(telegramId) {
    try {
      const cacheKey = `bot_mode_${telegramId}`
      
      // Try cache first
      if (queryManager.cache.has(cacheKey)) {
        const cached = queryManager.cache.get(cacheKey)
        if (Date.now() - cached.timestamp < 60000) { // 1 minute cache
          return { mode: cached.data }
        }
      }

      if (!checkCircuitBreaker()) {
        // Try fallback cache
        if (queryManager.fallbackCache.has(cacheKey)) {
          return { mode: queryManager.fallbackCache.get(cacheKey).data }
        }
        return { mode: "public" }
      }

      const result = await queryManager.execute(`SELECT bot_mode FROM whatsapp_users WHERE telegram_id = $1`, [
        telegramId,
      ])
      
      const mode = result.rows[0]?.bot_mode || "public"
      
      // Cache the result
      queryManager.cache.set(cacheKey, { data: mode, timestamp: Date.now() })
      queryManager.fallbackCache.set(cacheKey, { data: mode, timestamp: Date.now() })
      
      return { mode }
    } catch (error) {
      logger.error(`[UserQueries] Error getting bot mode: ${error.message}`)
      return { mode: "public" }
    }
  },

  async createWebUser(telegramId, phoneNumber = null) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      const result = await queryManager.execute(
        `INSERT INTO users (telegram_id, phone_number, is_active, created_at, updated_at)
         VALUES ($1, $2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id) 
         DO UPDATE SET 
           phone_number = COALESCE($2, users.phone_number),
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [telegramId, phoneNumber],
      )
      return result.rows[0]
    } catch (error) {
      logger.error(`[UserQueries] Error creating web user: ${error.message}`)
      throw error
    }
  },

  async ensureUserInUsersTable(telegramId, userData = {}) {
    if (!checkCircuitBreaker()) {
      logger.warn(`[UserQueries] Circuit open, skipping ensureUserInUsersTable`)
      return null
    }

    try {
      const result = await queryManager.execute(
        `INSERT INTO users (telegram_id, username, first_name, last_name, phone_number, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, true), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id) 
         DO UPDATE SET 
           username = COALESCE($2, users.username),
           first_name = COALESCE($3, users.first_name),
           last_name = COALESCE($4, users.last_name),
           phone_number = COALESCE($5, users.phone_number),
           is_active = COALESCE($6, users.is_active),
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [
          telegramId,
          userData.username || null,
          userData.first_name || null,
          userData.last_name || null,
          userData.phone_number || null,
          userData.is_active,
        ],
      )
      return result.rows[0]
    } catch (error) {
      logger.error(`[UserQueries] Error ensuring user exists: ${error.message}`)
      throw error
    }
  },

  async getSettings(userJid) {
    if (!checkCircuitBreaker()) {
      return null
    }

    try {
      const result = await queryManager.execute(`SELECT * FROM whatsapp_users WHERE jid = $1`, [userJid])
      return result.rows[0] || null
    } catch (error) {
      logger.error(`[UserQueries] Error getting settings: ${error.message}`)
      return null
    }
  },

  async getUserSettings(telegramId) {
    try {
      const cacheKey = `user_settings_${telegramId}`
      
      // Try cache
      if (queryManager.cache.has(cacheKey)) {
        const cached = queryManager.cache.get(cacheKey)
        if (Date.now() - cached.timestamp < 60000) {
          return cached.data
        }
      }

      if (!checkCircuitBreaker()) {
        // Try fallback
        if (queryManager.fallbackCache.has(cacheKey)) {
          return queryManager.fallbackCache.get(cacheKey).data
        }
        return { custom_prefix: "." }
      }

      const result = await queryManager.execute(`SELECT custom_prefix FROM whatsapp_users WHERE telegram_id = $1`, [
        telegramId,
      ])

      const settings = result.rows.length === 0 ? { custom_prefix: "." } : result.rows[0]
      
      // Cache it
      queryManager.cache.set(cacheKey, { data: settings, timestamp: Date.now() })
      queryManager.fallbackCache.set(cacheKey, { data: settings, timestamp: Date.now() })
      
      return settings
    } catch (error) {
      logger.error(`[UserQueries] Error getting user settings: ${error.message}`)
      return { custom_prefix: "." }
    }
  },

  async updateUserPrefix(telegramId, prefix) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")
      if (prefix && prefix.length > 10) throw new Error("Prefix cannot be longer than 10 characters")

      const normalizedPrefix = prefix === "none" ? "" : prefix

      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, custom_prefix, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET custom_prefix = EXCLUDED.custom_prefix, updated_at = CURRENT_TIMESTAMP
         RETURNING custom_prefix`,
        [telegramId, normalizedPrefix],
      )

      queryManager.invalidateCache(`user_settings_${telegramId}`)
      return result.rows[0]?.custom_prefix
    } catch (error) {
      logger.error(`[UserQueries] Error updating prefix: ${error.message}`)
      throw error
    }
  },

  async upsertSettings(telegramId, userJid = null, settings = {}) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")

      if (userJid) settings.jid = userJid

      if (Object.keys(settings).length === 0) {
        const result = await queryManager.execute(
          `INSERT INTO whatsapp_users (telegram_id, created_at, updated_at)
           VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (telegram_id)
           DO UPDATE SET updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [telegramId],
        )
        return result.rows[0]
      }

      const columns = Object.keys(settings)
      const values = Object.values(settings)
      const placeholders = columns.map((_, i) => `$${i + 2}`).join(", ")
      const updateSet = columns.map((col) => `${col} = COALESCE(EXCLUDED.${col}, whatsapp_users.${col})`).join(", ")

      const query = `
        INSERT INTO whatsapp_users (telegram_id, ${columns.join(", ")}, created_at, updated_at)
        VALUES ($1, ${placeholders}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (telegram_id)
        DO UPDATE SET ${updateSet}, updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `

      const result = await queryManager.execute(query, [telegramId, ...values])
      queryManager.invalidateCache(`user_settings_${telegramId}`)
      return result.rows[0]
    } catch (error) {
      logger.error(`[UserQueries] Error in upsertSettings: ${error.message}`)
      throw error
    }
  },

  async setAntiViewOnce(userJid, enabled, telegramId = null) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")

      const normalizedJid = userJid ? userJid.replace(/:\d+@/, "@") : null

      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, jid, antiviewonce_enabled, created_at, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET 
           jid = COALESCE(EXCLUDED.jid, whatsapp_users.jid),
           antiviewonce_enabled = EXCLUDED.antiviewonce_enabled,
           updated_at = CURRENT_TIMESTAMP
         RETURNING antiviewonce_enabled`,
        [telegramId, normalizedJid, enabled],
      )

      queryManager.invalidateCache(`user_settings_${telegramId}`)
      return result.rows[0]?.antiviewonce_enabled || false
    } catch (error) {
      logger.error(`[UserQueries] Error setting antiviewonce: ${error.message}`)
      throw error
    }
  },

  async isAntiViewOnceEnabled(userJid, telegramId = null) {
    if (!userJid && !telegramId) return false

    try {
      let query, params

      if (telegramId) {
        query = `SELECT antiviewonce_enabled FROM whatsapp_users WHERE telegram_id = $1`
        params = [telegramId]
      } else {
        const normalizedJid = userJid.replace(/:\d+@/, "@")
        query = `SELECT antiviewonce_enabled FROM whatsapp_users WHERE jid = $1`
        params = [normalizedJid]
      }

      if (!checkCircuitBreaker()) {
        return false
      }

      const result = await queryManager.execute(query, params)
      return result.rows.length > 0 && result.rows[0].antiviewonce_enabled === true
    } catch (error) {
      logger.error(`[UserQueries] Error checking antiviewonce: ${error.message}`)
      return false
    }
  },

  async getAntiViewOnceUsers() {
    if (!checkCircuitBreaker()) {
      return []
    }

    try {
      const result = await queryManager.execute(
        `SELECT wu.jid, wu.telegram_id 
         FROM whatsapp_users wu
         WHERE wu.antiviewonce_enabled = true 
         AND wu.jid IS NOT NULL 
         AND wu.telegram_id IS NOT NULL`,
      )

      const validUsers = result.rows
        .map((row) => ({ jid: row.jid, telegram_id: row.telegram_id }))
        .filter((user) => user.jid && user.jid.includes("@"))

      return validUsers
    } catch (error) {
      logger.error(`[UserQueries] Error getting antiviewonce users: ${error.message}`)
      return []
    }
  },

  async getAntiDeleteUsers() {
    if (!checkCircuitBreaker()) {
      return []
    }

    try {
      const result = await queryManager.execute(
        `SELECT wu.jid, wu.telegram_id 
         FROM whatsapp_users wu
         WHERE wu.antideleted_enabled = true 
         AND wu.jid IS NOT NULL 
         AND wu.telegram_id IS NOT NULL`,
      )

      const validUsers = result.rows
        .map((row) => ({ jid: row.jid, telegram_id: row.telegram_id }))
        .filter((user) => user.jid && user.jid.includes("@"))

      return validUsers
    } catch (error) {
      logger.error(`[UserQueries] Error getting antideleted users: ${error.message}`)
      return []
    }
  },

  async isAntiDeletedEnabled(jid, telegramId) {
    try {
      if (!checkCircuitBreaker()) {
        return false
      }

      const result = await queryManager.execute(
        `SELECT antideleted_enabled FROM whatsapp_users 
         WHERE telegram_id = $1`,
        [telegramId],
      )

      if (result.rows.length > 0) {
        return Boolean(result.rows[0].antideleted_enabled)
      }
      return false
    } catch (error) {
      logger.error(`[UserQueries] Error checking anti-deleted status: ${error.message}`)
      return false
    }
  },

  async setAntiDeleted(jid, enabled, telegramId) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")

      await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, jid, antideleted_enabled, created_at, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET 
           jid = COALESCE(EXCLUDED.jid, whatsapp_users.jid),
           antideleted_enabled = EXCLUDED.antideleted_enabled,
           updated_at = CURRENT_TIMESTAMP`,
        [telegramId, jid, enabled],
      )
      return true
    } catch (error) {
      logger.error(`[UserQueries] Error setting anti-deleted status: ${error.message}`)
      throw error
    }
  },

  async getWhatsAppUserByTelegramId(telegramId) {
    if (!checkCircuitBreaker()) {
      return null
    }

    try {
      const result = await queryManager.execute(
        `SELECT jid, telegram_id, antideleted_enabled, antiviewonce_enabled
         FROM whatsapp_users WHERE telegram_id = $1 LIMIT 1`,
        [telegramId],
      )

      if (result.rows.length > 0) {
        return {
          jid: result.rows[0].jid,
          telegram_id: result.rows[0].telegram_id,
          antideleted_enabled: Boolean(result.rows[0].antideleted_enabled),
          antiviewonce_enabled: Boolean(result.rows[0].antiviewonce_enabled),
        }
      }
      return null
    } catch (error) {
      logger.error(`[UserQueries] Error getting WhatsApp user: ${error.message}`)
      return null
    }
  },

  async ensureUserExists(userJid, userName = null) {
    if (!userJid) return null

    if (!checkCircuitBreaker()) {
      logger.warn(`[UserQueries] Circuit open, skipping ensureUserExists`)
      return null
    }

    try {
      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (jid, name, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id) 
         DO UPDATE SET 
           name = COALESCE($2, whatsapp_users.name),
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [userJid, userName],
      )
      return result.rows[0]
    } catch (error) {
      logger.error(`[UserQueries] Error ensuring user exists: ${error.message}`)
      throw error
    }
  },

  async setAutoOnline(telegramId, enabled) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")

      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, auto_online, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET auto_online = EXCLUDED.auto_online, updated_at = CURRENT_TIMESTAMP
         RETURNING auto_online`,
        [telegramId, enabled],
      )

      queryManager.invalidateCache(`presence_${telegramId}`)
      return result.rows[0]?.auto_online || false
    } catch (error) {
      logger.error(`[UserQueries] Error setting auto-online: ${error.message}`)
      throw error
    }
  },

  async setAutoTyping(telegramId, enabled) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")

      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, auto_typing, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET auto_typing = EXCLUDED.auto_typing, updated_at = CURRENT_TIMESTAMP
         RETURNING auto_typing`,
        [telegramId, enabled],
      )

      queryManager.invalidateCache(`presence_${telegramId}`)
      return result.rows[0]?.auto_typing || false
    } catch (error) {
      logger.error(`[UserQueries] Error setting auto-typing: ${error.message}`)
      throw error
    }
  },

  async setAutoRecording(telegramId, enabled) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")

      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, auto_recording, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET auto_recording = EXCLUDED.auto_recording, updated_at = CURRENT_TIMESTAMP
         RETURNING auto_recording`,
        [telegramId, enabled],
      )

      queryManager.invalidateCache(`presence_${telegramId}`)
      return result.rows[0]?.auto_recording || false
    } catch (error) {
      logger.error(`[UserQueries] Error setting auto-recording: ${error.message}`)
      throw error
    }
  },

  async setAutoStatusView(telegramId, enabled) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")

      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, auto_status_view, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET auto_status_view = EXCLUDED.auto_status_view, updated_at = CURRENT_TIMESTAMP
         RETURNING auto_status_view`,
        [telegramId, enabled],
      )

      queryManager.invalidateCache(`presence_${telegramId}`)
      return result.rows[0]?.auto_status_view || false
    } catch (error) {
      logger.error(`[UserQueries] Error setting auto-status-view: ${error.message}`)
      throw error
    }
  },

  async setAutoStatusLike(telegramId, enabled) {
    if (!checkCircuitBreaker()) {
      throw new Error('Database unavailable')
    }

    try {
      if (!telegramId) throw new Error("telegram_id is required")

      const result = await queryManager.execute(
        `INSERT INTO whatsapp_users (telegram_id, auto_status_like, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (telegram_id)
         DO UPDATE SET auto_status_like = EXCLUDED.auto_status_like, updated_at = CURRENT_TIMESTAMP
         RETURNING auto_status_like`,
        [telegramId, enabled],
      )

      queryManager.invalidateCache(`presence_${telegramId}`)
      return result.rows[0]?.auto_status_like || false
    } catch (error) {
      logger.error(`[UserQueries] Error setting auto-status-like: ${error.message}`)
      throw error
    }
  },

  async getPresenceSettings(telegramId) {
    try {
      const cacheKey = `presence_${telegramId}`
      
      // Try cache
      if (queryManager.cache.has(cacheKey)) {
        const cached = queryManager.cache.get(cacheKey)
        if (Date.now() - cached.timestamp < 60000) {
          return cached.data
        }
      }

      if (!checkCircuitBreaker()) {
        // Try fallback
        if (queryManager.fallbackCache.has(cacheKey)) {
          return queryManager.fallbackCache.get(cacheKey).data
        }
        return {
          auto_online: false,
          auto_typing: false,
          auto_recording: false,
          auto_status_view: false,
          auto_status_like: false,
          default_presence: "unavailable",
        }
      }

      const result = await queryManager.execute(
        `SELECT auto_online, auto_typing, auto_recording, 
                auto_status_view, auto_status_like, default_presence
         FROM whatsapp_users WHERE telegram_id = $1`,
        [telegramId],
      )

      const settings = result.rows[0] || {
        auto_online: false,
        auto_typing: false,
        auto_recording: false,
        auto_status_view: false,
        auto_status_like: false,
        default_presence: "unavailable",
      }

      // Cache it
      queryManager.cache.set(cacheKey, { data: settings, timestamp: Date.now() })
      queryManager.fallbackCache.set(cacheKey, { data: settings, timestamp: Date.now() })
      
      return settings
    } catch (error) {
      logger.error(`[UserQueries] Error getting presence settings: ${error.message}`)
      return {
        auto_online: false,
        auto_typing: false,
        auto_recording: false,
        auto_status_view: false,
        auto_status_like: false,
        default_presence: "unavailable",
      }
    }
  },
}


// ==========================================
// SIMPLE JSON-BASED ACTIVITY QUERIES
// ==========================================

export const ActivityQueries = {
  
/**
 * Update user activity when they send a message
 * This is called from processor.js
 */
async updateUserActivity(groupJid, userJid, hasMedia = false) {
  if (!checkCircuitBreaker()) {
    logger.debug(`Circuit open, skipping activity update`)
    return
  }

  try {
    await queryManager.execute(
      `INSERT INTO group_activity (group_jid, activity_data, last_message_at, updated_at)
       VALUES (
         $1::text,
         jsonb_build_object(
           $2::text, 
           jsonb_build_object(
             'messages', 1,
             'media', $3::int,
             'last_seen', CURRENT_TIMESTAMP
           )
         ),
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP
       )
       ON CONFLICT (group_jid)
       DO UPDATE SET
         activity_data = CASE
           WHEN group_activity.activity_data ? $2::text THEN
             jsonb_set(
               jsonb_set(
                 group_activity.activity_data,
                 ARRAY[$2::text, 'messages'],
                 to_jsonb((group_activity.activity_data->$2::text->>'messages')::int + 1)
               ),
               ARRAY[$2::text, 'media'],
               to_jsonb((group_activity.activity_data->$2::text->>'media')::int + $3::int)
             )
           ELSE
             group_activity.activity_data || jsonb_build_object(
               $2::text,
               jsonb_build_object(
                 'messages', 1,
                 'media', $3::int,
                 'last_seen', CURRENT_TIMESTAMP
               )
             )
         END,
         last_message_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [groupJid, userJid, hasMedia ? 1 : 0]
    )
  } catch (error) {
    if (!error.message?.includes('timeout')) {
      logger.error(`Error updating activity: ${error.message}`)
    }
  }
},

/**
 * Mark a user as having left the group
 * Removes them from activity_data but keeps historical record
 */
async setUserLeftGroup(groupJid, userJid) {
  if (!checkCircuitBreaker()) {
    logger.debug(`Circuit open, skipping set user left`)
    return
  }

  try {
    await queryManager.execute(
      `UPDATE group_activity
       SET activity_data = activity_data - $2::text,
           updated_at = CURRENT_TIMESTAMP
       WHERE group_jid = $1`,
      [groupJid, userJid]
    )
    
    logger.debug(`Marked ${userJid} as left from ${groupJid}`)
  } catch (error) {
    logger.error(`Error marking user as left: ${error.message}`)
  }
},

  /**
   * Get ALL activity data for a group
   * Returns JSON with all users who ever sent a message
   */
  async getGroupActivity(groupJid) {
    if (!checkCircuitBreaker()) {
      return null
    }

    try {
      const result = await queryManager.execute(
        `SELECT activity_data, last_message_at, updated_at
         FROM group_activity
         WHERE group_jid = $1`,
        [groupJid]
      )
      
      if (result.rows.length === 0) {
        return { activity_data: {} }
      }
      
      return result.rows[0]
    } catch (error) {
      logger.error(`Error getting group activity: ${error.message}`)
      return { activity_data: {} }
    }
  },

  /**
   * Get active members (sent at least 1 message)
   * Returns sorted array: [{ jid, name, messages, media, last_seen }, ...]
   */
  async getActiveMembers(groupJid) {
    try {
      const groupData = await this.getGroupActivity(groupJid)
      
      if (!groupData || !groupData.activity_data) {
        return []
      }

      // Convert JSON to array and sort by message count
      const activityData = groupData.activity_data
      const activeMembers = []

      for (const [userJid, userData] of Object.entries(activityData)) {
        activeMembers.push({
          user_jid: userJid,
          user_name: userData.name || 'Unknown',
          messages: userData.messages || 0,
          media: userData.media || 0,
          last_seen: userData.last_seen
        })
      }

      // Sort by messages (highest first)
      activeMembers.sort((a, b) => b.messages - a.messages)

      return activeMembers
    } catch (error) {
      logger.error(`Error getting active members: ${error.message}`)
      return []
    }
  },

/**
 * Get inactive members (in group but never sent message OR sent message but not recently)
 * This gets current group members and compares with tracked activity
 */
async getInactiveMembers(sock, groupJid) {
  try {
    // Get current group members from WhatsApp
    const metadata = await sock.groupMetadata(groupJid).catch(() => null)
    
    if (!metadata || !metadata.participants) {
      return []
    }

    // Get tracked activity from database
    const groupData = await this.getGroupActivity(groupJid)
    const activityData = groupData?.activity_data || {}

    const inactiveMembers = []

    // Check each group member
    for (const participant of metadata.participants) {
      const userJid = participant.id
      const userData = activityData[userJid]

      // Inactive if: not in database OR in database with 0 recent messages
      if (!userData || userData.messages === 0) {
        inactiveMembers.push({
          user_jid: userJid,
          messages: userData?.messages || 0,
          last_seen: userData?.last_seen || null
        })
      }
    }

    return inactiveMembers
  } catch (error) {
    logger.error(`Error getting inactive members: ${error.message}`)
    return []
  }
},

  /**
   * Reset activity counters (called weekly/monthly to "reset" the tracking period)
   */
  async resetActivityCounters() {
    if (!checkCircuitBreaker()) {
      return 0
    }

    try {
      const result = await queryManager.execute(
        `UPDATE group_activity
         SET activity_data = '{}'::jsonb,
             active_members_7d = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE last_message_at < NOW() - INTERVAL '7 days'`
      )
      return result.rowCount
    } catch (error) {
      logger.error(`Error resetting counters: ${error.message}`)
      return 0
    }
  },

  /**
   * Delete inactive groups (no messages in 4+ days)
   */
  async cleanupInactiveGroups(daysInactive = 4) {
    if (!checkCircuitBreaker()) {
      return 0
    }

    try {
      const result = await queryManager.execute(
        `DELETE FROM group_activity
         WHERE last_message_at < NOW() - INTERVAL '${daysInactive} days'
         RETURNING group_jid`
      )

      if (result.rows.length > 0) {
        logger.info(`Deleted ${result.rows.length} inactive groups`)
      }

      return result.rows.length
    } catch (error) {
      logger.error(`Error cleaning up groups: ${error.message}`)
      return 0
    }
  }
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

export const Utils = {
  async cleanupOldData(days = 90) {
    if (!checkCircuitBreaker()) {
      logger.warn(`[Utils] Circuit open, skipping cleanupOldData`)
      return 0
    }

    try {
      const result = await queryManager.execute(`SELECT cleanup_old_data($1)`, [days])
      return result.rows[0]?.cleanup_old_data || 0
    } catch (error) {
      logger.error(`[Utils] Error cleaning up old data: ${error.message}`)
      return 0
    }
  },

  async getDatabaseStats() {
    if (!checkCircuitBreaker()) {
      return {}
    }

    const stats = {}
    const tables = ["users", "messages", "groups", "warnings", "settings", "group_analytics", "whatsapp_users"]

    for (const table of tables) {
      try {
        const result = await queryManager.execute(`SELECT COUNT(*) as count FROM ${table}`)
        stats[table] = Number.parseInt(result.rows[0].count)
      } catch (error) {
        stats[table] = 0
      }
    }

    return stats
  },

  async testConnection() {
    try {
      const result = await queryManager.execute("SELECT NOW() as current_time")
      logger.info(`[Utils] Database connection OK: ${result.rows[0].current_time}`)
      return true
    } catch (error) {
      logger.error(`[Utils] Database connection failed: ${error.message}`)
      return false
    }
  },

  async verifyConstraints() {
    if (!checkCircuitBreaker()) {
      return []
    }

    try {
      const result = await queryManager.execute(`
        SELECT conname as constraint_name,
          conrelid::regclass as table_name,
          contype as constraint_type
        FROM pg_constraint 
        WHERE contype = 'u' 
        AND conrelid::regclass::text IN (
          'whatsapp_users', 'groups', 'messages', 
          'warnings', 'settings', 'group_analytics'
        )
        ORDER BY table_name, constraint_name
      `)

      logger.info("[Utils] Unique constraints found:")
      result.rows.forEach((row) => {
        logger.info(`  ${row.table_name}: ${row.constraint_name}`)
      })

      return result.rows
    } catch (error) {
      logger.error(`[Utils] Error verifying constraints: ${error.message}`)
      return []
    }
  },
}

export default queryManager