// Optimized Plugin System with Full Directory Watching
import fs from "fs/promises"
import fsr from "fs"
import path from "path"
import { fileURLToPath } from "url"
import chalk from "chalk"
import { isGroupAdmin, isBotAdmin } from "../whatsapp/groups/index.js"
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
    this.maxAge = 10000 // 10 seconds TTL (fire and forget)

    this.startCleanup()

    log.info("MessageDeduplicator initialized (cleanup: 10s, TTL: 10s)")
  }

  generateKey(groupJid, messageId) {
    if (!groupJid || !messageId) return null
    return `${groupJid}_${messageId}`
  }

  tryLockForProcessing(messageKey, sessionId, action) {
    if (!messageKey) return false

    if (!this.processedMessages.has(messageKey)) {
      this.processedMessages.set(messageKey, {
        actions: new Set(),
        timestamp: Date.now(),
        lockedBy: null,
      })
    }

    const entry = this.processedMessages.get(messageKey)

    if (entry.actions.has(action)) {
      return false
    }

    if (entry.lockedBy && entry.lockedBy !== sessionId) {
      return false
    }

    entry.lockedBy = sessionId
    entry.timestamp = Date.now()

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

    for (const [key, entry] of this.processedMessages.entries()) {
      if (now - entry.timestamp > this.maxAge) {
        this.processedMessages.delete(key)
        cleanedCount++
      }
    }

    if (this.processedMessages.size > 500) {
      const entries = Array.from(this.processedMessages.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)
      const toRemove = entries.slice(0, this.processedMessages.size - 200)
      toRemove.forEach(([key]) => this.processedMessages.delete(key))
      cleanedCount += toRemove.length
    }

    if (cleanedCount > 0) {
      log.info(`Cleaned up ${cleanedCount} message entries (remaining: ${this.processedMessages.size})`)
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

  findCommand(commandName) {
    if (!commandName || typeof commandName !== "string") return null
    const normalizedCommand = commandName.toLowerCase().trim()
    const pluginId = this.commands.get(normalizedCommand)
    return pluginId ? this.plugins.get(pluginId) : null
  }

  async executeCommand(sock, sessionId, commandName, args, m) {
    try {
      const plugin = this.findCommand(commandName)
      if (!plugin) return { success: false, silent: true }

      if (!m.pushName) {
        m.pushName = await this.extractPushName(sock, m)
      }

      const isCreator = this.checkIsBotOwner(sock, m.sender, m.key?.fromMe)

      const enhancedM = {
        ...m,
        chat: m.chat || m.key?.remoteJid || m.from,
        sender: m.sender || m.key?.participant || m.from,
        isCreator,
        isOwner: isCreator, // Add alias for compatibility
        isGroup: m.isGroup || (m.chat && m.chat.endsWith("@g.us")),
        sessionContext: m.sessionContext || { telegram_id: "Unknown", session_id: sessionId },
        sessionId,
        reply: m.reply,
        prefix: m.prefix || ".",
      }

      // Bot mode check
      if (!enhancedM.isCreator) {
        try {
          const { UserQueries } = await import("../database/query.js")
          const modeSettings = await UserQueries.getBotMode(enhancedM.sessionContext.telegram_id)

          if (modeSettings.mode === "self") {
            this.clearTempData()
            return { success: false, silent: true }
          }
        } catch (error) {
          log.error("Error checking bot mode:", error)
        }
      }

      // Group-only check
      if (enhancedM.isGroup) {
        try {
          const { GroupQueries } = await import("../database/query.js")
          const isGroupOnlyEnabled = await GroupQueries.isGroupOnlyEnabled(enhancedM.chat)

          if (!isGroupOnlyEnabled && !["grouponly", "go"].includes(commandName.toLowerCase())) {
            const isAdmin = await isGroupAdmin(sock, enhancedM.chat, enhancedM.sender)

            if (isAdmin || enhancedM.isCreator) {
              await sock.sendMessage(
                enhancedM.chat,
                {
                  text: `❌ *Group Commands Disabled*\n\nUse *${enhancedM.prefix}grouponly on* to enable.`,
                },
                { quoted: m },
              )
            }

            this.clearTempData()
            return { success: false, silent: true }
          }
        } catch (error) {
          log.error("Error checking grouponly:", error)
        }
      }

      // Permission check
      const permissionCheck = await this.checkPluginPermissions(sock, plugin, enhancedM)
      if (!permissionCheck.allowed) {
        this.clearTempData()

        if (permissionCheck.silent) {
          return { success: false, silent: true }
        }

        try {
          await sock.sendMessage(
            enhancedM.chat,
            {
              text: permissionCheck.message,
            },
            { quoted: m },
          )
        } catch (sendError) {
          log.error("Failed to send permission error:", sendError)
        }

        return { success: false, error: permissionCheck.message }
      }

      // Execute plugin
      const result = await this.executePluginWithFallback(sock, sessionId, args, enhancedM, plugin)

      // DEDUPLICATION: For admin commands that update database
      // ALL users already responded above (in plugin.execute)
      // Now check if database should be updated (ONLY ONCE)
      if (this.shouldCheckDatabaseUpdate(plugin, commandName)) {
        const messageKey = this.deduplicator.generateKey(enhancedM.chat, enhancedM.key?.id)

        if (messageKey && !this.deduplicator.isActionProcessed(messageKey, "db-update")) {
          // First session - database update already happened in plugin.execute()
          // Just mark it as processed so others skip
          this.deduplicator.markAsProcessed(messageKey, sessionId, "db-update")
          log.debug(`DB update marked for ${commandName} by ${sessionId}`)
        } else if (messageKey) {
          log.debug(`DB update already done for ${commandName}, session ${sessionId} skipped`)
        }
      }

      this.clearTempData()

      return { success: true, result }
    } catch (error) {
      log.error(`Error executing command ${commandName}:`, error)
      this.clearTempData()
      return { success: false, error: error.message }
    }
  }

  /**
   * Check if command needs database update deduplication
   * This applies to:
   * 1. Commands in groupmenu category (admin commands that modify group settings)
   * 2. Commands that have adminOnly or groupAdmin permissions
   * 3. Commands with "admin" in permissions array
   */
  shouldCheckDatabaseUpdate(plugin, commandName) {
    if (!plugin || !commandName) return false

    // Method 1: Check if it's a groupmenu command
    if (plugin.category === "groupmenu") {
      return true
    }

    // Method 2: Check if command requires admin permissions (boolean flags)
    if (plugin.adminOnly === true || plugin.groupAdmin === true) {
      return true
    }

    // Method 3: Check permissions array for "admin" or "group_admin"
    if (Array.isArray(plugin.permissions)) {
      const hasAdminPerm = plugin.permissions.some((perm) => {
        const p = String(perm).toLowerCase()
        return p === "admin" || p === "group_admin" || p === "system_admin"
      })
      if (hasAdminPerm) return true
    }

    // Method 4: Fallback - specific critical commands that MUST be deduplicated
    const criticalCommands = [
      "antilink",
      "anticall",
      "antibot",
      "antispam",
      "antiraid",
      "antiimage",
      "antivideo",
      "antiaudio",
      "antidocument",
      "antisticker",
      "antigroupmention",
      "antidelete",
      "antiviewonce",
      "antitag",
      "grouponly",
      "publicmode",
      "welcome",
      "goodbye",
      "autowelcome",
      "autokick",
      "closetime",
      "opentime",
      "antipromote",
      "antidemote",
      "antiadd",
      "antiremove",
    ]

    return criticalCommands.includes(commandName.toLowerCase())
  }

  async executePluginWithFallback(sock, sessionId, args, m, plugin) {
    try {
      if (m.isGroup && (!m.hasOwnProperty("isAdmin") || !m.hasOwnProperty("isBotAdmin"))) {
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
          store: null,
        }
        return await plugin.execute(sock, m, context)
      }

      return await plugin.execute(sock, sessionId, args, m)
    } catch (error) {
      log.error(`Plugin execution failed for ${plugin.name}:`, error)
      throw error
    }
  }

  // ==================== PERMISSION CHECKS ====================

  async checkPluginPermissions(sock, plugin, m) {
    try {
      if (!plugin) {
        return { allowed: false, message: "❌ Plugin not found.", silent: false }
      }

      const commandName = plugin.commands?.[0]?.toLowerCase() || ""

      // Menu commands - everyone can view (except vipmenu)
      const publicMenus = ["aimenu", "convertmenu", "downloadmenu", "gamemenu", "groupmenu", "mainmenu", "ownermenu"]
      if (publicMenus.includes(commandName)) {
        return { allowed: true }
      }

      // VIP menu - VIP and owner only
      if (commandName === "vipmenu") {
        const { VIPQueries } = await import("../database/query.js")
        const { VIPHelper } = await import("../whatsapp/index.js")

        const userTelegramId = VIPHelper.fromSessionId(m.sessionId)
        if (!userTelegramId) {
          return { allowed: false, message: "❌ Could not verify VIP status.", silent: false }
        }

        const vipStatus = await VIPQueries.isVIP(userTelegramId)
        if (!vipStatus.isVIP && !m.isCreator) {
          return {
            allowed: false,
            message: "❌ VIP menu requires VIP access.\n\nContact bot owner for privileges.",
            silent: false,
          }
        }
        return { allowed: true }
      }

      // Game menu - everyone can use
      if (plugin.category === "gamemenu") {
        return { allowed: true }
      }

      // === CRITICAL: GROUP PERMISSION LOGIC ===
      // In groups: ONLY bot owner (m.sender === sock.user.id) and group admins can use commands
      if (m.isGroup) {
        // Fresh admin check - always get latest metadata
        const isAdmin = await isGroupAdmin(sock, m.chat, m.sender)

        // Only bot owner or group admin allowed
        if (!m.isCreator && !isAdmin) {
          return { allowed: false, silent: true }
        }
      }

      // Check specific command permissions
      const requiredPermission = this.determineRequiredPermission(plugin)

      // Owner-only commands
      if (requiredPermission === "owner" && !m.isCreator) {
        return { allowed: false, message: "❌ Bot owner only.", silent: false }
      }

      // VIP commands
      if (requiredPermission === "vip") {
        const { VIPQueries } = await import("../database/query.js")
        const { VIPHelper } = await import("../whatsapp/index.js")

        const userTelegramId = VIPHelper.fromSessionId(m.sessionId)
        if (!userTelegramId) {
          return { allowed: false, message: "❌ Could not verify VIP status.", silent: false }
        }

        const vipStatus = await VIPQueries.isVIP(userTelegramId)
        if (!vipStatus.isVIP && !m.isCreator) {
          return {
            allowed: false,
            message: "❌ VIP access required.\n\nContact bot owner.",
            silent: false,
          }
        }
      }

      // Group admin commands
      if ((requiredPermission === "admin" || requiredPermission === "group_admin") && m.isGroup) {
        const isAdmin = await isGroupAdmin(sock, m.chat, m.sender)

        if (!isAdmin && !m.isCreator) {
          return { allowed: false, message: "❌ Admin privileges required.", silent: false }
        }
      }

      // Owner menu category
      if (plugin.category === "ownermenu" && !m.isCreator) {
        return { allowed: false, message: "❌ Bot owner only.", silent: false }
      }

      return { allowed: true }
    } catch (error) {
      log.error("Error checking permissions:", error)
      return { allowed: false, message: "❌ Permission check failed.", silent: false }
    }
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
    // DEDUPLICATION: Generate message key
    const messageKey = this.deduplicator.generateKey(m.chat, m.key?.id)
    if (!messageKey) {
      log.warn("Cannot generate message key for anti-plugin processing")
      return
    }

    for (const plugin of this.antiPlugins.values()) {
      try {
        if (!sock || !sessionId || !m || !plugin) continue

        let enabled = true
        if (typeof plugin.isEnabled === "function") {
          enabled = await plugin.isEnabled(m.chat)
        }
        if (!enabled) continue

        let shouldProcess = true
        if (typeof plugin.shouldProcess === "function") {
          shouldProcess = await plugin.shouldProcess(m)
        }
        if (!shouldProcess) continue

        // DEDUPLICATION: Try to acquire lock BEFORE processing
        const actionKey = `anti-${plugin.name || "unknown"}` // e.g., 'anti-Anti-Link'

        if (!this.deduplicator.tryLockForProcessing(messageKey, sessionId, actionKey)) {
          log.debug(`Skipping ${plugin.name} - already being processed by another session`)
          continue // Another session is processing, SKIP
        }

        // Got lock - process the message
        if (typeof plugin.processMessage === "function") {
          await plugin.processMessage(sock, sessionId, m)
        }

        // DEDUPLICATION: Mark as processed AFTER completion
        this.deduplicator.markAsProcessed(messageKey, sessionId, actionKey)
      } catch (pluginErr) {
        log.warn(`Anti-plugin error in ${plugin?.name || "unknown"}: ${pluginErr.message}`)
      }
    }
  }

  async shutdown() {
    await this.clearWatchers()
    this.clearTempData()
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
