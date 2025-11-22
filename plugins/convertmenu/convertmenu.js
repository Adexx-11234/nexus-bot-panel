export default {
  name: "convertmenu",
  commands: ["convertmenu", "convert", "conv"],
  description: "Display file conversion and utility commands menu",
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

      // Generate convert menu
      const menuText = await menuSystem.generateCategoryMenu("convertmenu", userInfo, m.isCreator || false)

      // Send menu with conversion-specific styling
      await sock.sendMessage(m.chat, {
        text: menuText,
        contextInfo: {
          externalAdReply: {
            title: "🔄 Convert Menu",
            body: "File Conversion & Utility Commands",
            thumbnailUrl: "https://i.imgur.com/placeholder.jpg",
            sourceUrl: "https://github.com/yourusername/bot",
            mediaType: 1,
            renderLargerThumbnail: false,
          },
        },
      }, { quoted: m })

      return { success: true }
    } catch (error) {
      console.error("[ConvertMenu] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Error loading convert menu. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}
