export default {
  name: "warn",
  aliases: ["warning", "warnuser"],
  category: "groupmenu",
  description: "Warn a group member (3 warnings = kick)",
  usage: "warn <number> or reply to user",
  cooldown: 5,
  permissions: ["admin"],

  async execute(sock, m, { args, quoted, isAdmin, isBotAdmin, db }) {
    if (!m.isGroup) {
      return m.reply(`❌ This command can only be used in groups!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    if (!isAdmin) {
      return m.reply(`❌ Only group admins can use this command!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    if (!isBotAdmin) {
      return m.reply(`❌ Bot needs to be admin to warn members!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    let targetNumber
    if (quoted && quoted.sender) {
      targetNumber = quoted.sender
    } else if (args.length) {
      targetNumber = args[0].replace(/\D/g, "") + "@s.whatsapp.net"
    } else {
      return m.reply(`❌ Please provide a number or reply to a user!\n\nExample: .warn 1234567890` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      // Initialize group warnings if not exists
      if (!db.groups[m.chat].warn) {
        db.groups[m.chat].warn = {}
      }

      const currentWarnings = db.groups[m.chat].warn[targetNumber] || 0
      const newWarnings = currentWarnings + 1

      if (newWarnings >= 3) {
        // Kick user after 3 warnings
        await sock.groupParticipantsUpdate(m.chat, [targetNumber], "remove")
        delete db.groups[m.chat].warn[targetNumber]

        const number = targetNumber.split("@")[0]
        m.reply(`🚫 @${number} has been kicked from the group for receiving 3 warnings!`, {
          mentions: [targetNumber],
        })
      } else {
        // Add warning
        db.groups[m.chat].warn[targetNumber] = newWarnings
        const number = targetNumber.split("@")[0]

        m.reply(`⚠️ Warning ${newWarnings}/3 given to @${number}\n\nReason: Violating group rules`, {
          mentions: [targetNumber],
        })
      }
    } catch (error) {
      console.log("[v0] Error in warn command:", error)
      m.reply(`❌ Failed to warn user!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
