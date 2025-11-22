
import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"
import { getSessionManager } from "../../whatsapp/index.js"

export default {
  name: "connectedusers",
  commands: ["connectedusers", "connected", "activesessions"],
  description: "View all currently connected users (Default VIP only)",
  adminOnly: true,
  usage: ".connectedusers - Display all connected users",
  
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
            "Only the bot administrator can view connected users." + `

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return { success: false, error: "Not default VIP" }
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
      
      for (const session of allSessions) {
        const sessionId = session.sessionId || `session_${session.telegramId}`
        
        try {
          // Use isReallyConnected to verify both socket and database status
          const isConnected = await sessionManager.isReallyConnected(sessionId)
          
          const userInfo = {
            sessionId,
            telegramId: session.telegramId,
            phoneNumber: session.phoneNumber || 'Unknown',
            source: session.source || 'telegram',
            lastSeen: session.updatedAt || session.lastSeen || 'Unknown'
          }
          
          if (isConnected) {
            connectedUsers.push(userInfo)
          } else if (session.isConnected) {
            // Database says connected but socket check failed
            disconnectedUsers.push({
              ...userInfo,
              status: 'stale'
            })
          }
        } catch (error) {
          console.error(`[ConnectedUsers] Error checking ${sessionId}:`, error)
        }
      }

      // Build response message
      let responseText = `╭━━━『 *CONNECTED USERS* 』━━━╮\n\n`
      responseText += `📊 *Summary*\n`
      responseText += `├ Total Sessions: ${allSessions.length}\n`
      responseText += `├ Active: ${connectedUsers.length}\n`
      responseText += `└ Stale: ${disconnectedUsers.length}\n\n`

      if (connectedUsers.length > 0) {
        responseText += `━━━━━━━━━━━━━━━━\n\n`
        responseText += `✅ *ACTIVE CONNECTIONS*\n\n`

        connectedUsers.forEach((user, index) => {
          responseText += `${index + 1}. 📱 *${user.phoneNumber}*\n`
          responseText += `   └ Telegram: \`${user.telegramId}\`\n`
          responseText += `   └ Source: ${user.source === 'web' ? '🌐 Web' : '📲 Telegram'}\n`
          responseText += `   └ Session: \`${user.sessionId}\`\n\n`
        })
      }

      if (disconnectedUsers.length > 0) {
        responseText += `━━━━━━━━━━━━━━━━\n\n`
        responseText += `⚠️ *STALE CONNECTIONS*\n`
        responseText += `*(Database shows connected but socket unavailable)*\n\n`

        disconnectedUsers.forEach((user, index) => {
          responseText += `${index + 1}. 📱 ${user.phoneNumber}\n`
          responseText += `   └ Telegram: \`${user.telegramId}\`\n`
          responseText += `   └ Session: \`${user.sessionId}\`\n\n`
        })
      }

      if (connectedUsers.length === 0 && disconnectedUsers.length === 0) {
        responseText += `━━━━━━━━━━━━━━━━\n\n`
        responseText += `📭 *No Active Connections*\n\n`
        responseText += `All sessions are disconnected.\n\n`
      }

      responseText += `━━━━━━━━━━━━━━━━\n\n`
      responseText += `💡 *Tip:* Use \`.vipmenu\` to see available commands\n\n`
      responseText += `╰━━━━━━━━━━━━━━━━╯`

      await sock.sendMessage(m.chat, {
        text: responseText
      }, { quoted: m })

      return { 
        success: true, 
        connectedCount: connectedUsers.length,
        staleCount: disconnectedUsers.length,
        totalSessions: allSessions.length
      }

    } catch (error) {
      console.error("[ConnectedUsers] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: `❌ *Error checking connected users*\n\n${error.message}

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  }
}