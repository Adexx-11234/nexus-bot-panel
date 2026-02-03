export default {
  name: "addowner",
  commands: ["addowner", "makeowner"],
  description: "Add a new bot owner (Owner only)",
  category: "ownermenu", // Changed from "utility" to "ownermenu"
  ownerOnly: true, // Explicitly mark as owner-only

  async execute(sock, sessionId, args, m) {
    try {
      // Import permission system
      const { default: permissionSystem } = await import("../../utils/permission-system.js")

      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a user identifier.\n\n*Usage:*\n• `.addowner @user` (reply to user)\n• `.addowner 1234567890` (phone number)\n• `.addowner telegram:123456789` (Telegram ID)\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        })
      }

      let targetJid = args[0]
      let platform = "whatsapp"

      // Handle different input formats
      if (m.quoted && m.quoted.sender) {
        targetJid = m.quoted.sender
      } else if (args[0].startsWith("telegram:")) {
        platform = "telegram"
        targetJid = args[0].replace("telegram:", "")
      } else if (args[0].startsWith("@")) {
        // Handle @mention format
        targetJid = args[0].replace("@", "") + "@s.whatsapp.net"
      } else if (/^\d+$/.test(args[0])) {
        // Handle phone number
        targetJid = args[0] + "@s.whatsapp.net"
      }

      const normalizedId = permissionSystem.normalizeUserIdentifier(targetJid, platform)
      if (permissionSystem.isOwner(targetJid, platform)) {
        return await sock.sendMessage(m.chat, {
          text: `⚠️ User is already a bot owner!\n\n👑 *Owner:* ${normalizedId}\n🌐 *Platform:* ${platform.charAt(0).toUpperCase() + platform.slice(1)}

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        })
      }

      // Add owner
      const success = permissionSystem.addOwner(targetJid, platform)

      if (success) {
        await sock.sendMessage(m.chat, {
          text: `✅ Successfully added new owner!\n\n👑 *New Owner:* ${normalizedId}\n🌐 *Platform:* ${platform.charAt(0).toUpperCase() + platform.slice(1)}\n📊 *Total Owners:* ${permissionSystem.getOwners().length}\n\n*Note:* Changes take effect immediately.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          contextInfo: {
            externalAdReply: {
              title: "👑 New Owner Added",
              body: `${normalizedId} is now a bot owner`,
              thumbnailUrl: "https://i.imgur.com/success-placeholder.jpg",
              mediaType: 1,
            },
          },
        })

        //console.log(`[AddOwner] New owner added: ${normalizedId} (${platform}) by ${m.sender}`)
      } else {
        await sock.sendMessage(m.chat, {
          text: "❌ Failed to add owner. Please check the identifier and try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        })
      }

      return { success }
    } catch (error) {
      console.error("[AddOwner] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Error adding owner. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" })
      return { success: false, error: error.message }
    }
  },
}
