export default {
  name: "promote",
  aliases: ["promoteuser", "makeadmin"],
  category: "groupmenu",
  description: "Promote a member to group admin",
  usage: "promote <number> or reply to user",
  cooldown: 5,
  permissions: ["admin"],

  async execute(sock, m, { args, quoted, isAdmin, isBotAdmin }) {
    if (!m.isGroup) {
      return m.reply(`❌ This command can only be used in groups!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    if (!isAdmin) {
      return m.reply(`❌ Only group admins can use this command!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    if (!isBotAdmin) {
      return m.reply(`❌ Bot needs to be admin to promote members!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

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
      //console.log("[v0] Error in promote command:", error)
      m.reply(`❌ Failed to promote user! They might already be an admin or not in the group.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
