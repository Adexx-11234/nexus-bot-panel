export default {
  name: "del",
  aliases: ["delete", "del"],
  category: "groupmenu",
  description: "Delete a message by replying to it",
  usage: "Reply to a message with .del",
    permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},

  async execute(sock, m, { quoted, isAdmin, isBotAdmin }) {


    if (!quoted) {
      return m.reply(`❌ Please reply to the message you want to delete!\n\nExample: Reply to a message and type .del` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      // Check if the quoted message is from the bot itself
      const isBotMessage = quoted.key?.fromMe === true

      // If it's not a bot message and bot is not admin, inform the user
      if (!isBotMessage && !isBotAdmin) {
        return m.reply(`❌ Bot needs to be admin to delete messages from other users!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }

      // Attempt to delete the message
      await sock.sendMessage(m.chat, {
        delete: {
          remoteJid: quoted.key.remoteJid,
          fromMe: quoted.key.fromMe,
          id: quoted.key.id,
          participant: quoted.key.participant
        }
      })

      // Optional: Delete the command message itself after a brief delay
      setTimeout(async () => {
        try {
          await sock.sendMessage(m.chat, {
            delete: {
              remoteJid: m.key.remoteJid,
              fromMe: m.key.fromMe,
              id: m.key.id,
              participant: m.key.participant
            }
          })
        } catch (err) {
          // Silently fail if can't delete command message
        }
      }, 500)

    } catch (error) {
      console.log("[Delete] Error deleting message:", error)
      
      // Provide specific error messages
      if (error.message?.includes("forbidden")) {
        return m.reply(`❌ Cannot delete this message. It might be too old or the bot lacks permissions.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      } else if (error.message?.includes("not-authorized")) {
        return m.reply(`❌ Bot is not authorized to delete this message.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      } else {
        return m.reply(`❌ Failed to delete the message. The message might be too old or already deleted.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
    }
  },
}