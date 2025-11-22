import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("TAGONLINE")

export default {
  name: "TagOnline",
  description: "Tag only online group members",
  commands: ["tagonline", "tagactive", "online"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.tagonline` - Tag online members\n• `.tagonline [message]` - Tag online members with custom message",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat

    if (!m.isGroup) {
      return { response: "❌ This command can only be used in groups!" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
    }

    // Check if user is admin
    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
    if (!isAdmin) {
      return { response: "❌ Only group admins can use this command!" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
    }

    try {
      // Get group metadata
      let groupMetadata
      try {
        groupMetadata = await sock.groupMetadata(groupJid)
      } catch (error) {
        logger.error("[TagOnline] Error getting group metadata:", error.message)
        return { response: "❌ Unable to get group information!" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
      }

      // Get all participants
      const participants = groupMetadata?.participants || []
      
      if (participants.length === 0) {
        return { response: "❌ No participants found in this group!" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
      }

      logger.info(`[TagOnline] Checking ${participants.length} participants for online status`)

      // Store online members
      const onlineMembers = []
      const presenceData = {}

      // Set up presence listener
      const presenceHandler = (update) => {
        try {
          logger.info(`[TagOnline] Presence update received:`, JSON.stringify(update))
          
          // Handle different presence update formats
          if (update.id && update.presences) {
            // Format 1: Group presence with presences object (CORRECT FORMAT)
            for (const [jid, presence] of Object.entries(update.presences)) {
              presenceData[jid] = presence
              logger.info(`[TagOnline] Stored presence for ${jid}: ${presence.lastKnownPresence}`)
            }
          } else if (update.id && update.lastKnownPresence) {
            // Format 2: Direct presence update (store with the ID)
            presenceData[update.id] = update
            logger.info(`[TagOnline] Stored presence for ${update.id}: ${update.lastKnownPresence}`)
          } else if (update.lastKnownPresence) {
            // Format 3: Presence without explicit ID (shouldn't happen but handle it)
            logger.warn(`[TagOnline] Received presence without ID:`, JSON.stringify(update))
          }
        } catch (err) {
          logger.error('[TagOnline] Error in presence handler:', err)
        }
      }

      // Listen for presence updates (using console.log to see raw data + presenceHandler to store it)
      sock.ev.on('presence.update', (update) => {
        console.log(update)  // Log for debugging
        presenceHandler(update)  // Store the data
      })

      try {
        // Subscribe to individual participants using their LID
        logger.info(`[TagOnline] Subscribing to individual participants...`)
        for (const participant of participants) {
          const participantJid = participant.id
          
          // Skip bot itself
          if (participantJid === sock.user?.id) {
            continue
          }
          
          try {
            // Subscribe using the participant's actual JID (including @lid)
            await sock.presenceSubscribe(participantJid)
            logger.info(`[TagOnline] Subscribed to ${participantJid}`)
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100))
          } catch (subError) {
            logger.debug(`[TagOnline] Failed to subscribe to ${participantJid}: ${subError.message}`)
          }
        }

        // Wait for presence updates to arrive
        logger.info(`[TagOnline] Waiting for presence updates...`)
        await new Promise(resolve => setTimeout(resolve, 5000))

        logger.info(`[TagOnline] Received ${Object.keys(presenceData).length} presence updates`)
        logger.info(`[TagOnline] All presence data:`, JSON.stringify(presenceData, null, 2))
        
        // Debug: Log what we're looking for
        logger.info(`[TagOnline] Participant IDs we're checking:`, participants.map(p => p.id))

        // Process collected presence data
        for (const participant of participants) {
          const participantJid = participant.id
          
          // Skip bot
          if (participantJid === sock.user?.id) {
            continue
          }
          
          const presence = presenceData[participantJid]
          
          if (presence) {
            const lastKnownPresence = presence.lastKnownPresence
            logger.info(`[TagOnline] ${participantJid}: ${lastKnownPresence}`)
            
            // Check if user is online (available, composing, recording, or paused)
            if (lastKnownPresence === 'available' || 
                lastKnownPresence === 'composing' || 
                lastKnownPresence === 'recording' ||
                lastKnownPresence === 'paused') {
              onlineMembers.push(participantJid)
              logger.info(`[TagOnline] ✅ ${participantJid} is ONLINE (${lastKnownPresence})`)
            } else {
              logger.debug(`[TagOnline] ⭕ ${participantJid} is ${lastKnownPresence || 'offline'}`)
            }
          } else {
            logger.debug(`[TagOnline] ❌ No presence data for ${participantJid}`)
          }
        }

        // Fallback: Use lastSeen if available and no online members found
        if (onlineMembers.length === 0) {
          logger.warn("[TagOnline] No online members detected via presence, checking lastSeen timestamps")
          
          const now = Math.floor(Date.now() / 1000)
          
          for (const participant of participants) {
            const participantJid = participant.id
            
            // Skip bot
            if (participantJid === sock.user?.id) {
              continue
            }
            
            const presence = presenceData[participantJid]
            
            if (presence && presence.lastSeen) {
              const lastSeen = presence.lastSeen
              const timeDiff = now - lastSeen
              
              logger.info(`[TagOnline] ${participantJid} lastSeen: ${timeDiff}s ago`)
              
              // Consider online if last seen within 5 minutes (300 seconds)
              if (timeDiff < 300) {
                onlineMembers.push(participantJid)
                logger.info(`[TagOnline] ✅ Added ${participantJid} via lastSeen (${Math.floor(timeDiff / 60)}m ago)`)
              }
            }
          }
        }

      } finally {
        // Always remove the event listener
        sock.ev.off('presence.update', presenceHandler)
        logger.info(`[TagOnline] Cleaned up presence listener`)
      }

      if (onlineMembers.length === 0) {
        return { 
          response: "❌ No online members detected!\n\n" +
                   "_Note: Privacy settings may prevent detection of online status. " +
                   "This feature works best when members have their 'Last Seen' visible._" + 
                   `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }
      }

      // Get custom message or default
      const customMessage = args.length ? args.join(" ") : "Hey online members! 👋"
      
      // Get sender's phone number
      const senderNumber = m.sender.split('@')[0]
      
      // Build the tag message
      let tagMessage = `╚»˙·٠🌐●♥  ♥●🌐٠·˙«╝\n`
      tagMessage += `😶 Tagger: @${senderNumber}\n`
      tagMessage += `🌿 Message: ${customMessage}\n`
      tagMessage += `✅ Online Members (${onlineMembers.length}/${participants.length}):\n\n`
      
      // Add online members
      onlineMembers.forEach((memberId) => {
        const phoneNumber = memberId.split('@')[0]
        tagMessage += `🌐 @${phoneNumber}\n`
      })
      
      tagMessage += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      
      // Prepare mentions array
      const mentions = [...onlineMembers, m.sender]

      logger.info(`[TagOnline] Tagging ${onlineMembers.length} online members in ${groupJid}`)

      // Send the tag message
      await sock.sendMessage(groupJid, {
        text: tagMessage,
        mentions: mentions
      }, { quoted: m })

      logger.info(`[TagOnline] Successfully tagged ${onlineMembers.length} online members`)
      
      return { response: null, success: true }

    } catch (error) {
      logger.error("[TagOnline] Error in tagonline command:", error)
      logger.error("[TagOnline] Stack trace:", error.stack)
      return { 
        response: `❌ Failed to tag online members!\n\nError: ${error.message}` + 
                 `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }
    }
  },

  // Helper method to get online participant count
  async getOnlineCount(sock, groupJid) {
    try {
      const groupMetadata = await sock.groupMetadata(groupJid)
      const participants = groupMetadata?.participants || []
      const presenceData = {}
      let onlineCount = 0

      const presenceHandler = (update) => {
        if (update.presences) {
          for (const [jid, presence] of Object.entries(update.presences)) {
            presenceData[jid] = presence
          }
        } else if (update.id && update.lastKnownPresence) {
          presenceData[update.id] = update
        }
      }

      sock.ev.on('presence.update', presenceHandler)

      try {
        // Subscribe to individual participants only
        for (const participant of participants) {
          if (participant.id !== sock.user?.id) {
            try {
              await sock.presenceSubscribe(participant.id)
              await new Promise(resolve => setTimeout(resolve, 100))
            } catch (err) {
              // Ignore errors for individual subscriptions
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 2500))

        for (const participant of participants) {
          const presence = presenceData[participant.id]
          if (presence?.lastKnownPresence === 'available' || 
              presence?.lastKnownPresence === 'composing' ||
              presence?.lastKnownPresence === 'recording' ||
              presence?.lastKnownPresence === 'paused') {
            onlineCount++
          }
        }

        return onlineCount
      } finally {
        sock.ev.off('presence.update', presenceHandler)
      }
    } catch (error) {
      logger.error(`[TagOnline] Error getting online count: ${error.message}`)
      return 0
    }
  },

  // Helper method to check if there are any online members
  async hasOnlineMembers(sock, groupJid) {
    try {
      const count = await this.getOnlineCount(sock, groupJid)
      return count > 0
    } catch (error) {
      logger.error(`[TagOnline] Error checking online members: ${error.message}`)
      return false
    }
  }
}