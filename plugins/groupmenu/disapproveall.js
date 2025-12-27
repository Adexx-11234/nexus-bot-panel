import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("DISAPPROVE-ALL")

export default {
  name: "Disapprove All",
  description: "Reject all pending join requests in the group",
  commands: ["disapproveall"],
  category: "group",
    permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage:
    "• `.disapproveall` - Reject all pending join requests\n• `.disapproveall status` - Check pending requests count",

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
              `${count > 0 ? `Use \`.disapproveall\` to reject all pending requests` : "No pending requests to reject"}`,
          }

        default:
          return await this.processDisapproveAll(sock, m, groupJid)
      }
    } catch (error) {
      logger.error("Error in disapproveall command:", error)
      return { response: "❌ Error processing disapprove all command" }
    }
  },

  async processDisapproveAll(sock, m, groupJid) {
    try {
      // Get pending join requests
      const pendingRequests = await sock.groupRequestParticipantsList(groupJid)
      
      if (!pendingRequests || pendingRequests.length === 0) {
        return { response: "✅ No pending join requests found!" }
      }

      // Extract JIDs from requests
      const userJids = pendingRequests.map(request => request.jid)
      
      logger.info(`[Disapprove-All] Processing ${userJids.length} join requests in ${groupJid}`)

      // Send initial processing message
      const processingMsg = await sock.sendMessage(groupJid, {
        text: `⏳ Processing ${userJids.length} join request(s)...\nPlease wait...

` + `

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      // Initialize counters
      let rejectedCount = 0
      let failedCount = 0
      const rejectedUsers = []
      const failedUsers = []

      // Process each request individually for better error handling
      for (let i = 0; i < userJids.length; i++) {
        try {
          await sock.groupRequestParticipantsUpdate(
            groupJid,
            [userJids[i]],
            'reject'
          )
          
          rejectedCount++
          rejectedUsers.push(pendingRequests[i])
          logger.info(`[Disapprove-All] Rejected: ${userJids[i]}`)
          
          // Add delay to prevent rate limiting
          if (i < userJids.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
          
        } catch (error) {
          failedCount++
          failedUsers.push(pendingRequests[i])
          logger.error(`[Disapprove-All] Failed to reject ${userJids[i]}:`, error.message)
        }
      }

      // Wait for operations to complete
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Prepare result message
      let resultText = `🚫 *Join Request Processing Complete!*\n\n`
      resultText += `📊 *Results:*\n`
      resultText += `❌ Rejected: ${rejectedCount}\n`
      resultText += `⚠️ Failed: ${failedCount}\n`
      resultText += `📝 Total: ${userJids.length}\n\n`

      // Add rejected users list
      if (rejectedUsers.length > 0) {
        resultText += `❌ *Successfully Rejected:*\n`
        rejectedUsers.forEach((user, index) => {
          const phoneNumber = user.jid.split('@')[0]
          resultText += `${index + 1}. @${phoneNumber}\n`
        })
        resultText += '\n'
      }

      // Add failed users list
      if (failedUsers.length > 0) {
        resultText += `⚠️ *Failed Rejections:*\n`
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
        resultText += `Try running the command again for remaining requests.`
      }

      // Extract mentions for tagging users
      const mentions = [...rejectedUsers, ...failedUsers].map(user => user.jid)

      // Update the processing message with results
      await sock.sendMessage(groupJid, {
        text: resultText,
        edit: processingMsg.key,
        mentions: mentions
      })

      // Return success response
      return {
        response: null, // We already sent the message above
        success: true
      }

    } catch (error) {
      logger.error("[Disapprove-All] Error processing requests:", error)
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
      logger.error(`[Disapprove-All] Error checking pending requests: ${error.message}`)
      return false
    }
  },

  // Helper method to get request count
  async getPendingCount(sock, groupJid) {
    try {
      const pendingRequests = await sock.groupRequestParticipantsList(groupJid)
      return pendingRequests ? pendingRequests.length : 0
    } catch (error) {
      logger.error(`[Disapprove-All] Error getting pending count: ${error.message}`)
      return 0
    }
  }
}