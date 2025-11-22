import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("ANTI-GROUP-MENTION")

export default {
  name: "Anti-Group-Mention",
  description: "Prevent mentioning the group in WhatsApp Status",
  commands: ["antigroupmention", "angm"],
  category: "group",
  adminOnly: true,
  usage: "• `.antigroupmention on` - Enable group status mention protection\n• `.antigroupmention off` - Disable protection\n• `.antigroupmention status` - Check protection status",

  /**
   * Main command execution
   */
  async execute(sock, sessionId, args, m) {
    try {
      // Validate inputs
      if (!this.validateCommandInputs(sock, m)) return

      const action = args[0]?.toLowerCase()
      const groupJid = m.chat

      // Ensure this is a group
      if (!this.isGroupMessage(m)) {
        await sock.sendMessage(groupJid, {
          text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Check admin permissions
      if (!(await this.checkAdminPermission(sock, groupJid, m.sender, m))) return

      // Handle command actions
      switch (action) {
        case "on":
          await this.enableProtection(sock, groupJid, m)
          break
        case "off":
          await this.disableProtection(sock, groupJid, m)
          break
        case "status":
          await this.showStatus(sock, groupJid, m)
          break
        default:
          await this.showHelp(sock, groupJid, m)
          break
      }
    } catch (error) {
      logger.error("Error executing antigroupmention command:", error)
      await this.sendErrorMessage(sock, m.chat, m)
    }
  },

  /**
   * Check if the plugin is enabled for a group
   */
  async isEnabled(groupJid) {
    try {
      if (!groupJid) return false
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antigroupmention")
    } catch (error) {
      logger.error("Error checking if antigroupmention enabled:", error)
      return false
    }
  },

  /**
   * Check if message should be processed by this plugin
   * Fixed: Only takes message parameter, not sock
   */
  async shouldProcess(m) {
    try {
      // Validate required parameters
      if (!m) {
        logger.debug("Missing message parameter in shouldProcess")
        return false
      }

      // Skip bot's own messages
      if (m.key?.fromMe) return false

      // Only process group messages
      if (!this.isGroupMessage(m)) return false

      // Skip if required message properties are missing
      if (!m.chat || !m.sender) {
        logger.debug("Missing chat or sender in message")
        return false
      }

      // Check if this is a group status mention
      return this.isGroupStatusMention(m)

    } catch (error) {
      logger.error("Error in shouldProcess:", error)
      return false
    }
  },

  /**
   * Process the message for group status mention detection
   */
  async processMessage(sock, sessionId, m) {
    try {
      if (!this.validateProcessInputs(sock, m)) return

      const groupJid = m.chat

      // Skip admin messages (moved from shouldProcess since we need sock here)
      if (await this.isUserAdmin(sock, groupJid, m.sender)) return

      // Check if bot has admin permissions
      if (!(await this.checkBotAdminPermission(sock, groupJid))) return

      // Process the violation
      await this.processViolation(sock, groupJid, m)

    } catch (error) {
      logger.error("Error processing antigroupmention message:", error)
    }
  },

  // ===================
  // VALIDATION METHODS
  // ===================

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
   * Validate message processing inputs
   */
  validateProcessInputs(sock, m) {
    if (!sock || !m || !m.chat || !m.sender || !m.key?.id) {
      logger.warn("Invalid process inputs provided")
      return false
    }
    return true
  },

  /**
   * Check if message is from a group
   */
  isGroupMessage(m) {
    return m?.isGroup === true || (m?.chat && m.chat.endsWith('@g.us'))
  },

  /**
   * Check if message is a group status mention
   */
  isGroupStatusMention(m) {
    if (!m?.message) return false

    // Method 1: Direct type check
    if (m.type === 'groupStatusMentionMessage') {
      return true
    }

    // Method 2: Check message content
    if (m.message.groupStatusMentionMessage) {
      return true
    }

    // Method 3: Check protocol message type 25 (status mention)
    if (m.message.protocolMessage?.type === 25) {
      return true
    }

    // Method 4: Check for messageContextInfo only message
    if (Object.keys(m.message).length === 1 && Object.keys(m.message)[0] === 'messageContextInfo') {
      return true
    }

    return false
  },

  // ===================
  // PERMISSION METHODS
  // ===================

  /**
   * Check if user is admin
   */
  async isUserAdmin(sock, groupJid, userJid) {
    try {
      const adminChecker = new AdminChecker()
      return await adminChecker.isGroupAdmin(sock, groupJid, userJid)
    } catch (error) {
      logger.error("Error checking user admin status:", error)
      return false
    }
  },

  /**
   * Check admin permission for command execution
   */
  async checkAdminPermission(sock, groupJid, userJid, m) {
    const isAdmin = await this.isUserAdmin(sock, groupJid, userJid)
    if (!isAdmin) {
      await sock.sendMessage(groupJid, {
        text: "❌ Only group admins can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return false
    }
    return true
  },

  /**
   * Check if bot has admin permissions
   */
  async checkBotAdminPermission(sock, groupJid) {
    try {
      const adminChecker = new AdminChecker()
      const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
      
      if (!botIsAdmin) {
        await sock.sendMessage(groupJid, {
          text: "👥 Group status mention detected but bot lacks admin permissions to take action.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        })
        return false
      }
      return true
    } catch (error) {
      logger.error("Error checking bot admin permission:", error)
      return false
    }
  },

  // ===================
  // COMMAND HANDLERS
  // ===================

  /**
   * Enable anti-group-mention protection
   */
  async enableProtection(sock, groupJid, m) {
    await GroupQueries.setAntiCommand(groupJid, "antigroupmention", true)
    await sock.sendMessage(groupJid, {
      text: "✅ Anti-group-status-mention enabled\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
    }, { quoted: m })
  },

  /**
   * Disable anti-group-mention protection
   */
  async disableProtection(sock, groupJid, m) {
    await GroupQueries.setAntiCommand(groupJid, "antigroupmention", false)
    await sock.sendMessage(groupJid, {
      text: "❌ Anti-group-status-mention disabled\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
    }, { quoted: m })
  },

  /**
   * Show current protection status
   */
  async showStatus(sock, groupJid, m) {
    const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antigroupmention")
    await sock.sendMessage(groupJid, {
      text: `Status: ${status ? "✅ Enabled" : "❌ Disabled"}

` + `

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m })
  },

  /**
   * Show help message
   */
  async showHelp(sock, groupJid, m) {
    const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antigroupmention")
    
    await sock.sendMessage(groupJid, {
      text: "`.antigroupmention on/off/status`\n\n" +
            `Current: ${currentStatus ? "✅ Enabled" : "❌ Disabled"}`
    }, { quoted: m })
  },

  /**
   * Send error message
   */
  async sendErrorMessage(sock, groupJid, m) {
    try {
      await sock.sendMessage(groupJid, {
        text: "❌ Error managing anti-group-status-mention settings\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    } catch (error) {
      logger.error("Failed to send error message:", error)
    }
  },

  // ===================
  // VIOLATION PROCESSING
  // ===================

  /**
   * Process violation and handle warnings/kicks
   */
  async processViolation(sock, groupJid, m) {
    const sender = m.sender
    const messageId = m.key.id

    try {
      // DELETE THE MESSAGE FIRST
      try {
        await sock.sendMessage(groupJid, { delete: m.key })
        m._wasDeletedByAntiPlugin = true
      } catch (error) {
        logger.error("Failed to delete group status mention:", error)
        m._wasDeletedByAntiPlugin = true
      }

      // Add warning to user
      const warnings = await this.addUserWarning(groupJid, sender)

      // Build response message
      let response =
        `👥 *Group Status Mention Detected!*\n\n` +
        `👤 @${sender.split("@")[0]}\n` +
        `⚠️ Warning: ${warnings}/4`

      // Handle kick if warnings reached limit
      if (warnings >= 4) {
        const kicked = await this.kickUser(sock, groupJid, sender)
        
        if (kicked) {
          await this.resetUserWarnings(groupJid, sender)
        }
      }

      // Send warning message
      await sock.sendMessage(groupJid, {
        text: response,
        mentions: [sender]
      })

      // Log violation
      await this.logViolation(groupJid, sender, messageId, warnings >= 4 ? "kick" : "warning", warnings)

    } catch (error) {
      logger.error("Error processing violation:", error)
    }
  },

  /**
   * Add warning to user
   */
  async addUserWarning(groupJid, sender) {
    try {
      return await WarningQueries.addWarning(
        groupJid,
        sender,
        "antigroupmention",
        "Mentioned group in WhatsApp Status"
      )
    } catch (error) {
      logger.error("Failed to add warning:", error)
      return 1
    }
  },

  /**
   * Build warning message text
   */
  buildWarningMessage(sender, warnings) {
    return `👥 *Group Status Mention Detected!*\n\n` +
           `👤 @${sender.split("@")[0]}\n` +
           `⚠️ Warning: ${warnings}/4`
  },

  /**
   * Send warning message to group
   */
  async sendWarningMessage(sock, groupJid, message, sender) {
    try {
      await sock.sendMessage(groupJid, {
        text: message,
        mentions: [sender]
      })
    } catch (error) {
      logger.error("Failed to send warning message:", error)
    }
  },

  /**
   * Attempt to kick user from group
   */
  async kickUser(sock, groupJid, sender) {
    try {
      await sock.groupParticipantsUpdate(groupJid, [sender], "remove")
      return true
    } catch (error) {
      logger.error("Failed to kick user:", error)
      return false
    }
  },

  /**
   * Reset user warnings after kick
   */
  async resetUserWarnings(groupJid, sender) {
    try {
      await WarningQueries.resetUserWarnings(groupJid, sender, "antigroupmention")
    } catch (error) {
      logger.error("Failed to reset user warnings:", error)
    }
  },

  /**
   * Log violation to database
   */
  async logViolation(groupJid, sender, messageId, action, warnings) {
    try {
      await ViolationQueries.logViolation(
        groupJid,
        sender,
        "antigroupmention",
        "Group status mention",
        {},
        action,
        warnings,
        messageId
      )
    } catch (error) {
      logger.error("Failed to log violation:", error)
    }
  }
}