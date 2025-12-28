// ==================================================================================
// FIXED PERMISSION CHECKER - Stale Cache & Error Handling
// File: src/plugins/permission-checker.js
// ==================================================================================

import { isGroupAdmin, isBotAdmin } from "../whatsapp/groups/index.js"
import { VIPQueries } from "../database/query.js"
import { VIPHelper } from "../whatsapp/index.js"

const log = {
 debug: (msg) => console.log(`[PermChecker] ${msg}`),
  warn: (msg) => console.warn(`[PermChecker] ${msg}`),
  error: (msg, err) => console.error(`[PermChecker] ${msg}`, err?.message || ""),
}

/**
 * ==================================================================================
 * PERMISSION CHECKER - Centralized Access Control with Error Handling
 * ==================================================================================
 */
class PermissionChecker {
  constructor() {
    this.cache = new Map()
    this.CACHE_TTL = 30000 // 30 seconds
    
    // ✅ NEW: Track cache invalidation needs
    this.cacheInvalidationQueue = new Set()
    this.invalidationCheckInterval = 5000 // Check every 5 seconds
    
    setInterval(() => this.cleanupCache(), 60000)
    setInterval(() => this.processCacheInvalidations(), this.invalidationCheckInterval)
    
    log.debug("PermissionChecker initialized with stale cache protection")
  }

  // ================================================================================
  // COMMAND PERMISSION CHECKS (Normal Logic)
  // ================================================================================
  
  async checkCommandPermissions(sock, plugin, m) {
    try {
      const permissions = this.normalizePermissions(plugin)
      
      // Context requirements (fastest checks)
      const contextCheck = await this.checkContextRequirements(permissions, m)
      if (!contextCheck.allowed) return contextCheck

      // Bot requirements
      const botCheck = await this.checkBotRequirements(sock, permissions, m)
      if (!botCheck.allowed) return botCheck

      // User permissions (cached)
      const userCheck = await this.checkUserPermissions(sock, permissions, m)
      if (!userCheck.allowed) return userCheck

      return { allowed: true }
    } catch (error) {
      log.error("Command permission check failed:", error)
      return { 
        allowed: false, 
        message: "❌ Permission check failed. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        silent: false 
      }
    }
  }

  // ================================================================================
  // ANTI-PLUGIN PERMISSION CHECKS (Inverted Logic) - WITH ERROR HANDLING
  // ================================================================================
  
  async checkAntiPluginPermissions(sock, plugin, m) {
    try {
      // ✅ STEP 1: Validate input
      if (!this.validateAntiPluginInput(sock, plugin, m)) {
        log.warn("Invalid input for anti-plugin permission check")
        return false // Safe default: don't process
      }

      const permissions = this.normalizePermissions(plugin)
      
      // Context checks
      if (permissions.groupOnly && !m.isGroup) {
        log.debug(`Skipping ${plugin.name} - not in group`)
        return false
      }
      if (permissions.privateOnly && m.isGroup) {
        log.debug(`Skipping ${plugin.name} - is a group`)
        return false
      }

      // Bot admin check - if bot not admin, can't enforce
      if (permissions.botAdminRequired && m.isGroup) {
        try {
          const botIsAdmin = await this.getCachedBotAdmin(sock, m.chat)
          if (!botIsAdmin) {
            log.debug(`Skipping ${plugin.name} - bot is not admin`)
            return false
          }
        } catch (botError) {
          log.error(`Bot admin check failed for ${plugin.name}:`, botError)
          return false // Safe default
        }
      }

      // ✅ INVERTED: adminRequired = non-admins GET PROCESSED
      if (permissions.adminRequired && m.isGroup) {
        try {
          const senderIsAdmin = await this.getCachedUserAdmin(sock, m.chat, m.sender)
          if (senderIsAdmin) {
            log.debug(`Skipping ${plugin.name} - sender is admin (bypass)`)
            return false  // ← Admins bypass
          }
          // Non-admins fall through and get processed
        } catch (adminError) {
          log.error(`Admin check failed for ${plugin.name}:`, adminError)
          // ✅ NEW: On error, assume NOT admin (process message for safety)
          log.warn(`Assuming non-admin due to error - will process ${plugin.name}`)
        }
      }

      // ✅ INVERTED: vipRequired = non-VIPs GET PROCESSED
      if (permissions.vipRequired) {
        try {
          const senderIsVIP = await this.getCachedVIPStatus(m)
          if (senderIsVIP) {
            log.debug(`Skipping ${plugin.name} - sender is VIP (bypass)`)
            return false  // ← VIPs bypass
          }
          // Non-VIPs fall through and get processed
        } catch (vipError) {
          log.error(`VIP check failed for ${plugin.name}:`, vipError)
          // ✅ NEW: On error, assume NOT VIP (process message for safety)
          log.warn(`Assuming non-VIP due to error - will process ${plugin.name}`)
        }
      }

      // Owner only plugins - only owner bypasses
      if (permissions.ownerOnly) {
        try {
          const isBotOwner = this.getCachedBotOwner(sock, m.sender)
          if (isBotOwner || m.isCreator) {
            log.debug(`Skipping ${plugin.name} - sender is owner (bypass)`)
            return false
          }
        } catch (ownerError) {
          log.error(`Owner check failed for ${plugin.name}:`, ownerError)
          // Owner check failure = assume not owner, process message
          log.warn(`Assuming non-owner due to error - will process ${plugin.name}`)
        }
      }

      // Passed all permission checks - PROCESS THIS MESSAGE
      log.debug(`Processing ${plugin.name} for ${m.sender}`)
      return true

    } catch (error) {
      log.error("Anti-plugin permission check failed:", error)
      return false // ✅ Safe default on unexpected error
    }
  }

  // ✅ NEW: Validate anti-plugin input
  validateAntiPluginInput(sock, plugin, m) {
    try {
      if (!sock || typeof sock !== 'object') {
        log.warn("Invalid socket object")
        return false
      }

      if (!plugin || typeof plugin !== 'object') {
        log.warn("Invalid plugin object")
        return false
      }

      if (!m || typeof m !== 'object') {
        log.warn("Invalid message object")
        return false
      }

      // Check required message properties
      if (!m.chat || typeof m.chat !== 'string') {
        log.warn("Invalid m.chat")
        return false
      }

      if (!m.sender || typeof m.sender !== 'string') {
        log.warn("Invalid m.sender")
        return false
      }

      if (typeof m.isGroup !== 'boolean') {
        log.warn("m.isGroup is not boolean")
        return false
      }

      return true
    } catch (error) {
      log.error("Input validation error:", error)
      return false
    }
  }

  // ================================================================================
  // PERMISSION NORMALIZATION
  // ================================================================================
  
  normalizePermissions(plugin) {
    try {
      const perms = plugin.permissions || {}
      
      return {
        ownerOnly: perms.ownerOnly || plugin.ownerOnly || false,
        vipRequired: perms.vipRequired || plugin.vipOnly || false,
        ownerOrVip: perms.ownerOrVip || false,
        defaultVipOnly: perms.defaultVipOnly || false,
        ownerAndVip: perms.ownerAndVip || false,
        adminRequired: perms.adminRequired || plugin.adminOnly || false,
        botAdminRequired: perms.botAdminRequired || false,
        groupOnly: perms.groupOnly || plugin.category === "groupmenu" || false,
        privateOnly: perms.privateOnly || false,
      }
    } catch (error) {
      log.error("Error normalizing permissions:", error)
      return {
        ownerOnly: false,
        vipRequired: false,
        ownerOrVip: false,
        defaultVipOnly: false,
        ownerAndVip: false,
        adminRequired: false,
        botAdminRequired: false,
        groupOnly: false,
        privateOnly: false,
      }
    }
  }

  // ================================================================================
  // CONTEXT & BOT REQUIREMENTS - WITH ERROR HANDLING
  // ================================================================================
  
  async checkContextRequirements(permissions, m) {
    try {
      if (permissions.groupOnly && !m.isGroup) {
        return {
          allowed: false,
          message: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          silent: false
        }
      }

      if (permissions.privateOnly && m.isGroup) {
        return {
          allowed: false,
          message: "❌ This command can only be used in private chats. Please message me directly.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          silent: false
        }
      }

      return { allowed: true }
    } catch (error) {
      log.error("Context requirement check failed:", error)
      return { allowed: false, message: "❌ Error checking context.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙", silent: false }
    }
  }

  async checkBotRequirements(sock, permissions, m) {
    try {
      if (permissions.botAdminRequired && m.isGroup) {
        const botIsAdmin = await this.getCachedBotAdmin(sock, m.chat)
        
        if (!botIsAdmin) {
          return {
            allowed: false,
            message: "❌ Bot needs to be admin to use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            silent: false
          }
        }
      }

      return { allowed: true }
    } catch (error) {
      log.error("Bot requirement check failed:", error)
      return { allowed: false, message: "❌ Error checking bot status.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙", silent: false }
    }
  }

  // ================================================================================
  // USER PERMISSION CHECKS - WITH ERROR HANDLING
  // ================================================================================
  
  async checkUserPermissions(sock, permissions, m) {
    try {
      const isBotOwner = this.getCachedBotOwner(sock, m.sender)
      
      // 1️⃣ OWNER ONLY (strict - only owner)
      if (permissions.ownerOnly) {
        if (!isBotOwner && !m.isCreator) {
          return {
            allowed: false,
            message: "❌ Bot owner only.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            silent: false
          }
        }
        return { allowed: true }
      }

      // 2️⃣ DEFAULT VIP ONLY
      if (permissions.defaultVipOnly) {
        if (isBotOwner || m.isCreator) {
          return { allowed: true }
        }
        const defaultVipCheck = await this.checkDefaultVIPAccess(m, sock)
        if (!defaultVipCheck.allowed) return defaultVipCheck
        return { allowed: true }
      }

      // 3️⃣ OWNER **AND** VIP
      if (permissions.ownerAndVip) {
        if (!isBotOwner && !m.isCreator) {
          return {
            allowed: false,
            message: "❌ Bot owner only.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            silent: false
          }
        }
        
        const vipCheck = await this.checkVIPAccess(m, sock)
        if (!vipCheck.allowed) {
          return {
            allowed: false,
            message: "❌ Bot owner must also have VIP status.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            silent: false
          }
        }
        
        return { allowed: true }
      }

      // 4️⃣ OWNER **OR** VIP
      if (permissions.ownerOrVip) {
        if (isBotOwner || m.isCreator) {
          return { allowed: true }
        }
        const vipCheck = await this.checkVIPAccess(m, sock)
        if (!vipCheck.allowed) return vipCheck
        return { allowed: true }
      }

      // 5️⃣ VIP ONLY
      if (permissions.vipRequired) {
        const vipCheck = await this.checkVIPAccess(m, sock)
        if (!vipCheck.allowed) return vipCheck
      }

      // 6️⃣ ADMIN ONLY
      if (permissions.adminRequired && m.isGroup) {
        if (isBotOwner || m.isCreator) {
          return { allowed: true }
        }
        const adminCheck = await this.checkAdminAccess(sock, m)
        if (!adminCheck.allowed) return adminCheck
      }

      return { allowed: true }
    } catch (error) {
      log.error("User permission check failed:", error)
      return {
        allowed: false,
        message: "❌ Error checking permissions.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        silent: false
      }
    }
  }

  // ================================================================================
  // INDIVIDUAL ACCESS CHECKS - WITH ERROR HANDLING
  // ================================================================================
  
  async checkVIPAccess(m, sock = null) {
    try {
      if (sock) {
        const isBotOwner = this.getCachedBotOwner(sock, m.sender)
        if (isBotOwner || m.isCreator) return { allowed: true }
      }

      const isVIP = await this.getCachedVIPStatus(m)
      
      if (!isVIP) {
        return {
          allowed: false,
          message: "❌ VIP access required.\n\nContact bot owner for privileges.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          silent: false
        }
      }

      return { allowed: true }
    } catch (error) {
      log.error("VIP check failed:", error)
      return {
        allowed: false,
        message: "❌ Could not verify VIP status.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        silent: false
      }
    }
  }

  async checkDefaultVIPAccess(m, sock = null) {
    try {
      if (sock) {
        const isBotOwner = this.getCachedBotOwner(sock, m.sender)
        if (isBotOwner || m.isCreator) return { allowed: true }
      }

      const userTelegramId = VIPHelper.fromSessionId(m.sessionId)
      if (!userTelegramId) {
        return {
          allowed: false,
          message: "❌ Could not verify VIP status.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          silent: false
        }
      }

      const cacheKey = `defaultvip_${userTelegramId}`
      const cached = this.getFromCache(cacheKey)
      
      let isDefaultVIP = false
      
      if (cached !== null) {
        isDefaultVIP = cached
      } else {
        const vipStatus = await VIPQueries.isVIP(userTelegramId)
        isDefaultVIP = vipStatus.isDefault || vipStatus.level === 99
        this.setCache(cacheKey, isDefaultVIP)
      }
      
      if (!isDefaultVIP) {
        return {
          allowed: false,
          message: "❌ This command is only available to Default VIP (bot owner).\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          silent: false
        }
      }

      return { allowed: true }
    } catch (error) {
      log.error("Default VIP check failed:", error)
      return {
        allowed: false,
        message: "❌ Could not verify Default VIP status.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        silent: false
      }
    }
  }

  async checkAdminAccess(sock, m) {
    try {
      const isBotOwner = this.getCachedBotOwner(sock, m.sender)
      if (isBotOwner || m.isCreator) return { allowed: true }

      const isAdmin = await this.getCachedUserAdmin(sock, m.chat, m.sender)
      
      if (!isAdmin) {
        return {
          allowed: false,
          message: "❌ Only group admins can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          silent: false
        }
      }

      return { allowed: true }
    } catch (error) {
      log.error("Admin check failed:", error)
      return {
        allowed: false,
        message: "❌ Could not verify admin status.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        silent: false
      }
    }
  }

  // ================================================================================
  // CACHED LOOKUPS - WITH STALE CACHE PROTECTION
  // ================================================================================
  
  async getCachedBotAdmin(sock, groupJid) {
    try {
      if (!groupJid || typeof groupJid !== 'string') {
        log.warn("Invalid groupJid for bot admin check")
        return false
      }

      const cacheKey = `botadmin_${groupJid}`
      const cached = this.getFromCache(cacheKey)
      
      if (cached !== null) {
        log.debug(`Bot admin cache hit for ${groupJid}`)
        return cached
      }
      
      log.debug(`Bot admin cache miss for ${groupJid} - fetching fresh`)
      const botIsAdmin = await isBotAdmin(sock, groupJid)
      this.setCache(cacheKey, botIsAdmin)
      return botIsAdmin
    } catch (error) {
      log.error("Error checking bot admin:", error)
      return false // Safe default: assume not admin
    }
  }

  async getCachedUserAdmin(sock, groupJid, userJid) {
    try {
      // ✅ Input validation
      if (!groupJid || typeof groupJid !== 'string') {
        log.warn("Invalid groupJid for user admin check")
        return false
      }

      if (!userJid || typeof userJid !== 'string') {
        log.warn("Invalid userJid for user admin check")
        return false
      }

      const cacheKey = `admin_${groupJid}_${userJid}`
      const cached = this.getFromCache(cacheKey)
      
      if (cached !== null) {
        log.debug(`Admin cache hit for ${userJid} in ${groupJid}`)
        return cached
      }
      
      log.debug(`Admin cache miss for ${userJid} in ${groupJid} - fetching fresh`)
      const userIsAdmin = await isGroupAdmin(sock, groupJid, userJid)
      this.setCache(cacheKey, userIsAdmin)
      return userIsAdmin
    } catch (error) {
      log.error(`Error checking admin status for ${userJid}:`, error)
      return false // Safe default: assume not admin
    }
  }

  async getCachedVIPStatus(m) {
    try {
      if (!m || typeof m !== 'object') {
        log.warn("Invalid message object for VIP check")
        return false
      }

      if (m.isCreator) return true

      const userTelegramId = VIPHelper.fromSessionId(m.sessionId)
      if (!userTelegramId) {
        log.warn("Could not extract telegram ID from session")
        return false
      }

      const cacheKey = `vip_${userTelegramId}`
      const cached = this.getFromCache(cacheKey)
      
      if (cached !== null) {
        log.debug(`VIP cache hit for ${userTelegramId}`)
        return cached
      }
      
      log.debug(`VIP cache miss for ${userTelegramId} - fetching fresh`)
      const vipStatus = await VIPQueries.isVIP(userTelegramId)
      this.setCache(cacheKey, vipStatus.isVIP)
      return vipStatus.isVIP
    } catch (error) {
      log.error("VIP check failed:", error)
      return false // Safe default: assume not VIP
    }
  }

  getCachedBotOwner(sock, senderJid) {
    try {
      if (!sock || !senderJid) return false

      const cacheKey = `botowner_${senderJid}`
      const cached = this.getFromCache(cacheKey)
      
      if (cached !== null) {
        return cached
      }
      
      const isOwner = this.checkIsBotOwner(sock, senderJid)
      this.setCache(cacheKey, isOwner)
      return isOwner
    } catch (error) {
      log.error("Error checking bot owner:", error)
      return false
    }
  }

  checkIsBotOwner(sock, senderJid) {
    try {
      if (!sock?.user?.id || !senderJid) return false

      let botUserId = sock.user.id
      if (botUserId.includes(':')) botUserId = botUserId.split(':')[0]
      if (botUserId.includes('@')) botUserId = botUserId.split('@')[0]

      let userNumber = senderJid
      if (userNumber.includes(':')) userNumber = userNumber.split(':')[0]
      if (userNumber.includes('@')) userNumber = userNumber.split('@')[0]

      const isOwner = botUserId === userNumber
      if (isOwner) log.debug(`Bot owner detected: ${userNumber}`)
      return isOwner
    } catch (error) {
      log.error("Error checking bot owner:", error)
      return false
    }
  }

  // ================================================================================
  // CACHE MANAGEMENT - WITH STALE CACHE PREVENTION
  // ================================================================================
  
  getFromCache(key) {
    try {
      const cached = this.cache.get(key)
      if (!cached) return null
      
      if (Date.now() - cached.timestamp > this.CACHE_TTL) {
        this.cache.delete(key)
        return null
      }
      
      return cached.value
    } catch (error) {
      log.error("Cache retrieval error:", error)
      return null
    }
  }

  setCache(key, value) {
    try {
      this.cache.set(key, { value, timestamp: Date.now() })
    } catch (error) {
      log.error("Cache setting error:", error)
    }
  }

  // ✅ NEW: Invalidate specific cache entries
  invalidateCache(pattern) {
    try {
      let count = 0
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key)
          count++
          log.debug(`Invalidated cache: ${key}`)
        }
      }
      return count
    } catch (error) {
      log.error("Cache invalidation error:", error)
      return 0
    }
  }

  // ✅ NEW: Queue cache invalidation (e.g., when admin status changes)
  queueCacheInvalidation(groupJid) {
    try {
      if (!groupJid || typeof groupJid !== 'string') {
        log.warn("Invalid groupJid for cache invalidation queue")
        return
      }

      this.cacheInvalidationQueue.add(groupJid)
      log.debug(`Queued cache invalidation for ${groupJid}`)
    } catch (error) {
      log.error("Cache invalidation queue error:", error)
    }
  }

  // ✅ NEW: Process queued cache invalidations
  processCacheInvalidations() {
    try {
      if (this.cacheInvalidationQueue.size === 0) return

      for (const groupJid of this.cacheInvalidationQueue) {
        try {
          // Invalidate all admin caches for this group
          this.invalidateCache(`admin_${groupJid}`)
          this.invalidateCache(`botadmin_${groupJid}`)
          
          log.info(`Processed cache invalidation for group ${groupJid}`)
        } catch (error) {
          log.error(`Error invalidating cache for ${groupJid}:`, error)
        }
      }

      this.cacheInvalidationQueue.clear()
    } catch (error) {
      log.error("Cache invalidation processing error:", error)
    }
  }

  cleanupCache() {
    try {
      const now = Date.now()
      let cleaned = 0
      
      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp > this.CACHE_TTL) {
          this.cache.delete(key)
          cleaned++
        }
      }
      
      if (this.cache.size > 500) {
        const entries = Array.from(this.cache.entries())
          .sort((a, b) => a[1].timestamp - b[1].timestamp)
        
        const toRemove = entries.slice(0, this.cache.size - 250)
        toRemove.forEach(([key]) => this.cache.delete(key))
        cleaned += toRemove.length
      }
      
      if (cleaned > 0) {
        log.debug(`Cleaned ${cleaned} cache entries (remaining: ${this.cache.size})`)
      }
    } catch (error) {
      log.error("Cache cleanup error:", error)
    }
  }

  clearCache() {
    try {
      this.cache.clear()
      this.cacheInvalidationQueue.clear()
      log.debug("Cache cleared")
    } catch (error) {
      log.error("Cache clear error:", error)
    }
  }

  // ✅ NEW: Get cache stats
  getCacheStats() {
    try {
      return {
        totalEntries: this.cache.size,
        queuedInvalidations: this.cacheInvalidationQueue.size,
        cacheTTL: this.CACHE_TTL,
        timestamp: Date.now()
      }
    } catch (error) {
      log.error("Cache stats error:", error)
      return {
        totalEntries: 0,
        queuedInvalidations: 0,
        cacheTTL: this.CACHE_TTL,
        timestamp: Date.now()
      }
    }
  }
}

export default new PermissionChecker()