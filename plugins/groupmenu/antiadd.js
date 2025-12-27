import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, ViolationQueries } from "../../database/query.js"

const logger = createComponentLogger("ANTI-ADD")

// Track add attempts per user
const addAttempts = new Map()

export default {
  name: "Anti-Add",
  description: "Prevent unauthorized member additions to the group",
  commands: ["antiadd"],
  category: "groupmenu", 
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage:
    "• `.antiadd on` - Enable anti-add protection\n• `.antiadd off` - Disable protection\n• `.antiadd status` - Check protection status",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antiadd", true)
          return {
            response:
              "🛡️ *Anti-add protection enabled!*\n\n" +
              "✅ Unauthorized additions will be blocked\n" +
              "👑 New admins cannot add members for security\n" +
              "⏰ 48-hour restriction for newly promoted admins\n" +
              "🔒 Multiple attempts will result in punishment"
          }

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antiadd", false)
          return { response: "🛡️ Anti-add protection disabled." }

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antiadd")
          return {
            response: `🛡️ *Anti-Add Status*\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}`
          }

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antiadd")
          return {
            response:
              "🛡️ *Anti-Add Commands*\n\n" +
              "• `.antiadd on` - Enable protection\n" +
              "• `.antiadd off` - Disable protection\n" +
              "• `.antiadd status` - Check status\n\n" +
              `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}`
          }
      }
    } catch (error) {
      logger.error("Error in antiadd command:", error)
      return { response: "❌ Error managing anti-add settings" }
    }
  },

  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antiadd")
    } catch (error) {
      logger.error("Error checking if antiadd enabled:", error)
      return false
    }
  },

  async shouldProcess(m) {
    return true
  },

  async processParticipantUpdate(sock, sessionId, update) {
    try {
      if (update.action === 'add' && await this.isEnabled(update.jid)) {
        await this.handleAddition(sock, sessionId, update)
      }
    } catch (error) {
      logger.error("Error processing participant update:", error)
    }
  },

  async handleAddition(sock, sessionId, update) {
    try {
      const groupJid = update.jid
      const addedUser = update.participants[0]
      
      // More robust actor extraction
      let actor = update.actor || update.author
      if (!actor && update.key?.participant) {
        actor = update.key.participant
      }
      if (!actor && update.key?.fromMe === false && update.key?.remoteJid) {
        logger.warn("Could not determine who performed the addition, skipping anti-add")
        return
      }
      
      // Get group metadata
      const metadata = await sock.groupMetadata(groupJid)
      const groupOwner = metadata.owner
      
      // Allow if added by owner or bot itself
      const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'
      if (actor === groupOwner || actor === botJid) {
        // Still log the addition for tracking
        await this.logMemberAddition(groupJid, addedUser, actor)
        return
      }
      
      // Check if actor is a new admin (less than 48 hours)
      const isNewAdmin = await this.isNewAdmin(groupJid, actor, 48)
      
      if (isNewAdmin) {
        // Remove the added user immediately
        await sock.groupParticipantsUpdate(groupJid, [addedUser], "remove")
        
        // Track add attempts
        const attemptKey = `${groupJid}:${actor}`
        const attempts = (addAttempts.get(attemptKey) || 0) + 1
        addAttempts.set(attemptKey, attempts)
        
        if (attempts >= 2) {
          // Demote the new admin after 2 attempts
          await sock.groupParticipantsUpdate(groupJid, [actor], "demote")
          
          // Lock the group
          await sock.groupSettingUpdate(groupJid, 'announcement')
          
          await sock.sendMessage(groupJid, {
            text: `🚨 *SECURITY ALERT: Unauthorized Additions!* 🚨\n\n` +
                  `👤 @${actor.split("@")[0]} attempted multiple unauthorized additions\n` +
                  `❌ Admin privileges revoked\n` +
                  `🔒 Group locked for security\n\n` +
                  `⚠️ New admins cannot add members for 48 hours.\n` +
                  `🛡️ This prevents compromised account attacks.

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            mentions: [actor]
          })
          
          addAttempts.delete(attemptKey)
        } else {
          await sock.sendMessage(groupJid, {
            text: `🛡️ *Unauthorized Addition Blocked!*\n\n` +
                  `👤 @${actor.split("@")[0]} tried to add a new member\n` +
                  `❌ Addition blocked - new member removed\n` +
                  `⚠️ Attempt ${attempts}/2 - Next attempt = DEMOTION\n\n` +
                  `🔐 *Security Policy:* New admins cannot add members for 48 hours\n` +
                  `💡 This prevents compromised account attacks

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            mentions: [actor]
          })
        }
        
        // Log the violation
        await ViolationQueries.logViolation(
          groupJid,
          actor,
          "antiadd",
          `Attempted to add @${addedUser.split("@")[0]} (attempt ${attempts})`,
          { addedUser: addedUser, attempts: attempts },
          attempts >= 2 ? "demote" : "warning",
          attempts,
          null
        )
      } else {
        // Log legitimate addition
        await this.logMemberAddition(groupJid, addedUser, actor)
      }
    } catch (error) {
      logger.error("Error handling addition:", error)
    }
  },

  async isNewAdmin(groupJid, userJid, hoursThreshold = 48) {
    try {
      const { GroupQueries } = await import("../../database/query.js")
      
      const promoteTime = await GroupQueries.getUserPromoteTime(groupJid, userJid)
      if (!promoteTime) {
        return true
      }
      
      const promoteTimestamp = new Date(promoteTime).getTime()
      const currentTime = Date.now()
      const timeDifference = currentTime - promoteTimestamp
      const hoursAgo = timeDifference / (1000 * 60 * 60)
      
      return hoursAgo <= hoursThreshold
    } catch (error) {
      logger.error("Error checking if user is new admin:", error)
      return true
    }
  },

  async logMemberAddition(groupJid, addedUserJid, addedByJid) {
    try {
      const { GroupQueries } = await import("../../database/query.js")
      
      await GroupQueries.logMemberAddition(groupJid, addedUserJid, addedByJid)
    } catch (error) {
      logger.error("Error logging member addition:", error)
    }
  }
}