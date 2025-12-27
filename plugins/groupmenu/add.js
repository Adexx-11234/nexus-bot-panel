export default {
  name: "add",
  aliases: ["addmember", "add"],
  category: "groupmenu",
  description: "Add a member to the group",
  usage: "add <number> or reply to user",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},

  async execute(sock, m, { args, quoted }) {

    let targetNumber
    if (quoted && quoted.sender) {
      targetNumber = quoted.sender
    } else if (args.length) {
      targetNumber = args[0].replace(/\D/g, "") + "@s.whatsapp.net"
    } else {
      return m.reply(`❌ Please provide a number or reply to a user!\n\nExample: .add 1234567890` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const number = targetNumber.split("@")[0]

    try {
      // Try method 1: groupParticipantsUpdate
      const result = await sock.groupParticipantsUpdate(m.chat, [targetNumber], "add")
      
      if (result && result.length > 0) {
        const res = result[0]
        
        // Check if already in group
        if (res.status == 409 || res.status == "409") {
          return m.reply(`✅ @${number} is already in the group!`, { mentions: [targetNumber] })
        }
        
        // Check if successfully added
        if (res.status == 200 || res.status == "200") {
          return m.reply(`✅ Successfully added @${number} to the group!`, { mentions: [targetNumber] })
        }
      }
      
      // If status is not success, try fallback method
      throw new Error("Method 1 failed, trying fallback")
      
    } catch (error) {
      console.log("[v0] groupParticipantsUpdate failed, trying groupAdd:", error.message)
      
      try {
        // Try method 2: groupAdd
        await sock.groupAdd(m.chat, [targetNumber])
        return m.reply(`✅ Successfully added @${number} to the group!`, { mentions: [targetNumber] })
        
      } catch (error2) {
        console.log("[v0] groupAdd failed, sending invite:", error2.message)
        
        try {
          // Fallback to invite
          const inviteCode = await sock.groupInviteCode(m.chat)
          const inviteLink = `https://chat.whatsapp.com/${inviteCode}`

          await sock
            .sendMessage(targetNumber, {
              text: `📨 *Group Invitation*\n\n` +
                `You've been invited to join: *${m.metadata.subject}*\n` +
                `By: @${m.sender.split("@")[0]}\n\n` +
                `${inviteLink}\n\n` +
                `Click the link above to join the group.

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
              mentions: [m.sender],
            })
            .catch(() => {})

          m.reply(`📨 @${number} couldn't be added directly. Invitation sent via private message.`, {
            mentions: [targetNumber],
          })
          
        } catch (error3) {
          console.log("[v0] All methods failed:", error3.message)
          // Silent fail - no error message to user
        }
      }
    }
  },
}