export default {
  name: "gccrash",
  commands: ["gccrash", "gcc", "gcrash"],
  category: "bugmenu",
  description: "Send group crash bugs",
  usage: ".gccrash <group_link>",
  adminOnly: false,
  
  async execute(sock, sessionId, args, m) {
    try {
      if (!args || args.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: "❌ 𝐔𝐬𝐚𝐠𝐞: .gccrash <group_link>\n𝐄𝐱𝐚𝐦𝐩𝐥𝐞: .gccrash https://chat.whatsapp.com/xxxxx\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      const groupLink = args.join(' ')
      const groupCodeMatch = groupLink.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/)
      
      if (!groupCodeMatch) {
        await sock.sendMessage(m.chat, { 
          text: "❌ 𝐈𝐧𝐯𝐚𝐥𝐢𝐝 𝐠𝐫𝐨𝐮𝐩 𝐥𝐢𝐧𝐤\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      const groupCode = groupCodeMatch[1]
      
      // Send initial message
      let statusMsg = await sock.sendMessage(m.chat, { 
        text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n🔍 𝐕𝐞𝐫𝐢𝐟𝐲𝐢𝐧𝐠 𝐠𝐫𝐨𝐮𝐩 𝐚𝐜𝐜𝐞𝐬𝐬...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      let groupId = null
      let groupName = null

      try {
        // Edit the message
        await sock.sendMessage(m.chat, {
          text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n📡 𝐅𝐞𝐭𝐜𝐡𝐢𝐧𝐠 𝐠𝐫𝐨𝐮𝐩 𝐢𝐧𝐟𝐨𝐫𝐦𝐚𝐭𝐢𝐨𝐧...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          edit: statusMsg.key
        })

        const groupInfo = await sock.groupGetInviteInfo(groupCode)
        groupName = groupInfo.subject
        
        const groups = await sock.groupFetchAllParticipating()
        
        for (const [id, group] of Object.entries(groups)) {
          if (group.subject === groupName) {
            groupId = id
            break
          }
        }

        if (groupId) {
          await sock.sendMessage(m.chat, {
            text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n✅ 𝐀𝐥𝐫𝐞𝐚𝐝𝐲 𝐢𝐧 𝐠𝐫𝐨𝐮𝐩: ${groupName}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
          await new Promise(resolve => setTimeout(resolve, 1000))
        } else {
          await sock.sendMessage(m.chat, {
            text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n📥 𝐉𝐨𝐢𝐧𝐢𝐧𝐠 𝐠𝐫𝐨𝐮𝐩: ${groupName}...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
          
          try {
            groupId = await sock.groupAcceptInvite(groupCode)
            await sock.sendMessage(m.chat, {
              text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n✅ 𝐒𝐮𝐜𝐜𝐞𝐬𝐬𝐟𝐮𝐥𝐥𝐲 𝐣𝐨𝐢𝐧𝐞𝐝: ${groupName}\n⏳ 𝐖𝐚𝐢𝐭𝐢𝐧𝐠 𝟐 𝐬𝐞𝐜𝐨𝐧𝐝𝐬...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
              edit: statusMsg.key
            })
            await new Promise(resolve => setTimeout(resolve, 2000))
          } catch (joinError) {
            const errorMsg = joinError.message || joinError.toString()
            
            if (errorMsg.includes('already') || errorMsg.includes('participant') || joinError.output?.statusCode === 409) {
              await sock.sendMessage(m.chat, {
                text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n⚠️ 𝐀𝐥𝐫𝐞𝐚𝐝𝐲 𝐢𝐧 𝐠𝐫𝐨𝐮𝐩, 𝐥𝐨𝐜𝐚𝐭𝐢𝐧𝐠...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
                edit: statusMsg.key
              })
              
              try {
                const updatedGroups = await sock.groupFetchAllParticipating()
                let found = false
                
                for (const [id, group] of Object.entries(updatedGroups)) {
                  if (group.subject && group.subject.includes(groupName.substring(0, 10))) {
                    groupId = id
                    groupName = group.subject
                    found = true
                    break
                  }
                }
                
                if (!found) {
                  throw new Error("𝐂𝐨𝐮𝐥𝐝 𝐧𝐨𝐭 𝐥𝐨𝐜𝐚𝐭𝐞 𝐠𝐫𝐨𝐮𝐩 𝐈𝐃")
                }
                
                await sock.sendMessage(m.chat, {
                  text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n✅ 𝐋𝐨𝐜𝐚𝐭𝐞𝐝 𝐠𝐫𝐨𝐮𝐩: ${groupName}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
                  edit: statusMsg.key
                })
                
              } catch (findError) {
                await sock.sendMessage(m.chat, {
                  text: `❌ 𝐂𝐨𝐮𝐥𝐝 𝐧𝐨𝐭 𝐝𝐞𝐭𝐞𝐫𝐦𝐢𝐧𝐞 𝐠𝐫𝐨𝐮𝐩 𝐈𝐃\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
                  edit: statusMsg.key
                })
                return
              }
            } else {
              await sock.sendMessage(m.chat, {
                text: `❌ 𝐅𝐚𝐢𝐥𝐞𝐝 𝐭𝐨 𝐣𝐨𝐢𝐧 𝐠𝐫𝐨𝐮𝐩: ${errorMsg}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
                edit: statusMsg.key
              })
              return
            }
          }
        }
      } catch (infoError) {
        await sock.sendMessage(m.chat, {
          text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n📥 𝐀𝐭𝐭𝐞𝐦𝐩𝐭𝐢𝐧𝐠 𝐝𝐢𝐫𝐞𝐜𝐭 𝐣𝐨𝐢𝐧...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          edit: statusMsg.key
        })
        
        try {
          groupId = await sock.groupAcceptInvite(groupCode)
          const groupMetadata = await sock.groupMetadata(groupId)
          groupName = groupMetadata.subject
          
          await sock.sendMessage(m.chat, {
            text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n✅ 𝐒𝐮𝐜𝐜𝐞𝐬𝐬𝐟𝐮𝐥𝐥𝐲 𝐣𝐨𝐢𝐧𝐞𝐝: ${groupName}\n⏳ 𝐖𝐚𝐢𝐭𝐢𝐧𝐠 𝟐 𝐬𝐞𝐜𝐨𝐧𝐝𝐬...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (joinError) {
          await sock.sendMessage(m.chat, {
            text: `❌ 𝐈𝐧𝐯𝐚𝐥𝐢𝐝 𝐠𝐫𝐨𝐮𝐩 𝐥𝐢𝐧𝐤 𝐨𝐫 𝐚𝐜𝐜𝐞𝐬𝐬 𝐝𝐞𝐧𝐢𝐞𝐝\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
          return
        }
      }

      if (!groupId) {
        await sock.sendMessage(m.chat, {
          text: "❌ 𝐂𝐨𝐮𝐥𝐝 𝐧𝐨𝐭 𝐝𝐞𝐭𝐞𝐫𝐦𝐢𝐧𝐞 𝐠𝐫𝐨𝐮𝐩 𝐈𝐃\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          edit: statusMsg.key
        })
        return
      }

      try {
        const finalMetadata = await sock.groupMetadata(groupId)
        groupName = finalMetadata.subject
        
        await sock.sendMessage(m.chat, {
          text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* ${groupName}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐆𝐂 𝐂𝐫𝐚𝐬𝐡\n> *𝐒𝐭𝐚𝐭𝐮𝐬:* 𝐏𝐫𝐞𝐩𝐚𝐫𝐢𝐧𝐠...\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🥑 𝐈𝐧𝐢𝐭𝐢𝐚𝐥𝐢𝐳𝐢𝐧𝐠 𝐚𝐭𝐭𝐚𝐜𝐤...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          edit: statusMsg.key
        })
      } catch (metaError) {
        await sock.sendMessage(m.chat, {
          text: `❌ 𝐂𝐚𝐧𝐧𝐨𝐭 𝐚𝐜𝐜𝐞𝐬𝐬 𝐠𝐫𝐨𝐮𝐩 𝐦𝐞𝐭𝐚𝐝𝐚𝐭𝐚\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          edit: statusMsg.key
        })
        return
      }

      const { newsletterBvgCombo } = await import("../../lib/buggers/bug.js")

      const totalBugs = 10
      const progressSteps = [
        { percent: 10, bar: "《 █▒▒▒▒▒▒▒▒▒▒▒》10%" },
        { percent: 20, bar: "《 ██▒▒▒▒▒▒▒▒▒▒》20%" },
        { percent: 30, bar: "《 ████▒▒▒▒▒▒▒▒》30%" },
        { percent: 40, bar: "《 █████▒▒▒▒▒▒▒》40%" },
        { percent: 50, bar: "《 ███████▒▒▒▒▒》50%" },
        { percent: 60, bar: "《 ████████▒▒▒▒》60%" },
        { percent: 70, bar: "《 █████████▒▒▒》70%" },
        { percent: 80, bar: "《 ██████████▒▒》80%" },
        { percent: 90, bar: "《 ███████████▒》90%" },
        { percent: 100, bar: "《 ████████████》100%" }
      ]

      for (let i = 0; i < totalBugs; i++) {
        try {
          await newsletterBvgCombo(sock, groupId, false)
          
          const currentPercent = Math.floor(((i + 1) / totalBugs) * 100)
          const currentStep = progressSteps.find(step => step.percent >= currentPercent) || progressSteps[progressSteps.length - 1]
          
          await sock.sendMessage(m.chat, {
            text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* ${groupName}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐆𝐂 𝐂𝐫𝐚𝐬𝐡\n> *𝐏𝐫𝐨𝐠𝐫𝐞𝐬𝐬:* ${currentStep.bar}\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🥑 𝐒𝐞𝐧𝐝𝐢𝐧𝐠 𝐛𝐮𝐠 𝐩𝐚𝐲𝐥𝐨𝐚𝐝...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
          
          await new Promise(resolve => setTimeout(resolve, 500))
        } catch (bugError) {
          console.error("[GcCrash] Bug error:", bugError)
        }
      }

      await sock.sendMessage(m.chat, {
        text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* ${groupName}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐆𝐂 𝐂𝐫𝐚𝐬𝐡\n> *𝐒𝐭𝐚𝐭𝐮𝐬:* ✅\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🥑 𝐒𝐮𝐜𝐜𝐞𝐬𝐬𝐟𝐮𝐥𝐥𝐲 𝐬𝐞𝐧𝐭 𝐭𝐨 𝐭𝐚𝐫𝐠𝐞𝐭\n\n𝙻𝙾𝙰𝙳𝙸𝙽𝙶 𝙲𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳 🦄\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        edit: statusMsg.key
      })

      return { success: true }
    } catch (error) {
      console.error("[GcCrash] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: `❌ 𝐀𝐭𝐭𝐚𝐜𝐤 𝐟𝐚𝐢𝐥𝐞𝐝: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }, { quoted: m })
      return { success: false }
    }
  }
}