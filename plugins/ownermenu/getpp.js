import { createComponentLogger } from "../../utils/logger.js"
import { writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

const logger = createComponentLogger("GETPP")

export default {
  name: "Get Profile Picture",
  description: "Get profile picture of user or group",
  commands: ["getpp", "pp", "profilepic"],
  category: "ownermenu",
    permissions: {
  ownerOnly: true,          // Only bot owner can use (overrides everything)
  privateOnly: true         // Can only be used in private chats
},
  usage: "• `.getpp` - Show help menu\n• `.getpp @user` - Get profile pic by mentioning user\n• `.getpp <number>` - Get profile pic by phone number\n• Reply to a message with `.getpp` - Get sender's profile pic\n• `.getpp me` - Get your own profile pic\n• `.getpp group` - Get current group profile pic",

  async execute(sock, sessionId, args, m) {
    try {
      // Determine target
      const target = await this.getTarget(sock, m, args)

      if (!target) {
        await this.showHelp(sock, m)
        return
      }

      // Send processing message
      const processingMsg = await sock.sendMessage(m.chat, {
        text: `⏳ Fetching profile picture...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      // Get profile picture
      const result = await this.getProfilePicture(sock, target)

      if (result.success) {
        // Send the profile picture
        await sock.sendMessage(m.chat, {
          image: result.buffer,
          caption: `✅ *Profile Picture*\n\n` +
                   `👤 User: @${target.jid.split('@')[0]}\n` +
                   `📱 Type: ${target.type}\n` +
                   `🔗 Quality: ${result.quality}\n\n` +
                   `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          mentions: [target.jid]
        })

        // Delete processing message
        await sock.sendMessage(m.chat, { delete: processingMsg.key })

      } else {
        // Update processing message with error
        await sock.sendMessage(m.chat, {
          text: `❌ ${result.error}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          edit: processingMsg.key
        })
      }

    } catch (error) {
      logger.error("Error executing getpp command:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Error fetching profile picture.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },

  /**
   * Determine the target user/group
   */
  async getTarget(sock, m, args) {
    try {
      // Method 1: Reply to a message (highest priority)
      if (m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedSender = m.message.extendedTextMessage.contextInfo.participant || 
                            m.message.extendedTextMessage.contextInfo.remoteJid
        
        return {
          jid: quotedSender,
          type: quotedSender.endsWith('@g.us') ? 'Group' : 'User',
          method: 'Reply'
        }
      }

      // Method 2: Mentioned user
      const mentionedJids = m.message?.extendedTextMessage?.contextInfo?.mentionedJid
      if (mentionedJids && mentionedJids.length > 0) {
        return {
          jid: mentionedJids[0],
          type: 'User',
          method: 'Mention'
        }
      }

      // Method 3: "me" - get sender's own profile pic
      if (args[0]?.toLowerCase() === 'me') {
        return {
          jid: m.sender,
          type: 'User',
          method: 'Self'
        }
      }

      // Method 4: "group" or "chat" - get current group/chat profile pic
      if (args[0]?.toLowerCase() === 'group' || args[0]?.toLowerCase() === 'chat') {
        return {
          jid: m.chat,
          type: m.chat.endsWith('@g.us') ? 'Group' : 'User',
          method: 'Current Chat'
        }
      }

      // Method 5: Phone number provided
      if (args[0]) {
        const phoneNumber = args[0].replace(/[^0-9]/g, '')
        
        if (phoneNumber.length >= 10) {
          // Check if it's a valid WhatsApp number
          const jid = `${phoneNumber}@s.whatsapp.net`
          
          try {
            // Verify number exists on WhatsApp
            const [result] = await sock.onWhatsApp(phoneNumber)
            if (result?.exists) {
              return {
                jid: result.jid,
                type: 'User',
                method: 'Phone Number'
              }
            }
          } catch (error) {
            logger.error("Error checking WhatsApp number:", error)
          }
        }
      }

      // Method 6: No valid args - return null to show help
      return null

    } catch (error) {
      logger.error("Error determining target:", error)
      return null
    }
  },

  /**
   * Get profile picture from WhatsApp
   */
  async getProfilePicture(sock, target) {
    try {
      // Try to get high quality profile picture first
      let profilePicUrl
      let quality = 'High'

      try {
        profilePicUrl = await sock.profilePictureUrl(target.jid, 'image')
      } catch (error) {
        // If high quality fails, try preview quality
        try {
          profilePicUrl = await sock.profilePictureUrl(target.jid, 'preview')
          quality = 'Preview'
        } catch (previewError) {
          return {
            success: false,
            error: `No profile picture found for this ${target.type.toLowerCase()}.`
          }
        }
      }

      // Download the profile picture
      const response = await fetch(profilePicUrl)
      if (!response.ok) {
        return {
          success: false,
          error: 'Failed to download profile picture.'
        }
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      return {
        success: true,
        buffer: buffer,
        quality: quality,
        url: profilePicUrl
      }

    } catch (error) {
      logger.error("Error getting profile picture:", error)
      return {
        success: false,
        error: 'Failed to fetch profile picture. User may have privacy settings enabled.'
      }
    }
  },

  /**
   * Show help message
   */
  async showHelp(sock, m) {
    await sock.sendMessage(m.chat, {
      text: "📸 *Get Profile Picture - Help Menu*\n\n" +
            "❓ *Usage:*\n" +
            "• `.getpp` - Show this help menu\n" +
            "• `.getpp @user` - Mention a user\n" +
            "• `.getpp 2348123456789` - Use phone number\n" +
            "• `.getpp me` - Your own profile pic\n" +
            "• `.getpp group` - Current group profile pic\n" +
            "• Reply to message + `.getpp` - Sender's pic\n\n" +
            "💡 *Examples:*\n" +
            "• `.getpp group` (in group chat)\n" +
            "• `.getpp @2348123456789`\n" +
            "• `.getpp 2348123456789`\n" +
            "• `.getpp me`\n" +
            "• Reply to someone's message with `.getpp`\n\n" +
            "📝 *Note:* Some users may have privacy settings that prevent viewing their profile picture.\n\n" +
            "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
    }, { quoted: m })
  }
}