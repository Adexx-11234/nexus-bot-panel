// Optimized Plugin System with Full Directory Watching
import fs from "fs/promises"
import fsr from "fs"
import path from "path"
import { fileURLToPath } from "url"
import chalk from "chalk"
import { isGroupAdmin, isBotAdmin } from "../whatsapp/groups/index.js"
import permissionChecker from "./permission-checker.js"
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const log = {
  info: (msg) => console.log(chalk.blue("[INFO]"), msg),
  warn: (msg) => console.log(chalk.yellow("[WARN]"), msg),
  debug: (msg) => /*console.log(chalk.cyan('[DEBUG]'), msg)*/ null,
  error: (msg, err) => console.log(chalk.red("[ERROR]"), msg, err?.message || ""),
}

// ==================== MESSAGE DEDUPLICATION SYSTEM ====================
/**
 * MessageDeduplicator - Prevents multiple bot sessions from processing same message
 *
 * Fire and forget - reduced TTL to 10s, cleanup every 10s for fast RAM release
 */
class MessageDeduplicator {
constructor() {
  this.processedMessages = new Map()
  this.cleanupInterval = 10000 // 10 seconds
  this.maxAge = 30000 // 30 seconds TTL (increased for slow commands)
  this.lockTimeout = 15000 // 15 seconds for active locks

  this.startCleanup()

  log.info("MessageDeduplicator initialized (cleanup: 10s, TTL: 30s, Lock: 15s)")
}

  generateKey(groupJid, messageId) {
    if (!groupJid || !messageId) return null
    return `${groupJid}_${messageId}`
  }

  tryLockForProcessing(messageKey, sessionId, action) {
  if (!messageKey) return false

  const existing = this.processedMessages.get(messageKey)
  
  // Check if action already processed
  if (existing?.actions.has(action)) {
    return false
  }

  // Check if locked by another session AND lock is still valid
  if (existing?.lockedBy && existing.lockedBy !== sessionId) {
    // If lock is expired (older than 15s), allow new session to lock
    const lockAge = Date.now() - existing.timestamp
    if (lockAge < this.lockTimeout) {
      return false // Lock still valid, deny
    }
    // Lock expired, allow this session to take over
    log.debug(`Lock expired for ${action}, allowing new session`)
  }

  // Create or update entry atomically
  if (!this.processedMessages.has(messageKey)) {
    this.processedMessages.set(messageKey, {
      actions: new Set(),
      timestamp: Date.now(),
      lockedBy: sessionId,
    })
  } else {
    existing.lockedBy = sessionId
    existing.timestamp = Date.now()
  }

  return true
}

  markAsProcessed(messageKey, sessionId, action) {
    if (!messageKey) return

    if (!this.processedMessages.has(messageKey)) {
      this.processedMessages.set(messageKey, {
        actions: new Set(),
        timestamp: Date.now(),
        lockedBy: sessionId,
      })
    }

    const entry = this.processedMessages.get(messageKey)
    entry.actions.add(action)
    entry.timestamp = Date.now()

    setTimeout(() => {
      this.processedMessages.delete(messageKey)
    }, this.maxAge)
  }

  isActionProcessed(messageKey, action) {
    if (!messageKey) return false
    const entry = this.processedMessages.get(messageKey)
    return entry ? entry.actions.has(action) : false
  }

  cleanup() {
  const now = Date.now()
  let cleanedCount = 0

  // Remove expired entries
  for (const [key, entry] of this.processedMessages.entries()) {
    if (now - entry.timestamp > this.maxAge) {
      this.processedMessages.delete(key)
      cleanedCount++
    }
  }

  // Aggressive memory management: Keep max 300 entries
  if (this.processedMessages.size > 300) {
    const entries = Array.from(this.processedMessages.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
    
    const toRemove = entries.slice(0, this.processedMessages.size - 150)
    toRemove.forEach(([key]) => this.processedMessages.delete(key))
    cleanedCount += toRemove.length
  }

  // Release stale locks (locked but not processed for >15s)
  for (const [key, entry] of this.processedMessages.entries()) {
    if (entry.lockedBy && entry.actions.size === 0) {
      const lockAge = now - entry.timestamp
      if (lockAge > this.lockTimeout) {
        entry.lockedBy = null // Release stale lock
      }
    }
  }

  if (cleanedCount > 0) {
    log.info(`Cleaned ${cleanedCount} entries (remaining: ${this.processedMessages.size})`)
  }
}

  startCleanup() {
    setInterval(() => this.cleanup(), this.cleanupInterval)
  }

  getStats() {
    return {
      totalEntries: this.processedMessages.size,
    }
  }
}

const commandIndexCache = new Map() // command -> pluginId (prebuilt index)
let commandIndexBuilt = false

class PluginLoader {
  constructor() {
    this.plugins = new Map()
    this.commands = new Map()
    this.antiPlugins = new Map()
    this.watchers = new Map()
    this.reloadTimeouts = new Map()
    this.isInitialized = false
    this.pluginDir = path.join(__dirname, "..", "plugins")
    this.projectRoot = path.join(__dirname, "..")
    this.autoReloadEnabled = process.env.PLUGIN_AUTO_RELOAD !== "false"
    this.reloadDebounceMs = 1000
    this.tempContactStore = new Map()
    this.deduplicator = new MessageDeduplicator()
    this.permissionCache = new Map() // "pluginId_userId" -> { allowed, timestamp }
    this.PERMISSION_CACHE_TTL = 30000 // 30 seconds

    this._startTempCleanup()

    log.info(`Plugin loader initialized (Auto-reload: ${this.autoReloadEnabled ? "ON" : "OFF"})`)
  }

  _startTempCleanup() {
    setInterval(() => {
      this.cleanupTempData()
    }, 30000) // Every 30 seconds
  }

  normalizeJid(jid) {
    if (!jid) return null
    return jid.split("@")[0].split(":")[0] + "@s.whatsapp.net"
  }

  compareJids(jid1, jid2) {
    return this.normalizeJid(jid1) === this.normalizeJid(jid2)
  }

  validatePlugin(plugin) {
    return !!(plugin?.name && typeof plugin.execute === "function")
  }

  generateFallbackName(jid) {
    if (!jid) return "Unknown"
    const phoneNumber = jid.split("@")[0]
    return phoneNumber?.length > 4 ? `User ${phoneNumber.slice(-4)}` : "Unknown User"
  }

  clearTempData() {
    this.tempContactStore.clear()
  }

  cleanupTempData() {
    const now = Date.now()
    let removed = 0
    for (const [jid, data] of this.tempContactStore.entries()) {
      if (now - data.timestamp > 30000) {
        // 30 seconds
        this.tempContactStore.delete(jid)
        removed++
      }
    }
    if (this.tempContactStore.size > 200) {
      const entries = Array.from(this.tempContactStore.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)
      const toRemove = entries.slice(0, this.tempContactStore.size - 100)
      toRemove.forEach(([key]) => this.tempContactStore.delete(key))
      removed += toRemove.length
    }
    if (removed > 0) {
      log.debug(`Cleaned ${removed} temp contacts (remaining: ${this.tempContactStore.size})`)
    }
  }

  // ==================== PLUGIN LOADING ====================

  async loadPlugins() {
    try {
      await this.clearWatchers()
      await this.loadAllPlugins()

      if (this.autoReloadEnabled) {
        await this.setupProjectWatcher()
      }

      this.isInitialized = true
      log.info(`Loaded ${this.plugins.size} plugins, ${this.commands.size} commands`)

      setInterval(() => this.cleanupTempData(), 120000)
      this._buildCommandIndex()
      return Array.from(this.plugins.values())
    } catch (error) {
      log.error("Error loading plugins:", error)
      throw error
    }
  }

  async loadAllPlugins() {
    await this.loadPluginsFromDirectory(this.pluginDir)
    this.registerAntiPlugins()
  }

  registerAntiPlugins() {
    for (const [pluginId, plugin] of this.plugins.entries()) {
      if (typeof plugin.processMessage === "function") {
        this.antiPlugins.set(pluginId, plugin)
      }
    }
  }

  async loadPluginsFromDirectory(dirPath, parentCategory = null) {
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true })

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name)

        if (item.isDirectory()) {
          const folderCategory = item.name.toLowerCase()
          await this.loadPluginsFromDirectory(itemPath, folderCategory)
        } else if (item.name.endsWith(".js")) {
          const category = parentCategory || "main"
          await this.loadPlugin(dirPath, item.name, category)
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        log.error(`Error loading plugins from ${dirPath}:`, error)
      }
    }
  }

  async loadPlugin(pluginPath, filename, category) {
    try {
      const fullPath = path.join(pluginPath, filename)
      const pluginName = path.basename(filename, ".js")
      const moduleUrl = `file://${fullPath}?t=${Date.now()}`

      const pluginModule = await import(moduleUrl)
      const plugin = pluginModule.default || pluginModule

      if (!this.validatePlugin(plugin)) return

      const pluginId = `${category}:${pluginName}`
      const commands = new Set()
      ;[plugin.commands, plugin.aliases].forEach((arr) => {
        if (Array.isArray(arr)) {
          arr.forEach((c) => {
            if (typeof c === "string") {
              const normalized = c.toLowerCase().trim()
              if (normalized) commands.add(normalized)
            }
          })
        }
      })

      if (plugin.name) commands.add(plugin.name.toLowerCase().trim())
      commands.add(pluginName.toLowerCase().trim())

      const uniqueCommands = Array.from(commands)

      const pluginData = {
        ...plugin,
        id: pluginId,
        category,
        filename,
        fullPath,
        pluginPath,
        commands: uniqueCommands,
      }

      this.plugins.set(pluginId, pluginData)

      uniqueCommands.forEach((command) => {
        this.commands.set(command, pluginId)
      })

      if (typeof plugin.processMessage === "function") {
        this.antiPlugins.set(pluginId, pluginData)
      }
    } catch (error) {
      log.error(`Error loading plugin ${filename}:`, error)
    }
  }

  // ==================== FILE WATCHING ====================

  async setupProjectWatcher() {
    try {
      await this.watchDirectoryRecursively(this.projectRoot, "main")
    } catch (error) {
      log.error("Error setting up project watcher:", error)
    }
  }

  async watchDirectoryRecursively(dirPath, category = "main") {
    try {
      const dirName = path.basename(dirPath)

      // Skip certain directories
      if (["node_modules", ".git", ".env", "dist", "build", "sessions", "logs"].includes(dirName)) {
        return
      }

      const watcher = fsr.watch(dirPath, { persistent: false }, (eventType, filename) => {
        if (!filename || filename.startsWith(".env") || filename.startsWith(".")) return

        const fullPath = path.join(dirPath, filename)

        if (filename.endsWith(".js")) {
          // Check if it's a plugin file
          if (fullPath.includes(this.pluginDir)) {
            // Hot-reload PLUGIN file
            const relativePath = path.relative(this.pluginDir, dirPath)
            const pluginCategory = relativePath ? relativePath.split(path.sep)[0] : category
            this.handleFileChange(dirPath, filename, pluginCategory)
          } else {
            // Hot-reload ANY other JavaScript file (utilities, helpers, etc.)
            this.handleAnyFileChange(fullPath)
          }
        }
      })

      this.watchers.set(dirPath, watcher)

      // Recursively watch subdirectories
      const items = await fs.readdir(dirPath, { withFileTypes: true })
      for (const item of items) {
        if (item.isDirectory()) {
          const subDirPath = path.join(dirPath, item.name)
          const subCategory = item.name.toLowerCase()
          await this.watchDirectoryRecursively(subDirPath, subCategory)
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        log.error(`Error watching ${dirPath}:`, error)
      }
    }
  }

  async handleFileChange(dirPath, filename, category) {
    const key = path.join(dirPath, filename)
    if (this.reloadTimeouts.has(key)) {
      clearTimeout(this.reloadTimeouts.get(key))
    }

    const timeout = setTimeout(async () => {
      try {
        await this.loadPlugin(dirPath, filename, category)
        const relativePath = path.relative(this.pluginDir, path.join(dirPath, filename))
        log.info(`🔄 Plugin reloaded: ${relativePath}`)
      } catch (error) {
        log.error(`Failed to reload plugin ${filename}:`, error)
      } finally {
        this.reloadTimeouts.delete(key)
      }
    }, this.reloadDebounceMs)

    this.reloadTimeouts.set(key, timeout)
  }

  async handleAnyFileChange(fullPath) {
    const reloadKey = fullPath
    if (this.reloadTimeouts.has(reloadKey)) {
      clearTimeout(this.reloadTimeouts.get(reloadKey))
    }

    const timeout = setTimeout(async () => {
      try {
        const relativePath = path.relative(this.projectRoot, fullPath)

        // Clear Node's require cache (if using CommonJS)
        if (require.cache[fullPath]) {
          delete require.cache[fullPath]
        }

        // Hot-reload with cache busting
        const moduleUrl = `file://${fullPath}?t=${Date.now()}`
        await import(moduleUrl)

        log.info(`🔄 File reloaded: ${relativePath}`)
      } catch (error) {
        const relativePath = path.relative(this.projectRoot, fullPath)
        log.error(`❌ Failed to reload ${relativePath}:`, error.message)
      } finally {
        this.reloadTimeouts.delete(reloadKey)
      }
    }, this.reloadDebounceMs)

    this.reloadTimeouts.set(reloadKey, timeout)
  }
  async clearWatchers() {
    this.watchers.forEach((watcher) => {
      try {
        watcher.close?.()
      } catch (_) {}
    })
    this.watchers.clear()

    this.reloadTimeouts.forEach((timeout) => clearTimeout(timeout))
    this.reloadTimeouts.clear()
  }
    
  // ==================== COMMAND EXECUTION ====================

  _buildCommandIndex() {
    commandIndexCache.clear()
    for (const [command, pluginId] of this.commands.entries()) {
      commandIndexCache.set(command, pluginId)
    }
    commandIndexBuilt = true
    log.info(`Command index built: ${commandIndexCache.size} commands`)
  }

  findCommand(commandName) {
    if (!commandName || typeof commandName !== "string") return null
    const normalizedCommand = commandName.toLowerCase().trim()

    // Use cached index for O(1) lookup
    if (commandIndexBuilt && commandIndexCache.has(normalizedCommand)) {
      const pluginId = commandIndexCache.get(normalizedCommand)
      return this.plugins.get(pluginId)
    }

    // Fallback to original lookup
    const pluginId = this.commands.get(normalizedCommand)
    return pluginId ? this.plugins.get(pluginId) : null
  }

  async executeCommand(sock, sessionId, commandName, args, m) {
  try {
    const plugin = this.findCommand(commandName)
    if (!plugin) return { success: false, silent: true }

    // Extract push name
    if (!m.pushName) {
      this.extractPushName(sock, m)
        .then((name) => {
          m.pushName = name
        })
        .catch(() => {})
    }

    const isCreator = this.checkIsBotOwner(sock, m.sender, m.key?.fromMe)

    const enhancedM = {
      ...m,
      chat: m.chat || m.key?.remoteJid || m.from,
      sender: m.sender || m.key?.participant || m.from,
      isCreator,
      isOwner: isCreator,
      isGroup: m.isGroup || (m.chat && m.chat.endsWith("@g.us")),
      sessionContext: m.sessionContext || { telegram_id: "Unknown", session_id: sessionId },
      sessionId,
      reply: m.reply,
      prefix: m.prefix || ".",
      pluginCategory: plugin.category,
      commandName: commandName.toLowerCase()
    }

    // ✅ FIX: Pre-populate admin status BEFORE permission check
    if (enhancedM.isGroup) {
      try {
        // Check admin statuses in parallel
        const [userIsAdmin, botIsAdmin] = await Promise.all([
          isGroupAdmin(sock, enhancedM.chat, enhancedM.sender),
          isBotAdmin(sock, enhancedM.chat)
        ])
        
        enhancedM.isAdmin = userIsAdmin
        enhancedM.isBotAdmin = botIsAdmin
        
        log.debug(`Admin status for ${commandName}: user=${userIsAdmin}, bot=${botIsAdmin}`)
      } catch (adminCheckError) {
        log.error("Error pre-checking admin status:", adminCheckError)
        // Don't fail - let permission checker handle it
      }
    }

    const [modeAllowed, permissionCheck] = await Promise.all([
      this._checkBotMode(enhancedM),
      this._checkPermissionsCached(sock, plugin, enhancedM),
    ])

    if (!modeAllowed) {
      this.clearTempData()
      return { success: false, silent: true }
    }

    if (enhancedM.isGroup) {
      const groupOnlyAllowed = await this._checkGroupOnly(sock, enhancedM, commandName)
      if (!groupOnlyAllowed) {
        this.clearTempData()
        return { success: false, silent: true }
      }
    }

    if (!permissionCheck.allowed) {
      this.clearTempData()

      if (permissionCheck.silent) {
        return { success: false, silent: true }
      }

      // For groupmenu/gamemenu: Only first bot sends error
      const needsDeduplication = plugin.category === 'groupmenu' || plugin.category === 'gamemenu'
      
      if (needsDeduplication) {
        const messageKey = this.deduplicator.generateKey(enhancedM.chat, m.key?.id)
        if (messageKey) {
          const actionKey = `permission-error-${commandName}`
          
          if (!this.deduplicator.tryLockForProcessing(messageKey, sessionId, actionKey)) {
            return { success: false, silent: true }
          }
          
          try {
            await sock.sendMessage(enhancedM.chat, { text: permissionCheck.message }, { quoted: m })
            this.deduplicator.markAsProcessed(messageKey, sessionId, actionKey)
          } catch (sendError) {
            log.error("Failed to send permission error:", sendError)
          }
        }
      } else {
        try {
          await sock.sendMessage(enhancedM.chat, { text: permissionCheck.message }, { quoted: m })
        } catch (sendError) {
          log.error("Failed to send permission error:", sendError)
        }
      }

      return { success: false, error: permissionCheck.message }
    }

    // Execute plugin
    const result = await this.executePluginWithFallback(sock, sessionId, args, enhancedM, plugin)

    this.clearTempData()
    return { success: true, result }
  } catch (error) {
    log.error(`Error executing command ${commandName}:`, error)
    this.clearTempData()
    return { success: false, error: error.message }
  }
}

  async _checkBotMode(m) {
    if (m.isCreator) return true
    try {
      const { UserQueries } = await import("../database/query.js")
      const modeSettings = await UserQueries.getBotMode(m.sessionContext.telegram_id)
      return modeSettings.mode !== "self"
    } catch (error) {
      log.error("Error checking bot mode:", error)
      return true // Allow on error
    }
  }

  async _checkGroupOnly(sock, m, commandName) {
    try {
      const { GroupQueries } = await import("../database/query.js")
      const isGroupOnlyEnabled = await GroupQueries.isGroupOnlyEnabled(m.chat)

      if (!isGroupOnlyEnabled && !["grouponly", "go"].includes(commandName.toLowerCase())) {
        const isAdmin = await isGroupAdmin(sock, m.chat, m.sender)

        if (isAdmin || m.isCreator) {
          await sock.sendMessage(
            m.chat,
            { text: `❌ *Group Commands Disabled*\n\nUse *${m.prefix}grouponly on* to enable.` },
            { quoted: m },
          )
        }
        return false
      }
      return true
    } catch (error) {
      log.error("Error checking grouponly:", error)
      return true
    }
  }

  async _checkPermissionsCached(sock, plugin, m) {
  const cacheKey = `${plugin.id}_${m.sender}_${m.chat}`
  const cached = this.permissionCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < this.PERMISSION_CACHE_TTL) {
    return cached.result
  }

  // ✅ Use centralized permission checker for COMMANDS
  const result = await permissionChecker.checkCommandPermissions(sock, plugin, m)

  this.permissionCache.set(cacheKey, {
    result,
    timestamp: Date.now(),
  })

  if (this.permissionCache.size > 500) {
    const entries = Array.from(this.permissionCache.entries())
    const toRemove = entries.slice(0, 200)
    toRemove.forEach(([key]) => this.permissionCache.delete(key))
  }

  return result
}

  // ==================== PERMISSION CHECKS ====================

async executePluginWithFallback(sock, sessionId, args, m, plugin) {
  // Retry logic for database conflicts (groupmenu only)
  const maxRetries = plugin.category === 'groupmenu' ? 2 : 0
  let lastError = null
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        log.debug(`Retry attempt ${attempt} for ${plugin.name}`)
        await new Promise(resolve => setTimeout(resolve, 100 * attempt)) // Backoff
      }
      
      if (m.isGroup && (!m.hasOwnProperty('isAdmin') || !m.hasOwnProperty('isBotAdmin'))) {
        m.isAdmin = await isGroupAdmin(sock, m.chat, m.sender)
        m.isBotAdmin = await isBotAdmin(sock, m.chat)
      }

      if (plugin.execute.length === 4) {
        return await plugin.execute(sock, sessionId, args, m)
      }
      
      if (plugin.execute.length === 3) {
        const context = {
          args: args || [],
          quoted: m.quoted || null,
          isAdmin: m.isAdmin || false,
          isBotAdmin: m.isBotAdmin || false,
          isCreator: m.isCreator || false,
          store: null
        }
        return await plugin.execute(sock, m, context)
      }

      return await plugin.execute(sock, sessionId, args, m)
} catch (error) {
      lastError = error
      
      // If it's a database error and we have retries left, continue
      if (attempt < maxRetries && error.message?.includes('database')) {
        log.warn(`Database error on attempt ${attempt + 1}, retrying...`)
        continue
      }
      
      // No more retries or non-database error
      log.error(`Plugin execution failed for ${plugin.name}:`, error)
      throw error
    }
  }
  
  // All retries failed
  if (lastError) throw lastError
}

  checkIsBotOwner(sock, userJid, fromMe = false) {
    // If fromMe is true, it's the bot owner
    if (fromMe === true) return true

    // Fallback: compare phone numbers
    try {
      if (!sock?.user?.id || !userJid) return false

      const botPhone = sock.user.id.split("@")[0].split(":")[0]
      const userPhone = userJid.split("@")[0].split(":")[0]

      return botPhone === userPhone
    } catch (error) {
      return false
    }
  }

  determineRequiredPermission(plugin) {
    if (!plugin) return "user"

    if (Array.isArray(plugin.permissions) && plugin.permissions.length > 0) {
      const perms = plugin.permissions.map((p) => String(p).toLowerCase())

      if (perms.includes("owner")) return "owner"
      if (perms.includes("admin") || perms.includes("system_admin")) return "group_admin"
      if (perms.includes("group_admin")) return "group_admin"
      if (perms.includes("vip")) return "vip"
    }

    if (plugin.ownerOnly === true) return "owner"
    if (plugin.adminOnly === true) return "group_admin"
    if (plugin.vipOnly === true) return "vip"

    const category = plugin.category?.toLowerCase() || ""

    if (category === "ownermenu" || category.includes("owner")) return "owner"
    if (category === "vipmenu" || category.includes("vip")) return "vip"
    if (category.includes("group") || category === "groupmenu") return "group_admin"
    if (plugin.filename?.toLowerCase().includes("owner")) return "owner"
    if (plugin.filename?.toLowerCase().includes("vip")) return "vip"

    return "user"
  }
async executePluginWithFallback(sock, sessionId, args, m, plugin) {
    try {
      if (m.isGroup && (!m.hasOwnProperty('isAdmin') || !m.hasOwnProperty('isBotAdmin'))) {
        m.isAdmin = await isGroupAdmin(sock, m.chat, m.sender)
        m.isBotAdmin = await isBotAdmin(sock, m.chat)
      }

      if (plugin.execute.length === 4) {
        return await plugin.execute(sock, sessionId, args, m)
      }
      
      if (plugin.execute.length === 3) {
        const context = {
          args: args || [],
          quoted: m.quoted || null,
          isAdmin: m.isAdmin || false,
          isBotAdmin: m.isBotAdmin || false,
          isCreator: m.isCreator || false,
          store: null
        }
        return await plugin.execute(sock, m, context)
      }

      return await plugin.execute(sock, sessionId, args, m)
    } catch (error) {
      log.error(`Plugin execution failed for ${plugin.name}:`, error)
      throw error
    }
  }

    
  // ==================== HELPER METHODS ====================

  async extractPushName(sock, m) {
    try {
      let pushName = m.pushName || m.message?.pushName || m.key?.notify

      if (!pushName && this.tempContactStore.has(m.sender)) {
        const cached = this.tempContactStore.get(m.sender)
        if (cached.pushName && Date.now() - cached.timestamp < 30000) {
          pushName = cached.pushName
        }
      }

      if (!pushName && sock.store?.contacts?.[m.sender]) {
        const contact = sock.store.contacts[m.sender]
        pushName = contact.notify || contact.name || contact.pushName
      }

      pushName = pushName || this.generateFallbackName(m.sender)

      this.tempContactStore.set(m.sender, {
        pushName: pushName,
        timestamp: Date.now(),
      })

      return pushName
    } catch (error) {
      return this.generateFallbackName(m.sender)
    }
  }

 async processAntiPlugins(sock, sessionId, m) {
  const messageKey = this.deduplicator.generateKey(m.chat, m.key?.id)
  
  // ✅ NEW: Validate message key
  if (!messageKey) {
    log.warn("Cannot generate message key for anti-plugin processing - missing chat or message ID")
    return // Exit early if we can't deduplicate
  }

  for (const plugin of this.antiPlugins.values()) {
    // ✅ NEW: Comprehensive try-catch for each plugin
    try {
      // ✅ STEP 1: Validate plugin and message
      if (!this.validateAntiPluginInput(sock, sessionId, m, plugin)) {
        log.warn(`Skipping ${plugin?.name || "unknown"} - validation failed`)
        continue
      }

      // ✅ STEP 2: Check if feature is enabled
      let enabled = true
      if (typeof plugin.isEnabled === "function") {
        try {
          enabled = await plugin.isEnabled(m.chat)
        } catch (enableError) {
          log.error(`Error checking if ${plugin.name} is enabled:`, enableError)
          continue // Skip to next plugin if enable check fails
        }
      }
      if (!enabled) continue

      // ✅ STEP 3: Basic shouldProcess check with error handling
      let shouldProcess = true
      if (typeof plugin.shouldProcess === "function") {
        try {
          shouldProcess = await plugin.shouldProcess(m)
        } catch (shouldProcessError) {
          log.error(`Error in shouldProcess for ${plugin.name}:`, shouldProcessError)
          continue // Skip to next plugin if shouldProcess fails
        }
      }
      if (!shouldProcess) continue

      // ✅ STEP 4: CHECK PERMISSIONS BEFORE LOCKING (with error handling)
      let shouldProcessMessage = false
      try {
        shouldProcessMessage = await permissionChecker.checkAntiPluginPermissions(sock, plugin, m)
      } catch (permError) {
        log.error(`Error checking anti-plugin permissions for ${plugin.name}:`, permError)
        // ✅ Safe default: don't process if permission check fails
        continue
      }
      
      if (!shouldProcessMessage) {
        log.debug(`Skipping ${plugin.name} for ${m.sender} - bypasses anti-plugin (admin/vip/owner)`)
        continue  // ← Skip WITHOUT acquiring lock
      }

      // ✅ STEP 5: NOW try to acquire lock (only if should process)
      const actionKey = `anti-${plugin.name || "unknown"}`

      let lockAcquired = false
      try {
        lockAcquired = this.deduplicator.tryLockForProcessing(messageKey, sessionId, actionKey)
      } catch (lockError) {
        log.error(`Error acquiring lock for ${plugin.name}:`, lockError)
        continue // Skip if lock fails
      }

      if (!lockAcquired) {
        log.debug(`Skipping ${plugin.name} - already being processed by another session`)
        continue  // Another session is already processing this message
      }

      // ✅ STEP 6: Got lock - process the message with error handling
      if (typeof plugin.processMessage === "function") {
        try {
          log.debug(`Processing ${plugin.name} for message from ${m.sender}`)
          await plugin.processMessage(sock, sessionId, m)
        } catch (processError) {
          log.error(`Error processing message in ${plugin.name}:`, processError)
          // ✅ Don't crash - continue to mark as processed
        }
      }

      // ✅ STEP 7: Mark as processed
      try {
        this.deduplicator.markAsProcessed(messageKey, sessionId, actionKey)
      } catch (markError) {
        log.error(`Error marking ${plugin.name} as processed:`, markError)
        // Continue anyway - error won't crash other plugins
      }

    } catch (pluginErr) {
      // ✅ FINAL SAFETY NET: Catch ANY error that slipped through
      log.warn(`Unexpected error in anti-plugin ${plugin?.name || "unknown"}:`, pluginErr?.message || "Unknown error")
      // Continue to next plugin - don't let one plugin crash others
    }
  }
}


validateAntiPluginInput(sock, sessionId, m, plugin) {
  try {
    // Check socket
    if (!sock || typeof sock !== 'object') {
      log.warn("Invalid socket object for anti-plugin")
      return false
    }

    // Check sessionId
    if (!sessionId || typeof sessionId !== 'string') {
      log.warn("Invalid sessionId for anti-plugin")
      return false
    }

    // Check message
    if (!m || typeof m !== 'object') {
      log.warn("Invalid message object for anti-plugin")
      return false
    }

    // Check required message properties
    if (!m.chat || typeof m.chat !== 'string') {
      log.warn("Invalid m.chat for anti-plugin")
      return false
    }

    if (!m.sender || typeof m.sender !== 'string') {
      log.warn("Invalid m.sender for anti-plugin")
      return false
    }

    if (typeof m.isGroup !== 'boolean') {
      log.warn("m.isGroup is not boolean")
      return false
    }

    // Check plugin
    if (!plugin || typeof plugin !== 'object' || !plugin.name) {
      log.warn("Invalid plugin object for anti-plugin")
      return false
    }

    return true
  } catch (error) {
    log.error("Anti-plugin input validation error:", error)
    return false
  }
}

/**
 * ✅ NEW METHOD: Check if sender meets anti-plugin permission requirements
 * This is INVERTED logic - we're checking if the SENDER is allowed to bypass the anti-plugin
 */
async checkAntiPluginPermissions(sock, permissions, m) {
  try {
    // For anti-plugins, we want to process messages from NON-ADMINS
    // So if adminRequired is true, we SKIP processing for admins
    
    // If plugin requires admin to ENABLE (like antitagadmin)
    // Then non-admins get processed, admins are skipped
    if (permissions.adminRequired && m.isGroup) {
      const cacheKey = `admin_${m.chat}_${m.sender}`
      const cached = this.permissionCache.get(cacheKey)
      
      let isAdmin
      if (cached && Date.now() - cached.timestamp < this.PERMISSION_CACHE_TTL) {
        isAdmin = cached.result
      } else {
        const { isGroupAdmin, isBotAdmin } = await import("../whatsapp/groups/index.js")
        isAdmin = await isGroupAdmin(sock, m.chat, m.sender)
        
        this.permissionCache.set(cacheKey, {
          result: isAdmin,
          timestamp: Date.now()
        })
      }
      
      // If sender is admin, SKIP processing (admins bypass anti-plugins)
      if (isAdmin) {
        return false
      }
    }

    // If bot needs admin to enforce actions
    if (permissions.botAdminRequired && m.isGroup) {
      const cacheKey = `botadmin_${m.chat}`
      const cached = this.permissionCache.get(cacheKey)
      
      let isBotAdmin
      if (cached && Date.now() - cached.timestamp < this.PERMISSION_CACHE_TTL) {
        isBotAdmin = cached.result
      } else {
        const { isBotAdmin: checkBotAdmin } = await import("../whatsapp/groups/index.js")
        isBotAdmin = await checkBotAdmin(sock, m.chat)
        
        this.permissionCache.set(cacheKey, {
          result: isBotAdmin,
          timestamp: Date.now()
        })
      }
      
      // If bot is not admin, SKIP processing (can't enforce)
      if (!isBotAdmin) {
        return false
      }
    }

    // Group-only check
    if (permissions.groupOnly && !m.isGroup) {
      return false
    }

    // Passed all checks - process this message
    return true

  } catch (error) {
    log.error("Error checking anti-plugin permissions:", error)
    return false
  }
}

/**
 * Normalize plugin permissions to standard format
 */
normalizePermissions(plugin) {
  const perms = plugin.permissions || {}
  
  // Support legacy formats
  return {
    adminRequired: perms.adminRequired || plugin.adminOnly || false,
    botAdminRequired: perms.botAdminRequired || false,
    ownerOnly: perms.ownerOnly || plugin.ownerOnly || false,
    vipRequired: perms.vipRequired || plugin.vipOnly || false,
    groupOnly: perms.groupOnly || plugin.category === "groupmenu" || false,
    privateOnly: perms.privateOnly || false,
  }
}

  async shutdown() {
    await this.clearWatchers()
    this.clearTempData()
    this.permissionCache.clear()
    commandIndexCache.clear()
  }

  getAvailableCommands(category = null) {
    const commands = []
    const seenPlugins = new Set()

    for (const [command, pluginId] of this.commands.entries()) {
      const plugin = this.plugins.get(pluginId)
      if (!plugin || seenPlugins.has(pluginId)) continue
      seenPlugins.add(pluginId)

      const pluginCategory = plugin.category

      if (!category || pluginCategory === category) {
        commands.push({
          command: plugin.commands[0],
          plugin: plugin.name,
          description: plugin.description || "No description",
          usage: plugin.usage || "",
          category: pluginCategory,
          adminOnly: plugin.adminOnly || false,
        })
      }
    }

    return commands.sort((a, b) => a.command.localeCompare(b.command))
  }

  getPluginStats() {
    return {
      totalPlugins: this.plugins.size,
      totalCommands: this.commands.size,
      totalAntiPlugins: this.antiPlugins.size,
      isInitialized: this.isInitialized,
      autoReloadEnabled: this.autoReloadEnabled,
      watchersActive: this.watchers.size,
      deduplication: this.deduplicator.getStats(), // Add deduplicator stats
    }
  }

  listPlugins() {
    return Array.from(this.plugins.values())
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        category: plugin.category,
        commands: plugin.commands || [],
        hasAntiFeatures: typeof plugin.processMessage === "function",
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
}

const pluginLoader = new PluginLoader()

const shutdown = async () => {
  await pluginLoader.shutdown()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

export default pluginLoader
