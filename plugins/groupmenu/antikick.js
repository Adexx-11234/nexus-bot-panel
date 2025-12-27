import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, ViolationQueries } from "../../database/query.js"

const logger = createComponentLogger("ANTI-REMOVE")

// Track removal attempts per user
const removeAttempts = new Map()

export default {
  name: "Anti-Remove",
  description: "Prevent unauthorized member removals in the group",
  commands: ["antiremove", "antikick"],
  category: "group",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage:
    "• `.antiremove on` - Enable anti-remove protection\n• `.antiremove off` - Disable protection\n• `.antiremove status` - Check protection status",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat


    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antiremove", true)
          return {
            response:
              "🛡️ *Anti-remove protection enabled!*\n\n" +
              "✅ Unauthorized removals will trigger immediate re-adds\n" +
              "👑 Only trusted admins can remove members\n" +
              "🔒 Multiple attempts will result in punishment\n" +
              "⚠️ Group will auto-lock if mass removal detected"
          }

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antiremove", false)
          return { response: "🛡️ Anti-remove protection disabled." }

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antiremove")
          return {
            response: `🛡️ *Anti-Remove Status*\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}`
          }

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antiremove")
          return {
            response:
              "🛡️ *Anti-Remove Commands*\n\n" +
              "• `.antiremove on` - Enable protection\n" +
              "• `.antiremove off` - Disable protection\n" +
              "• `.antiremove status` - Check status\n\n" +
              `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}`
          }
      }
    } catch (error) {
      logger.error("Error in antiremove command:", error)
      return { response: "❌ Error managing anti-remove settings" }
    }
  },

  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antiremove")
    } catch (error) {
      logger.error("Error checking if antiremove enabled:", error)
      return false
    }
  },

  async shouldProcess(m) {
    return true
  },

  async processParticipantUpdate(sock, sessionId, update) {
    try {
      if (update.action === 'remove' && await this.isEnabled(update.jid)) {
        await this.handleRemoval(sock, sessionId, update)
      }
    } catch (error) {
      logger.error("Error processing participant update:", error)
    }
  },

  async handleRemoval(sock, sessionId, update) {
    try {
      const groupJid = update.jid
      const removedUser = update.participants[0]
      
      // More robust actor extraction
      let actor = update.actor || update.author
      if (!actor && update.key?.participant) {
        actor = update.key.participant
      }
      if (!actor && update.key?.fromMe === false && update.key?.remoteJid) {
        logger.warn("Could not determine who performed the removal, skipping anti-remove")
        return
      }
      
      // Get group metadata
      const metadata = await sock.groupMetadata(groupJid)
      const groupOwner = metadata.owner
      
      // Allow if removed by owner or bot itself
      const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'
      if (actor === groupOwner || actor === botJid) {
        return
      }

      // CRITICAL: Check if bot owner was removed
      if (await this.isBotOwner(sock, removedUser)) {
        await this.handleBotOwnerRemoval(sock, groupJid, actor, removedUser)
        return
      }

      // Check if removed user is an admin
      const wasAdmin = await this.wasUserAdmin(groupJid, removedUser, metadata)
      
      // Check if actor is a new admin
      const isNewAdmin = await this.isNewAdmin(groupJid, actor)
      
      if (isNewAdmin && (wasAdmin || await this.isProtectedMember(groupJid, removedUser))) {
        // Immediately try to re-add the removed user
        try {
          await sock.groupParticipantsUpdate(groupJid, [removedUser], "add")
        } catch (readError) {
          logger.warn("Could not re-add removed user - they may have left voluntarily or blocked bot")
        }
        
        // Track removal attempts
        const attemptKey = `${groupJid}:${actor}`
        const attempts = (removeAttempts.get(attemptKey) || 0) + 1
        removeAttempts.set(attemptKey, attempts)
        
        if (attempts >= 2) {
          // Remove the attacker after 2 attempts
          await sock.groupParticipantsUpdate(groupJid, [actor], "remove")
          
          // Lock the group
          await sock.groupSettingUpdate(groupJid, 'announcement')
          
          await sock.sendMessage(groupJid, {
            text: `🚨 *SECURITY BREACH DETECTED!* 🚨\n\n` +
                  `👤 @${actor.split("@")[0]} attempted unauthorized removals\n` +
                  `❌ Attacker removed from group\n` +
                  `🔒 Group locked for security\n\n` +
                  `⚠️ This appears to be a compromised account attack.\n` +
                  `🛡️ All unauthorized actions have been blocked.

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            mentions: [actor]
          })
          
          removeAttempts.delete(attemptKey)
        } else {
          await sock.sendMessage(groupJid, {
            text: `🛡️ *Unauthorized Removal Blocked!*\n\n` +
                  `👤 @${actor.split("@")[0]} tried to remove a protected member\n` +
                  `✅ Member has been re-added\n` +
                  `⚠️ Attempt ${attempts}/2 - Next attempt = REMOVAL\n\n` +
                  `💡 Only trusted admins can remove members.

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            mentions: [actor, removedUser]
          })
        }
        
        // Log the violation
        await ViolationQueries.logViolation(
          groupJid,
          actor,
          "antiremove",
          `Attempted to remove ${wasAdmin ? 'admin' : 'member'} @${removedUser.split("@")[0]} (attempt ${attempts})`,
          { removedUser: removedUser, wasAdmin: wasAdmin, attempts: attempts },
          attempts >= 2 ? "kick" : "warning",
          attempts,
          null
        )
      }
    } catch (error) {
      logger.error("Error handling removal:", error)
    }
  },

  async handleBotOwnerRemoval(sock, groupJid, actor, botOwner) {
    try {
      // CRITICAL: Bot owner was removed - immediate emergency response
      await sock.sendMessage(groupJid, {
        text: `🚨 *CRITICAL SECURITY ALERT!* 🚨\n\n` +
              `⛔ BOT OWNER WAS REMOVED BY @${actor.split("@")[0]}\n` +
              `🚨 THIS IS A SECURITY BREACH!\n` +
              `🔒 GROUP EMERGENCY LOCKED\n\n` +
              `⚠️ All admin functions suspended\n` +
              `📞 Contact group owner immediately!

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        mentions: [actor]
      })

      // Lock group immediately
      await sock.groupSettingUpdate(groupJid, 'announcement')
      
      // Remove the attacker
      await sock.groupParticipantsUpdate(groupJid, [actor], "remove")
      
      // Log critical security event
      await ViolationQueries.logViolation(
        groupJid,
        actor,
        "antiremove",
        `CRITICAL: Removed bot owner ${botOwner}`,
        { removedUser: botOwner, criticalBreach: true },
        "emergency_lock",
        999,
        "Bot owner removal detected"
      )
      
    } catch (error) {
      logger.error("Error handling bot owner removal:", error)
    }
  },

  async isBotOwner(sock, userJid) {
    try {
      const botNumber = sock.user.id.split(":")[0]
      const botJid = `${botNumber}@s.whatsapp.net`
      const normalizedUserJid = userJid.includes("@") ? userJid : `${userJid}@s.whatsapp.net`
      return botJid === normalizedUserJid
    } catch (error) {
      return false
    }
  },

  async wasUserAdmin(groupJid, userJid, groupMetadata) {
    try {
      const participants = groupMetadata.participants || []
      return participants.some(p => 
        p.jid === userJid && (p.admin === 'admin' || p.admin === 'superadmin')
      )
    } catch (error) {
      logger.error("Error checking if user was admin:", error)
      return false
    }
  },

  async isNewAdmin(groupJid, userJid, hoursThreshold = 24) {
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

  async isProtectedMember(groupJid, userJid) {
    try {
      // You can add logic here to mark certain members as "protected"
      // For now, we'll protect all existing members from new admin removals
      return true
    } catch (error) {
      return true
    }
  }
}