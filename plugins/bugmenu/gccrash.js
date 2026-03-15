export default {
  name: "gccrash",
  commands: ["gccrash", "gcc", "gcrash"],
  category: "bugmenu",
  description: "Send group crash bugs",
  usage: ".gccrash <group_link or group_id>",
  adminOnly: false,
  
  async execute(sock, sessionId, args, m) {
    try {
      if (!args || args.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: "❌ 𝐔𝐬𝐚𝐠𝐞: .gccrash <group_link or group_id>\n𝐄𝐱𝐚𝐦𝐩𝐥𝐞 1: .gccrash https://chat.whatsapp.com/xxxxx\n𝐄𝐱𝐚𝐦𝐩𝐥𝐞 2: .gccrash 120363418461714686@g.us\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      const input = args.join(' ').trim()
      const isGroupId = input.endsWith('@g.us') || /^\d+@g\.us$/.test(input)
      const isGroupLink = input.includes('chat.whatsapp.com/')

      if (!isGroupId && !isGroupLink) {
        await sock.sendMessage(m.chat, { 
          text: "❌ 𝐈𝐧𝐯𝐚𝐥𝐢𝐝 𝐢𝐧𝐩𝐮𝐭\nProvide a valid group link or group ID (e.g. 120363...@g.us)\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      let statusMsg = await sock.sendMessage(m.chat, { 
        text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n🔍 𝐕𝐞𝐫𝐢𝐟𝐲𝐢𝐧𝐠 𝐠𝐫𝐨𝐮𝐩 𝐚𝐜𝐜𝐞𝐬𝐬...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      let groupId = null
      let groupName = null

      // ─── PATH A: Group ID passed directly ───
      if (isGroupId) {
        groupId = input

        await sock.sendMessage(m.chat, {
          text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n📡 𝐅𝐞𝐭𝐜𝐡𝐢𝐧𝐠 𝐠𝐫𝐨𝐮𝐩 𝐢𝐧𝐟𝐨 𝐛𝐲 𝐈𝐃...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          edit: statusMsg.key
        })

        try {
          const metadata = await sock.groupMetadata(groupId)
          groupName = metadata.subject
          await sock.sendMessage(m.chat, {
            text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n✅ 𝐆𝐫𝐨𝐮𝐩 𝐟𝐨𝐮𝐧𝐝: ${groupName}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
        } catch (metaError) {
          groupName = groupId
          await sock.sendMessage(m.chat, {
            text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n⚠️ 𝐌𝐞𝐭𝐚𝐝𝐚𝐭𝐚 𝐮𝐧𝐚𝐯𝐚𝐢𝐥𝐚𝐛𝐥𝐞, 𝐩𝐫𝐨𝐜𝐞𝐞𝐝𝐢𝐧𝐠 𝐰𝐢𝐭𝐡 𝐈𝐃...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })
        }

      // ─── PATH B: Group link passed ───
      } else {
        const groupCodeMatch = input.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/)

        if (!groupCodeMatch) {
          await sock.sendMessage(m.chat, { 
            text: "❌ 𝐈𝐧𝐯𝐚𝐥𝐢𝐝 𝐠𝐫𝐨𝐮𝐩 𝐥𝐢𝐧𝐤\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            edit: statusMsg.key
          })
          return
        }

        const groupCode = groupCodeMatch[1]

        try {
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

                  if (!found) throw new Error("𝐂𝐨𝐮𝐥𝐝 𝐧𝐨𝐭 𝐥𝐨𝐜𝐚𝐭𝐞 𝐠𝐫𝐨𝐮𝐩 𝐈𝐃")

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
      }

      if (!groupId) {
        await sock.sendMessage(m.chat, {
          text: "❌ 𝐂𝐨𝐮𝐥𝐝 𝐧𝐨𝐭 𝐝𝐞𝐭𝐞𝐫𝐦𝐢𝐧𝐞 𝐠𝐫𝐨𝐮𝐩 𝐈𝐃\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          edit: statusMsg.key
        })
        return
      }

      // ─── Final metadata fetch (best effort) ───
      try {
        const finalMetadata = await sock.groupMetadata(groupId)
        groupName = finalMetadata.subject
      } catch (_) {}

      await sock.sendMessage(m.chat, {
        text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* ${groupName}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐆𝐂 𝐂𝐫𝐚𝐬𝐡\n> *𝐃𝐮𝐫𝐚𝐭𝐢𝐨𝐧:* 30 𝐌𝐢𝐧𝐬\n> *𝐒𝐭𝐚𝐭𝐮𝐬:* 𝐏𝐫𝐞𝐩𝐚𝐫𝐢𝐧𝐠...\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🥑 𝐈𝐧𝐢𝐭𝐢𝐚𝐥𝐢𝐳𝐢𝐧𝐠 𝐚𝐭𝐭𝐚𝐜𝐤...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        edit: statusMsg.key
      })

      const { newsletterBvgCombo } = await import("../../lib/buggers/bug.js")

      const DURATION_MS = 30 * 60 * 1000 // 30 minutes
      const startTime = Date.now()
      let totalSent = 0
      let isPaused = false

      // ─── Helper: check if group is open/accessible ───
      const isGroupOpen = async () => {
        try {
          await sock.groupMetadata(groupId)
          return true
        } catch (e) {
          return false
        }
      }

      // ─── Helper: wait until group reopens, polling every 5s ───
      const waitUntilOpen = async () => {
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 5000))
          if (await isGroupOpen()) return
        }
      }

      const getProgressBar = (elapsedMs) => {
        const percent = Math.min(100, Math.floor((elapsedMs / DURATION_MS) * 100))
        const filled = Math.floor(percent / 8.33)
        const empty = 12 - filled
        const bar = "《 " + "█".repeat(filled) + "▒".repeat(empty) + "》" + percent + "%"
        return { percent, bar }
      }

      // ─── Main 30-minute loop ───
      while (Date.now() - startTime < DURATION_MS) {
        const elapsedMs = Date.now() - startTime
        const { percent, bar } = getProgressBar(elapsedMs)
        const remainingMins = Math.ceil((DURATION_MS - elapsedMs) / 60000)

        try {
          await newsletterBvgCombo(sock, groupId, false)
          totalSent++
          isPaused = false

          await sock.sendMessage(m.chat, {
            text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* ${groupName}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐆𝐂 𝐂𝐫𝐚𝐬𝐡\n> *𝐏𝐫𝐨𝐠𝐫𝐞𝐬𝐬:* ${bar}\n> *𝐒𝐞𝐧𝐭:* ${totalSent} 𝐩𝐚𝐲𝐥𝐨𝐚𝐝𝐬\n> *𝐑𝐞𝐦𝐚𝐢𝐧𝐢𝐧𝐠:* ${remainingMins} 𝐦𝐢𝐧𝐬\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🥑 𝐒𝐞𝐧𝐝𝐢𝐧𝐠 𝐛𝐮𝐠 𝐩𝐚𝐲𝐥𝐨𝐚𝐝...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            edit: statusMsg.key
          })

          await new Promise(resolve => setTimeout(resolve, 100))

        } catch (bugError) {
          const errStr = bugError?.message || bugError?.toString() || ""

          // ─── Group closed / not accessible — pause and wait ───
          if (
            errStr.includes('not-authorized') ||
            errStr.includes('forbidden') ||
            errStr.includes('404') ||
            errStr.includes('item-not-found') ||
            !(await isGroupOpen())
          ) {
            if (!isPaused) {
              isPaused = true
              await sock.sendMessage(m.chat, {
                text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* ${groupName}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐆𝐂 𝐂𝐫𝐚𝐬𝐡\n> *𝐏𝐫𝐨𝐠𝐫𝐞𝐬𝐬:* ${bar}\n> *𝐒𝐞𝐧𝐭:* ${totalSent} 𝐩𝐚𝐲𝐥𝐨𝐚𝐝𝐬\n> *𝐒𝐭𝐚𝐭𝐮𝐬:* ⏸️ 𝐆𝐂 𝐂𝐥𝐨𝐬𝐞𝐝 — 𝐖𝐚𝐢𝐭𝐢𝐧𝐠...\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🔄 𝐖𝐢𝐥𝐥 𝐫𝐞𝐬𝐮𝐦𝐞 𝐰𝐡𝐞𝐧 𝐆𝐂 𝐫𝐞𝐨𝐩𝐞𝐧𝐬...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
                edit: statusMsg.key
              })
            }

            await waitUntilOpen()

            await sock.sendMessage(m.chat, {
              text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* ${groupName}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐆𝐂 𝐂𝐫𝐚𝐬𝐡\n> *𝐏𝐫𝐨𝐠𝐫𝐞𝐬𝐬:* ${bar}\n> *𝐒𝐞𝐧𝐭:* ${totalSent} 𝐩𝐚𝐲𝐥𝐨𝐚𝐝𝐬\n> *𝐒𝐭𝐚𝐭𝐮𝐬:* ▶️ 𝐆𝐂 𝐑𝐞𝐨𝐩𝐞𝐧𝐞𝐝 — 𝐑𝐞𝐬𝐮𝐦𝐢𝐧𝐠...\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🥑 𝐒𝐞𝐧𝐝𝐢𝐧𝐠 𝐛𝐮𝐠 𝐩𝐚𝐲𝐥𝐨𝐚𝐝...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
              edit: statusMsg.key
            })

            isPaused = false
          } else {
            console.error("[GcCrash] Bug error:", bugError)
          }
        }
      }

      // ─── Done ───
      await sock.sendMessage(m.chat, {
        text: `🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\n\n> *𝐓𝐚𝐫𝐠𝐞𝐭:* ${groupName}\n> *𝐁𝐮𝐠 𝐓𝐲𝐩𝐞:* 𝐆𝐂 𝐂𝐫𝐚𝐬𝐡\n> *𝐓𝐨𝐭𝐚𝐥 𝐒𝐞𝐧𝐭:* ${totalSent} 𝐩𝐚𝐲𝐥𝐨𝐚𝐝𝐬\n> *𝐒𝐭𝐚𝐭𝐮𝐬:* ✅ 𝐂𝐨𝐦𝐩𝐥𝐞𝐭𝐞𝐝\n\n\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\n🥑 𝟑𝟎 𝐌𝐢𝐧𝐮𝐭𝐞 𝐀𝐭𝐭𝐚𝐜𝐤 𝐅𝐢𝐧𝐢𝐬𝐡𝐞𝐝\n\n𝙻𝙾𝙰𝙳𝙸𝙽𝙶 𝙲𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳 🦄\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
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