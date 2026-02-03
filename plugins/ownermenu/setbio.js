export default {
  name: "setbio",
  aliases: ["changebio", "updatebio"],
  category: "ownermenu",
  description: "Change bot's WhatsApp bio/status",
  usage: "setbio <new bio text>",
  cooldown: 10,
  permissions: ["owner"],

  async execute(sock, m, { args, isCreator }) {
    if (!isCreator) {
      return m.reply(`❌ This command is only for bot owners!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    if (!args.length) {
      return m.reply("❌ Please provide the new bio text!\n\nExample: .setbio I'm a WhatsApp bot!")
    }

    const newBio = args.join(" ")

    try {
      await sock.updateProfileStatus(newBio)
      m.reply(`✅ *Bio updated successfully!*\n\n📝 *New Bio:* ${newBio}` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    } catch (error) {
      //console.log("[v0] Error in setbio command:", error)
      m.reply(`❌ Failed to update bio! Please try again.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
