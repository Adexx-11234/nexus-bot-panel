import { createComponentLogger } from "../../utils/logger.js"
import pluginLoader from "../../utils/plugin-loader.js"
import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"
import fs from "fs"
import path from "path"
import sharp from "sharp"

const log = createComponentLogger("ALL-COMMANDS")

// Read more character
const readMore = String.fromCharCode(8206).repeat(4001)

export default {
  name: "AllCommands",
  description: "Display all available commands organized by category",
  commands: ["allcommands", "commands", "help", "allmenu", "mainmenu"],
  category: "mainmenu",
  adminOnly: false,
  usage:
    "• `.allcommands` - Show all available commands\n• `.commands` - Alias for allcommands\n• `.help` - Alias for allcommands",

  async execute(sock, sessionId, args, m) {
    try {
      // Check if user is VIP
      const userTelegramId = VIPHelper.fromSessionId(sessionId)
      let isVIP = false
      if (userTelegramId) {
        const vipStatus = await VIPQueries.isVIP(userTelegramId)
        isVIP = vipStatus.isVIP
      }

      // Check if user is bot owner
      const isOwner = sock?.user?.id && m.sender && 
        sock.user.id.split(':')[0].split('@')[0] === m.sender.split('@')[0].split(':')[0]

      // Get all available commands
      const allCommands = pluginLoader.getAvailableCommands()
      
      // Organize commands by folder category
      const categories = {
        mainmenu: [],
        aimenu: [],
        convertmenu: [],
        downloadmenu: [],
        gamemenu: [],
        groupmenu: [],
        vipmenu: [],
        ownermenu: [],
        other: [],
      }

      // Organize commands by their folder categories
      allCommands.forEach((cmd) => {
        const category = cmd.category?.toLowerCase() || "other"
        
        // Skip vipmenu commands if user is not VIP or owner
        if (category === 'vipmenu' && !isVIP && !isOwner) {
          return
        }

        // Skip ownermenu commands if user is not owner
        if (category === 'ownermenu' && !isOwner) {
          return
        }

        if (categories[category]) {
          categories[category].push(cmd)
        } else {
          categories.other.push(cmd)
        }
      })

      // Build the command list message
      let message = `╭━━━━━『 *ALL COMMANDS* 』━━━━━╮\n\n`
      let totalCommandCount = 0

      // Define category display names and emojis
      const categoryInfo = {
        mainmenu: { title: "📋 MAIN MENU", emoji: "➤" },
        aimenu: { title: "🤖 AI MENU", emoji: "➤" },
        convertmenu: { title: "🔄 CONVERT MENU", emoji: "➤" },
        downloadmenu: { title: "⬇️ DOWNLOAD MENU", emoji: "➤" },
        gamemenu: { title: "🎮 GAME MENU", emoji: "➤" },
        groupmenu: { title: "👥 GROUP MENU", emoji: "➤" },
        vipmenu: { title: "⭐ VIP MENU", emoji: "➤" },
        ownermenu: { title: "👑 OWNER MENU", emoji: "➤" },
        other: { title: "🔧 OTHER COMMANDS", emoji: "➤" },
      }

      // Display commands by category
      Object.entries(categories).forEach(([categoryName, commands]) => {
        if (commands.length > 0) {
          const catInfo = categoryInfo[categoryName] || { title: categoryName, emoji: "➤" }
          message += `┌───⊷ *${catInfo.title}*\n`
          
          commands.forEach((cmd) => {
            totalCommandCount++
            const adminBadge = cmd.adminOnly ? " 👑" : ""
            message += `│${catInfo.emoji} .${cmd.command}${adminBadge}\n`
          })
          
          message += `└─────────────\n${readMore}\n\n`
        }
      })

      message += `╰━━━━━━━━━━━━━━━━╯\n\n`
      message += `📊 *Total:* ${totalCommandCount} commands\n`
      
      if (isVIP) {
        message += `⭐ VIP Active\n`
      }
      
      if (isOwner) {
        message += `👑 Bot Owner\n`
      }
      message += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      // Get bot name and owner name
      const botname = global?.botname || "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      const ownername = m.pushName || "Owner"
      const link = global?.link || "https://nexus-bot-sta7.onrender.com"

      // Get and resize thumbnail (CRITICAL: Must be small for externalAdReply)
      let thumbnailBuffer = null
      try {
        const possiblePaths = [
          path.resolve(process.cwd(), "Defaults", "images", "menu.png"),
          path.resolve(process.cwd(), "defaults", "images", "menu.png"), 
          path.resolve(process.cwd(), "assets", "images", "menu.png")
        ]
        
        for (const imagePath of possiblePaths) {
          if (fs.existsSync(imagePath)) {
            const originalBuffer = fs.readFileSync(imagePath)
            
            // Resize image to thumbnail size for externalAdReply
            // Max 72KB for WhatsApp compatibility
            thumbnailBuffer = await sharp(originalBuffer)
              .resize(200, 200, { // Small thumbnail size
                fit: 'cover',
                position: 'center'
              })
              .jpeg({ 
                quality: 100, // Reduce quality for smaller size
                progressive: true 
              })
              .toBuffer()
            
            log.info(`Resized thumbnail: ${(thumbnailBuffer.length / 1024).toFixed(2)}KB`)
            break
          }
        }
        
        if (!thumbnailBuffer) {
          log.info("No image found in any path")
        }
      } catch (err) {
        log.error("Thumbnail processing error:", err.message)
        thumbnailBuffer = null // Fallback to no image
      }

      // Send message with thumbnail
      await sock.sendMessage(
        m.chat,
        {
          text: message,
          contextInfo: {
            mentionedJid: [m.sender],
            forwardingScore: 9999999,
            isForwarded: true,
            externalAdReply: {
              title: botname,
              body: ownername,
              thumbnailUrl: link,
              thumbnail: thumbnailBuffer,
              sourceUrl: link,
              mediaType: 1,
              renderLargerThumbnail: false
            }
          }
        },
        {
          quoted: m,
        }
      )

      log.info(`All commands list sent to ${m.sender}`)
    } catch (error) {
      log.error("Error in allcommands plugin:", error)
      try {
        await sock.sendMessage(
          m.chat,
          {
            text: "❌ Error loading commands\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          },
          {
            quoted: m,
          }
        )
      } catch (sendError) {
        log.error("Failed to send error message:", sendError)
      }
    }
  },
}