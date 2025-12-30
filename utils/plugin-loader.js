// Optimized Plugin System with Fixed Permission & Lock Logic
import fs from "fs/promises"
import fsr from "fs"
// Add at the top of the file, after imports
import { createWriteStream } from 'fs'
import { format } from 'util'
import path from "path"
import { fileURLToPath } from "url"
import chalk from "chalk"
import { isGroupAdmin } from "../whatsapp/groups/index.js"
import { isSameJid, normalizeJid, extractPhoneNumber, isGroupJid, getDisplayId } from '../whatsapp/utils/jid.js'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const log = {
  info: (msg) => console.log(chalk.blue("[INFO]"), msg),
  warn: (msg) => console.log(chalk.yellow("[WARN]"), msg),
  debug: (msg) => /*console.log(chalk.cyan('[DEBUG]'), msg)*/ null,
  error: (msg, err) => console.log(chalk.red("[ERROR]"), msg, err?.message || ""),


}



// ==================== STRUCTURED LOGGER ====================
class StructuredLogger {
  constructor() {
    this.logDir = path.join(__dirname, "..", "logs")
    this.ensureLogDir()
  }

  ensureLogDir() {
    try {
      if (!fsr.existsSync(this.logDir)) {
        fsr.mkdirSync(this.logDir, { recursive: true })
      }
    } catch (error) {
      console.error("Failed to create log directory:", error)
    }
  }

  generateLogFileName(sessionId, messageId) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const shortMessageId = messageId ? messageId.substring(0, 8) : 'unknown'
    return `command_${sessionId}_${shortMessageId}_${timestamp}.json`
  }

  async logCommandExecution(data) {
    try {
      const filename = this.generateLogFileName(data.sessionId, data.messageId)
      const filepath = path.join(this.logDir, filename)
      
      const logData = {
        timestamp: new Date().toISOString(),
        ...data
      }

    //  await fs.writeFile(filepath, JSON.stringify(logData, null, 2))

    } catch (error) {
      console.error("Failed to write log file:", error)
    }
  }
}

const structuredLogger = new StructuredLogger()


// ==================== MESSAGE DEDUPLICATION SYSTEM ====================
class MessageDeduplicator {
  constructor() {
    this.processedMessages = new Map()
    this.cleanupInterval = 10000
    this.maxAge = 30000
    this.lockTimeout = 15000
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
    
    if (existing?.actions.has(action)) {
      return false
    }

    if (existing?.lockedBy && existing.lockedBy !== sessionId) {
      const lockAge = Date.now() - existing.timestamp
      if (lockAge < this.lockTimeout) {
        return false
      }
      log.debug(`Lock expired for ${action}, allowing new session`)
    }

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

    for (const [key, entry] of this.processedMessages.entries()) {
      if (now - entry.timestamp > this.maxAge) {
        this.processedMessages.delete(key)
        cleanedCount++
      }
    }

    if (this.processedMessages.size > 300) {
      const entries = Array.from(this.processedMessages.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
      
      const toRemove = entries.slice(0, this.processedMessages.size - 150)
      toRemove.forEach(([key]) => this.processedMessages.delete(key))
      cleanedCount += toRemove.length
    }

    for (const [key, entry] of this.processedMessages.entries()) {
      if (entry.lockedBy && entry.actions.size === 0) {
        const lockAge = now - entry.timestamp
        if (lockAge > this.lockTimeout) {
          entry.lockedBy = null
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

const commandIndexCache = new Map()
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
    this.permissionCache = new Map()
    this.PERMISSION_CACHE_TTL = 30000

    this._startTempCleanup()

    log.info(`Plugin loader initialized (Auto-reload: ${this.autoReloadEnabled ? "ON" : "OFF"})`)
  }

  _startTempCleanup() {
    setInterval(() => {
      this.cleanupTempData()
    }, 30000)
  }

  normalizeJid(jid) {
  return normalizeJid(jid)
}

  compareJids(jid1, jid2) {
  return isSameJid(jid1, jid2)
}

  validatePlugin(plugin) {
    return !!(plugin?.name && typeof plugin.execute === "function")
  }

  generateFallbackName(jid) {
  return getDisplayId(jid)
}

  clearTempData() {
    this.tempContactStore.clear()
  }

  cleanupTempData() {
    const now = Date.now()
    let removed = 0
    for (const [jid, data] of this.tempContactStore.entries()) {
      if (now - data.timestamp > 30000) {
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

      if (["node_modules", ".git", ".env", "dist", "build", "sessions", "logs"].includes(dirName)) {
        return
      }

      const watcher = fsr.watch(dirPath, { persistent: false }, (eventType, filename) => {
        if (!filename || filename.startsWith(".env") || filename.startsWith(".")) return

        const fullPath = path.join(dirPath, filename)

        if (filename.endsWith(".js")) {
          if (fullPath.includes(this.pluginDir)) {
            const relativePath = path.relative(this.pluginDir, dirPath)
            const pluginCategory = relativePath ? relativePath.split(path.sep)[0] : category
            this.handleFileChange(dirPath, filename, pluginCategory)
          } else {
            this.handleAnyFileChange(fullPath)
          }
        }
      })

      this.watchers.set(dirPath, watcher)

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

        if (require.cache[fullPath]) {
          delete require.cache[fullPath]
        }

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

    if (commandIndexBuilt && commandIndexCache.has(normalizedCommand)) {
      const pluginId = commandIndexCache.get(normalizedCommand)
      return this.plugins.get(pluginId)
    }

    const pluginId = this.commands.get(normalizedCommand)
    return pluginId ? this.plugins.get(pluginId) : null
  }

 // Replace the entire executeCommand method with this:
async executeCommand(sock, sessionId, commandName, args, m) {
  const executionLog = {
    sessionId,
    command: commandName,
    messageId: m.key?.id,
    chatId: m.chat,
    senderId: m.sender,
    timestamp: Date.now(),
    steps: []
  }

  try {
    const plugin = this.findCommand(commandName)
    if (!plugin) {
      executionLog.status = 'PLUGIN_NOT_FOUND'
      executionLog.exitPoint = 'Plugin not found'
      await structuredLogger.logCommandExecution(executionLog)
      return { success: false, silent: true }
    }

    executionLog.pluginCategory = plugin.category
    executionLog.pluginAdminOnly = plugin.adminOnly

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
      isGroup: m.isGroup || isGroupJid(m.chat),
      sessionContext: m.sessionContext || { telegram_id: "Unknown", session_id: sessionId },
      sessionId,
      reply: m.reply,
      prefix: m.prefix || ".",
      pluginCategory: plugin.category,
      commandName: commandName.toLowerCase()
    }

    // Collect bot info
    executionLog.botJid = sock.user?.id
    executionLog.botPhone = extractPhoneNumber(sock.user?.id)
    executionLog.senderPhone = extractPhoneNumber(m.sender)
    executionLog.isGroup = enhancedM.isGroup
    executionLog.isCreator = isCreator
    executionLog.telegramId = m.sessionContext?.telegram_id

    // ✅ STEP 1: CHECK BOT MODE
    executionLog.steps.push({ step: 1, name: 'Bot Mode Check', started: Date.now() })
    
    const botModeAllowed = await this._checkBotMode(sock, enhancedM)
    
    executionLog.steps[executionLog.steps.length - 1].completed = Date.now()
    executionLog.steps[executionLog.steps.length - 1].result = { botModeAllowed }
    
    if (!botModeAllowed) {
      executionLog.status = 'BLOCKED_BY_BOT_MODE'
      executionLog.exitPoint = 'Step 1: Bot in self-mode'
      await structuredLogger.logCommandExecution(executionLog)
      this.clearTempData()
      return { success: false, silent: true }
    }

    // ✅ STEP 2: VALIDATE SENDER PERMISSIONS
    executionLog.steps.push({ step: 2, name: 'Sender Permission Check', started: Date.now() })
    
    const senderValidation = await this._validateSenderPermissions(sock, plugin, enhancedM)
    
    executionLog.steps[executionLog.steps.length - 1].completed = Date.now()
    executionLog.steps[executionLog.steps.length - 1].result = senderValidation
    
    if (!senderValidation.allowed) {
      const needsDeduplication = plugin.category === 'groupmenu' || plugin.category === 'group' || plugin.category === 'gamemenu'
      const messageKey = needsDeduplication ? this.deduplicator.generateKey(enhancedM.chat, m.key?.id) : null
      const errorActionKey = messageKey ? `cmd-error-${commandName}` : null
      
      executionLog.steps.push({ 
        step: 2.5, 
        name: 'Error Deduplication', 
        messageKey, 
        errorActionKey,
        needsDeduplication 
      })
      
      if (messageKey && errorActionKey) {
        if (!this.deduplicator.tryLockForProcessing(messageKey, sessionId, errorActionKey)) {
          executionLog.status = 'PERMISSION_ERROR_ALREADY_SENT'
          executionLog.exitPoint = 'Step 2: Another bot sent error'
          await structuredLogger.logCommandExecution(executionLog)
          this.clearTempData()
          return { success: false, silent: true }
        }
        
        try {
          await sock.sendMessage(enhancedM.chat, { 
            text: senderValidation.message 
          }, { quoted: m })
          executionLog.errorMessageSent = true
        } catch (error) {
          log.error("Failed to send permission error:", error)
          executionLog.errorMessageFailed = error.message
        }
        
        this.deduplicator.markAsProcessed(messageKey, sessionId, errorActionKey)
      }
      
      executionLog.status = 'PERMISSION_DENIED'
      executionLog.exitPoint = 'Step 2: Sender lacks permission'
      await structuredLogger.logCommandExecution(executionLog)
      this.clearTempData()
      return { success: false, error: senderValidation.message }
    }

    // ✅ STEP 3: CHECK BOT CAPABILITIES
    executionLog.steps.push({ step: 3, name: 'Bot Capability Check', started: Date.now() })
    
    const botCapability = await this._checkBotCapabilities(sock, plugin, enhancedM)
    
    if (enhancedM.isGroup && (plugin.category === 'groupmenu' || plugin.category === 'group') && plugin.adminOnly) {
      const { isBotAdmin: checkBotAdmin } = await import("../whatsapp/groups/index.js")
      const botIsAdmin = await checkBotAdmin(sock, enhancedM.chat)
      const senderIsAdmin = await isGroupAdmin(sock, enhancedM.chat, enhancedM.sender)
      
      executionLog.groupAdminCheck = {
        senderIsAdmin,
        botIsAdmin
      }
    }
    
    executionLog.steps[executionLog.steps.length - 1].completed = Date.now()
    executionLog.steps[executionLog.steps.length - 1].result = botCapability
    
    const needsDeduplication = plugin.category === 'groupmenu' || plugin.category === 'group' || plugin.category === 'gamemenu'
    const messageKey = needsDeduplication ? this.deduplicator.generateKey(enhancedM.chat, m.key?.id) : null
    const executionActionKey = needsDeduplication ? `cmd-execute-${commandName}` : null

    executionLog.deduplication = {
      needsDeduplication,
      messageKey,
      executionActionKey
    }

    // Check if already processed
    if (messageKey && this.deduplicator.isActionProcessed(messageKey, executionActionKey)) {
      executionLog.status = 'ALREADY_PROCESSED'
      executionLog.exitPoint = 'Step 3: Already executed by another bot'
      await structuredLogger.logCommandExecution(executionLog)
      this.clearTempData()
      return { success: false, silent: true }
    }

    // ✅ STEP 4: PRIORITY-BASED LOCK
    executionLog.steps.push({ step: 4, name: 'Lock Acquisition', started: Date.now() })
    
    if (!botCapability.canExecute) {
      executionLog.steps[executionLog.steps.length - 1].botCapable = false
      
      // ✅ Check if an admin bot already processed this
      if (messageKey) {
        if (this.deduplicator.isActionProcessed(messageKey, `${executionActionKey}-capable`)) {
          executionLog.steps[executionLog.steps.length - 1].completed = Date.now()
          executionLog.status = 'INCAPABLE_BOT_SKIPPED'
          executionLog.exitPoint = 'Step 4: Capable bot already processed'
          await structuredLogger.logCommandExecution(executionLog)
          this.clearTempData()
          return { success: false, silent: true }
        }
      }
      
      // ✅ NON-ADMIN BOT CAN EXECUTE - Just don't lock
      executionLog.steps[executionLog.steps.length - 1].completed = Date.now()
      executionLog.steps[executionLog.steps.length - 1].executedWithoutLock = true
      executionLog.nonAdminExecution = true
      
      // Continue to execution (Step 6) without locking
    } else {
      // ✅ STEP 5: CAPABLE BOT - ACQUIRE LOCK IMMEDIATELY
      executionLog.steps[executionLog.steps.length - 1].botCapable = true
      
      if (messageKey) {
        // Mark immediately that a capable bot is handling this
        this.deduplicator.markAsProcessed(messageKey, sessionId, `${executionActionKey}-capable`)
        executionLog.steps[executionLog.steps.length - 1].capableMarked = true
        
        if (!this.deduplicator.tryLockForProcessing(messageKey, sessionId, executionActionKey)) {
          executionLog.steps[executionLog.steps.length - 1].completed = Date.now()
          executionLog.status = 'CAPABLE_BOT_LOCK_FAILED'
          executionLog.exitPoint = 'Step 5: Another capable bot locked'
          await structuredLogger.logCommandExecution(executionLog)
          this.clearTempData()
          return { success: false, silent: true }
        }
        
        executionLog.steps[executionLog.steps.length - 1].mainLockAcquired = true
      }
      
      executionLog.steps[executionLog.steps.length - 1].completed = Date.now()
    }

    // Check group-only (both admin and non-admin bots check this)
    if (enhancedM.isGroup) {
      executionLog.steps.push({ step: 5.5, name: 'Group-Only Check', started: Date.now() })
      
      const groupOnlyAllowed = await this._checkGroupOnly(sock, enhancedM, commandName)
      
      executionLog.steps[executionLog.steps.length - 1].completed = Date.now()
      executionLog.steps[executionLog.steps.length - 1].result = { groupOnlyAllowed }
      
      if (!groupOnlyAllowed) {
        executionLog.status = 'GROUPONLY_DISABLED'
        executionLog.exitPoint = 'Step 5.5: Group-only disabled'
        await structuredLogger.logCommandExecution(executionLog)
        this.clearTempData()
        return { success: false, silent: true }
      }
    }

    // ✅ STEP 6: EXECUTE (Both admin and non-admin execute)
    executionLog.steps.push({ step: 6, name: 'Plugin Execution', started: Date.now() })
    
    const result = await this.executePluginWithFallback(sock, sessionId, args, enhancedM, plugin)
    
    executionLog.steps[executionLog.steps.length - 1].completed = Date.now()
    executionLog.steps[executionLog.steps.length - 1].result = 'Success'

    // ✅ Only mark as processed if bot was capable (admin)
    if (messageKey && executionActionKey && botCapability.canExecute) {
      this.deduplicator.markAsProcessed(messageKey, sessionId, executionActionKey)
      executionLog.markedAsFullyProcessed = true
    }

    executionLog.status = botCapability.canExecute ? 'SUCCESS' : 'SUCCESS_NON_ADMIN'
    executionLog.exitPoint = botCapability.canExecute ? 'Completed successfully' : 'Non-admin bot executed (not locked)'
    await structuredLogger.logCommandExecution(executionLog)
    
    this.clearTempData()
    return { success: true, result }
  } catch (error) {
    executionLog.status = 'ERROR'
    executionLog.exitPoint = 'Exception thrown'
    executionLog.error = {
      message: error.message,
      stack: error.stack
    }
    
    await structuredLogger.logCommandExecution(executionLog)
    
    log.error(`Error executing command ${commandName}:`, error)
    this.clearTempData()
    return { success: false, error: error.message }
  }
}



// ✅ NEW METHOD: Validate sender permissions (is sender allowed to use this command?)
async _validateSenderPermissions(sock, plugin, m) {
  try {
    // For group/groupmenu commands in groups, check if SENDER is admin
    if (m.isGroup && (plugin.category === 'groupmenu' || plugin.category === 'group')) {
      // Check if command requires admin
      if (plugin.adminOnly) {
        const senderIsAdmin = await isGroupAdmin(sock, m.chat, m.sender)
        
        if (!m.isCreator && !senderIsAdmin) {
          return { 
            allowed: false, 
            message: "❌ Only group admins can use this command!" 
          }
        }
      }
    }

    // Owner-only commands
    if (plugin.category === 'ownermenu' && !m.isCreator) {
      return { 
        allowed: false, 
        message: "❌ Bot owner only." 
      }
    }

    // VIP commands
    if (plugin.category === 'vipmenu' || this.determineRequiredPermission(plugin) === 'vip') {
      const { VIPQueries } = await import("../database/query.js")
      const { VIPHelper } = await import("../whatsapp/index.js")

      const userTelegramId = VIPHelper.fromSessionId(m.sessionId)
      if (!userTelegramId) {
        return { 
          allowed: false, 
          message: "❌ Could not verify VIP status." 
        }
      }

      const vipStatus = await VIPQueries.isVIP(userTelegramId)
      if (!vipStatus.isVIP && !m.isCreator) {
        return {
          allowed: false,
          message: "❌ VIP access required.\n\nContact bot owner.",
        }
      }
    }

    return { allowed: true }
  } catch (error) {
    log.error("Error validating sender permissions:", error)
    return { 
      allowed: false, 
      message: "❌ Permission check failed." 
    }
  }
}

// ✅ NEW METHOD: Check if THIS BOT can execute (bot capabilities)
async _checkBotCapabilities(sock, plugin, m) {
  try {
    // For group/groupmenu commands that are adminOnly
    if (m.isGroup && (plugin.category === 'groupmenu' || plugin.category === 'group') && plugin.adminOnly) {
      const { isBotAdmin: checkBotAdmin } = await import("../whatsapp/groups/index.js")
      const botIsAdmin = await checkBotAdmin(sock, m.chat)
      
      if (!botIsAdmin && !m.isCreator) {
        return { 
          canExecute: false, 
          reason: 'Bot is not group admin, cannot execute admin-required command' 
        }
      }
    }

    return { canExecute: true }
  } catch (error) {
    log.error("Error checking bot capabilities:", error)
    return { 
      canExecute: false, 
      reason: 'Capability check failed' 
    }
  }
}

  // ✅ FIX 4: IMPROVED BOT MODE CHECK WITH OWNER VALIDATION
  async _checkBotMode(sock, m) {
  
  if (m.isCreator) {
    return true
  }
  
  try {
    const { UserQueries } = await import("../database/query.js")
    const modeSettings = await UserQueries.getBotMode(m.sessionContext.telegram_id)
    
    if (modeSettings.mode !== "self") {
      return true
    }
    
    // Detailed JID comparison logging
    const botJid = sock.user?.id
    const senderJid = m.sender
    
    const botPhone = extractPhoneNumber(botJid)
    const senderPhone = extractPhoneNumber(senderJid)
    
    const normalizedBot = normalizeJid(botJid)
    const normalizedSender = normalizeJid(senderJid)
    
    const isSenderBotOwner = isSameJid(botJid, senderJid)
    
    if (!isSenderBotOwner) {
    } else {
    }
    return isSenderBotOwner
  } catch (error) {
    return true
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

    const result = await this.checkPluginPermissions(sock, plugin, m)

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

  async checkPluginPermissions(sock, plugin, m) {
    try {
      if (!plugin) {
        return { allowed: false, message: "❌ Plugin not found.", silent: false }
      }

      const commandName = plugin.commands?.[0]?.toLowerCase() || ""

      // Menu commands - everyone can view (except vipmenu)
      const publicMenus = ["aimenu", "convertmenu", "downloadmenu", "gamemenu", "groupmenu", "mainmenu", "ownermenu", "toolmenu", "searchmenu", "bugmenu"]
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

      // Game menu - everyone can use (but still check group permissions)
      if (plugin.category === "gamemenu") {
        if (m.isGroup) {
          const isAdmin = await isGroupAdmin(sock, m.chat, m.sender)
          if (!m.isCreator && !isAdmin) {
            return { allowed: false, silent: true, reason: 'gamemenu requires group admin' }
          }
        }
        return { allowed: true }
      }

      // ✅ CRITICAL FIX 5: GROUP PERMISSION CHECK FOR GROUPMENU
      // In groups, groupmenu commands require SENDER to be admin or bot owner
      if (m.isGroup && plugin.category === "groupmenu") {
        const senderIsAdmin = await isGroupAdmin(sock, m.chat, m.sender)

        if (!m.isCreator && !senderIsAdmin) {
          log.debug(`Permission denied: sender ${m.sender} is not admin in ${m.chat}`)
          return { allowed: false, silent: true, reason: 'sender not group admin' }
        }
      }

      // Check specific command permissions
      const requiredPermission = this.determineRequiredPermission(plugin)

      if (requiredPermission === "owner" && !m.isCreator) {
        return { allowed: false, message: "❌ Bot owner only.", silent: false }
      }

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

      if ((requiredPermission === "admin" || requiredPermission === "group_admin") && m.isGroup) {
        const isAdmin = await isGroupAdmin(sock, m.chat, m.sender)

        if (!isAdmin && !m.isCreator) {
          return { allowed: false, message: "❌ Admin privileges required.", silent: false }
        }
      }

      if (plugin.category === "ownermenu" && !m.isCreator) {
        return { allowed: false, message: "❌ Bot owner only.", silent: false }
      }

      return { allowed: true }
    } catch (error) {
      log.error("Error checking permissions:", error)
      return { allowed: false, message: "❌ Permission check failed.", silent: false }
    }
  }

  async executePluginWithFallback(sock, sessionId, args, m, plugin) {
    const maxRetries = plugin.category === 'groupmenu' ? 2 : 0
    let lastError = null
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          log.debug(`Retry attempt ${attempt} for ${plugin.name}`)
          await new Promise(resolve => setTimeout(resolve, 100 * attempt))
        }
        
        if (m.isGroup && (!m.hasOwnProperty('isAdmin') || !m.hasOwnProperty('isBotAdmin'))) {
          const { isBotAdmin } = await import("../whatsapp/groups/index.js")
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
        
        if (attempt < maxRetries && error.message?.includes('database')) {
          log.warn(`Database error on attempt ${attempt + 1}, retrying...`)
          continue
        }
        
        log.error(`Plugin execution failed for ${plugin.name}:`, error)
        throw error
      }
    }
    
    if (lastError) throw lastError
  }

  checkIsBotOwner(sock, userJid, fromMe = false) {
  if (fromMe === true) return true

  try {
    if (!sock?.user?.id || !userJid) return false

    // Use robust JID comparison
    return isSameJid(sock.user.id, userJid)
  } catch (error) {
    log.error("Error checking bot owner:", error)
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

  // ✅ FIX 6: IMPROVED ANTI-PLUGIN PROCESSING WITH PROPER LOCK LOGIC
  async processAntiPlugins(sock, sessionId, m) {
    const messageKey = this.deduplicator.generateKey(m.chat, m.key?.id)
    if (!messageKey) {
      log.warn("Cannot generate message key for anti-plugin processing")
      return
    }

    // ✅ Check bot mode first
    const botModeAllowed = await this._checkBotMode(sock, m)
    if (!botModeAllowed) {
      log.debug(`Bot in self-mode, skipping anti-plugin for ${m.sender}`)
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

        // ✅ CRITICAL FIX 7: CHECK BOT ADMIN STATUS FOR ADMIN-ONLY PLUGINS
        let canFullyProcess = true
        let isBotAdmin = false
        
        if (plugin.adminOnly && m.isGroup) {
          const { isBotAdmin: checkBotAdmin } = await import("../whatsapp/groups/index.js")
          isBotAdmin = await checkBotAdmin(sock, m.chat)
          const isOwner = this.checkIsBotOwner(sock, sock.user?.id)
          canFullyProcess = isBotAdmin || isOwner
          
          log.debug(`${plugin.name}: Bot admin check - isBotAdmin: ${isBotAdmin}, canFullyProcess: ${canFullyProcess}`)
        }

        const actionKey = `anti-${plugin.name || "unknown"}`

        // ✅ FIX 8: LOCK STRATEGY BASED ON BOT CAPABILITIES
        if (plugin.adminOnly && m.isGroup && !canFullyProcess) {
          // Non-admin bot for admin-only plugin:
          // - Can detect and notify users
          // - CANNOT lock (let admin bot handle actual deletion)
          // - CANNOT mark as processed (admin bot will mark it)
          
          // Check if action already processed by admin bot
          if (this.deduplicator.isActionProcessed(messageKey, actionKey)) {
            log.debug(`${plugin.name}: Already processed by admin bot, skipping notification`)
            continue
          }
          
          // Check if admin bot is currently processing
          if (this.deduplicator.isActionProcessed(messageKey, `${actionKey}-admin-processing`)) {
            log.debug(`${plugin.name}: Admin bot is processing, skipping notification`)
            continue
          }
          
          // Mark that a non-admin bot is notifying (to prevent duplicate notifications)
          const notifyKey = `${actionKey}-notify`
          if (!this.deduplicator.tryLockForProcessing(messageKey, sessionId, notifyKey)) {
            log.debug(`${plugin.name}: Another non-admin bot already notified`)
            continue
          }
          
          log.debug(`${plugin.name}: Non-admin bot notifying (no lock for deletion)`)
          
          // Process (detect and notify, but don't take action like deleting)
          if (typeof plugin.processMessage === "function") {
            await plugin.processMessage(sock, sessionId, m)
          }
          
          // Mark notification as sent
          this.deduplicator.markAsProcessed(messageKey, sessionId, notifyKey)
          
          // Don't lock the main action or mark as processed
          // Let admin bot handle actual deletion
          continue
        }

        // Admin bot or non-admin-required plugin:
        // - Can lock to prevent duplicates
        // - Can fully process and take action
        
        if (this.deduplicator.isActionProcessed(messageKey, actionKey)) {
          log.debug(`${plugin.name}: Already processed by another bot`)
          continue
        }

        if (!this.deduplicator.tryLockForProcessing(messageKey, sessionId, actionKey)) {
          log.debug(`${plugin.name}: Locked by another bot`)
          continue
        }
        
        // Mark admin processing to prevent non-admin notifications
        if (plugin.adminOnly && canFullyProcess) {
          this.deduplicator.markAsProcessed(messageKey, sessionId, `${actionKey}-admin-processing`)
        }

        // Fully process with lock
        if (typeof plugin.processMessage === "function") {
          await plugin.processMessage(sock, sessionId, m)
        }

        // Mark as processed
        this.deduplicator.markAsProcessed(messageKey, sessionId, actionKey)
        
      } catch (pluginErr) {
        log.warn(`Anti-plugin error in ${plugin?.name || "unknown"}: ${pluginErr.message}`)
      }
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
      deduplication: this.deduplicator.getStats(),
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