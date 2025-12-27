export default {
  name: "kick",
  aliases: ["dor"],
  category: "groupmenu",
  description: "Remove a member from the group",
  usage: "kick <number> or reply to user",
  cooldown: 5,
  permissions: {
    adminRequired: true, // User must be group admin (only applies in groups)
    botAdminRequired: true, // Bot must be group admin (only applies in groups)
    groupOnly: true, // Can only be used in groups
  },

  async execute(sock, m, { args, quoted }) {
    let targetNumber
    if (quoted && quoted.sender) {
      targetNumber = quoted.sender
    } else if (args.length) {
      targetNumber = args[0].replace(/\D/g, "") + "@s.whatsapp.net"
    } else {
      return m.reply(
        `❌ Please provide a number or reply to a user!\n\nExample: .kick 1234567890` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      )
    }

    // Prevent kicking admins or bot itself
    const botNumber = sock.user.id.split(":")[0] + "@s.whatsapp.net"
    if (targetNumber === botNumber) {
      return m.reply(`❌ I cannot kick myself!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      const result = await sock.groupParticipantsUpdate(m.chat, [targetNumber], "remove")
      const number = targetNumber.split("@")[0]

      m.reply(`✅ Successfully removed @${number} from the group!`, { mentions: [targetNumber] })
    } catch (error) {
      console.log("[v0] Error in kick command:", error)
      m.reply(`❌ Failed to remove member! They might be an admin or already left.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
