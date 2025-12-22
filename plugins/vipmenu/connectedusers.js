import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"
import { getSessionManager } from "../../whatsapp/index.js"

export default {
  name: "connectedusers",
  commands: ["connectedusers", "connected", "activesessions"],
  description: "View all currently connected users (Default VIP only)",
  adminOnly: true,
  usage: ".connectedusers - Display all connected users\n.connectedusers cleanup - Clean up stale sessions",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Get user telegram ID from session
      const userTelegramId = VIPHelper.fromSessionId(sessionId)
      
      if (!userTelegramId) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Could not identify your session\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return { success: false, error: "Session not identified" }
      }

      // Check if user is default VIP
      const vipStatus = await VIPQueries.isVIP(userTelegramId)
      
      if (!vipStatus.isDefault && vipStatus.level !== 99) {
        await sock.sendMessage(m.chat, { 
          text: "❌ *Access Denied*\n\n" +
            "This command is restricted to Default VIP only.\n" +
            "Only the bot administrator can view connected users.\n\n" +
            "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return { success: false, error: "Not default VIP" }
      }

      // Check for cleanup command
      if (args[0]?.toLowerCase() === 'cleanup') {
        return await this.cleanupStaleSessions(sock, m)
      }

      // Get session manager
      const sessionManager = getSessionManager()
      
      if (!sessionManager) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Session manager not available\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return { success: false, error: "Session manager unavailable" }
      }

      // Send initial message
      await sock.sendMessage(m.chat, { 
        text: "🔍 *Checking Connected Users...*\n\nThis may take a moment...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })

      // Get all sessions from database
      const allSessions = await sessionManager.getAllSessions()
      
      if (!allSessions || allSessions.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: "📊 *No sessions found in database*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return { success: true, connectedCount: 0 }
      }

      // Check each session for real connection
      const connectedUsers = []
      const disconnectedUsers = []
      const partiallyConnected = [] // NEW: Track partially connected sessions
      
      for (const session of allSessions) {
        const sessionId = session.sessionId || `session_${session.telegramId}`
        
        try {
          // Get socket status
          const socket = sessionManager.getSession(sessionId)
          const hasSocket = !!socket
          const hasUser = socket?.user ? true : false
          const dbConnected = session.isConnected === true
          
          // Use isReallyConnected to verify full connection
          const isFullyConnected = await sessionManager.isReallyConnected(sessionId)
          
          const userInfo = {
            sessionId,
            telegramId: session.telegramId,
            phoneNumber: session.phoneNumber || 'Unknown',
            source: session.source || 'telegram',
            lastSeen: session.updatedAt || session.lastSeen || 'Unknown',
            hasSocket,
            hasUser,
            dbConnected
          }
          
          if (isFullyConnected) {
            // Fully connected: socket + user + db status
            connectedUsers.push(userInfo)
          } else if (hasSocket || dbConnected) {
            // Partially connected: has socket OR db says connected, but not fully
            if (hasSocket && !hasUser) {
              userInfo.issue = 'Socket exists but not authenticated'
            } else if (!hasSocket && dbConnected) {
              userInfo.issue = 'Database shows connected but no socket'
            } else if (hasSocket && hasUser && !dbConnected) {
              userInfo.issue = 'Socket connected but database not updated'
            }
            partiallyConnected.push(userInfo)
          } else {
            // Completely disconnected
            disconnectedUsers.push(userInfo)
          }
        } catch (error) {
          console.error(`[ConnectedUsers] Error checking ${sessionId}:`, error)
        }
      }

      // Build response message
      let responseText = `╭━━━『 *CONNECTED USERS* 』━━━╮\n\n`
      responseText += `📊 *Summary*\n`
      responseText += `├ Total Sessions: ${allSessions.length}\n`
      responseText += `├ ✅ Fully Active: ${connectedUsers.length}\n`
      responseText += `├ ⚠️ Partial/Stale: ${partiallyConnected.length}\n`
      responseText += `└ ❌ Disconnected: ${disconnectedUsers.length}\n\n`

      if (connectedUsers.length > 0) {
        responseText += `━━━━━━━━━━━━━━━━\n\n`
        responseText += `✅ *FULLY ACTIVE CONNECTIONS*\n\n`

        connectedUsers.forEach((user, index) => {
          responseText += `${index + 1}. 📱 *${user.phoneNumber}*\n`
          responseText += `   └ Telegram: \`${user.telegramId}\`\n`
          responseText += `   └ Source: ${user.source === 'web' ? '🌐 Web' : '📲 Telegram'}\n`
          responseText += `   └ Session: \`${user.sessionId}\`\n\n`
        })
      }

      if (partiallyConnected.length > 0) {
        responseText += `━━━━━━━━━━━━━━━━\n\n`
        responseText += `⚠️ *PARTIAL/STALE CONNECTIONS*\n`
        responseText += `*(These need attention)*\n\n`

        partiallyConnected.forEach((user, index) => {
          responseText += `${index + 1}. 📱 ${user.phoneNumber}\n`
          responseText += `   └ Telegram: \`${user.telegramId}\`\n`
          responseText += `   └ Issue: ${user.issue}\n`
          responseText += `   └ Socket: ${user.hasSocket ? '✅' : '❌'} | User: ${user.hasUser ? '✅' : '❌'} | DB: ${user.dbConnected ? '✅' : '❌'}\n\n`
        })
        
        responseText += `💡 *To cleanup stale sessions, use:*\n`
        responseText += `\`.connectedusers cleanup\`\n\n`
      }

      if (connectedUsers.length === 0 && partiallyConnected.length === 0) {
        responseText += `━━━━━━━━━━━━━━━━\n\n`
        responseText += `📭 *No Active Connections*\n\n`
        responseText += `All sessions are disconnected.\n\n`
      }

      responseText += `━━━━━━━━━━━━━━━━\n\n`
      responseText += `💡 *Commands:*\n`
      responseText += `• \`.connectedusers\` - View status\n`
      responseText += `• \`.connectedusers cleanup\` - Fix stale sessions\n\n`
      responseText += `╰━━━━━━━━━━━━━━━━╯`

      await sock.sendMessage(m.chat, {
        text: responseText
      }, { quoted: m })

      return { 
        success: true, 
        fullyConnected: connectedUsers.length,
        partiallyConnected: partiallyConnected.length,
        disconnected: disconnectedUsers.length,
        totalSessions: allSessions.length
      }

    } catch (error) {
      console.error("[ConnectedUsers] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: `❌ *Error checking connected users*\n\n${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  },

  async cleanupStaleSessions(sock, m) {
    try {
      const sessionManager = getSessionManager()
      
      await sock.sendMessage(m.chat, { 
        text: "🔄 *Starting Cleanup...*\n\nRemoving stale sessions...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })

      const allSessions = await sessionManager.getAllSessions()
      let cleanedCount = 0
      const errors = []

      for (const session of allSessions) {
        const sessionId = session.sessionId || `session_${session.telegramId}`
        
        try {
          const isFullyConnected = await sessionManager.isReallyConnected(sessionId)
          const socket = sessionManager.getSession(sessionId)
          
          // Clean up if: DB says connected but no socket, OR socket exists without user
          if (session.isConnected && !isFullyConnected) {
            if (!socket || !socket.user) {
              console.log(`Cleaning stale session: ${sessionId}`)
              await sessionManager.performCompleteUserCleanup(sessionId)
              cleanedCount++
            }
          }
        } catch (error) {
          errors.push(`${sessionId}: ${error.message}`)
          console.error(`Error cleaning ${sessionId}:`, error)
        }
      }

      let responseText = `✅ *Cleanup Complete*\n\n`
      responseText += `📊 *Results:*\n`
      responseText += `├ Sessions checked: ${allSessions.length}\n`
      responseText += `├ Cleaned up: ${cleanedCount}\n`
      responseText += `└ Errors: ${errors.length}\n\n`

      if (errors.length > 0) {
        responseText += `⚠️ *Errors:*\n`
        errors.slice(0, 5).forEach(err => {
          responseText += `• ${err}\n`
        })
        if (errors.length > 5) {
          responseText += `• ...and ${errors.length - 5} more\n`
        }
        responseText += `\n`
      }

      responseText += `💡 Run \`.connectedusers\` to verify\n\n`
      responseText += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      await sock.sendMessage(m.chat, {
        text: responseText
      }, { quoted: m })

      return { success: true, cleaned: cleanedCount }

    } catch (error) {
      console.error("[ConnectedUsers] Cleanup error:", error)
      await sock.sendMessage(m.chat, { 
        text: `❌ *Cleanup failed*\n\n${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  }
}