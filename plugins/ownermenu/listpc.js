export default {
  name: "listpc",
  aliases: ["listprivate", "listprivatechat"],
  category: "ownermenu",
  description: "List all private chats the bot is in",
  usage: "listpc",
  cooldown: 5,
    permissions: {
  ownerOnly: true,          // Only bot owner can use (overrides everything)
  privateOnly: true         // Can only be used in private chats
},

  async execute(sock, m, { store, isCreator }) {
    if (!isCreator) {
      return m.reply(`❌ This command is only for bot owners!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      // Get all private chats (ending with .net but not @g.us)
      const privateChats = Object.keys(store.messages).filter(
        (chat) => chat.endsWith(".net") && !chat.endsWith("@g.us"),
      )

      let response = `📱 *PRIVATE CHAT LIST*\n\n`
      response += `Total Private Chats: ${privateChats.length}\n\n`

      if (privateChats.length === 0) {
        response += `No private chats found.`
        return m.reply(response)
      }

      for (let i = 0; i < privateChats.length; i++) {
        const chat = privateChats[i]

        try {
          // Get contact name
          const contactName = sock.getName(chat) || "Unknown"
          const phoneNumber = chat.split("@")[0]

          response += `${i + 1}. *Name:* ${contactName}\n`
          response += `   *Number:* @${phoneNumber}\n`
          response += `   *Chat:* https://wa.me/${phoneNumber}\n\n`
          response += `━━━━━━━━━━━━━━━━━━━━\n\n`
        } catch (error) {
          console.log(`[v0] Error getting contact info for ${chat}:`, error)
        }
      }

      await m.reply(response, { mentions: privateChats })
    } catch (error) {
      console.log("[v0] Error in listpc command:", error)
      m.reply(`❌ Failed to get private chat list!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
