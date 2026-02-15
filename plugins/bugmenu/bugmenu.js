// import { VIPQueries } from "../../database/query.js"
// import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "bugmenu",
  commands: ["bugmenu", "bugs"],
  description: "Display bug attack commands menu",
  adminOnly: false,
  category: "bugmenu",
  
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
          text: "❌ *𝐕𝐈𝐏 𝐀𝐜𝐜𝐞𝐬𝐬 𝐑𝐞𝐪𝐮𝐢𝐫𝐞𝐝*\n\n𝐁𝐮𝐠 𝐜𝐨𝐦𝐦𝐚𝐧𝐝𝐬 𝐚𝐫𝐞 𝐨𝐧𝐥𝐲 𝐚𝐯𝐚𝐢𝐥𝐚𝐛𝐥𝐞 𝐟𝐨𝐫 𝐕𝐈𝐏 𝐮𝐬𝐞𝐫𝐬.\n\n𝐂𝐨𝐧𝐭𝐚𝐜𝐭 𝐭𝐡𝐞 𝐛𝐨𝐭 𝐨𝐰𝐧𝐞𝐫 𝐟𝐨𝐫 𝐕𝐈𝐏 𝐚𝐜𝐜𝐞𝐬𝐬.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }
      */

      const userInfo = {
        name: m.pushName || m.name || m.notify || "User",
        id: m.sender,
      }

      let menuText = `╭━━━『 𝐁𝐔𝐆 𝐀𝐓𝐓𝐀𝐂𝐊 𝐌𝐄𝐍𝐔 』━━━╮\n\n`
      menuText += `👤 𝐔𝐬𝐞𝐫: ${userInfo.name}\n`
      // menuText += `⭐ 𝐕𝐈𝐏 𝐋𝐞𝐯𝐞𝐥: ${vipStatus.level}${vipStatus.isDefault ? ' (Admin)' : ''}\n\n`
      menuText += `\n`

      menuText += `━━━━━━━━━━━━━━━━\n\n`

      menuText += `🤖💥 𝐀𝐍𝐃𝐑𝐎𝐈𝐃 + 𝐂𝐑𝐀𝐒𝐇\n`
      menuText += `*.androidcrash <number>*\n\n`
      
      menuText += `🍎⚡ 𝐢𝐎𝐒 + 𝐅𝐎𝐑𝐂𝐄𝐂𝐋𝐎𝐒𝐄\n`
      menuText += `*.iosfc <number>*\n\n`
      
      menuText += `👥 𝐆𝐑𝐎𝐔𝐏 𝐂𝐑𝐀𝐒𝐇\n`
      menuText += `*.gccrash <group_link>*\n\n`

      menuText += `━━━━━━━━━━━━━━━━\n\n`
      menuText += `⚠️ 𝐖𝐀𝐑𝐍𝐈𝐍𝐆𝐒:\n`
      // menuText += `• 𝐂𝐚𝐧𝐧𝐨𝐭 𝐚𝐭𝐭𝐚𝐜𝐤 𝐕𝐈𝐏 𝐮𝐬𝐞𝐫𝐬\n`
      menuText += `• 𝐂𝐚𝐧𝐧𝐨𝐭 𝐚𝐭𝐭𝐚𝐜𝐤 𝐲𝐨𝐮𝐫𝐬𝐞𝐥𝐟\n`
      menuText += `• 𝐏𝐫𝐨𝐭𝐞𝐜𝐭𝐞𝐝 𝐠𝐫𝐨𝐮𝐩𝐬 𝐚𝐫𝐞 𝐬𝐤𝐢𝐩𝐩𝐞𝐝\n`
      
      menuText += `\n💡 𝐔𝐒𝐀𝐆𝐄:\n`
      menuText += `𝐍𝐮𝐦𝐛𝐞𝐫: .androidcrash 234 81234 5678\n`
      menuText += `𝐆𝐫𝐨𝐮𝐩: .gccrash https://chat.whatsapp.com/xxxxx\n\n`
      
      menuText += `╰━━━━━━━━━━━━━━━━╯\n\n`
      menuText += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      await sock.sendMessage(m.chat, { text: menuText }, { quoted: m })

      return { success: true }
    } catch (error) {
      console.error("[BugMenu] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ 𝐄𝐫𝐫𝐨𝐫 𝐥𝐨𝐚𝐝𝐢𝐧𝐠 𝐛𝐮𝐠 𝐦𝐞𝐧𝐮.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
      return { success: false, error: error.message }
    }
  }
}