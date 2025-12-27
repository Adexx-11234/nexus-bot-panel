import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"

const logger = createComponentLogger("ANTI-IMAGE")

export default {
  name: "Anti-Image",
  description: "Detect and remove images with configurable warning system",
  commands: ["antiimage"],
  category: "groupmenu",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• .antiimage on/off/kick/status\n• .antiimage warn [0-10]\n• .antiimage reset @user\n• .antiimage list/stats",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat


    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antiimage", true)
          const currentLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antiimage")
          const actionText = currentLimit === 0 ? "instant removal" : `${currentLimit} warnings before removal`
          return { response: `✅ Anti-image enabled (${actionText})` }

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antiimage", false)
          return { response: "❌ Anti-image disabled" }

        case "kick":
          await GroupQueries.setAntiCommand(groupJid, "antiimage", true)
          await GroupQueries.setAntiCommandWarningLimit(groupJid, "antiimage", 0)
          return { response: "✅ Anti-image set to instant removal (0 warnings)" }

        case "warn":
          if (args.length < 2) {
            const currentLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antiimage")
            return { response: `Current limit: ${currentLimit} (0 = instant kick, 1-10 = warnings)\n\nUsage: .antiimage warn [0-10]` }
          }

          const newLimit = parseInt(args[1])
          if (isNaN(newLimit) || newLimit < 0 || newLimit > 10) {
            return { response: "❌ Limit must be 0-10 (0 = instant kick)" }
          }

          await GroupQueries.setAntiCommand(groupJid, "antiimage", true)
          await GroupQueries.setAntiCommandWarningLimit(groupJid, "antiimage", newLimit)
          const actionType = newLimit === 0 ? "instant removal" : `${newLimit} warnings before removal`
          return { response: `✅ Anti-image set to ${actionType}` }

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antiimage")
          const warningLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antiimage")
          const warningStats = await WarningQueries.getWarningStats(groupJid, "antiimage")
          const action = warningLimit === 0 ? "Instant kick" : `${warningLimit} warnings`
          return { 
            response: `📷 Anti-Image Status\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}\nAction: ${action}\nActive warnings: ${warningStats.totalUsers} users\nTotal warnings: ${warningStats.totalWarnings}` 
          }

        case "reset":
          const targetUser = await this.extractTargetUser(m, args)
          if (!targetUser) {
            return { response: "❌ Usage: .antiimage reset @user or reply to user's message" }
          }

          await WarningQueries.resetUserWarnings(groupJid, targetUser, "antiimage")
          return { response: `✅ Warnings reset for @${targetUser.split("@")[0]}`, mentions: [targetUser] }

        case "list":
          const warningList = await WarningQueries.getWarningList(groupJid, "antiimage")
          if (warningList.length === 0) {
            return { response: "📋 No active warnings" }
          }

          const limit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antiimage")
          let listResponse = "📋 Active Anti-Image Warnings\n\n"
          warningList.forEach((warn, index) => {
            const userNumber = warn.user_jid.split("@")[0]
            listResponse += `${index + 1}. @${userNumber} - ${warn.warning_count}/${limit}\n`
          })

          return { response: listResponse, mentions: warningList.map(w => w.user_jid) }

        case "stats":
          const violationStats = await ViolationQueries.getViolationStats(groupJid, "antiimage", 7)
          const weekStats = violationStats[0] || { unique_violators: 0, warnings: 0, kicks: 0 }
          return { 
            response: `📊 Anti-Image Stats (7 days)\n\n👥 Users warned: ${weekStats.unique_violators}\n⚠️ Warnings: ${weekStats.warnings}\n🚪 Kicks: ${weekStats.kicks}` 
          }

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antiimage")
          const currentWarnLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antiimage")
          return { 
            response: `📷 Anti-Image Commands\n\n• .antiimage on - Enable\n• .antiimage off - Disable\n• .antiimage kick - Instant removal\n• .antiimage warn [0-10] - Set limit\n• .antiimage status - Check status\n• .antiimage reset @user - Reset warnings\n• .antiimage list - Show warnings\n• .antiimage stats - Statistics\n\nStatus: ${currentStatus ? "✅ Enabled" : "❌ Disabled"}\nLimit: ${currentWarnLimit} warnings` 
          }
      }
    } catch (error) {
      logger.error("Error in antiimage command:", error)
      return { response: "❌ Error managing anti-image settings" }
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
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antiimage")
    } catch (error) {
      logger.error("Error checking if antiimage enabled:", error)
      return false
    }
  },

  async shouldProcess(m) {
    if (!m.isGroup || !this.detectImages(m)) return false
    if (m.isCommand) return false
    if (m.key?.fromMe) return false
    return true
  },

  async processMessage(sock, sessionId, m) {
    try {
      await this.handleImageDetection(sock, sessionId, m)
    } catch (error) {
      logger.error("Error processing antiimage message:", error)
    }
  },

  async handleImageDetection(sock, sessionId, m) {
    try {
      const groupJid = m.chat
      
      if (!groupJid) return

      const warningLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antiimage")

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
          text: `📷 Image detected - @${m.sender.split("@")[0]} removed (instant kick mode)`,
          mentions: [m.sender]
        })

        await ViolationQueries.logViolation(
          groupJid,
          m.sender,
          "antiimage",
          "Image message",
          { imageType: this.getImageType(m) },
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
        "antiimage",
        "Posted image in restricted group"
      )

      let response = `📷 Image detected!\n\n👤 @${m.sender.split("@")[0]}\n⚠️ Warning: ${warnings}/${warningLimit}`

      if (warnings >= warningLimit) {
        try {
          await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
          await WarningQueries.resetUserWarnings(groupJid, m.sender, "antiimage")
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
        "antiimage",
        "Image message",
        { imageType: this.getImageType(m) },
        warnings >= warningLimit ? "kick" : "warning",
        warnings,
        m.key.id
      )
    } catch (error) {
      logger.error("Error handling image detection:", error)
    }
  },

  detectImages(m) {
    if (m.message?.imageMessage) return true
    if (m.message?.viewOnceMessage?.message?.imageMessage) return true
    if (m.message?.ephemeralMessage?.message?.imageMessage) return true
    if (m.mtype === 'imageMessage') return true
    if (m.mtype === 'viewOnceMessage' && m.message?.viewOnceMessage?.message?.imageMessage) return true
    return false
  },

  getImageType(m) {
    if (m.message?.imageMessage) return "image"
    if (m.message?.viewOnceMessage?.message?.imageMessage) return "view-once-image"
    if (m.message?.ephemeralMessage?.message?.imageMessage) return "ephemeral-image"
    return "unknown-image"
  }
}