export default {
  name: "ownermenu",
  commands: ["ownermenu", "owner"],
  description: "Display owner-only commands menu",
  category: "ownermenu", // Changed from "utility" to "ownermenu"
  ownerOnly: true, // Explicitly mark as owner-only

  async execute(sock, sessionId, args, m) {
    try {
      // Import menu system
      const { default: menuSystem } = await import("../../utils/menu-system.js")

      // Get user info
      const userInfo = {
        name: m.pushName || "User",
        id: m.sender,
      }

      // Generate owner menu
      const menuText = await menuSystem.generateCategoryMenu("ownermenu", userInfo, m.isCreator || false)

      // Send menu with special styling for owner commands
      await sock.sendMessage(m.chat, {
        text: menuText,
        contextInfo: {
          externalAdReply: {
            title: "👑 Owner Menu",
            body: m.isCreator ? "Owner Access Granted" : "View Only - Owner Permission Required",
            thumbnailUrl: "https://i.imgur.com/placeholder.jpg",
            sourceUrl: "https://github.com/yourusername/bot",
            mediaType: 1,
            renderLargerThumbnail: false,
          },
        },
      })

      return { success: true }
    } catch (error) {
      console.error("[OwnerMenu] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Error loading owner menu. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" })
      return { success: false, error: error.message }
    }
  },
}
