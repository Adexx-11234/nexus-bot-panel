export default {
  name: "groupmenu",
  commands: ["groupmenu"],
  description: "Display group management commands menu",
    permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  async execute(sock, sessionId, args, m) {
    try {
      // Import menu system
      const { default: menuSystem } = await import("../../utils/menu-system.js")
      
      // Get user info with multiple fallbacks
      const userInfo = {
        name: m.pushName || m.name || m.notify || m.verifiedName || "User",
        id: m.sender,
      }
      
      // Additional safety check - if still no name, try to get from contact
      if (!userInfo.name || userInfo.name === "User") {
        try {
          // Try to get name from sender ID
          const senderNumber = m.sender?.replace('@s.whatsapp.net', '') || 'Unknown'
          userInfo.name = `User ${senderNumber.slice(-4)}` // Use last 4 digits as fallback
        } catch (e) {
          userInfo.name = "User"
        }
      }
      
      // Generate group menu
      const menuText = await menuSystem.generateCategoryMenu("groupmenu", userInfo, m.isCreator || false)
      
      // Send menu with group-specific styling
      await sock.sendMessage(m.chat, {
        text: menuText,
        contextInfo: {
          externalAdReply: {
            title: "👥 Group Menu",
            body: m.isGroup ? "Group Management Commands" : "Group Commands (Use in Groups)",
            thumbnailUrl: "https://i.imgur.com/placeholder.jpg",
            sourceUrl: "https://github.com/yourusername/bot",
            mediaType: 1,
            renderLargerThumbnail: false,
          },
        },
      })
      
      return { success: true }
    } catch (error) {
      console.error("[GroupMenu] Error:", error)
      await sock.sendMessage(m.chat, { text: "❌ Error loading group menu. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" })
      return { success: false, error: error.message }
    }
  },
}