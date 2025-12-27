import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("APPROVE-ALL")

export default {
  name: "Approve All",
  description: "Approve all pending join requests in the group",
  commands: ["approveall"],
  category: "groupmenu",
    permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage:
    "• `.approveall` - Approve all pending join requests\n• `.approveall status` - Check pending requests count",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    try {
      switch (action) {
        case "status":
          const pendingRequests = await sock.groupRequestParticipantsList(groupJid)
          const count = pendingRequests ? pendingRequests.length : 0
          return {
            response:
              `📋 *Join Request Status*\n\n` +
              `Pending Requests: ${count}\n` +
              `${count > 0 ? `Use \`.approveall\` to approve all pending requests` : "No pending requests to approve"}`,
          }

        default:
          return await this.processApproveAll(sock, m, groupJid)
      }
    } catch (error) {
      logger.error("Error in approveall command:", error)
      return { response: "❌ Error processing approve all command" }
    }
  },

  async processApproveAll(sock, m, groupJid) {
    try {
      // Get pending join requests
      const pendingRequests = await sock.groupRequestParticipantsList(groupJid)
      
      if (!pendingRequests || pendingRequests.length === 0) {
        return { response: "✅ No pending join requests found!" }
      }

      // Extract JIDs from requests
      const userJids = pendingRequests.map(request => request.jid)
      
      logger.info(`[Approve-All] Processing ${userJids.length} join requests in ${groupJid}`)

      // Send initial processing message
      await sock.sendMessage(groupJid, {
        text: `⏳ Processing ${userJids.length} join request(s)...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      // Initialize counters
      let approvedCount = 0
      let failedCount = 0
      const approvedUsers = []
      const failedUsers = []

      // Process each request individually for better error handling
      for (let i = 0; i < userJids.length; i++) {
        try {
          await sock.groupRequestParticipantsUpdate(
            groupJid,
            [userJids[i]],
            'approve'
          )
          
          approvedCount++
          approvedUsers.push(pendingRequests[i])
          logger.info(`[Approve-All] Approved: ${userJids[i]}`)
          
          // Add delay to prevent rate limiting
          if (i < userJids.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 600))
          }
          
        } catch (error) {
          failedCount++
          failedUsers.push(pendingRequests[i])
          logger.error(`[Approve-All] Failed to approve ${userJids[i]}:`, error.message)
        }
      }

      // Wait for operations to complete
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Prepare result message
      let resultText = `🎉 *Join Request Processing Complete!*\n\n`
      resultText += `📊 *Results:*\n`
      resultText += `✅ Approved: ${approvedCount}\n`
      resultText += `❌ Failed: ${failedCount}\n`
      resultText += `📝 Total: ${userJids.length}\n\n`

      // Add approved users list
      if (approvedUsers.length > 0) {
        resultText += `✅ *Successfully Approved:*\n`
        approvedUsers.forEach((user, index) => {
          const phoneNumber = user.jid.split('@')[0]
          resultText += `${index + 1}. @${phoneNumber}\n`
        })
        resultText += '\n'
      }

      // Add failed users list
      if (failedUsers.length > 0) {
        resultText += `❌ *Failed Approvals:*\n`
        failedUsers.forEach((user, index) => {
          const phoneNumber = user.jid.split('@')[0]
          resultText += `${index + 1}. @${phoneNumber}\n`
        })
        resultText += '\n'
      }

      // Add helpful note if there were failures
      if (failedCount > 0) {
        resultText += `💡 *Note:* Failed requests may be due to:\n`
        resultText += `• Expired requests\n`
        resultText += `• User canceled request\n`
        resultText += `• Network/API issues\n\n`
        resultText += `Try running the command again for remaining requests.\n\n`
      }

      resultText += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      // Extract mentions for tagging users
      const mentions = [...approvedUsers, ...failedUsers].map(user => user.jid)

      // Send results as a new message (not edited)
      await sock.sendMessage(groupJid, {
        text: resultText,
        mentions: mentions
      }, { quoted: m })

      // Return success response
      return {
        response: null, // We already sent the message above
        success: true
      }

    } catch (error) {
      logger.error("[Approve-All] Error processing requests:", error)
      return {
        response:
          `❌ *Error processing join requests*\n\n` +
          `*Error:* ${error.message}\n\n` +
          `*Solution:* Please try again in a few minutes.`
      }
    }
  },

  // Helper method to check if there are pending requests
  async hasPendingRequests(sock, groupJid) {
    try {
      const pendingRequests = await sock.groupRequestParticipantsList(groupJid)
      return pendingRequests && pendingRequests.length > 0
    } catch (error) {
      logger.error(`[Approve-All] Error checking pending requests: ${error.message}`)
      return false
    }
  },

  // Helper method to get request count
  async getPendingCount(sock, groupJid) {
    try {
      const pendingRequests = await sock.groupRequestParticipantsList(groupJid)
      return pendingRequests ? pendingRequests.length : 0
    } catch (error) {
      logger.error(`[Approve-All] Error getting pending count: ${error.message}`)
      return 0
    }
  }
}