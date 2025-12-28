import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("ANTI-TAG-ADMIN")

export default {
  name: "Anti-Tag-Admin",
  description: "Prevent non-admins from tagging admins excessively",
  commands: ["antitagadmin"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.antitagadmin on` - Enable admin tag protection\n• `.antitagadmin off` - Disable protection\n• `.antitagadmin status` - Check protection status",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    if (!m.isGroup) {
      await sock.sendMessage(groupJid, {
        text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

      // Check if user is admin
      const adminChecker = new AdminChecker()
      const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
      if (!isAdmin) {
        return { response: "❌ Only group admins can use this command!" }
      }
    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antitagadmin", true)
          await sock.sendMessage(groupJid, {
            text: "👑 *Anti-admin-tag protection enabled!*\n\n" +
              "✅ Tagging admins excessively will be prevented\n" +
              "⚠️ Users get warnings for tagging admins without reason\n" +
              "🔒 Admins are protected from unnecessary mentions" + `

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
          break

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antitagadmin", false)
          await sock.sendMessage(groupJid, {
            text: "👑 Anti-admin-tag protection disabled.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m })
          break

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antitagadmin")
          await sock.sendMessage(groupJid, {
            text: `👑 *Anti-Admin-Tag Status*\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}

` + `

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
          break

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antitagadmin")
          
          await sock.sendMessage(groupJid, {
            text:
              "👑 *Anti-Tag-Admin Commands*\n\n" +
              "• `.antitagadmin on` - Enable protection\n" +
              "• `.antitagadmin off` - Disable protection\n" +
              "• `.antitagadmin status` - Check status\n\n" +
              `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}`
          }, { quoted: m })
          break
      }
    } catch (error) {
      logger.error("Error in antitagadmin command:", error)
      await sock.sendMessage(groupJid, {
        text: "❌ Error managing anti-tag-admin settings\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },

  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antitagadmin")
    } catch (error) {
      logger.error("Error checking if antitagadmin enabled:", error)
      return false
    }
  },

  async shouldProcess(m) {
    if (!m.isGroup || !m.text) return false
    if (m.isCommand) return false
    if (m.key?.fromMe) return false
    
    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, m.chat, m.sender)
    if (isAdmin) return false
    
    return this.hasAdminMentions(sock, m)
  },

  async processMessage(sock, sessionId, m) {
    try {
      await this.handleAdminTagDetection(sock, sessionId, m)
    } catch (error) {
      logger.error("Error processing antitagadmin message:", error)
    }
  },

  async handleAdminTagDetection(sock, sessionId, m) {
    try {
      const adminChecker = new AdminChecker()
      const groupJid = m.chat
      
      if (!groupJid) {
        logger.warn("No group JID available for antitagadmin processing")
        return
      }

      const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
      if (!botIsAdmin) {
        try {
          await sock.sendMessage(groupJid, {
            text: "👑 Admin tagging detected but bot lacks admin permissions to take action.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          })
        } catch (error) {
          logger.error("Failed to send no-permission message:", error)
        }
        return
      }

      const mentionedAdmins = await this.getMentionedAdmins(sock, m)
      if (mentionedAdmins.length === 0) return

      const messageInfo = {
        sender: m.sender,
        text: m.text,
        id: m.key.id,
        mentionedAdmins: mentionedAdmins
      }

      let warnings
      try {
        warnings = await WarningQueries.addWarning(
          groupJid,
          messageInfo.sender,
          "antitagadmin",
          `Tagged ${mentionedAdmins.length} admin(s)`
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
        `👑 *Admin Tagging Detected & Removed!*\n\n` +
        `👤 @${messageInfo.sender.split("@")[0]}\n` +
        `🔖 Tagged ${mentionedAdmins.length} admin(s)\n` +
        `⚠️ Warning: ${warnings}/4`

      if (warnings >= 4) {
        try {
          await sock.groupParticipantsUpdate(groupJid, [messageInfo.sender], "remove")
          response += `\n\n❌ *User removed* after reaching 4 warnings.`
          await WarningQueries.resetUserWarnings(groupJid, messageInfo.sender, "antitagadmin")
        } catch (error) {
          logger.error("Failed to remove user:", error)
          response += `\n\n❌ Failed to remove user (insufficient permissions)`
        }
      } else {
        response += `\n\n📝 ${4 - warnings} warnings remaining before removal.`
      }

      response += `\n\n💡 *Note:* Only tag admins for important matters.`

      try {
        await sock.sendMessage(groupJid, {
          text: response,
          mentions: [messageInfo.sender]
        })
      } catch (error) {
        logger.error("Failed to send warning message:", error)
      }

      try {
        await ViolationQueries.logViolation(
          groupJid,
          messageInfo.sender,
          "antitagadmin",
          messageInfo.text,
          { mentionedAdmins: mentionedAdmins },
          warnings >= 4 ? "kick" : "warning",
          warnings,
          messageInfo.id
        )
      } catch (error) {
        logger.error("Failed to log violation:", error)
      }
      
    } catch (error) {
      logger.error("Error handling admin tag detection:", error)
    }
  },

  async hasAdminMentions(sock, m) {
    const mentionedAdmins = await this.getMentionedAdmins(sock, m)
    return mentionedAdmins.length > 0
  },

  async getMentionedAdmins(sock, m) {
    if (!m.message) return []
    
    const adminChecker = new AdminChecker()
    const groupJid = m.chat
    let mentionedJids = []
    
    // Get mentioned jids from message
    if (m.message.extendedTextMessage && 
        m.message.extendedTextMessage.contextInfo && 
        m.message.extendedTextMessage.contextInfo.mentionedJid) {
      mentionedJids = m.message.extendedTextMessage.contextInfo.mentionedJid
    }
    
    // Check which mentioned users are admins
    const mentionedAdmins = []
    for (const jid of mentionedJids) {
      if (await adminChecker.isGroupAdmin(sock, groupJid, jid)) {
        mentionedAdmins.push(jid)
      }
    }
    
    return mentionedAdmins
  }
}