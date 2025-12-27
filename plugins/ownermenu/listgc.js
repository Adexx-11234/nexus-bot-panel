export default {
  name: "listgc",
  aliases: ["listgroup", "listgroups"],
  category: "ownermenu",
  description: "List all groups the bot is in",
  usage: "listgc",
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
      // Get all group chats
      const groupChats = Object.keys(store.messages).filter((chat) => chat.endsWith("@g.us"))

      let response = `👥 *GROUP CHAT LIST*\n\n`
      response += `Total Groups: ${groupChats.length}\n\n`

      if (groupChats.length === 0) {
        response += `No groups found.`
        return m.reply(response)
      }

      for (let i = 0; i < groupChats.length; i++) {
        const groupId = groupChats[i]

        try {
          let metadata = store.groupMetadata[groupId]
          if (!metadata) {
            metadata = await sock.groupMetadata(groupId).catch(() => ({}))
            store.groupMetadata[groupId] = metadata
          }

          if (metadata.subject) {
            const creationDate = metadata.creation ? new Date(metadata.creation * 1000).toLocaleDateString() : "Unknown"

            response += `${i + 1}. *Name:* ${metadata.subject}\n`
            response += `   *Owner:* ${metadata.owner ? `@${metadata.owner.split("@")[0]}` : "Unknown"}\n`
            response += `   *ID:* ${metadata.id}\n`
            response += `   *Created:* ${creationDate}\n`
            response += `   *Members:* ${metadata.participants?.length || 0}\n\n`
            response += `━━━━━━━━━━━━━━━━━━━━\n\n`
          }
        } catch (error) {
          console.log(`[v0] Error getting group metadata for ${groupId}:`, error)
        }
      }

      await m.reply(response)
    } catch (error) {
      console.log("[v0] Error in listgc command:", error)
      m.reply(`❌ Failed to get group list!` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  },
}
