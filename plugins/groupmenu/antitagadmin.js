import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"

const logger = createComponentLogger("ANTI-TAG-ADMIN")

export default {
  name: "Anti-Tag-Admin",
  description: "Prevent non-admins from tagging admins excessively",
  commands: ["antitagadmin"],
  category: "groupmenu",
  
  // ✅ Permissions control BOTH command execution AND anti-plugin behavior
  permissions: {
    adminRequired: true,      // Non-admins get processed, admins bypass
    botAdminRequired: true,   // Bot needs admin to delete/kick
    groupOnly: true,          // Only works in groups
  },
  
  usage:
    "• `.antitagadmin on` - Enable admin tag protection\n" +
    "• `.antitagadmin off` - Disable protection\n" +
    "• `.antitagadmin status` - Check protection status",

  // ========================================
  // COMMAND EXECUTION
  // ========================================
  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antitagadmin", true)
          await sock.sendMessage(groupJid, {
            text: "👑 *Anti-admin-tag protection enabled!*\n\n" +
              "✅ Tagging admins excessively will be prevented\n" +
              "⚠️ Users get warnings for tagging admins without reason\n" +
              "🔒 Admins are protected from unnecessary mentions\n\n" +
              "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
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
            text: `👑 *Anti-Admin-Tag Status*\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
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

  // ========================================
  // ANTI-PLUGIN PROCESSING
  // ✅ NO ADMIN CHECKS - Plugin loader handles it!
  // ========================================
  
  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antitagadmin")
    } catch (error) {
      logger.error("Error checking if antitagadmin enabled:", error)
      return false
    }
  },

  async shouldProcess(m) {
    // ✅ NO ADMIN CHECKS - Plugin loader handles permission filtering
    // Only basic message filtering here
    
    if (!m.isGroup || !m.text) return false
    if (m.isCommand) return false  // Don't process commands
    if (m.key?.fromMe) return false  // Don't process bot's own messages
    
    // Check if message has mentions (basic check)
    const hasMentions = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0
    if (!hasMentions) return false
    
    return true
  },

  async processMessage(sock, sessionId, m) {
    // ✅ NO ADMIN CHECKS - Plugin loader already filtered:
    //    - Non-admins only (admins were skipped)
    //    - Bot is admin (messages were skipped if bot isn't admin)
    //    - In a group (messages were skipped if not in group)
    
    try {
      const groupJid = m.chat
      
      if (!groupJid) {
        logger.warn("No group JID available for antitagadmin processing")
        return
      }

      // Get mentioned admins
      const mentionedAdmins = await this.getMentionedAdmins(sock, m)
      if (mentionedAdmins.length === 0) {
        return // No admins mentioned, nothing to do
      }

      const messageInfo = {
        sender: m.sender,
        text: m.text,
        id: m.key.id,
        mentionedAdmins: mentionedAdmins
      }

      // Add warning
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

      // Delete the message
      try {
        await sock.sendMessage(groupJid, { delete: m.key })
        m._wasDeletedByAntiPlugin = true
      } catch (error) {
        logger.error("Failed to delete message:", error)
      }

      await new Promise(resolve => setTimeout(resolve, 800))

      let response =
        `👑 *Admin Tagging Detected & Removed!*\n\n` +
        `👤 @${messageInfo.sender.split("@")[0]}\n` +
        `🔖 Tagged ${mentionedAdmins.length} admin(s)\n` +
        `⚠️ Warning: ${warnings}/4`

      // Kick if reached limit
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

      // Send warning message
      try {
        await sock.sendMessage(groupJid, {
          text: response,
          mentions: [messageInfo.sender]
        })
      } catch (error) {
        logger.error("Failed to send warning message:", error)
      }

      // Log violation
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
      logger.error("Error processing antitagadmin message:", error)
    }
  },

  // ========================================
  // HELPER METHODS
  // ✅ Only needs to identify admins, not check sender
  // ========================================
  
  async getMentionedAdmins(sock, m) {
    if (!m.message) return []
    
    const groupJid = m.chat
    let mentionedJids = []
    
    // Extract mentioned JIDs from message
    if (m.message.extendedTextMessage?.contextInfo?.mentionedJid) {
      mentionedJids = m.message.extendedTextMessage.contextInfo.mentionedJid
    }
    
    if (mentionedJids.length === 0) return []
    
    // ✅ We still need to check WHO is an admin (to know if they tagged admins)
    // But we DON'T check if the SENDER is admin (plugin loader does that)
    const { isGroupAdmin } = await import("../../whatsapp/groups/index.js")
    
    const mentionedAdmins = []
    for (const jid of mentionedJids) {
      try {
        const isAdmin = await isGroupAdmin(sock, groupJid, jid)
        if (isAdmin) {
          mentionedAdmins.push(jid)
        }
      } catch (error) {
        logger.error(`Error checking if ${jid} is admin:`, error)
      }
    }
    
    return mentionedAdmins
  }
}