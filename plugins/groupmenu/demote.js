export default {
  name: "demote",
  aliases: ["demoteuser", "removeadmin"],
  category: "groupmenu",
  description: "Demote a group admin to regular member",
  usage: "demote <number> or reply to user",
    permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},

  async execute(sock, m, { args, quoted, isAdmin, isBotAdmin }) {

    let targetNumber
    if (quoted && quoted.sender) {
      targetNumber = quoted.sender
    } else if (args.length) {
      targetNumber = args[0].replace(/\D/g, "") + "@s.whatsapp.net"
    } else {
      return m.reply(`❌ Please provide a number or reply to a user!\n\nExample: .demote 1234567890` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    // Prevent demoting bot itself
    const botNumber = sock.user.id.split(":")[0] + "@s.whatsapp.net"
    if (targetNumber === botNumber) {
      return m.reply(`❌ I cannot demote myself!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      await sock.groupParticipantsUpdate(m.chat, [targetNumber], "demote")
      const number = targetNumber.split("@")[0]

      m.reply(`✅ Successfully demoted @${number} from admin!`, { mentions: [targetNumber] })
    } catch (error) {
      console.log("[v0] Error in demote command:", error)
      m.reply(`❌ Failed to demote user! They might not be an admin or not in the group.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
