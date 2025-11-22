import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("KICK-ALL")

// Store active kick operations per group
const activeKickOperations = new Map()

export default {
  name: "Kick All",
  description: "Remove all non-admin members from the group with warning period",
  commands: ["kickall"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.kickall` - Initiate kick all non-admins (3 min warning)\n" +
    "• `.kickall cancel` - Cancel pending kick operation\n" +
    "• `.kickall status` - Check if there's a pending operation",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    if (!m.isGroup) {
      return { response: "❌ This command can only be used in groups!" }
    }

    // Check if user is admin
    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
    if (!isAdmin) {
      return { response: "❌ Only group admins can use this command!" }
    }

    // Check if bot is admin
    const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
    if (!botIsAdmin) {
      return { response: "❌ Bot needs admin permissions to remove members!" }
    }

    try {
      switch (action) {
        case "cancel":
          return await this.cancelKickOperation(sock, groupJid, m)

        case "status":
          return await this.checkKickStatus(sock, groupJid)

        default:
          return await this.initiateKickAll(sock, m, groupJid, adminChecker)
      }
    } catch (error) {
      logger.error("Error in kickall command:", error)
      return { response: "❌ Error processing kick all command" }
    }
  },

  async initiateKickAll(sock, m, groupJid, adminChecker) {
    try {
      // Check if there's already an active operation
      if (activeKickOperations.has(groupJid)) {
        const operation = activeKickOperations.get(groupJid)
        const timeLeft = Math.ceil((operation.executeAt - Date.now()) / 1000)
        return {
          response:
            `⚠️ *Kick operation already in progress!*\n\n` +
            `Time remaining: ${timeLeft} seconds\n` +
            `Use \`.kickall cancel\` to cancel this operation.`
        }
      }

      // Get group metadata
      const groupMetadata = await sock.groupMetadata(groupJid)
      const participants = groupMetadata.participants

      // Separate admins and non-admins
      const admins = []
      const nonAdmins = []

      for (const p of participants) {
        if (p.admin === "admin" || p.admin === "superadmin") {
          admins.push(p)
        } else {
          nonAdmins.push(p)
        }
      }

      // Check if there are members to kick
      if (nonAdmins.length === 0) {
        return {
          response: "✅ No non-admin members found in the group!"
        }
      }

      // Extract admin JIDs for mentions
      const adminJids = admins.map(a => a.id)

      // Create warning message
      const warningMsg = 
        `⚠️ *KICK ALL INITIATED* ⚠️\n\n` +
        `🚨 *CRITICAL WARNING*\n` +
        `ALL ${nonAdmins.length} non-admin members will be removed from this group in *3 MINUTES*!\n\n` +
        `📊 *Statistics:*\n` +
        `👥 Total Members: ${participants.length}\n` +
        `👑 Admins (Protected): ${admins.length}\n` +
        `🎯 Members to Remove: ${nonAdmins.length}\n\n` +
        `🛡️ *Protected Admins:*\n` +
        admins.map((a, i) => `${i + 1}. @${a.id.split('@')[0]}`).join('\n') +
        `\n\n` +
        `⏰ *Execution Time:* 3 minutes from now\n` +
        `🔴 *To CANCEL:* Type \`.kickall cancel\`\n\n` +
        `⚡ *This action cannot be undone after execution!*\n\n` +
        `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      // Send warning message and tag all admins
      const warningMsgSent = await sock.sendMessage(groupJid, {
        text: warningMsg,
        mentions: adminJids
      }, { quoted: m })

      // Schedule the kick operation
      const executeAt = Date.now() + (3 * 60 * 1000) // 3 minutes
      
      const timeoutId = setTimeout(async () => {
        await this.executeKickAll(sock, groupJid, nonAdmins, admins)
        activeKickOperations.delete(groupJid)
      }, 3 * 60 * 1000)

      // Store operation details
      activeKickOperations.set(groupJid, {
        timeoutId,
        executeAt,
        initiatedBy: m.sender,
        nonAdmins,
        admins,
        warningMessageKey: warningMsgSent.key
      })

      logger.info(`[Kick-All] Operation initiated in ${groupJid} by ${m.sender}. ${nonAdmins.length} members scheduled for removal.`)

      return {
        response: null, // Message already sent above
        success: true
      }

    } catch (error) {
      logger.error("[Kick-All] Error initiating kick operation:", error)
      return {
        response:
          `❌ *Error initiating kick operation*\n\n` +
          `*Error:* ${error.message}`
      }
    }
  },

  async cancelKickOperation(sock, groupJid, m) {
    try {
      const operation = activeKickOperations.get(groupJid)

      if (!operation) {
        return {
          response: "ℹ️ No active kick operation to cancel."
        }
      }

      // Clear the timeout
      clearTimeout(operation.timeoutId)
      activeKickOperations.delete(groupJid)

      // Extract admin JIDs for mentions
      const adminJids = operation.admins.map(a => a.id)

      const cancelMsg =
        `✅ *KICK OPERATION CANCELLED*\n\n` +
        `🛡️ The scheduled kick operation has been successfully cancelled.\n\n` +
        `👥 ${operation.nonAdmins.length} members are safe and will NOT be removed.\n` +
        `Cancelled by: @${m.sender.split('@')[0]}\n\n` +
        `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      await sock.sendMessage(groupJid, {
        text: cancelMsg,
        mentions: [...adminJids, m.sender]
      }, { quoted: m })

      logger.info(`[Kick-All] Operation cancelled in ${groupJid} by ${m.sender}`)

      return {
        response: null, // Message already sent above
        success: true
      }

    } catch (error) {
      logger.error("[Kick-All] Error cancelling operation:", error)
      return {
        response: `❌ Error cancelling operation: ${error.message}`
      }
    }
  },

  async checkKickStatus(sock, groupJid) {
    const operation = activeKickOperations.get(groupJid)

    if (!operation) {
      return {
        response: "ℹ️ No active kick operation in this group."
      }
    }

    const timeLeft = Math.ceil((operation.executeAt - Date.now()) / 1000)
    const minutes = Math.floor(timeLeft / 60)
    const seconds = timeLeft % 60

    return {
      response:
        `⏳ *ACTIVE KICK OPERATION*\n\n` +
        `👥 Members to be removed: ${operation.nonAdmins.length}\n` +
        `⏰ Time remaining: ${minutes}m ${seconds}s\n` +
        `👤 Initiated by: @${operation.initiatedBy.split('@')[0]}\n\n` +
        `🔴 To cancel: \`.kickall cancel\``,
      mentions: [operation.initiatedBy]
    }
  },

  async executeKickAll(sock, groupJid, nonAdmins, admins) {
    try {
      logger.info(`[Kick-All] Executing kick operation in ${groupJid}. Removing ${nonAdmins.length} members.`)

      // Send execution started message
      const adminJids = admins.map(a => a.id)
      
      await sock.sendMessage(groupJid, {
        text:
          `🔴 *EXECUTING KICK OPERATION*\n\n` +
          `Removing ${nonAdmins.length} members...\n` +
          `Please wait...\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        mentions: adminJids
      })

      // Initialize counters
      let kickedCount = 0
      let failedCount = 0
      const kickedUsers = []
      const failedUsers = []

      // Process each member individually
      for (let i = 0; i < nonAdmins.length; i++) {
        try {
          await sock.groupParticipantsUpdate(
            groupJid,
            [nonAdmins[i].id],
            'remove'
          )
          
          kickedCount++
          kickedUsers.push(nonAdmins[i])
          logger.info(`[Kick-All] Removed: ${nonAdmins[i].id}`)
          
          // Add delay to prevent rate limiting
          if (i < nonAdmins.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
          
        } catch (error) {
          failedCount++
          failedUsers.push(nonAdmins[i])
          logger.error(`[Kick-All] Failed to remove ${nonAdmins[i].id}:`, error.message)
        }
      }

      // Wait for operations to complete
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Prepare result message
      let resultText = `✅ *KICK OPERATION COMPLETED*\n\n`
      resultText += `📊 *Results:*\n`
      resultText += `✅ Removed: ${kickedCount}\n`
      resultText += `❌ Failed: ${failedCount}\n`
      resultText += `📝 Total Processed: ${nonAdmins.length}\n`
      resultText += `👑 Admins Protected: ${admins.length}\n\n`

      // Add failed users list if any
      if (failedUsers.length > 0) {
        resultText += `❌ *Failed to Remove:*\n`
        failedUsers.slice(0, 10).forEach((user, index) => {
          const phoneNumber = user.id.split('@')[0]
          resultText += `${index + 1}. @${phoneNumber}\n`
        })
        if (failedUsers.length > 10) {
          resultText += `... and ${failedUsers.length - 10} more\n`
        }
        resultText += '\n'
        resultText += `💡 *Reasons for failure:*\n`
        resultText += `• User already left\n`
        resultText += `• Network/API issues\n`
        resultText += `• Rate limiting\n\n`
      }

      resultText += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      // Send completion message
      await sock.sendMessage(groupJid, {
        text: resultText,
        mentions: adminJids
      })

      logger.info(`[Kick-All] Operation completed in ${groupJid}. Removed ${kickedCount}/${nonAdmins.length} members.`)

    } catch (error) {
      logger.error("[Kick-All] Error executing kick operation:", error)
      
      await sock.sendMessage(groupJid, {
        text:
          `❌ *ERROR DURING KICK OPERATION*\n\n` +
          `*Error:* ${error.message}\n\n` +
          `Some members may not have been removed.\n` +
          `Please check the group and try again if needed.`
      })
    }
  }
}