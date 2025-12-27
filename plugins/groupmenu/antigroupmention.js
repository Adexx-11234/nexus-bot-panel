import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"
import { isBotAdmin } from "../../whatsapp/groups/index.js"

const logger = createComponentLogger("ANTI-GROUP-MENTION")

export default {
  name: "Anti-Group-Mention",
  description: "Prevent mentioning the group in WhatsApp Status",
  commands: ["antigroupmention", "angm"],
  category: "group",
  permissions: {
    adminRequired: true, // User must be group admin (only applies in groups)
    botAdminRequired: true, // Bot must be group admin (only applies in groups)
    groupOnly: true, // Can only be used in groups
  },
  usage:
    "• `.antigroupmention on` - Enable group status mention protection\n• `.antigroupmention off` - Disable protection\n• `.antigroupmention status` - Check protection status",

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
        await sock.sendMessage(
          groupJid,
          {
            text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          },
          { quoted: m },
        )
        return
      }

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
   */
  async shouldProcess(m) {
    try {
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

      // Check if bot has admin permissions for enforcement
      const botIsAdmin = await isBotAdmin(sock, groupJid)
      if (!botIsAdmin) {
        await sock.sendMessage(groupJid, {
          text: "👥 Group status mention detected but bot lacks admin permissions to take action.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        })
        return
      }

      // Process the violation
      await this.processViolation(sock, groupJid, m)
    } catch (error) {
      logger.error("Error processing antigroupmention message:", error)
    }
  },

  // ===================
  // VALIDATION METHODS
  // ===================

  validateCommandInputs(sock, m) {
    if (!sock || !m || !m.chat || !m.sender) {
      logger.warn("Invalid command inputs provided")
      return false
    }
    return true
  },

  validateProcessInputs(sock, m) {
    if (!sock || !m || !m.chat || !m.sender || !m.key?.id) {
      logger.warn("Invalid process inputs provided")
      return false
    }
    return true
  },

  isGroupMessage(m) {
    return m?.isGroup === true || (m?.chat && m.chat.endsWith("@g.us"))
  },

  isGroupStatusMention(m) {
    if (!m?.message) return false

    if (m.type === "groupStatusMentionMessage") {
      return true
    }

    if (m.message.groupStatusMentionMessage) {
      return true
    }

    if (m.message.protocolMessage?.type === 25) {
      return true
    }

    if (Object.keys(m.message).length === 1 && Object.keys(m.message)[0] === "messageContextInfo") {
      return true
    }

    return false
  },

  // ===================
  // COMMAND HANDLERS
  // ===================

  async enableProtection(sock, groupJid, m) {
    await GroupQueries.setAntiCommand(groupJid, "antigroupmention", true)
    await sock.sendMessage(
      groupJid,
      {
        text: "✅ Anti-group-status-mention enabled\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
      },
      { quoted: m },
    )
  },

  async disableProtection(sock, groupJid, m) {
    await GroupQueries.setAntiCommand(groupJid, "antigroupmention", false)
    await sock.sendMessage(
      groupJid,
      {
        text: "❌ Anti-group-status-mention disabled\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
      },
      { quoted: m },
    )
  },

  async showStatus(sock, groupJid, m) {
    const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antigroupmention")
    await sock.sendMessage(
      groupJid,
      {
        text: `Status: ${status ? "✅ Enabled" : "❌ Disabled"}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      },
      { quoted: m },
    )
  },

  async showHelp(sock, groupJid, m) {
    const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antigroupmention")

    await sock.sendMessage(
      groupJid,
      {
        text: "`.antigroupmention on/off/status`\n\n" + `Current: ${currentStatus ? "✅ Enabled" : "❌ Disabled"}`,
      },
      { quoted: m },
    )
  },

  async sendErrorMessage(sock, groupJid, m) {
    try {
      await sock.sendMessage(
        groupJid,
        {
          text: "❌ Error managing anti-group-status-mention settings\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        },
        { quoted: m },
      )
    } catch (error) {
      logger.error("Failed to send error message:", error)
    }
  },

  // ===================
  // VIOLATION PROCESSING
  // ===================

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
      const response =
        `👥 *Group Status Mention Detected!*\n\n` + `👤 @${sender.split("@")[0]}\n` + `⚠️ Warning: ${warnings}/4`

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
        mentions: [sender],
      })

      // Log violation
      await this.logViolation(groupJid, sender, messageId, warnings >= 4 ? "kick" : "warning", warnings)
    } catch (error) {
      logger.error("Error processing violation:", error)
    }
  },

  async addUserWarning(groupJid, sender) {
    try {
      return await WarningQueries.addWarning(groupJid, sender, "antigroupmention", "Mentioned group in WhatsApp Status")
    } catch (error) {
      logger.error("Failed to add warning:", error)
      return 1
    }
  },

  async kickUser(sock, groupJid, sender) {
    try {
      await sock.groupParticipantsUpdate(groupJid, [sender], "remove")
      return true
    } catch (error) {
      logger.error("Failed to kick user:", error)
      return false
    }
  },

  async resetUserWarnings(groupJid, sender) {
    try {
      await WarningQueries.resetUserWarnings(groupJid, sender, "antigroupmention")
    } catch (error) {
      logger.error("Failed to reset user warnings:", error)
    }
  },

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
        messageId,
      )
    } catch (error) {
      logger.error("Failed to log violation:", error)
    }
  },
}
