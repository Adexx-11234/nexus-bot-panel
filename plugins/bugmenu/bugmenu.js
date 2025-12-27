// import { VIPQueries } from "../../database/query.js"
// import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "bugmenu",
  commands: ["bugmenu", "bugs"],
  description: "Display bug attack commands menu",
  adminOnly: false,
  category: "bugmenu",
  
    permissions: {
  ownerOnly: true,          // Only bot owner can use (overrides everything)
  privateOnly: true         // Can only be used in private chats
},          // Only bot owner can use (overrides everything)

  
  async execute(sock, sessionId, args, m) {
    try {
      /* VIP CHECK - COMMENTED OUT
      const userTelegramId = VIPHelper.fromSessionId(sessionId)
      if (!userTelegramId) {
        await sock.sendMessage(m.chat, { text: "❌ Could not identify your session\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      const vipStatus = await VIPQueries.isVIP(userTelegramId)
      
      if (!vipStatus.isVIP) {
        await sock.sendMessage(m.chat, { 
          text: "❌ *VIP Access Required*\n\nBug commands are only available for VIP users.\n\nContact the bot owner for VIP access.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }
      */

      const userInfo = {
        name: m.pushName || m.name || m.notify || "User",
        id: m.sender,
      }

      let menuText = `╭━━━『 *BUG ATTACK MENU* 』━━━╮\n\n`
      menuText += `👤 *User:* ${userInfo.name}\n`
      // menuText += `⭐ *VIP Level:* ${vipStatus.level}${vipStatus.isDefault ? ' (Admin)' : ''}\n\n`
      menuText += `\n`

      menuText += `━━━━━━━━━━━━━━━━\n\n`

      menuText += `🤖💥 *ANDROID + CRASH*\n`
      menuText += `*.androidcrash <number>*\n\n`
      menuText += `🍎⚡ *iOS + FORCECLOSE*\n`
      menuText += `*.iosfc <number>*\n\n`
      menuText += `👥 *GROUP CRASH*\n`
      menuText += `*.gccrash <group_link>*\n\n`

      menuText += `🌪️ *MIXED (ALL BUGS)*\n`
      menuText += `*.mixedcrash <number>*\n`
      menuText += `Sends ALL bugs except group bugs\n\n`

      menuText += `━━━━━━━━━━━━━━━━\n\n`
      menuText += `⚠️ *WARNINGS:*\n`
      // menuText += `• Cannot attack VIP users\n`
      menuText += `• Cannot attack yourself\n`
      menuText += `• Protected groups are skipped\n`
      
      menuText += `\n💡 *USAGE:*\n`
      menuText += `Number: .androidcrash 234 81234 5678\n`
      menuText += `Group: .gccrash https://chat.whatsapp.com/xxxxx\n\n`
      
      menuText += `╰━━━━━━━━━━━━━━━━╯`

      await sock.sendMessage(m.chat, { text: menuText }, { quoted: m })

      return { success: true }
    } catch (error) {
      console.error("[BugMenu] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Error loading bug menu.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
      return { success: false, error: error.message }
    }
  }
}