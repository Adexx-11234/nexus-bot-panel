import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"
import { pool } from "../../config/database.js"

const logger = createComponentLogger("ANTI-LINK")

export default {
  name: "Anti-Link",
  description: "Detect and remove links with configurable warning system",
  commands: ["antilink"],
  category: "groupmenu",
  adminOnly: true,
  usage:
    "• `.antilink on` - Enable link protection\n• `.antilink off` - Disable link protection\n• `.antilink status` - Check protection status\n• `.antilink warn [number]` - Set warning limit (3-10)\n• `.antilink reset @user` - Reset user warnings\n• `.antilink list` - Show warning list\n• `.antilink stats` - View statistics",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    if (!m.isGroup) {
      await sock.sendMessage(groupJid, {
        text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    const adminChecker = new AdminChecker()
  const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
  if (!isAdmin) {
    return { response: "❌ Only group admins can use this command!" }
  }

    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antilink", true)
          // Set default warning limit to 4 if not already set
          const currentLimit = await this.getWarningLimit(groupJid)
          if (!currentLimit) {
            await this.setWarningLimit(groupJid, 4)
          }
          
  await sock.sendMessage(groupJid, {
    text: "✅ Anti-link enabled\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
  }, { quoted: m })
  break

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antilink", false)
          await sock.sendMessage(groupJid, {
            text: "🔗 Anti-link protection disabled.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m })
          break

        case "warn":
          if (args.length < 2) {
            const currentLimit = await this.getWarningLimit(groupJid) || 4
            await sock.sendMessage(groupJid, {
              text: `⚠️ *Current warning limit:* ${currentLimit}\n\nUsage: \`.antilink warn [3-10]\` to change limit` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
            }, { quoted: m })
            return
          }

          const newLimit = parseInt(args[1])
          if (isNaN(newLimit) || newLimit < 3 || newLimit > 10) {
            await sock.sendMessage(groupJid, {
              text: "❌ Warning limit must be between 3 and 10\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
            }, { quoted: m })
            return
          }

          await this.setWarningLimit(groupJid, newLimit)
          await sock.sendMessage(groupJid, {
            text: `✅ Warning limit set to ${newLimit} warnings before removal

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
          break

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antilink")
          const warningStats = await WarningQueries.getWarningStats(groupJid, "antilink")
          const warningLimit = await this.getWarningLimit(groupJid) || 4
          
          await sock.sendMessage(groupJid, {
            text: `🔗 *Anti-link Status*\n\n` +
              `Status: ${status ? "✅ Enabled" : "❌ Disabled"}\n` +
              `Warning Limit: ${warningLimit} warnings\n` +
              `Active Warnings: ${warningStats.totalUsers} users\n` +
              `Total Warnings: ${warningStats.totalWarnings}\n` +
              `Max Warnings: ${warningStats.maxWarnings}/${warningLimit}

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
          break

        case "reset":
          const targetUser = await this.extractTargetUser(m, args)
          if (!targetUser) {
            await sock.sendMessage(groupJid, {
              text: "❌ Usage: `.antilink reset @user` or reply to a user's message with `.antilink reset`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
            }, { quoted: m })
            return
          }

          const resetResult = await WarningQueries.resetUserWarnings(groupJid, targetUser, "antilink")
          const userNumber = targetUser.split("@")[0]
          
          if (resetResult) {
            await sock.sendMessage(groupJid, {
              text: `✅ Warning limit set to ${newLimit} warnings before removal` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
              ,
              mentions: [targetUser]
            }, { quoted: m })
          } else {
            await sock.sendMessage(groupJid, {
              text: `ℹ️ @${userNumber} had no active warnings to reset` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
              mentions: [targetUser]
            }, { quoted: m })
          }
          break

        case "list":
          const warningList = await WarningQueries.getWarningList(groupJid, "antilink")
          if (warningList.length === 0) {
            await sock.sendMessage(groupJid, {
              text: "📋 No active warnings found\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
            }, { quoted: m })
            return
          }

          const currentWarningLimit = await this.getWarningLimit(groupJid) || 4
          let listResponse = "📋 *Active Anti-link Warnings*\n\n"
          warningList.forEach((warn, index) => {
            const userNumber = warn.user_jid.split("@")[0]
            listResponse += `${index + 1}. @${userNumber} - ${warn.warning_count}/${currentWarningLimit} warnings\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          })

          const mentions = warningList.map((w) => w.user_jid)
          await sock.sendMessage(groupJid, {
            text: listResponse,
            mentions: mentions
          }, { quoted: m })
          break

        case "stats":
          const violationStats = await ViolationQueries.getViolationStats(groupJid, "antilink", 7)
          const weekStats = violationStats[0] || { total_violations: 0, unique_violators: 0, kicks: 0, warnings: 0 }

          await sock.sendMessage(groupJid, {
            text: `📊 *Anti-link Statistics (Last 7 days)*\n\n` +
              `👥 Users warned: ${weekStats.unique_violators}\n` +
              `⚠️ Warnings issued: ${weekStats.warnings}\n` +
              `🚪 Users kicked: ${weekStats.kicks}

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
          break

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antilink")
          const currentWarnLimit = await this.getWarningLimit(groupJid) || 4
          
          await sock.sendMessage(groupJid, {
            text:
              "🔗 *Anti-Link Commands*\n\n" +
              "• `.antilink on` - Enable protection\n" +
              "• `.antilink off` - Disable protection\n" +
              "• `.antilink status` - Check status\n" +
              "• `.antilink warn [3-10]` - Set warning limit\n" +
              "• `.antilink reset @user` - Reset warnings\n" +
              "• `.antilink list` - Show warning list\n" +
              "• `.antilink stats` - View statistics\n\n" +
              `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}\n` +
              `*Warning Limit:* ${currentWarnLimit} warnings` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
          break
      }
    } catch (error) {
      logger.error("Error in antilink command:", error)
      await sock.sendMessage(groupJid, {
        text: "❌ Error managing anti-link settings\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },

  // Helper function to extract target user from mentions or replies
  async extractTargetUser(m, args) {
    // Method 1: Check for mentions in the message
    const contextInfo = m.message?.message?.extendedTextMessage?.contextInfo
    if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
      return contextInfo.mentionedJid[0]
    }

    // Method 2: Check if it's a reply to someone's message
    if (contextInfo?.quotedMessage && contextInfo.participant) {
      return contextInfo.participant
    }

    // Method 3: Check for mentions in different message types
    const messageContent = m.message?.message
    if (messageContent) {
      // Check in conversation (regular text)
      if (messageContent.conversation && contextInfo?.mentionedJid) {
        return contextInfo.mentionedJid[0]
      }
      
      // Check in extended text message
      if (messageContent.extendedTextMessage?.contextInfo?.mentionedJid) {
        return messageContent.extendedTextMessage.contextInfo.mentionedJid[0]
      }
    }

    // Method 4: Try to extract from raw message structure
    if (m.mentionedJid && m.mentionedJid.length > 0) {
      return m.mentionedJid[0]
    }

    // Method 5: Check if user provided a phone number manually
    if (args.length > 1) {
      const phoneArg = args[1].replace(/[@\s-+]/g, '')
      if (/^\d{10,15}$/.test(phoneArg)) {
        return `${phoneArg}@s.whatsapp.net`
      }
    }

    // Method 6: Check if replying to a message (alternative approach)
    if (m.quoted && m.quoted.sender) {
      return m.quoted.sender
    }

    return null
  },

  // Get warning limit for a group
  async getWarningLimit(groupJid) {
    try {
      const result = await pool.query(
        `SELECT warning_limit FROM groups WHERE jid = $1`,
        [groupJid]
      )
      return result.rows[0]?.warning_limit || 4 // Default to 4 if not set
    } catch (error) {
      logger.error("Error getting warning limit:", error)
      return 4
    }
  },

  // Set warning limit for a group
  async setWarningLimit(groupJid, limit) {
    try {
      // Ensure group exists first
      await GroupQueries.ensureGroupExists(groupJid)
      
      await pool.query(
        `UPDATE groups SET warning_limit = $1, updated_at = CURRENT_TIMESTAMP WHERE jid = $2`,
        [limit, groupJid]
      )
      return true
    } catch (error) {
      logger.error("Error setting warning limit:", error)
      return false
    }
  },

  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antilink")
    } catch (error) {
      logger.error("Error checking if antilink enabled:", error)
      return false
    }
  },

  async shouldProcess(m) {
    if (!m.isGroup || !m.text) return false
    if (m.isCommand) return false
    if (m.key?.fromMe) return false
    return this.detectLinks(m.text)
  },

  async processMessage(sock, sessionId, m) {
    try {
      await this.handleLinkDetection(sock, sessionId, m)
    } catch (error) {
      logger.error("Error processing antilink message:", error)
    }
  },

  async handleLinkDetection(sock, sessionId, m) {
    try {
      const adminChecker = new AdminChecker()
      const groupJid = m.chat
      
      if (!groupJid) {
        logger.warn("No group JID available for antilink processing")
        return
      }

      const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
      if (isAdmin) {
        return
      }

      const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
      if (!botIsAdmin) {
        try {
          await sock.sendMessage(groupJid, {
            text: "🔗 Link detected but bot lacks admin permissions to remove it.\n\nPlease make bot an admin to enable message deletion.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          })
        } catch (error) {
          logger.error("Failed to send no-permission message:", error)
        }
        return
      }

      const detectedLinks = this.extractLinks(m.text)
      const warningLimit = await this.getWarningLimit(groupJid)
      
      const messageInfo = {
        sender: m.sender,
        text: m.text,
        id: m.key.id
      }

      let warnings
      try {
        warnings = await WarningQueries.addWarning(
          groupJid,
          messageInfo.sender,
          "antilink",
          "Posted link in restricted group"
        )
      } catch (error) {
        logger.error("Failed to add warning:", error)
        warnings = 1
      }

      try {
        await sock.sendMessage(groupJid, { delete: m.key })
        m._wasDeletedByAntiPlugin = true
      } catch (error) {
        logger.error("Failed to delete message:", error)
        m._wasDeletedByAntiPlugin = true
      }

      await new Promise(resolve => setTimeout(resolve, 800))

let response =
  `🔗 *Link Detected & Removed!*\n\n` +
  `👤 @${messageInfo.sender.split("@")[0]}\n` +
    `⚠️ Warning: ${warnings}/${warningLimit}` +
  `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

if (warnings >= warningLimit) {
  try {
    await sock.groupParticipantsUpdate(groupJid, [messageInfo.sender], "remove")
    await WarningQueries.resetUserWarnings(groupJid, messageInfo.sender, "antilink")
  } catch (error) {
    logger.error("Failed to remove user:", error)
  }
}
      try {
        await sock.sendMessage(groupJid, {
          text: response,
          mentions: [messageInfo.sender]
        })
      } catch (error) {
        logger.error("Failed to send warning message:", error)
        try {
          await sock.sendMessage(groupJid, {
            text: response.replace(`@${messageInfo.sender.split("@")[0]}`, messageInfo.sender.split("@")[0])
          })
        } catch (fallbackError) {
          logger.error("Failed to send fallback message:", fallbackError)
        }
      }

      try {
        await ViolationQueries.logViolation(
          groupJid,
          messageInfo.sender,
          "antilink",
          messageInfo.text,
          { links: detectedLinks },
          warnings >= warningLimit ? "kick" : "warning",
          warnings,
          messageInfo.id
        )
      } catch (error) {
        logger.error("Failed to log violation:", error)
      }
      
    } catch (error) {
      logger.error("Error handling link detection:", error)
    }
  },

  detectLinks(text) {
    // Clean text and normalize spaces
    const cleanText = text.trim().replace(/\s+/g, ' ')
    
    // More precise link detection patterns
    const linkPatterns = [
      // HTTP/HTTPS URLs
      /https?:\/\/(?:[-\w.])+(?:\:[0-9]+)?(?:\/[^\s]*)?/gi,
      
      // www. URLs
      /\bwww\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?/gi,
      
      // Domain with common TLDs (more restrictive)
      /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.(?:com|net|org|edu|gov|mil|co|io|me|tv|info|biz|app|dev|tech|online|site|website|store|shop)\b(?:\/[^\s]*)?/gi,
      
      // Specific platform patterns
      /\bt\.me\/[a-zA-Z0-9_]+/gi,
      /\byoutube\.com\/watch\?v=[a-zA-Z0-9_-]+/gi,
      /\byoutu\.be\/[a-zA-Z0-9_-]+/gi,
      /\bwa\.me\/[0-9]+/gi,
      /\binstagram\.com\/[a-zA-Z0-9_.]+/gi,
      /\bfacebook\.com\/[a-zA-Z0-9.]+/gi,
      /\btwitter\.com\/[a-zA-Z0-9_]+/gi,
      /\btiktok\.com\/@?[a-zA-Z0-9_.]+/gi,
      /\bdiscord\.gg\/[a-zA-Z0-9]+/gi,
      /\bbit\.ly\/[a-zA-Z0-9]+/gi,
      /\btinyurl\.com\/[a-zA-Z0-9]+/gi
    ]

    // Check each pattern
    for (const pattern of linkPatterns) {
      if (pattern.test(cleanText)) {
        return true
      }
    }

    // Additional check for suspicious patterns that might be disguised links
    const suspiciousPatterns = [
      // Spaced out URLs
      /h\s*t\s*t\s*p\s*s?\s*:\s*\/\s*\/\s*[^\s]+/gi,
      // Dotted domains without proper spacing
      /[a-zA-Z0-9]\.[a-zA-Z0-9]\.[a-zA-Z]{2,}/g
    ]

    for (const pattern of suspiciousPatterns) {
      const matches = cleanText.match(pattern)
      if (matches) {
        // Verify it's actually a link and not just dots in numbers/text
        for (const match of matches) {
          const cleaned = match.replace(/\s+/g, '')
          if (this.isValidUrl(cleaned)) {
            return true
          }
        }
      }
    }

    return false
  },

  extractLinks(text) {
    const links = new Set()
    const cleanText = text.trim().replace(/\s+/g, ' ')
    
    const linkPatterns = [
      /https?:\/\/(?:[-\w.])+(?:\:[0-9]+)?(?:\/[^\s]*)?/gi,
      /\bwww\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?/gi,
      /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.(?:com|net|org|edu|gov|mil|co|io|me|tv|info|biz|app|dev|tech|online|site|website|store|shop)\b(?:\/[^\s]*)?/gi,
      /\bt\.me\/[a-zA-Z0-9_]+/gi,
      /\byoutube\.com\/watch\?v=[a-zA-Z0-9_-]+/gi,
      /\byoutu\.be\/[a-zA-Z0-9_-]+/gi,
      /\bwa\.me\/[0-9]+/gi,
      /\binstagram\.com\/[a-zA-Z0-9_.]+/gi,
      /\bfacebook\.com\/[a-zA-Z0-9.]+/gi,
      /\btwitter\.com\/[a-zA-Z0-9_]+/gi,
      /\btiktok\.com\/@?[a-zA-Z0-9_.]+/gi,
      /\bdiscord\.gg\/[a-zA-Z0-9]+/gi,
      /\bbit\.ly\/[a-zA-Z0-9]+/gi,
      /\btinyurl\.com\/[a-zA-Z0-9]+/gi
    ]

    linkPatterns.forEach(pattern => {
      let match
      pattern.lastIndex = 0 // Reset regex state
      while ((match = pattern.exec(cleanText)) !== null) {
        const link = match[0].trim()
        if (link && this.isValidUrl(link)) {
          links.add(link)
        }
      }
    })

    return Array.from(links)
  },

  isValidUrl(text) {
    // Remove common false positives
    if (!text || text.length < 4) return false
    
    // Skip if it's just numbers with dots (like IP addresses in normal text)
    if (/^\d+\.\d+(\.\d+)*$/.test(text)) return false
    
    // Skip if it looks like a version number or decimal
    if (/^\d+\.\d+$/.test(text) && !text.includes('/')) return false
    
    // Skip if it's just file extensions
    if (/^\.[a-z]{2,4}$/i.test(text)) return false
    
    // Must contain at least one valid TLD or be a recognized platform
    const validPatterns = [
      /^https?:\/\//i,
      /^www\./i,
      /\.(com|net|org|edu|gov|mil|co|io|me|tv|info|biz|app|dev|tech|online|site|website|store|shop)(\b|\/)/i,
      /^(t\.me|wa\.me|bit\.ly|tinyurl\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|twitter\.com|tiktok\.com|discord\.gg)\//i
    ]

    return validPatterns.some(pattern => pattern.test(text))
  }
}