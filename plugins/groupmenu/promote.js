export default {
  name: "promote",
  aliases: ["promoteuser", "makeadmin"],
  category: "groupmenu",
  description: "Promote a member to group admin",
  usage: "promote <number> or reply to user",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},

  async execute(sock, m, { args, quoted}) {


    let targetNumber
    if (quoted && quoted.sender) {
      targetNumber = quoted.sender
    } else if (args.length) {
      targetNumber = args[0].replace(/\D/g, "") + "@s.whatsapp.net"
    } else {
      return m.reply(`❌ Please provide a number or reply to a user!\n\nExample: .promote 1234567890` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      await sock.groupParticipantsUpdate(m.chat, [targetNumber], "promote")
      const number = targetNumber.split("@")[0]

      m.reply(`✅ Successfully promoted @${number} to admin!`, { mentions: [targetNumber] })
    } catch (error) {
      console.log("[v0] Error in promote command:", error)
      m.reply(`❌ Failed to promote user! They might already be an admin or not in the group.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
