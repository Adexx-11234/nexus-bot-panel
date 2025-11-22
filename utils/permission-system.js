// Plugin System with Enhanced Debugging - Find Missing Plugins
import fs from "fs/promises"
import fsr from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { logger } from "./logger.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class PluginLoader {
  constructor() {
    this.plugins = new Map()
    this.commands = new Map()
    this.antiPlugins = new Map()
    this.contactStore = new Map()
    this.middleware = []
    this.isInitialized = false
    this.pluginDir = path.join(__dirname, "..", "plugins")
    
    // Debug tracking
    this.loadAttempts = new Map()
    this.failedPlugins = new Map()
    this.skippedPlugins = new Map()

    // Auto-reload configuration
    this.watchers = new Map()
    this.reloadTimeouts = new Map()
    this.autoReloadEnabled = process.env.PLUGIN_AUTO_RELOAD !== "false"
    this.reloadDebounceMs = Number.parseInt(process.env.PLUGIN_RELOAD_DEBOUNCE) || 1000

    logger.info(`[PluginLoader] Plugin loader initialized (Auto-reload: ${this.autoReloadEnabled ? "ON" : "OFF"})`)
  }

  /**
   * Enhanced validation with detailed logging
   */
  validatePlugin(plugin, pluginName, filePath) {
    try {
      if (!plugin || typeof plugin !== "object") {
        this.skippedPlugins.set(pluginName, `Not an object or null/undefined`)
        logger.warn(`[PluginLoader] ${pluginName}: Plugin is not a valid object`)
        return false
      }
      
      if (!plugin.name || typeof plugin.name !== "string") {
        this.skippedPlugins.set(pluginName, `Missing or invalid 'name' property`)
        logger.warn(`[PluginLoader] ${pluginName}: Missing or invalid 'name' property`)
        return false
      }
      
      if (typeof plugin.execute !== "function") {
        this.skippedPlugins.set(pluginName, `Missing or invalid 'execute' function`)
        logger.warn(`[PluginLoader] ${pluginName}: Missing or invalid 'execute' function`)
        return false
      }
      
      // Validate permissions array if present
      if (plugin.permissions && Array.isArray(plugin.permissions)) {
        const validPermissions = ["owner", "admin", "group_admin", "user"]
        const hasInvalidPermission = plugin.permissions.some(p => 
          !validPermissions.includes(p.toLowerCase())
        )
        if (hasInvalidPermission) {
          logger.warn(`[PluginLoader] ${pluginName}: Invalid permissions: ${JSON.stringify(plugin.permissions)}`)
        }
      }
      
      logger.info(`[PluginLoader] ${pluginName}: Validation passed ✓`)
      return true
    } catch (error) {
      this.skippedPlugins.set(pluginName, `Validation error: ${error.message}`)
      logger.error(`[PluginLoader] ${pluginName}: Validation error:`, error)
      return false
    }
  }

  async loadPlugins() {
    try {
      logger.info("[PluginLoader] Starting plugin discovery and loading...")

      // Clear debug tracking
      this.loadAttempts.clear()
      this.failedPlugins.clear()
      this.skippedPlugins.clear()

      // Clear existing watchers if reloading
      await this.clearWatchers()

      await this.loadAllPlugins()

      // Setup file watchers for auto-reload
      if (this.autoReloadEnabled) {
        await this.setupFileWatchers()
      }

      this.isInitialized = true
      
      // Print detailed loading summary
      this.printLoadingSummary()

      return Array.from(this.plugins.values())
    } catch (error) {
      logger.error("[PluginLoader] Error loading plugins:", error)
      throw error
    }
  }

  /**
   * Print detailed loading summary
   */
  printLoadingSummary() {
    const totalAttempted = this.loadAttempts.size
    const totalLoaded = this.plugins.size
    const totalFailed = this.failedPlugins.size
    const totalSkipped = this.skippedPlugins.size
    
    logger.info(`[PluginLoader] === LOADING SUMMARY ===`)
    logger.info(`[PluginLoader] Total files attempted: ${totalAttempted}`)
    logger.info(`[PluginLoader] Successfully loaded: ${totalLoaded}`)
    logger.info(`[PluginLoader] Failed to load: ${totalFailed}`)
    logger.info(`[PluginLoader] Skipped (validation failed): ${totalSkipped}`)
    logger.info(`[PluginLoader] Total commands: ${this.commands.size}`)
    logger.info(`[PluginLoader] Anti-plugins: ${this.antiPlugins.size}`)
    
    if (this.failedPlugins.size > 0) {
      logger.warn(`[PluginLoader] === FAILED PLUGINS ===`)
      for (const [plugin, reason] of this.failedPlugins) {
        logger.warn(`[PluginLoader] ❌ ${plugin}: ${reason}`)
      }
    }
    
    if (this.skippedPlugins.size > 0) {
      logger.warn(`[PluginLoader] === SKIPPED PLUGINS ===`)
      for (const [plugin, reason] of this.skippedPlugins) {
        logger.warn(`[PluginLoader] ⏭️ ${plugin}: ${reason}`)
      }
    }
  }

  async loadAllPlugins() {
    try {
      await this.loadPluginsFromDirectory(this.pluginDir)
      await this.registerAntiPlugins()
      logger.info(`[PluginLoader] Completed loading plugins from all directories`)
    } catch (error) {
      logger.error(`[PluginLoader] Error loading all plugins:`, error)
    }
  }

  async registerAntiPlugins() {
    try {
      for (const [pluginId, plugin] of this.plugins.entries()) {
        if (plugin && typeof plugin.processMessage === "function") {
          this.antiPlugins.set(pluginId, plugin)
        }
      }
    } catch (error) {
      logger.error("[PluginLoader] Error registering anti-plugins:", error)
    }
  }

  async loadPluginsFromDirectory(dirPath, category = "main") {
    try {
      logger.info(`[PluginLoader] Scanning directory: ${dirPath} (category: ${category})`)
      const items = await fs.readdir(dirPath, { withFileTypes: true })
      
      let fileCount = 0
      let dirCount = 0

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name)

        if (item.isDirectory()) {
          dirCount++
          const subCategory = category === "main" ? item.name : `${category}/${item.name}`
          await this.loadPluginsFromDirectory(itemPath, subCategory)
        } else if (item.name.endsWith(".js")) {
          fileCount++
          await this.loadPlugin(dirPath, item.name, category)
        }
      }
      
      logger.info(`[PluginLoader] Directory ${dirPath}: Found ${fileCount} JS files, ${dirCount} subdirectories`)
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.error(`[PluginLoader] Error loading plugins from ${dirPath}:`, error)
      } else {
        logger.warn(`[PluginLoader] Directory not found: ${dirPath}`)
      }
    }
  }

  async loadPlugin(pluginPath, filename, category) {
    const pluginName = path.basename(filename, ".js")
    const fullPath = path.join(pluginPath, filename)
    const pluginId = `${category}:${pluginName}`
    
    // Track loading attempt
    this.loadAttempts.set(pluginName, {
      path: fullPath,
      category,
      pluginId,
      timestamp: Date.now()
    })

    try {
      logger.info(`[PluginLoader] Attempting to load: ${filename} (category: ${category})`)

      // Check if file exists and is readable
      try {
        await fs.access(fullPath, fs.constants.R_OK)
      } catch (accessError) {
        this.failedPlugins.set(pluginName, `File not accessible: ${accessError.message}`)
        logger.error(`[PluginLoader] Cannot access file ${fullPath}:`, accessError)
        return
      }

      // Clear module cache for hot reloading
      const moduleUrl = `file://${fullPath}?t=${Date.now()}`

      // Dynamic import for ES modules
      logger.debug(`[PluginLoader] Importing module: ${moduleUrl}`)
      const pluginModule = await import(moduleUrl)
      
      if (!pluginModule) {
        this.failedPlugins.set(pluginName, `Module import returned null/undefined`)
        logger.error(`[PluginLoader] Module import returned null for ${filename}`)
        return
      }

      const plugin = pluginModule.default || pluginModule

      if (!plugin) {
        this.failedPlugins.set(pluginName, `No default export and no direct export found`)
        logger.error(`[PluginLoader] No valid export found in ${filename}`)
        return
      }

      logger.debug(`[PluginLoader] Module imported successfully: ${filename}`)
      logger.debug(`[PluginLoader] Plugin object:`, {
        hasName: !!plugin.name,
        hasExecute: typeof plugin.execute === 'function',
        hasCommands: !!plugin.commands,
        hasCategory: !!plugin.category,
        hasPermissions: !!plugin.permissions,
        adminOnly: !!plugin.adminOnly
      })

      // Validate plugin structure
      if (!this.validatePlugin(plugin, pluginName, fullPath)) {
        return // Skip this plugin
      }

      // Normalize commands: combine commands + aliases; fallback to name
      const normalizedCommands = []
      
      // Handle both 'commands' and 'aliases' arrays
      if (Array.isArray(plugin.commands)) {
        for (const c of plugin.commands) {
          if (typeof c === "string") normalizedCommands.push(c.toLowerCase())
        }
      }
      if (Array.isArray(plugin.aliases)) {
        for (const a of plugin.aliases) {
          if (typeof a === "string") normalizedCommands.push(a.toLowerCase())
        }
      }
      
      // Fallback to plugin name if no commands defined
      if (normalizedCommands.length === 0 && typeof plugin.name === "string") {
        normalizedCommands.push(plugin.name.toLowerCase())
      }

      // Always include filename as a command alias
      if (typeof pluginName === "string" && !normalizedCommands.includes(pluginName.toLowerCase())) {
        normalizedCommands.push(pluginName.toLowerCase())
      }
      
      const uniqueCommands = Array.from(new Set(normalizedCommands))

      const pluginData = {
        ...plugin,
        id: pluginId,
        category,
        filename,
        fullPath,
        pluginPath,
        loadedAt: new Date().toISOString(),
        commands: uniqueCommands,
      }

      this.plugins.set(pluginId, pluginData)

      // Register commands
      for (const command of uniqueCommands) {
        if (this.commands.has(command)) {
          logger.warn(`[PluginLoader] Command '${command}' already registered by another plugin. Overriding...`)
        }
        this.commands.set(command, pluginId)
      }

      // Register as anti-plugin if it has processMessage function
      if (typeof plugin.processMessage === "function") {
        this.antiPlugins.set(pluginId, pluginData)
        logger.debug(`[PluginLoader] Registered as anti-plugin: ${pluginId}`)
      }

      logger.info(`[PluginLoader] ✅ Successfully loaded: ${pluginId} (commands: ${uniqueCommands.join(", ") || "none"})`)
    } catch (error) {
      this.failedPlugins.set(pluginName, `Load error: ${error.message}`)
      logger.error(`[PluginLoader] ❌ Failed to load plugin ${filename}:`, error)
      
      // Log additional details for debugging
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        logger.error(`[PluginLoader] Module not found details:`, {
          filename,
          fullPath,
          error: error.message
        })
      }
    }
  }

  /**
   * Enhanced pushName extraction with multiple fallback methods
   */
  async extractPushName(sock, m) {
    try {
      let pushName = null
      const senderJid = m.sender

      if (m.pushName) {
        pushName = m.pushName
      }
      else if (m.message && m.message.pushName) {
        pushName = m.message.pushName
      }
      else if (m.key && m.key.notify) {
        pushName = m.key.notify
      }
      else if (this.contactStore.has(senderJid)) {
        const cached = this.contactStore.get(senderJid)
        if (cached.pushName && (Date.now() - cached.timestamp) < 300000) {
          pushName = cached.pushName
        }
      }
      else if (sock.store && sock.store.contacts && sock.store.contacts[senderJid]) {
        const contact = sock.store.contacts[senderJid]
        pushName = contact.notify || contact.name || contact.pushName
      }

      pushName = pushName || this.generateFallbackName(senderJid)

      this.contactStore.set(senderJid, {
        pushName: pushName,
        timestamp: Date.now()
      })

      return pushName

    } catch (error) {
      const fallback = this.generateFallbackName(m.sender)
      logger.warn(`[PushName] Error extracting pushName: ${error.message}, using fallback: "${fallback}"`)
      return fallback
    }
  }

  generateFallbackName(jid) {
    if (!jid) return "Unknown"
    
    const phoneNumber = jid.split('@')[0]
    if (phoneNumber && phoneNumber.length > 4) {
      return `User ${phoneNumber.slice(-4)}`
    }
    return "Unknown User"
  }

  normalizeJid(jid) {
    if (!jid) return null
    return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
  }

  cleanupContactStore() {
    const now = Date.now()
    const maxAge = 1800000 // 30 minutes

    for (const [jid, data] of this.contactStore.entries()) {
      if (now - data.timestamp > maxAge) {
        this.contactStore.delete(jid)
      }
    }
  }

  performMaintenance() {
    this.cleanupContactStore()
  }

  async setupFileWatchers() {
    try {
      await this.setupDirectoryWatchersRecursively(this.pluginDir, "main")
    } catch (error) {
      logger.error("[PluginLoader] Error setting up file watchers:", error)
    }
  }

  async setupDirectoryWatchersRecursively(dirPath, category) {
    try {
      await this.setupDirectoryWatcher(dirPath, category)

      const items = await fs.readdir(dirPath, { withFileTypes: true })
      for (const item of items) {
        if (item.isDirectory()) {
          const subDirPath = path.join(dirPath, item.name)
          const subCategory = category === "main" ? item.name : `${category}/${item.name}`
          await this.setupDirectoryWatchersRecursively(subDirPath, subCategory)
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.error(`[PluginLoader] Error setting up watchers for ${dirPath}:`, error)
      }
    }
  }

  async setupDirectoryWatcher(dirPath, category) {
    try {
      const watcher = fsr.watch(dirPath, { persistent: false }, (eventType, filename) => {
        if (filename && filename.endsWith(".js")) {
          this.handleFileChange(dirPath, filename, category, eventType)
        }
      })

      this.watchers.set(dirPath, watcher)
    } catch (error) {
      logger.error(`[PluginLoader] Error setting up watcher for ${dirPath}:`, error)
    }
  }

  async handleFileChange(dirPath, filename, category, eventType) {
    try {
      const key = path.join(dirPath, filename)
      const existing = this.reloadTimeouts.get(key)
      if (existing) {
        clearTimeout(existing)
      }
      const timeout = setTimeout(async () => {
        try {
          await this.loadPlugin(dirPath, filename, category)
          logger.info(`[PluginLoader] Reloaded plugin due to ${eventType}: ${filename}`)
        } catch (error) {
          logger.error(`[PluginLoader] Failed to reload plugin ${filename}:`, error)
        } finally {
          this.reloadTimeouts.delete(key)
        }
      }, this.reloadDebounceMs)

      this.reloadTimeouts.set(key, timeout)
    } catch (error) {
      logger.error("[PluginLoader] Error handling file change:", error)
    }
  }

  async clearWatchers() {
    try {
      for (const watcher of this.watchers.values()) {
        try {
          watcher.close && watcher.close()
        } catch (_) {}
      }
      this.watchers.clear()

      for (const timeout of this.reloadTimeouts.values()) {
        try {
          clearTimeout(timeout)
        } catch (_) {}
      }
      this.reloadTimeouts.clear()
    } catch (error) {
      logger.error("[PluginLoader] Error clearing watchers:", error)
    }
  }

  findCommand(commandName) {
    try {
      if (!commandName || typeof commandName !== 'string') {
        return null;
      }

      const normalizedCommand = commandName.toLowerCase();
      const pluginId = this.commands.get(normalizedCommand);
      
      if (!pluginId) {
        return null;
      }

      const plugin = this.plugins.get(pluginId);
      return plugin || null;
    } catch (error) {
      logger.error(`[PluginLoader] Error finding command ${commandName}:`, error);
      return null;
    }
  }

  async executeCommand(sock, sessionId, commandName, args, m) {
    try {
      const plugin = this.findCommand(commandName);

      if (!m.pushName) {
        m.pushName = await this.extractPushName(sock, m);
      }

      if (!m.pushName) {
        m.pushName = m.name || m.notify || m.verifiedName || this.generateFallbackName(m.sender);
      }
        
      const isCreator = this.checkIsBotOwner(sock, m.sender);
      m.isCreator = isCreator;

      const enhancedM = {
        ...m,
        chat: m.chat || m.key?.remoteJid || m.from,
        sender: m.sender || m.key?.participant || m.from,
        isCreator: isCreator,
        isGroup: m.isGroup || (m.chat && m.chat.endsWith('@g.us')),
        isAdmin: m.isAdmin || false,
        isBotAdmin: m.isBotAdmin || false,
        groupMetadata: m.groupMetadata || null,
        participants: m.participants || null,
        sessionContext: m.sessionContext || { telegram_id: "Unknown", session_id: sessionId },
        sessionId: sessionId,
        reply: m.reply
      };

      const permissionCheck = await this.checkPluginPermissions(sock, plugin, enhancedM)
      if (!permissionCheck.allowed) {
        return {
          success: false,
          error: permissionCheck.message
        }
      }

      const result = await this.executePluginWithFallback(sock, sessionId, args, enhancedM, plugin);
      
      return {
        success: true,
        result: result
      };
    } catch (error) {
      logger.error(`[PluginLoader] Error executing command ${commandName}: ${error.message}`);
      return {
        success: false,
        error: `Error executing command: ${error.message}`
      };
    }
  }

  async executePluginWithFallback(sock, sessionId, args, m, plugin) {
    try {
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
      logger.error(`[PluginLoader] Plugin execution failed for ${plugin.name}: ${error.message}`)
      throw error
    }
  }

  async checkPluginPermissions(sock, plugin, m) {
    try {
      const requiredPermission = this.determineRequiredPermission(plugin, m.command?.name)
      
      const categoryCheck = this.checkCategoryRestrictions(plugin, m)
      if (!categoryCheck.allowed) {
        return categoryCheck
      }

      if (requiredPermission === "owner" && !m.isCreator) {
        return {
          allowed: false,
          message: "❌ This command is restricted to the bot owner only."
        }
      }

      if (requiredPermission === "admin" && !m.isAdmin && !m.isCreator) {
        return {
          allowed: false,
          message: "❌ This command requires admin privileges."
        }
      }

      if (requiredPermission === "group_admin" && m.isGroup && !m.isAdmin && !m.isCreator) {
        return {
          allowed: false,
          message: "❌ This command requires group admin privileges."
        }
      }

      return { allowed: true }
    } catch (error) {
      logger.error(`[PluginLoader] Error checking permissions: ${error.message}`)
      return {
        allowed: false,
        message: "❌ Permission check failed."
      }
    }
  }

  checkIsBotOwner(sock, userJid) {
    try {
      if (!sock?.user?.id || !userJid) {
        return false
      }

      let botUserId = sock.user.id
      
      if (botUserId.includes(':')) {
        botUserId = botUserId.split(':')[0]
      }
      
      if (botUserId.includes('@')) {
        botUserId = botUserId.split('@')[0]
      }

      let userNumber = userJid
      if (userNumber.includes(':')) {
        userNumber = userNumber.split(':')[0]
      }
      if (userNumber.includes('@')) {
        userNumber = userNumber.split('@')[0]
      }

      const isOwner = botUserId === userNumber
      
      return isOwner
    } catch (error) {
      logger.error(`[PluginLoader] Error checking bot owner status: ${error.message}`)
      return false
    }
  }
 
  determineRequiredPermission(plugin, command) {
    if (plugin.commandPermissions && plugin.commandPermissions[command]) {
      return plugin.commandPermissions[command].toLowerCase()
    }

    if (plugin.permissions && Array.isArray(plugin.permissions) && plugin.permissions.length > 0) {
      const perms = plugin.permissions.map(p => String(p).toLowerCase())
      
      if (perms.includes("owner")) return "owner"
      if (perms.includes("admin") || perms.includes("system_admin")) return "admin"
      if (perms.includes("group_admin")) return "group_admin"
      if (perms.includes("user")) return "user"
    }

    if (plugin.ownerOnly === true) {
      return "owner"
    }

    if (plugin.adminOnly === true) {
      return "group_admin"
    }

    const category = plugin.category?.toLowerCase() || ""
    const filename = plugin.filename?.toLowerCase() || ""
    const pluginPath = plugin.fullPath?.toLowerCase() || ""
    
    if (category.includes("owner") || 
        filename.includes("owner") ||
        pluginPath.includes("owner") ||
        pluginPath.includes("/ownermenu/")) {
      return "owner"
    }

    if (category.includes("group") || 
        pluginPath.includes("group") ||
        pluginPath.includes("/groupmenu/")) {
      return "group_admin"
    }

    return "user"
  }

  checkCategoryRestrictions(plugin, m) {
    const category = plugin.category?.toLowerCase() || ""
    
    if ((category === "group" || category === "groupmenu") && !m.isGroup) {
      return {
        allowed: false,
        message: "❌ This command can only be used in groups."
      }
    }

    if ((category === "private" || category === "privatemenu") && m.isGroup) {
      return {
        allowed: false,
        message: "❌ This command can only be used in private chat."
      }
    }

    return { allowed: true }
  }

  getAvailableCommands(category = null) {
    const commands = []
    const seenPlugins = new Set()

    for (const [command, pluginId] of this.commands.entries()) {
      const plugin = this.plugins.get(pluginId)

      if (seenPlugins.has(pluginId)) continue
      seenPlugins.add(pluginId)

      const pluginCategory = plugin.category.split("/")[0]

      if (!category || pluginCategory === category || plugin.category === "both") {
        commands.push({
          command: plugin.commands[0],
          plugin: plugin.name,
          description: plugin.description,
          category: plugin.category,
          adminOnly: plugin.adminOnly || false,
          permissions: plugin.permissions || [],
          usage: plugin.usage || `${plugin.commands[0]} - ${plugin.description}`,
          allCommands: plugin.commands,
        })
      }
    }

    return commands
  }

  getPluginByCommand(commandName) {
    const pluginId = this.commands.get(commandName)
    if (!pluginId) return null
    return this.plugins.get(pluginId) || null
  }

  async processAntiPlugins(sock, sessionId, m) {
    try {
      for (const plugin of this.antiPlugins.values()) {
        try {
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

          if (typeof plugin.processMessage === "function") {
            await plugin.processMessage(sock, sessionId, m)
          }
        } catch (pluginErr) {
          logger.warn(`[PluginLoader] Anti-plugin error in ${plugin?.name || "unknown"}: ${pluginErr.message}`)
        }
      }
    } catch (error) {
      throw error
    }
  }

  async getAvailableMenus() {
    try {
      const { default: menuSystem } = await import("./menu-system.js")
      return await menuSystem.scanMenuFolders()
    } catch (error) {
      logger.error("[PluginLoader] Error getting available menus:", error)
      return []
    }
  }

  getPluginStats() {
    const categories = {}
    for (const plugin of this.plugins.values()) {
      const rootCategory = plugin.category.split("/")[0]
      categories[rootCategory] = (categories[rootCategory] || 0) + 1
    }

    return {
      totalPlugins: this.plugins.size,
      totalCommands: this.commands.size,
      totalAntiPlugins: this.antiPlugins.size,
      categories,
      isInitialized: this.isInitialized,
      autoReloadEnabled: this.autoReloadEnabled,
      watchersActive: this.watchers.size,
      loadAttempts: this.loadAttempts.size,
      failedPlugins: this.failedPlugins.size,
      skippedPlugins: this.skippedPlugins.size,
    }
  }

  listPlugins() {
    const pluginList = []

    for (const [pluginId, plugin] of this.plugins) {
      pluginList.push({
        id: pluginId,
        name: plugin.name,
        category: plugin.category,
        commands: plugin.commands || [],
        hasAntiFeatures: typeof plugin.processMessage === "function",
        adminOnly: plugin.adminOnly || false,
        permissions: plugin.permissions || [],
        description: plugin.description,
        loadedAt: plugin.loadedAt,
      })
    }

    return pluginList.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Debug method to check specific plugin
   */
  async debugPlugin(pluginName, category = "groupmenu") {
    const filename = `${pluginName}.js`
    const pluginPath = path.join(this.pluginDir, category)
    const fullPath = path.join(pluginPath, filename)
    
    logger.info(`[PluginLoader] === DEBUGGING PLUGIN: ${pluginName} ===`)
    logger.info(`[PluginLoader] File: ${filename}`)
    logger.info(`[PluginLoader] Category: ${category}`)
    logger.info(`[PluginLoader] Full path: ${fullPath}`)
    
    try {
      // Check file existence
      await fs.access(fullPath, fs.constants.R_OK)
      logger.info(`[PluginLoader] ✅ File exists and is readable`)
      
      // Try to import
      const moduleUrl = `file://${fullPath}?t=${Date.now()}`
      const pluginModule = await import(moduleUrl)
      const plugin = pluginModule.default || pluginModule
      
      if (!plugin) {
        logger.error(`[PluginLoader] ❌ No valid export found`)
        return
      }
      
      logger.info(`[PluginLoader] ✅ Module imported successfully`)
      logger.info(`[PluginLoader] Plugin details:`, {
        name: plugin.name || 'MISSING',
        hasExecute: typeof plugin.execute === 'function',
        commands: plugin.commands || 'MISSING',
        aliases: plugin.aliases || 'NONE',
        category: plugin.category || 'MISSING',
        adminOnly: plugin.adminOnly || false,
        permissions: plugin.permissions || 'NONE',
        description: plugin.description || 'MISSING'
      })
      
      // Check if it would pass validation
      if (this.validatePlugin(plugin, pluginName, fullPath)) {
        logger.info(`[PluginLoader] ✅ Plugin would pass validation`)
      } else {
        logger.error(`[PluginLoader] ❌ Plugin would fail validation`)
      }
      
    } catch (error) {
      logger.error(`[PluginLoader] ❌ Debug failed:`, error)
    }
    
    logger.info(`[PluginLoader] === END DEBUG ===`)
  }

  /**
   * Get debug information for missing plugins
   */
  getDebugInfo() {
    return {
      loadAttempts: Object.fromEntries(this.loadAttempts),
      failedPlugins: Object.fromEntries(this.failedPlugins),
      skippedPlugins: Object.fromEntries(this.skippedPlugins),
      loadedPlugins: Array.from(this.plugins.keys()),
      totalCommands: this.commands.size,
      commandMap: Object.fromEntries(this.commands)
    }
  }

  async shutdown() {
    logger.info("[PluginLoader] Shutting down plugin loader...")
    await this.clearWatchers()
    logger.info("[PluginLoader] Plugin loader shutdown complete")
  }
}

// Create singleton instance
const pluginLoader = new PluginLoader()

// Handle process termination gracefully
process.on("SIGTERM", async () => {
  await pluginLoader.shutdown()
})

process.on("SIGINT", async () => {
  await pluginLoader.shutdown()
})

export default pluginLoader

// Schedule periodic maintenance every 30 minutes
setInterval(() => {
  pluginLoader.performMaintenance()
}, 1800000)