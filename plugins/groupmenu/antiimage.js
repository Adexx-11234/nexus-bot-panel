import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("ANTI-IMAGE")

export default {
  name: "Anti-Image",
  description: "Detect and remove images with warning system",
  commands: ["antiimage"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.antiimage on` - Enable image protection\n• `.antiimage off` - Disable image protection\n• `.antiimage status` - Check protection status\n• `.antiimage reset @user` - Reset user warnings\n• `.antiimage list` - Show warning list\n• `.antiimage stats` - View statistics",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    if (!m.isGroup) {
      return { response: "❌ This command can only be used in groups!" }
    }

    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antiimage", true)
          return {
            response:
              "📷 *Anti-image protection enabled!*\n\n" +
              "✅ Images will be detected and removed\n" +
              "⚠️ Users get 4 warnings before removal\n" +
              "👑 Admins are exempt from image restrictions",
          }

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antiimage", false)
          return { response: "📷 Anti-image protection disabled." }

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antiimage")
          const warningStats = await WarningQueries.getWarningStats(groupJid, "antiimage")
          return {
            response:
              `📷 *Anti-Image Status*\n\n` +
              `Status: ${status ? "✅ Enabled" : "❌ Disabled"}\n` +
              `Active Warnings: ${warningStats.totalUsers} users\n` +
              `Total Warnings: ${warningStats.totalWarnings}\n` +
              `Max Warnings: ${warningStats.maxWarnings}/4`,
          }

        case "reset":
          if (args.length < 2) {
            return { response: "❌ Usage: `.antiimage reset @user`" }
          }

          // Extract mentioned user
          const mentionedJid = m.message?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
          if (!mentionedJid) {
            return { response: "❌ Please mention a user to reset their warnings" }
          }

          await WarningQueries.resetUserWarnings(groupJid, mentionedJid, "antiimage")
          return {
            response: `✅ Warnings reset for @${mentionedJid.split("@")[0]}`,
            mentions: [mentionedJid],
          }

        case "list":
          const warningList = await WarningQueries.getWarningList(groupJid, "antiimage")
          if (warningList.length === 0) {
            return { response: "📋 No active warnings found" }
          }

          let listResponse = "📋 *Active Anti-image Warnings*\n\n"
          warningList.forEach((warn, index) => {
            const userNumber = warn.user_jid.split("@")[0]
            listResponse += `${index + 1}. @${userNumber} - ${warn.warning_count}/4 warnings\n`
          })

          const mentions = warningList.map((w) => w.user_jid)
          return { response: listResponse, mentions }

        case "stats":
          const violationStats = await ViolationQueries.getViolationStats(groupJid, "antiimage", 7)
          const weekStats = violationStats[0] || { total_violations: 0, unique_violators: 0, kicks: 0, warnings: 0 }

          return {
            response:
              `📊 *Anti-image Statistics (Last 7 days)*\n\n` +
              `👥 Users warned: ${weekStats.unique_violators}\n` +
              `⚠️ Warnings issued: ${weekStats.warnings}\n` +
              `🚪 Users kicked: ${weekStats.kicks}`,
          }

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antiimage")
          return {
            response:
              "📷 *Anti-image Commands*\n\n" +
              "• `.antiimage on` - Enable protection\n" +
              "• `.antiimage off` - Disable protection\n" +
              "• `.antiimage status` - Check status\n" +
              "• `.antiimage reset @user` - Reset warnings\n" +
              "• `.antiimage list` - Show warning list\n" +
              "• `.antiimage stats` - View statistics\n\n" +
              `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}`,
          }
      }
    } catch (error) {
      logger.error("Error in antiimage command:", error)
      return { response: "❌ Error managing anti-image settings" }
    }
  },

  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antiimage")
    } catch (error) {
      logger.error(`[Anti-Image] Error checking if enabled: ${error.message}`)
      return false
    }
  },

  async shouldProcess(m) {
    if (!m.isGroup) return false
    if (m.isCommand) return false
    if (m.key?.fromMe) return false
    return this.detectImages(m)
  },

  async processMessage(sock, sessionId, m) {
    try {
      await this.handleImageDetection(sock, sessionId, m)
    } catch (error) {
      logger.error(`[Anti-Image] Error processing message: ${error.message}`)
    }
  },

  async handleImageDetection(sock, sessionId, m) {
    try {
      const adminChecker = new AdminChecker()
      const groupJid = m.chat
      if (!groupJid) {
        logger.warn(`[Anti-Image] No group JID available, skipping`)
        return
      }

      const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
      if (isAdmin) {
        logger.debug(`[Anti-Image] Admin ${m.sender} exempt from image restrictions`)
        return
      }

      const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
      if (!botIsAdmin) {
        logger.warn(`[Anti-Image] Bot not admin in ${groupJid}, cannot delete messages`)
        await sock.sendMessage(groupJid, {
          text: "📷 Image detected but bot lacks admin permissions to remove it.\n\n" +
            "Please make bot an admin to enable message deletion." + `

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        }, {quoted: m})
        return
      }

      try {
        await sock.sendMessage(groupJid, { delete: m.key })
        // CRITICAL FIX: Mark message as deleted by anti-plugin
        m._wasDeletedByAntiPlugin = true
        logger.info(`[Anti-Image] Deleted image message from ${m.sender} in ${groupJid}`)
      } catch (deleteError) {
        logger.error(`[Anti-Image] Failed to delete message: ${deleteError.message}`)
        // Even if delete fails, still mark it to prevent command execution
        m._wasDeletedByAntiPlugin = true
      }

      const warnings = await WarningQueries.addWarning(
        groupJid,
        m.sender,
        "antiimage",
        "Posted image in restricted group",
      )

      let response =
        `📷 *Image Detected & Removed!*\n\n` +
        `👤 @${m.sender.split("@")[0]}\n` +
        `⚠️ Warning: ${warnings}/4`

      if (warnings >= 4) {
        try {
          await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
          response += `\n\n❌ *User removed* after reaching 4 warnings.`
          await WarningQueries.resetUserWarnings(groupJid, m.sender, "antiimage")
          logger.info(`[Anti-Image] Removed user ${m.sender} from ${groupJid} after 4 warnings`)
        } catch (removeError) {
          logger.error(`[Anti-Image] Failed to remove user: ${removeError.message}`)
          response += `\n\n❌ Failed to remove user (insufficient permissions)`
        }
      } else {
        response += `\n\n📝 ${4 - warnings} warnings remaining before removal.`
      }

      response += `\n\n💡 *Tip:* Admins can send images freely.`

      await sock.sendMessage(
        groupJid,
        {
          text: response,
          mentions: [m.sender],
        },
        { quoted: m },
      )

      await ViolationQueries.logViolation(
        groupJid,
        m.sender,
        "antiimage",
        "Image message",
        { messageType: this.getImageType(m) },
        warnings >= 4 ? "kick" : "warning",
        warnings,
        m.id,
      )

      logger.info(`[Anti-Image] Warning issued: ${m.sender} in ${groupJid} (${warnings}/4)`)
    } catch (error) {
      logger.error("[Anti-Image] Error handling image detection:", error)
    }
  },

  detectImages(m) {
    // Check if message contains image
    if (m.message?.imageMessage) return true
    if (m.message?.viewOnceMessage?.message?.imageMessage) return true
    if (m.message?.ephemeralMessage?.message?.imageMessage) return true
    
    // Check message type
    if (m.mtype === 'imageMessage') return true
    if (m.mtype === 'viewOnceMessage' && m.message?.viewOnceMessage?.message?.imageMessage) return true
    
    return false
  },

  getImageType(m) {
    if (m.message?.imageMessage) return "image"
    if (m.message?.viewOnceMessage?.message?.imageMessage) return "view-once-image"
    if (m.message?.ephemeralMessage?.message?.imageMessage) return "ephemeral-image"
    return "unknown-image"
  },

  extractLinks(text) {
    // This method is no longer needed for image detection, but keeping for compatibility
    return []
  },
}