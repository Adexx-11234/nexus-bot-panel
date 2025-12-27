import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("TAGONLINE")

export default {
  name: "TagOnline",
  description: "Tag all online group members",
  commands: ["tagonline", "tagactive", "online"],
  category: "group",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage:
    "• `.tagonline` - Tag online members\n• `.tagonline [message]` - Tag online members with custom message",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat
    try {
      // Get group metadata
      let groupMetadata
      try {
        groupMetadata = await sock.groupMetadata(groupJid)
      } catch (error) {
        return { 
          response: "❌ Unable to get group information!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }
      }

      // Get participants
      const participants = groupMetadata?.participants || []
      
      if (participants.length === 0) {
        return { 
          response: "❌ No participants found in this group!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }
      }

      // Send initial status message
      try {
        await sock.sendMessage(groupJid, {
          text: "🔍 Checking for online members... Please wait."
        }, { quoted: m })
      } catch (error) {
        logger.warn('Failed to send status message:', error.message)
      }

      // Store online members
      const onlineMembers = []
      const offlineMembers = []
      const errorMembers = []
      
      // Configuration
      const BATCH_SIZE = 5
      const BATCH_DELAY = 1500
      const PRESENCE_TIMEOUT = 5000

      for (let i = 0; i < participants.length; i += BATCH_SIZE) {
        const batch = participants.slice(i, i + BATCH_SIZE)

        const batchPromises = batch.map((participant) => {
          const jid = participant.id
          
          // Skip the bot itself
          if (jid === sock.user.id) {
            return Promise.resolve({ jid, isOnline: false, reason: 'bot_user' })
          }

          return new Promise((resolve) => {
            let resolved = false
            
            const timeout = setTimeout(() => {
              if (!resolved) {
                resolved = true
                resolve({ jid, isOnline: false, reason: 'timeout' })
              }
            }, PRESENCE_TIMEOUT)

            const presenceHandler = (update) => {
              if (update.id === jid && !resolved) {
                const presences = update.presences || {}
                const userPresence = presences[jid]
                
                if (userPresence) {
                  resolved = true
                  const lastKnownPresence = userPresence.lastKnownPresence
                  const isOnline = lastKnownPresence === 'available' || 
                                  lastKnownPresence === 'composing' ||
                                  lastKnownPresence === 'recording'
                  
                  clearTimeout(timeout)
                  sock.ev.off('presence.update', presenceHandler)
                  resolve({ jid, isOnline, reason: 'presence_received' })
                }
              }
            }

            sock.ev.on('presence.update', presenceHandler)

            sock.presenceSubscribe(jid).catch(err => {
              if (!resolved) {
                resolved = true
                clearTimeout(timeout)
                sock.ev.off('presence.update', presenceHandler)
                resolve({ jid, isOnline: false, reason: 'subscription_error' })
              }
            })
          })
        })

        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises)
        
        // Categorize results
        batchResults.forEach(result => {
          if (result.reason === 'bot_user') {
            return
          }
          
          if (result.isOnline) {
            onlineMembers.push(result.jid)
          } else if (result.reason === 'subscription_error') {
            errorMembers.push(result.jid)
          } else {
            offlineMembers.push(result.jid)
          }
        })

        // Delay between batches (except for last batch)
        if (i + BATCH_SIZE < participants.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY))
        }
      }

      if (onlineMembers.length === 0) {
        return { 
          response: `😔 No online members found at the moment!\n\n📊 Summary:\n• Total: ${participants.length}\n• Online: 0\n• Offline/Unknown: ${offlineMembers.length}\n• Errors: ${errorMembers.length}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }
      }

      // Get custom message or default
      const customMessage = args.length ? args.join(" ") : "You're online!"
      
      // Get sender's phone number
      const senderNumber = m.sender.split('@')[0]
      
      // Build the tag message
      let tagMessage = `╚»˙·٠🎯●♥  ♥●🎯٠·˙«╝\n`
      tagMessage += `😶 Tagger: @${senderNumber}\n`
      tagMessage += `🌿 Message: ${customMessage}\n`
      tagMessage += `👥 Online Members: ${onlineMembers.length}/${participants.length}\n\n`
      
      // Add all online members
      onlineMembers.forEach((jid) => {
        const phoneNumber = jid.split('@')[0]
        tagMessage += `🟢 @${phoneNumber}\n`
      })
      
      tagMessage += `\n📊 Summary:\n`
      tagMessage += `• Online: ${onlineMembers.length}\n`
      tagMessage += `• Offline/Unknown: ${offlineMembers.length}\n`
      tagMessage += `• Errors: ${errorMembers.length}\n`
      tagMessage += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      
      // Prepare mentions array
      const mentions = [...onlineMembers, m.sender]

      // Send the tag message with retry logic
      let sendAttempts = 0
      const MAX_ATTEMPTS = 3
      let sendSuccess = false

      while (sendAttempts < MAX_ATTEMPTS && !sendSuccess) {
        try {
          await sock.sendMessage(groupJid, {
            text: tagMessage,
            mentions: mentions
          }, { quoted: m })
          
          sendSuccess = true
        } catch (error) {
          sendAttempts++
          logger.error(`Send attempt ${sendAttempts} failed:`, error.message)
          
          if (sendAttempts < MAX_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        }
      }

      if (!sendSuccess) {
        return {
          response: "❌ Failed to send tag message after multiple attempts. Please try again later.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }
      }
      
      return { response: null, success: true }

    } catch (error) {
      logger.error('Error in tagonline command:', error)
      
      return { 
        response: `❌ Failed to tag online members! Error: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }
    }
  }
}