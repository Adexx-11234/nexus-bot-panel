export default {
  name: "leave",
  aliases: ["leavegroup", "exit"],
  category: "ownermenu",
  description: "Leave the current group",
  usage: "leave",
  cooldown: 10,
  permissions: ["owner"],

  async execute(sock, m, { isCreator }) {
    if (!isCreator) {
      return m.reply(`❌ This command is only for bot owners!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    if (!m.isGroup) {
      return m.reply(`❌ This command can only be used in groups!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      const groupName = m.metadata.subject || "Unknown Group"

      // Send goodbye message
      await m.reply(`👋 *Goodbye!*\n\nBot is leaving ${groupName}.\nThanks for using our services!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      // Leave the group after a short delay
      setTimeout(async () => {
        try {
          await sock.groupLeave(m.chat)

          // Notify owner in private
          await sock.sendMessage(m.sender, {
            text: `✅ Successfully left group: *${groupName}*

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          })
        } catch (error) {
          //console.log("[v0] Error leaving group:", error)
        }
      }, 2000)
    } catch (error) {
      //console.log("[v0] Error in leave command:", error)
      m.reply(`❌ Failed to leave group!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
