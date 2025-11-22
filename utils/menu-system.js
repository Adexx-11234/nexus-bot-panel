// Improved Menu System for WhatsApp Bot - Optimized and Clean
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { logger } from "./logger.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class MenuSystem {
  constructor() {
    this.pluginDir = path.join(__dirname, "..", "plugins")
    this.menuCache = new Map()
    this.lastScan = 0
    this.cacheDuration = 60000 // 1 minute cache (reduced from 30 seconds for better performance)
  }

  /**
   * Scan plugin directories and return available menu folders
   */
  async scanMenuFolders() {
    try {
      const now = Date.now()
      if (this.menuCache.has("folders") && now - this.lastScan < this.cacheDuration) {
        return this.menuCache.get("folders")
      }

      const items = await fs.readdir(this.pluginDir, { withFileTypes: true })
      const folders = []

      for (const item of items) {
        if (item.isDirectory()) {
                  // SKIP VIPMENU - it's handled separately
        if (item.name.toLowerCase() === 'vipmenu') {
          continue
        }
          const folderPath = path.join(this.pluginDir, item.name)
          const jsFiles = await this.getJSFilesInFolder(folderPath)

          if (jsFiles.length > 0) {
            folders.push({
              name: item.name,
              displayName: this.formatMenuName(item.name),
              fileCount: jsFiles.length,
              files: jsFiles,
            })
          }
        }
      }

      this.menuCache.set("folders", folders)
      this.lastScan = now

      return folders
    } catch (error) {
      logger.error("[MenuSystem] Error scanning menu folders:", error)
      return []
    }
  }

  /**
   * Get all JS files in a folder
   */
  async getJSFilesInFolder(folderPath) {
    try {
      const files = await fs.readdir(folderPath)
      return files.filter((file) => file.endsWith(".js"))
    } catch (error) {
      return []
    }
  }

  /**
   * Format menu name for display
   */
  formatMenuName(folderName) {
    return folderName
      .replace(/menu$/i, "")
      .replace(/([A-Z])/g, " $1")
      .trim()
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }

  /**
   * Generate main menu with dynamic buttons
   */
  async generateMainMenu(userInfo = {}) {
    const folders = await this.scanMenuFolders()
    const currentTime = new Date()
    const timeGreeting = this.getTimeGreeting()

    let menuText = `┌─❖\n`
    menuText += `│ 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙\n`
    menuText += `└┬❖\n`
    menuText += `┌┤ ${timeGreeting}\n`
    menuText += `│└────────┈⳹\n`
    menuText += `│👤 ᴜsᴇʀ: ${userInfo.name || "User"}\n`
    menuText += `│📅 ᴅᴀᴛᴇ: ${currentTime.toLocaleDateString()}\n`
    menuText += `│⏰ ᴛɪᴍᴇ: ${currentTime.toLocaleTimeString()}\n`
    menuText += `│🛠 ᴠᴇʀsɪᴏɴ: 1.0.0\n`
    menuText += `└─────────────┈⳹\n\n`

    menuText += `📜 Available Commands:\n\n`

    // Generate menu buttons dynamically
    for (const folder of folders) {
      const emoji = this.getMenuEmoji(folder.name)
      menuText += `${emoji} .${folder.name.toLowerCase()}\n`
    }

    menuText += `\n© paulbot`

    return menuText
  }

  /**
   * Generate menu for specific category
   */
  async generateCategoryMenu(category, userInfo = {}, isOwner = false) {
    const folderPath = path.join(this.pluginDir, category)

    try {
      const files = await this.getJSFilesInFolder(folderPath)

      if (files.length === 0) {
        return `❌ No commands found in ${category} menu.`
      }

      const plugins = await this.getPluginDetails(folderPath, files)
      const categoryDisplay = this.formatMenuName(category)

      let menuText = `┌─❖\n`
      menuText += `│ ${categoryDisplay} Menu\n`
      menuText += `└┬❖\n`
      menuText += `┌┤ 📋 Available Commands\n`
      menuText += `│└────────┈⳹\n`

      // Check if this is owner menu and user is not owner
      if (category.toLowerCase().includes("owner") && !isOwner) {
        menuText += `│🔒 Owner Only Commands\n`
        menuText += `│ (View only - requires owner permission)\n`
        menuText += `│└────────┈⳹\n\n`
      }

      let index = 1
      for (const plugin of plugins) {
        const emoji = this.getCommandEmoji(plugin.name)
        const primaryCommand = plugin.commands[0] || plugin.name
        menuText += `${emoji} ${index}. *.${primaryCommand}*\n`
        menuText += `   └ ${plugin.description || "No description"}\n\n`
        index++
      }

      menuText += `© paulbot`

      return menuText
    } catch (error) {
      logger.error(`[MenuSystem] Error generating ${category} menu:`, error)
      return `❌ Error loading ${category} menu.`
    }
  }

  /**
   * Generate allmenu command showing all plugins with enhanced formatting
   */
  async generateAllMenu() {
    const folders = await this.scanMenuFolders()
    const allPlugins = []

    // Collect all plugins from all folders
    for (const folder of folders) {
      const folderPath = path.join(this.pluginDir, folder.name)
      const plugins = await this.getPluginDetails(folderPath, folder.files)

      for (const plugin of plugins) {
        allPlugins.push({
          ...plugin,
          category: folder.displayName,
          folderName: folder.name,
        })
      }
    }

    let menuText = `🅞 = For Owner\n🅖 = For Group\n🅕 = For Free User\n🅟 = For Premium User\n\n`

    // Group by category and display in specific order
    const categoryOrder = ["ownermenu", "groupmenu", "mainmenu", "downloadmenu", "convertmenu", "gamemenu", "aimenu"]
    const groupedPlugins = {}

    // Initialize groups in order
    for (const category of categoryOrder) {
      groupedPlugins[category] = []
    }

    // Add other categories not in the predefined order
    for (const plugin of allPlugins) {
      const folderName = plugin.folderName.toLowerCase()
      if (!groupedPlugins[folderName]) {
        groupedPlugins[folderName] = []
      }
      groupedPlugins[folderName].push(plugin)
    }

    // Display categories in order
    for (const [folderName, plugins] of Object.entries(groupedPlugins)) {
      if (plugins.length === 0) continue

      const categoryDisplay = this.formatMenuName(folderName).replace("Menu", "")
      menuText += `╭––『 ${categoryDisplay} Menu 』\n`

      for (const plugin of plugins) {
        const primaryCommand = plugin.commands[0] || plugin.name
        let indicator = "🅕" // Default for free user
        if (folderName.includes("owner")) indicator = "🅞"
        else if (folderName.includes("group")) indicator = "🅖"

        menuText += `┆❏ .${primaryCommand} ${indicator}\n`
      }

      menuText += `╰–––––––––––––––༓\n\n`
    }

    menuText += `© paulbot`
    return menuText
  }

  /**
   * Get plugin details from files - improved error handling
   */
  async getPluginDetails(folderPath, files) {
    const plugins = []

    for (const file of files) {
      try {
        const filePath = path.join(folderPath, file)
        const moduleUrl = `file://${filePath}?t=${Date.now()}`
        const pluginModule = await import(moduleUrl)
        const plugin = pluginModule.default || pluginModule

        if (plugin && plugin.name) {
          plugins.push({
            name: plugin.name,
            commands: plugin.commands || plugin.aliases || [file.replace(".js", "")],
            description: plugin.description || "No description available",
            adminOnly: plugin.adminOnly || false,
            permissions: plugin.permissions || [],
            filename: file,
          })
        }
      } catch (error) {
        // If plugin fails to load, create basic info from filename
        const pluginName = file.replace(".js", "")
        plugins.push({
          name: pluginName,
          commands: [pluginName],
          description: "Plugin description unavailable",
          adminOnly: false,
          permissions: [],
          filename: file,
        })
      }
    }

    return plugins.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Get time-based greeting
   */
  getTimeGreeting() {
    const hour = new Date().getHours()
    if (hour < 12) return "🌅 Good Morning"
    if (hour < 17) return "🌤 Good Afternoon"  
    if (hour < 21) return "🌆 Good Evening"
    return "🌙 Good Night"
  }

  /**
   * Get emoji for menu categories
   */
  getMenuEmoji(menuName) {
    const emojiMap = {
      mainmenu: "🏠",
      ownermenu: "👑",
      groupmenu: "👥",
      downloadmenu: "📥",
      gamemenu: "🎮",
      aimenu: "🤖",
      convertmenu: "🔄",
      toolsmenu: "🛠",
      funmenu: "🎉",
      adminmenu: "⚡",
      utilitymenu: "🔧",
    }
    return emojiMap[menuName.toLowerCase()] || "📋"
  }

  /**
   * Get emoji for individual commands
   */
  getCommandEmoji(commandName) {
    const name = commandName.toLowerCase()
    const emojiMap = {
      ping: "🏓",
      help: "❓", 
      menu: "📋",
      antilink: "🔗",
      antidelete: "🗑",
      promote: "⬆️",
      demote: "⬇️",
      kick: "👢",
      add: "➕",
      tagall: "📢",
      hidetag: "👻",
      download: "📥",
      play: "▶️",
      search: "🔍",
      welcome: "👋",
      block: "🚫",
      unblock: "✅"
    }
    return emojiMap[name] || "▫️"
  }

  /**
   * Clear menu cache
   */
  clearCache() {
    this.menuCache.clear()
    this.lastScan = 0
  }

  /**
   * Generate interactive menu buttons for WhatsApp - improved structure
   */
  async generateInteractiveMenu(userInfo = {}, prefix = ".") {
    const folders = await this.scanMenuFolders()
    const currentTime = new Date()
    const timeGreeting = this.getTimeGreeting()
  
    let captionText = `┌─❖\n`
    captionText += `│ 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙\n`
    captionText += `└┬❖\n`
    captionText += `┌┤ ${timeGreeting}\n`
    captionText += `│└────────┈⳹\n`
    captionText += `│👤 ᴜsᴇʀ: ${userInfo.name || "User"}\n`
    captionText += `│📅 ᴅᴀᴛᴇ: ${currentTime.toLocaleDateString()}\n`
    captionText += `│⏰ ᴛɪᴍᴇ: ${currentTime.toLocaleTimeString()}\n`
    captionText += `│🛠 ᴠᴇʀsɪᴏɴ: 1.0.0\n`
    captionText += `└─────────────┈⳹\n\n`
    captionText += `🎯 Select a menu category below to explore available commands!\n`
    captionText += `📊 Total Categories: ${folders.length}`

    const menuRows = []

    // Add allmenu as first option
    menuRows.push({
      header: "📶 ALL MENU",
      title: "Click to display",
      description: "🌠 Displays The Complete List Of All Features 🎁",
      id: `${prefix}allmenu`,
    })

    for (const folder of folders) {
      const emoji = this.getMenuEmoji(folder.name)
      const displayName = folder.displayName.toUpperCase()
      const description = this.getFolderDescription(folder.name, folder.fileCount)

      menuRows.push({
        header: `${emoji} ${displayName} MENU`,
        title: "Click to display",
        description: `🎯 ${description}`,
        id: `${prefix}${folder.name.toLowerCase()}`,
      })
    }

    return {
      caption: captionText,
      buttons: [
        {
          buttonId: "mainmenu_options",
          buttonText: { displayText: "🔘 CLICK TO DISPLAY LIST OF COMMANDS 🔘" },
          type: 4,
          nativeFlowInfo: {
            name: "single_select",
            paramsJson: JSON.stringify({
              title: "🔘 CLICK TO DISPLAY LIST OF COMMANDS 🔘",
              sections: [
                {
                  title: "𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
                  rows: menuRows,
                },
              ],
            }),
          },
        },
      ],
    }
  }

  /**
   * Get description for folder based on its contents
   */
  getFolderDescription(folderName, fileCount) {
    const descriptions = {
      mainmenu: `Displays The List Of Main Features (${fileCount} commands)`,
      ownermenu: `Displays The List Of Owner Features (${fileCount} commands) 🥇`,
      groupmenu: `Displays The List Of Group Management Features (${fileCount} commands) 🍁`,
      downloadmenu: `Displays The List Of Download Features (${fileCount} commands) 🦄`,
      gamemenu: `Displays The List Of Game Features (${fileCount} commands) 🍂`,
      aimenu: `Displays The List Of AI Features (${fileCount} commands) 🍡`,
      convertmenu: `Displays The List Of Convert Features (${fileCount} commands) 💡`,
      funmenu: `Displays The List Of Fun Features (${fileCount} commands) 🎷`,
      toolsmenu: `Displays The List Of Tool Features (${fileCount} commands) 🔧`,
      adminmenu: `Displays The List Of Admin Features (${fileCount} commands) ⚡`,
    }

    return (
      descriptions[folderName.toLowerCase()] ||
      `Displays The List Of ${this.formatMenuName(folderName)} Features (${fileCount} commands) 🎯`
    )
  }

  /**
   * Get menu system statistics
   */
  async getStats() {
    const folders = await this.scanMenuFolders()
    let totalCommands = 0

    for (const folder of folders) {
      totalCommands += folder.fileCount
    }

    return {
      totalCategories: folders.length,
      totalCommands: totalCommands,
      cacheSize: this.menuCache.size,
      lastScan: new Date(this.lastScan).toISOString(),
      cacheDuration: this.cacheDuration,
      categories: folders.map(f => ({
        name: f.name,
        displayName: f.displayName,
        commandCount: f.fileCount
      }))
    }
  }
}

// Create singleton instance
const menuSystem = new MenuSystem()

export default menuSystem