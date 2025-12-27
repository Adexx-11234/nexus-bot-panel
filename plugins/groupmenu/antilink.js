import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"

const logger = createComponentLogger("ANTI-LINK")

export default {
  name: "Anti-Link",
  description: "Detect and remove links with configurable warning system",
  commands: ["antilink"],
  category: "groupmenu",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• .antilink on/off/kick/status\n• .antilink warn [0-10]\n• .antilink reset @user\n• .antilink list/stats",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat


    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antilink", true)
          const currentLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antilink")
          const actionText = currentLimit === 0 ? "instant removal" : `${currentLimit} warnings before removal`
          return { response: `✅ Antilink enabled (${actionText})` }

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antilink", false)
          return { response: "❌ Antilink disabled" }

        case "kick":
          await GroupQueries.setAntiCommand(groupJid, "antilink", true)
          await GroupQueries.setAntiCommandWarningLimit(groupJid, "antilink", 0)
          return { response: "✅ Antilink set to instant removal (0 warnings)" }

        case "warn":
          if (args.length < 2) {
            const currentLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antilink")
            return { response: `Current limit: ${currentLimit} (0 = instant kick, 1-10 = warnings)\n\nUsage: .antilink warn [0-10]` }
          }

          const newLimit = parseInt(args[1])
          if (isNaN(newLimit) || newLimit < 0 || newLimit > 10) {
            return { response: "❌ Limit must be 0-10 (0 = instant kick)" }
          }

          await GroupQueries.setAntiCommand(groupJid, "antilink", true)
          await GroupQueries.setAntiCommandWarningLimit(groupJid, "antilink", newLimit)
          const actionType = newLimit === 0 ? "instant removal" : `${newLimit} warnings before removal`
          return { response: `✅ Antilink set to ${actionType}` }

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antilink")
          const warningLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antilink")
          const warningStats = await WarningQueries.getWarningStats(groupJid, "antilink")
          const action = warningLimit === 0 ? "Instant kick" : `${warningLimit} warnings`
          return { 
            response: `📗 Antilink Status\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}\nAction: ${action}\nActive warnings: ${warningStats.totalUsers} users\nTotal warnings: ${warningStats.totalWarnings}` 
          }

        case "reset":
          const targetUser = await this.extractTargetUser(m, args)
          if (!targetUser) {
            return { response: "❌ Usage: .antilink reset @user or reply to user's message" }
          }

          await WarningQueries.resetUserWarnings(groupJid, targetUser, "antilink")
          return { response: `✅ Warnings reset for @${targetUser.split("@")[0]}`, mentions: [targetUser] }

        case "list":
          const warningList = await WarningQueries.getWarningList(groupJid, "antilink")
          if (warningList.length === 0) {
            return { response: "📋 No active warnings" }
          }

          const limit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antilink")
          let listResponse = "📋 Active Antilink Warnings\n\n"
          warningList.forEach((warn, index) => {
            const userNumber = warn.user_jid.split("@")[0]
            listResponse += `${index + 1}. @${userNumber} - ${warn.warning_count}/${limit}\n`
          })

          return { response: listResponse, mentions: warningList.map(w => w.user_jid) }

        case "stats":
          const violationStats = await ViolationQueries.getViolationStats(groupJid, "antilink", 7)
          const weekStats = violationStats[0] || { unique_violators: 0, warnings: 0, kicks: 0 }
          return { 
            response: `📊 Antilink Stats (7 days)\n\n👥 Users warned: ${weekStats.unique_violators}\n⚠️ Warnings: ${weekStats.warnings}\n🚪 Kicks: ${weekStats.kicks}` 
          }

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antilink")
          const currentWarnLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antilink")
          return { 
            response: `📗 Antilink Commands\n\n• .antilink on - Enable\n• .antilink off - Disable\n• .antilink kick - Instant removal\n• .antilink warn [0-10] - Set limit\n• .antilink status - Check status\n• .antilink reset @user - Reset warnings\n• .antilink list - Show warnings\n• .antilink stats - Statistics\n\nStatus: ${currentStatus ? "✅ Enabled" : "❌ Disabled"}\nLimit: ${currentWarnLimit} warnings` 
          }
      }
    } catch (error) {
      logger.error("Error in antilink command:", error)
      return { response: "❌ Error managing antilink settings" }
    }
  },

  async extractTargetUser(m, args) {
    const contextInfo = m.message?.message?.extendedTextMessage?.contextInfo
    if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
      return contextInfo.mentionedJid[0]
    }
    if (contextInfo?.quotedMessage && contextInfo.participant) {
      return contextInfo.participant
    }
    if (m.quoted && m.quoted.sender) {
      return m.quoted.sender
    }
    return null
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
      const groupJid = m.chat
      
      if (!groupJid) return

      const warningLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antilink")

      // Delete message first
      try {
        await sock.sendMessage(groupJid, { delete: m.key })
        m._wasDeletedByAntiPlugin = true
      } catch (error) {
        logger.error("Failed to delete message:", error)
        m._wasDeletedByAntiPlugin = true
      }

      // Handle instant kick (limit = 0)
      if (warningLimit === 0) {
        await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
        await sock.sendMessage(groupJid, {
          text: `🔗 Link detected - @${m.sender.split("@")[0]} removed (instant kick mode)`,
          mentions: [m.sender]
        })

        await ViolationQueries.logViolation(
          groupJid,
          m.sender,
          "antilink",
          m.text,
          { links: this.extractLinks(m.text) },
          "kick",
          0,
          m.key.id
        )
        return
      }

      // Handle warnings
      const warnings = await WarningQueries.addWarning(
        groupJid,
        m.sender,
        "antilink",
        "Posted link in restricted group"
      )

      let response = `🔗 Link detected!\n\n👤 @${m.sender.split("@")[0]}\n⚠️ Warning: ${warnings}/${warningLimit}`

      if (warnings >= warningLimit) {
        try {
          await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
          await WarningQueries.resetUserWarnings(groupJid, m.sender, "antilink")
        } catch (error) {
          logger.error("Failed to remove user:", error)
        }
      }

      await sock.sendMessage(groupJid, {
        text: response,
        mentions: [m.sender]
      })

      await ViolationQueries.logViolation(
        groupJid,
        m.sender,
        "antilink",
        m.text,
        { links: this.extractLinks(m.text) },
        warnings >= warningLimit ? "kick" : "warning",
        warnings,
        m.key.id
      )
    } catch (error) {
      logger.error("Error handling link detection:", error)
    }
  },

  detectLinks(text) {
    const cleanText = text.trim().replace(/\s+/g, ' ')
    const linkPatterns = [
      /https?:\/\/(?:[-\w.])+(?:\:[0-9]+)?(?:\/[^\s]*)?/gi,
      /\bwww\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?/gi,
      /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.(?:com|net|org|edu|gov|mil|co|io|me|tv|info|biz|app|dev|tech|online|site|website|store|shop)\b(?:\/[^\s]*)?/gi,
      /\bt\.me\/[a-zA-Z0-9_]+/gi,
      /\byoutube\.com\/watch\?v=[a-zA-Z0-9_-]+/gi,
      /\byoutu\.be\/[a-zA-Z0-9_-]+/gi,
      /\bwa\.me\/[0-9]+/gi
    ]

    return linkPatterns.some(pattern => pattern.test(cleanText))
  },

  extractLinks(text) {
    const links = new Set()
    const cleanText = text.trim().replace(/\s+/g, ' ')
    
    const linkPatterns = [
      /https?:\/\/(?:[-\w.])+(?:\:[0-9]+)?(?:\/[^\s]*)?/gi,
      /\bwww\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?/gi,
      /\bt\.me\/[a-zA-Z0-9_]+/gi,
      /\bwa\.me\/[0-9]+/gi
    ]

    linkPatterns.forEach(pattern => {
      let match
      pattern.lastIndex = 0
      while ((match = pattern.exec(cleanText)) !== null) {
        links.add(match[0].trim())
      }
    })

    return Array.from(links)
  }
}