import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("SETWARN")

export default {
  name: "setwarn",
  aliases: ["setwarning", "warnlimit", "setlimit"],
  category: "groupmenu",
  description: "Set warning limit before kick (3-10 warnings)",
  usage: "setwarn <3-10> or setwarn status",
  cooldown: 5,
  adminOnly: true,

  async execute(sock, sessionId, args, m) {
    if (!m.isGroup) {
      await sock.sendMessage(m.chat, {
        text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, m.chat, m.sender)
    
    if (!isAdmin) {
      await sock.sendMessage(m.chat, {
        text: "❌ Only group admins can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    const action = args[0]?.toLowerCase()

    try {
      // Show current status
      if (!action || action === "status") {
        const settings = await GroupQueries.getGroupSettings(m.chat)
        const currentLimit = settings?.warning_limit || 4
        const warningStats = await WarningQueries.getWarningStats(m.chat, "manual")

        await sock.sendMessage(m.chat, {
          text: `⚙️ *Warning System Settings*\n\n` +
                `Current Limit: ${currentLimit} warnings\n` +
                `Active Warnings: ${warningStats.totalUsers} users\n` +
                `Total Warnings: ${warningStats.totalWarnings}\n\n` +
                `*Usage:*\n` +
                `• \`.setwarn 3\` - Set to 3 warnings\n` +
                `• \`.setwarn 5\` - Set to 5 warnings\n` +
                `• \`.setwarn 10\` - Set to 10 warnings\n` +
                `• \`.setwarn status\` - Show this info\n\n` +
                `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return
      }

      // Set new warning limit
      const newLimit = parseInt(action)
      
      if (isNaN(newLimit)) {
        await sock.sendMessage(m.chat, {
          text: "❌ Invalid number! Please provide a number between 3 and 10.\n\n" +
                "Example: `.setwarn 5`\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      if (newLimit < 3 || newLimit > 10) {
        await sock.sendMessage(m.chat, {
          text: "❌ Warning limit must be between 3 and 10!\n\n" +
                "*Recommended values:*\n" +
                "• 3 warnings - Strict enforcement\n" +
                "• 4 warnings - Balanced (default)\n" +
                "• 5-7 warnings - Lenient\n" +
                "• 8-10 warnings - Very lenient\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Ensure group exists in database
      await GroupQueries.ensureGroupExists(m.chat)

      // Update warning limit
      await GroupQueries.updateGroupSettings(m.chat, {
        warning_limit: newLimit
      })

      // Get warning statistics
      const warningStats = await WarningQueries.getWarningStats(m.chat, "manual")

      await sock.sendMessage(m.chat, {
        text: `✅ Warning limit updated successfully!\n\n` +
              `New Limit: ${newLimit} warnings\n` +
              `Current Active Warnings: ${warningStats.totalUsers} users\n\n` +
              `ℹ️ Users will be kicked after receiving ${newLimit} warnings.\n\n` +
              `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      // Log the change
      logger.info(`Warning limit changed to ${newLimit} in group ${m.chat}`)

    } catch (error) {
      logger.error("Error in setwarn command:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Failed to update warning limit! Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  }
}