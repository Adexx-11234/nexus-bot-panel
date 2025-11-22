export default {
  name: "aimenu",
  commands: ["aimenu", "ai", "artificial"],
  description: "Display AI and chatbot commands menu",
  adminOnly: false,

  async execute(sock, sessionId, args, m) {
    try {
      // Import menu system
      const { default: menuSystem } = await import("../../utils/menu-system.js")

      // Get user info
      const userInfo = {
        name: m.pushName || "User",
        id: m.sender,
      }

      // Generate AI menu
      const menuText = await menuSystem.generateCategoryMenu("aimenu", userInfo, m.isCreator || false)

      // Send menu with AI-specific styling
      await sock.sendMessage(m.chat, {
        text: menuText,
        contextInfo: {
          externalAdReply: {
            title: "🤖 AI Menu",
            body: "Artificial Intelligence & Chat Commands",
            thumbnailUrl: "https://i.imgur.com/placeholder.jpg",
            sourceUrl: "https://github.com/yourusername/bot",
            mediaType: 1,
            renderLargerThumbnail: false,
          },
        },
      }, { quoted: m })

      return { success: true }
    } catch (error) {
      console.error("[AIMenu] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Error loading AI menu. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}
