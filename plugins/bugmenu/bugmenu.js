import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "bugmenu",
  commands: ["bugmenu", "bugs"],
  description: "Display bug attack commands menu (VIP Only)",
  adminOnly: false,
  async execute(sock, sessionId, args, m) {
    try {
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

      const userInfo = {
        name: m.pushName || m.name || m.notify || "VIP User",
        id: m.sender,
      }

      let menuText = `╭━━━『 *BUG ATTACK MENU* 』━━━╮\n\n`
      menuText += `👤 *User:* ${userInfo.name}\n`
      menuText += `⭐ *VIP Level:* ${vipStatus.level}${vipStatus.isDefault ? ' (Admin)' : ''}\n\n`

      menuText += `━━━━━━━━━━━━━━━━\n\n`

      menuText += `🤖💥 *ANDROID + CRASH*\n`
      menuText += `*.androidcrash <number>*\n`
      menuText += `Sends: Delaycrash, DelayBlonde, DefJam, HardInvis, XProtexDelay, BlankVisco, BulldoserV3, PhotoDelay, Protocol6, VerloadDelay, VerloadHardCore, Noise, CrashInvis, NewImage2, CrashInvisible\n\n`

      menuText += `🍎⚡ *iOS + FORCECLOSE*\n`
      menuText += `*.iosfc <number>*\n`
      menuText += `Sends: IosinVisFC, NewProtocol6, VtxForceDel, SnitchDelay, FreezeIphone, BlankVisco, PhotoDelay, IosInvisible, ContactXIos, VampireCrash, CrashIos, CrashIos3, Protocol6, FlowXNull, ForceClick, XheavensdeeP, SqhForce, FreezePack, SqhForceCombo \n\n`

      menuText += `👥 *GROUP CRASH*\n`
      menuText += `*.gccrash <group_link>*\n`
      menuText += `Sends: BugGcCrash, BugGcNewup\n\n`

      menuText += `🌪️ *MIXED (ALL BUGS)*\n`
      menuText += `*.mixedcrash <number>*\n`
      menuText += `Sends ALL bugs except group bugs\n\n`

      menuText += `━━━━━━━━━━━━━━━━\n\n`
      menuText += `⚠️ *WARNINGS:*\n`
      menuText += `• Cannot attack VIP users\n`
      menuText += `• Cannot attack yourself\n`
      menuText += `• 500ms delay between bugs\n`
      menuText += `• Live progress updates\n\n`
      
      menuText += `💡 *USAGE:*\n`
      menuText += `Number: .androidcrash 234 806 7023422\n`
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