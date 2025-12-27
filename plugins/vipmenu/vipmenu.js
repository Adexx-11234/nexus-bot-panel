import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
  name: "vipmenu",
  commands: ["vipmenu"],
  description: "Display VIP commands menu",
  permissions: {
  ownerAndVip: true,
  privateOnly: true
},
  async execute(sock, sessionId, args, m) {
    try {
      // Get user info
      const userInfo = {
        name: m.pushName || m.name || m.notify || "VIP User",
        id: m.sender,
      }

      // Get VIP statistics
      const ownedUsers = await VIPQueries.getOwnedUsers(userTelegramId)

      // Scan vipmenu folder for plugins
      const vipMenuPath = path.join(__dirname)
      const vipPlugins = await this.scanVIPPlugins(vipMenuPath)

      let menuText = `╭━━━『 *VIP MENU* 』━━━╮\n\n`
      menuText += `👤 *User:* ${userInfo.name}\n`
      menuText += `⭐ *VIP Level:* ${vipStatus.level}${vipStatus.isDefault ? ' (Default VIP)' : ''}\n`
      menuText += `👥 *Owned Users:* ${ownedUsers.length}\n`
      menuText += `📊 *Total Takeovers:* ${ownedUsers.reduce((sum, u) => sum + (u.takeovers_count || 0), 0)}\n\n`

      menuText += `━━━━━━━━━━━━━━━━\n\n`

      // List all VIP commands dynamically
      let commandIndex = 1
      for (const plugin of vipPlugins) {
        // Skip vipmenu itself
        if (plugin.commands.includes('vipmenu')) continue
        
        // Check if command is admin-only
        const isAdminOnly = plugin.filename.includes('promote') || 
                           plugin.filename.includes('demote') || 
                           plugin.filename.includes('admin') ||
                           plugin.filename.includes('reassign') ||
                           plugin.filename.includes('unclaim')
        
        // Skip admin commands if user is not default VIP
        if (isAdminOnly && !vipStatus.isDefault && vipStatus.level !== 99) {
          continue
        }
        
        const primaryCommand = plugin.commands[0]
        menuText += `${commandIndex}. *.${primaryCommand}*\n`
        menuText += `   ${plugin.description}\n`
        if (plugin.usage) {
          menuText += `   📖 ${plugin.usage.split('\n')[0]}\n`
        }
        menuText += `\n`
        commandIndex++
      }

      // Default VIP exclusive section
      if (vipStatus.isDefault || vipStatus.level === 99) {
        menuText += `━━━━━━━━━━━━━━━━\n\n`
        menuText += `👑 *ADMIN COMMANDS*\n`
        menuText += `*(Default VIP Exclusive)*\n\n`
        
        const adminPlugins = vipPlugins.filter(p => 
          p.filename.includes('promote') || 
          p.filename.includes('demote') || 
          p.filename.includes('admin') ||
          p.filename.includes('reassign') ||
          p.filename.includes('unclaim')
        )
        
        adminPlugins.forEach((plugin, idx) => {
          const primaryCommand = plugin.commands[0]
          menuText += `${idx + 1}. *.${primaryCommand}*\n`
          menuText += `   ${plugin.description}\n\n`
        })
      }

      menuText += `━━━━━━━━━━━━━━━━\n\n`
      menuText += `💡 *Quick Tips:*\n`
      menuText += `• Claim users before taking over\n`
      menuText += `• Use vipgroups to see available targets\n`
      menuText += `• Takeovers are instant and silent\n`
      menuText += `• Target user won't be notified\n\n`
      menuText += `╰━━━━━━━━━━━━━━━━╯`

      await sock.sendMessage(m.chat, {
        text: menuText,
      }, { quoted: m })

      return { success: true }
    } catch (error) {
      console.error("[VIPMenu] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Error loading VIP menu.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
      return { success: false, error: error.message }
    }
  },

  // Scan VIP plugins dynamically
  async scanVIPPlugins(vipMenuPath) {
    try {
      const files = await fs.readdir(vipMenuPath)
      const plugins = []

      for (const file of files) {
        if (!file.endsWith('.js') || file === 'vipmenu.js') continue

        try {
          const filePath = path.join(vipMenuPath, file)
          const moduleUrl = `file://${filePath}?t=${Date.now()}`
          const pluginModule = await import(moduleUrl)
          const plugin = pluginModule.default || pluginModule

          if (plugin && plugin.name) {
            plugins.push({
              name: plugin.name,
              commands: plugin.commands || [file.replace('.js', '')],
              description: plugin.description || 'No description',
              usage: plugin.usage || '',
              filename: file
            })
          }
        } catch (error) {
          console.error(`[VIPMenu] Failed to load ${file}:`, error.message)
        }
      }

      return plugins.sort((a, b) => a.name.localeCompare(b.name))
    } catch (error) {
      console.error('[VIPMenu] Error scanning plugins:', error)
      return []
    }
  }
}