import { createComponentLogger } from "../../utils/logger.js"
import fs from "fs"
import path from "path"
import sharp from "sharp"

const logger = createComponentLogger("BOT-LINK")

// Read more character
const readMore = String.fromCharCode(8206).repeat(4001)

export default {
  name: "BotLink",
  description: "Get bot connection links and information",
  commands: ["botlink", "connect", "botinfo", "repo"],
  category: "mainmenu",
  adminOnly: false,
  usage:
    "• `.botlink` - Show bot connection links\n• `.connect` - Alias for botlink\n• `.botinfo` - Alias for botlink",

  /**
   * Main command execution
   */
  async execute(sock, sessionId, args, m) {
    try {
      // Validate inputs
      if (!this.validateCommandInputs(sock, m)) return

      // Get user info
      const userName = m.pushName || m.sender?.split('@')[0] || "User"
      const userNumber = m.sender?.split('@')[0] || "Unknown"

      // Get bot info
      const botname = global?.botname || "𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      
      // Bot connection links
      const webLink = "https://nexus-bot-sta7.onrender.com"
      const telegramLink = "https://t.me/nexus_xmd_bot"

      // Build response message (FIXED: Added missing + operator)
      const response = 
        `╔═══════════════════╗\n` +
        `║   🤖 ${botname.toUpperCase()}   ║\n` +
        `╚═══════════════════╝\n\n` +
        `👋 Hi *${userName}*!\n\n` +
        `Connect with the bot through:\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 *WEB INTERFACE*\n` +
        `${webLink}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📱 *TELEGRAM BOT*\n` +
        `${telegramLink}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `> © ${botname}`

      // Get and resize thumbnail
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
            logger.info(`Found image: ${imagePath}, size: ${(originalBuffer.length / 1024).toFixed(2)}KB`)
            
            // Resize to thumbnail
            thumbnailBuffer = await sharp(originalBuffer)
              .resize(200, 200, {
                fit: 'cover',
                position: 'center'
              })
              .jpeg({ 
                quality: 70,
                progressive: true 
              })
              .toBuffer()
            
            logger.info(`Resized thumbnail: ${(thumbnailBuffer.length / 1024).toFixed(2)}KB`)
            break
          }
        }
      } catch (err) {
        logger.error("Thumbnail processing error:", err.message)
        thumbnailBuffer = null
      }

      // Send message with simplified contextInfo (like your working ownermenu)
      await sock.sendMessage(m.chat, {
        text: response,
        contextInfo: {
         mentionedJid: [m.sender],
          forwardingScore: 9999999,
          isForwarded: true,
          externalAdReply: {
            title: `🤖 ${botname}`,
            body: "Connect with us! 🌐",
            thumbnailUrl: webLink,
            thumbnail: thumbnailBuffer,
            sourceUrl: webLink,
            mediaType: 1,
            renderLargerThumbnail: false,
          },
        },
      }, {
        quoted: m,
      })

      logger.info(`Bot links sent to ${userName} (${userNumber})`)

      return { success: true }

    } catch (error) {
      logger.error("Error in botlink plugin:", error)
      await this.sendErrorMessage(sock, m.chat, m)
      return { success: false, error: error.message }
    }
  },

  /**
   * Validate command execution inputs
   */
  validateCommandInputs(sock, m) {
    if (!sock || !m || !m.chat || !m.sender) {
      logger.warn("Invalid command inputs provided")
      return false
    }
    return true
  },

  /**
   * Send error message
   */
  async sendErrorMessage(sock, chatId, m) {
    try {
      await sock.sendMessage(
        chatId,
        {
          text: "❌ Error loading bot information. Please try again later.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        },
        {
          quoted: m,
        }
      )
    } catch (error) {
      logger.error("Failed to send error message:", error)
    }
  }
}