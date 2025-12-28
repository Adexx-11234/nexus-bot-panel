export default {
  name: "creategc",
  aliases: ["buatgc", "creategroup"],
  category: "ownermenu",
  description: "Create a new WhatsApp group",
  usage: "creategc <group name>",
  cooldown: 10,
  permissions: ["owner"],

  async execute(sock, m, { args, isCreator }) {
    if (!isCreator) {
      return m.reply(`❌ This command is only for bot owners!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    if (!args.length) {
      return m.reply(`❌ Please provide a group name!\n\nExample: .creategc My New Group` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const groupName = args.join(" ")

    try {
      // Create the group with the sender as initial member
      const group = await sock.groupCreate(groupName, [m.sender])

      // Get group invite link
      const inviteCode = await sock.groupInviteCode(group.id)
      const inviteLink = `https://chat.whatsapp.com/${inviteCode}`

      let response = `✅ *GROUP CREATED SUCCESSFULLY*\n\n`
      response += `📝 *Group Name:* ${group.subject}\n`
      response += `🔗 *Invite Link:* ${inviteLink}\n`
      response += `⏰ *Auto-promote in 30 seconds*\n\n`
      response += `Join the group within 30 seconds to become an admin!`

      await m.reply(response, { detectLink: true })

      // Wait 30 seconds then promote the creator
      setTimeout(async () => {
        try {
          await sock.groupParticipantsUpdate(group.id, [m.sender], "promote")
          await sock.sendMessage(group.id, {
            text: `🎉 Welcome to ${group.subject}!\n\n@${m.sender.split("@")[0]} has been promoted to admin.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            mentions: [m.sender],
          })
        } catch (error) {
          console.log("[v0] Error promoting user:", error)
        }
      }, 30000)
    } catch (error) {
      console.log("[v0] Error creating group:", error)
      m.reply(`❌ Failed to create group! Make sure the bot has permission to create groups.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
