import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"
import fs from 'fs/promises'
import path from 'path'

const logger = createComponentLogger("TAGONLINE")

// Diagnostic logger
class DiagnosticLogger {
  constructor(groupJid) {
    this.logs = []
    this.groupJid = groupJid
    this.startTime = Date.now()
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString()
    const elapsed = Date.now() - this.startTime
    const logEntry = {
      timestamp,
      elapsed: `${elapsed}ms`,
      level,
      message,
      ...data
    }
    this.logs.push(logEntry)
    
    // Also log to console
    const logMessage = `[${level}] [${elapsed}ms] ${message}`
    if (level === 'ERROR') {
      logger.error(logMessage, data)
    } else if (level === 'WARN') {
      logger.warn(logMessage, data)
    } else {
      logger.info(logMessage, data)
    }
  }

  async saveToFile() {
    try {
      const logsDir = path.join(process.cwd(), 'logs', 'tagonline')
      await fs.mkdir(logsDir, { recursive: true })
      
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0]
      const groupId = this.groupJid.split('@')[0]
      const filename = `tagonline_${groupId}_${timestamp}.txt`
      const filepath = path.join(logsDir, filename)
      
      let logContent = '='.repeat(80) + '\n'
      logContent += 'TAGONLINE DIAGNOSTIC LOG\n'
      logContent += '='.repeat(80) + '\n\n'
      logContent += `Group: ${this.groupJid}\n`
      logContent += `Start Time: ${new Date(this.startTime).toISOString()}\n`
      logContent += `Total Duration: ${Date.now() - this.startTime}ms\n\n`
      logContent += '='.repeat(80) + '\n\n'
      
      for (const log of this.logs) {
        logContent += `[${log.timestamp}] [${log.elapsed}] [${log.level}]\n`
        logContent += `  ${log.message}\n`
        
        // Add additional data if present
        const { timestamp, elapsed, level, message, ...extraData } = log
        if (Object.keys(extraData).length > 0) {
          logContent += `  Data: ${JSON.stringify(extraData, null, 2)}\n`
        }
        logContent += '\n'
      }
      
      await fs.writeFile(filepath, logContent, 'utf8')
      
      logger.info(`[TagOnline] Diagnostic log saved to: ${filepath}`)
      return filepath
    } catch (error) {
      logger.error('[TagOnline] Failed to save diagnostic log:', error)
      return null
    }
  }
}

export default {
  name: "TagOnline",
  description: "Tag all online group members",
  commands: ["tagonline", "tagactive", "online"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.tagonline` - Tag online members\n• `.tagonline [message]` - Tag online members with custom message",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat
    const diagnostics = new DiagnosticLogger(groupJid)

    diagnostics.log('INFO', 'TagOnline command started', { 
      sender: m.sender,
      args: args.join(' ')
    })

    if (!m.isGroup) {
      diagnostics.log('ERROR', 'Command used outside group')
      await diagnostics.saveToFile()
      return { 
        response: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }
    }

    // Check if user is admin
    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)

    if (!isAdmin) {
      diagnostics.log('ERROR', 'Non-admin user attempted to use command', { sender: m.sender })
      await diagnostics.saveToFile()
      return { 
        response: "❌ Only group admins can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }
    }

    diagnostics.log('INFO', 'Admin check passed')

    try {
      // Get group metadata
      let groupMetadata
      try {
        groupMetadata = await sock.groupMetadata(groupJid)
        diagnostics.log('INFO', 'Group metadata retrieved', {
          groupName: groupMetadata.subject,
          participantCount: groupMetadata.participants?.length || 0
        })
      } catch (error) {
        diagnostics.log('ERROR', 'Failed to get group metadata', { error: error.message })
        await diagnostics.saveToFile()
        return { 
          response: "❌ Unable to get group information!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }
      }

      // Get participants
      const participants = groupMetadata?.participants || []
      
      if (participants.length === 0) {
        diagnostics.log('ERROR', 'No participants found')
        await diagnostics.saveToFile()
        return { 
          response: "❌ No participants found in this group!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }
      }

      diagnostics.log('INFO', `Processing ${participants.length} participants`)

      // Send initial status message
      try {
        await sock.sendMessage(groupJid, {
          text: "🔍 Checking for online members... Please wait.\n(Diagnostic mode: Full logs will be saved)"
        }, { quoted: m })
        diagnostics.log('INFO', 'Initial status message sent')
      } catch (error) {
        diagnostics.log('WARN', 'Failed to send status message', { error: error.message })
      }

      // Store online members with details
      const onlineMembers = []
      const offlineMembers = []
      const errorMembers = []
      
      // Configuration
      const BATCH_SIZE = 5 // Reduced batch size for better reliability
      const BATCH_DELAY = 1500 // Increased delay
      const PRESENCE_TIMEOUT = 5000 // Increased to 5 seconds

      diagnostics.log('INFO', 'Starting presence checks', {
        batchSize: BATCH_SIZE,
        batchDelay: BATCH_DELAY,
        presenceTimeout: PRESENCE_TIMEOUT
      })

      let batchNumber = 0
      for (let i = 0; i < participants.length; i += BATCH_SIZE) {
        batchNumber++
        const batch = participants.slice(i, i + BATCH_SIZE)
        
        diagnostics.log('INFO', `Processing batch ${batchNumber}`, {
          batchStart: i,
          batchEnd: Math.min(i + BATCH_SIZE, participants.length),
          batchSize: batch.length
        })

        const batchPromises = batch.map((participant, batchIndex) => {
          const jid = participant.id
          const phoneNumber = jid.split('@')[0]
          
          // Skip the bot itself
          if (jid === sock.user.id) {
            diagnostics.log('INFO', `Skipping bot user: ${phoneNumber}`)
            return Promise.resolve({ jid, isOnline: false, reason: 'bot_user' })
          }

          return new Promise((resolve) => {
            const startTime = Date.now()
            let resolved = false
            
            const timeout = setTimeout(() => {
              if (!resolved) {
                resolved = true
                const elapsed = Date.now() - startTime
                diagnostics.log('WARN', `Presence check timeout for ${phoneNumber}`, {
                  jid,
                  elapsed: `${elapsed}ms`,
                  batchNumber,
                  batchIndex
                })
                resolve({ jid, isOnline: false, reason: 'timeout', elapsed })
              }
            }, PRESENCE_TIMEOUT)

            const presenceHandler = (update) => {
              if (update.id === jid && !resolved) {
                const presences = update.presences || {}
                const userPresence = presences[jid]
                
                if (userPresence) {
                  resolved = true
                  const elapsed = Date.now() - startTime
                  const lastKnownPresence = userPresence.lastKnownPresence
                  const isOnline = lastKnownPresence === 'available' || 
                                  lastKnownPresence === 'composing' ||
                                  lastKnownPresence === 'recording'
                  
                  clearTimeout(timeout)
                  sock.ev.off('presence.update', presenceHandler)
                  
                  diagnostics.log('INFO', `Presence received for ${phoneNumber}`, {
                    jid,
                    presence: lastKnownPresence,
                    isOnline,
                    elapsed: `${elapsed}ms`,
                    batchNumber,
                    batchIndex
                  })
                  
                  resolve({ jid, isOnline, reason: 'presence_received', elapsed, presence: lastKnownPresence })
                }
              }
            }

            sock.ev.on('presence.update', presenceHandler)

            diagnostics.log('INFO', `Subscribing to presence for ${phoneNumber}`, {
              jid,
              batchNumber,
              batchIndex
            })

            sock.presenceSubscribe(jid).catch(err => {
              if (!resolved) {
                resolved = true
                clearTimeout(timeout)
                sock.ev.off('presence.update', presenceHandler)
                const elapsed = Date.now() - startTime
                
                diagnostics.log('ERROR', `Subscription error for ${phoneNumber}`, {
                  jid,
                  error: err.message,
                  elapsed: `${elapsed}ms`,
                  batchNumber,
                  batchIndex
                })
                
                resolve({ jid, isOnline: false, reason: 'subscription_error', error: err.message, elapsed })
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
            diagnostics.log('INFO', `✅ Online: ${result.jid.split('@')[0]}`, {
              presence: result.presence,
              elapsed: result.elapsed
            })
          } else if (result.reason === 'subscription_error') {
            errorMembers.push(result.jid)
            diagnostics.log('WARN', `❌ Error: ${result.jid.split('@')[0]}`, {
              error: result.error,
              elapsed: result.elapsed
            })
          } else {
            offlineMembers.push(result.jid)
            diagnostics.log('INFO', `⭕ Offline/Unknown: ${result.jid.split('@')[0]}`, {
              reason: result.reason,
              elapsed: result.elapsed
            })
          }
        })

        diagnostics.log('INFO', `Batch ${batchNumber} complete`, {
          online: onlineMembers.length,
          offline: offlineMembers.length,
          errors: errorMembers.length
        })

        // Delay between batches (except for last batch)
        if (i + BATCH_SIZE < participants.length) {
          diagnostics.log('INFO', `Waiting ${BATCH_DELAY}ms before next batch`)
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY))
        }
      }

      diagnostics.log('INFO', 'All presence checks complete', {
        totalParticipants: participants.length,
        onlineFound: onlineMembers.length,
        offlineFound: offlineMembers.length,
        errorsFound: errorMembers.length
      })

      // Save diagnostic log
      const logPath = await diagnostics.saveToFile()

      if (onlineMembers.length === 0) {
        return { 
          response: `😔 No online members found at the moment!\n\n📊 Summary:\n• Total: ${participants.length}\n• Online: 0\n• Offline/Unknown: ${offlineMembers.length}\n• Errors: ${errorMembers.length}\n\n📁 Log saved: ${logPath || 'Failed to save'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
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
      tagMessage += `📁 Full log saved for analysis\n`
      tagMessage += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      
      // Prepare mentions array
      const mentions = [...onlineMembers, m.sender]

      diagnostics.log('INFO', `Sending tag message for ${onlineMembers.length} members`)

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
          diagnostics.log('INFO', 'Tag message sent successfully')
        } catch (error) {
          sendAttempts++
          diagnostics.log('ERROR', `Send attempt ${sendAttempts} failed`, { error: error.message })
          
          if (sendAttempts < MAX_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        }
      }

      if (!sendSuccess) {
        diagnostics.log('ERROR', 'Failed to send tag message after all attempts')
        await diagnostics.saveToFile()
        return {
          response: "❌ Failed to send tag message after multiple attempts. Please try again later.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }
      }
      
      diagnostics.log('INFO', 'TagOnline command completed successfully')
      await diagnostics.saveToFile()
      
      return { response: null, success: true }

    } catch (error) {
      diagnostics.log('ERROR', 'Unexpected error in tagonline command', { 
        error: error.message,
        stack: error.stack
      })
      await diagnostics.saveToFile()
      
      return { 
        response: `❌ Failed to tag online members! Error: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }
    }
  }
}