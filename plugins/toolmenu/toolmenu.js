export default {
  name: "toolmenu",
  commands: ["toolmenu"],
  description: "Display tools and utility commands menu",
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

      // Generate tool menu
      const menuText = await menuSystem.generateCategoryMenu("toolmenu", userInfo, m.isCreator || false)

      // Send menu with tool-specific styling
      await sock.sendMessage(m.chat, {
        text: menuText,
        contextInfo: {
          externalAdReply: {
            title: "🔧 Tool Menu",
            body: "Utility Tools & Helper Commands",
            thumbnailUrl: "https://i.imgur.com/placeholder.jpg",
            sourceUrl: "https://github.com/yourusername/bot",
            mediaType: 1,
            renderLargerThumbnail: false,
          },
        },
      }, { quoted: m })

      return { success: true }
    } catch (error) {
      console.error("[ToolMenu] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Error loading tool menu. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}