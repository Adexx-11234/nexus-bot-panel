export default {
  name: "searchmenu",
  commands: ["searchmenu"],
  description: "Display search and lookup commands menu",
  permissions: {

},

  async execute(sock, sessionId, args, m) {
    try {
      // Import menu system
      const { default: menuSystem } = await import("../../utils/menu-system.js")

      // Get user info
      const userInfo = {
        name: m.pushName || "User",
        id: m.sender,
      }

      // Generate search menu
      const menuText = await menuSystem.generateCategoryMenu("searchmenu", userInfo, m.isCreator || false)

      // Send menu with search-specific styling
      await sock.sendMessage(m.chat, {
        text: menuText,
        contextInfo: {
          externalAdReply: {
            title: "🔍 Search Menu",
            body: "Search & Lookup Commands",
            thumbnailUrl: "https://i.imgur.com/placeholder.jpg",
            sourceUrl: "https://github.com/yourusername/bot",
            mediaType: 1,
            renderLargerThumbnail: false,
          },
        },
      }, { quoted: m })

      return { success: true }
    } catch (error) {
      console.error("[SearchMenu] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Error loading search menu. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}