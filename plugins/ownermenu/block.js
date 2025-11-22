export default {
  name: "Block",
  description: "Block a user from using the bot",
  commands: ["block", "blokir", "blockuser"],
  category: "ownermenu", // Changed from "utility" to "ownermenu"
  ownerOnly: true, // Explicitly mark as owner-only
  usage: "• `.block <number>` or reply to user",

  async execute(sock, m, { args, quoted, isCreator }) {
    if (!isCreator) {
      return m.reply(`❌ This command is only for bot owners!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    let targetNumber
    if (quoted && quoted.sender) {
      targetNumber = quoted.sender
    } else if (args.length) {
      targetNumber = args[0].replace(/\D/g, "") + "@s.whatsapp.net"
    } else if (m.isGroup) {
      return m.reply(`❌ Please provide a number or reply to a user!\n\nExample: .block 1234567890` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    } else {
      targetNumber = m.chat // Block current chat if in private
    }

    try {
      await sock.updateBlockStatus(targetNumber, "block")
      const number = targetNumber.split("@")[0]

      sock.sendMessage(`✅ Successfully blocked @${number}!`, { mentions: [targetNumber] }, {quoted: m})
    } catch (error) {
      console.log("[v0] Error in block command:", error)
      m.reply(`❌ Failed to block user!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
