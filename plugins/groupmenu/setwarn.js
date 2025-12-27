import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries } from "../../database/query.js"

const logger = createComponentLogger("SETWARN")

export default {
  name: "setwarn",
  aliases: ["setwarning", "warnlimit", "setlimit"],
  category: "groupmenu",
  description: "Set manual warning limit before kick (3-10 warnings)",
  usage: "setwarn <3-10> or setwarn status",
  permissions: {
    adminRequired: true,
    botAdminRequired: true,
    groupOnly: true,
  },

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()

    try {
      // Show current status
      if (!action || action === "status") {
        const currentLimit = await GroupQueries.getAntiCommandWarningLimit(m.chat, "manual")
        const warningStats = await WarningQueries.getWarningStats(m.chat, "manual")

        return { 
          response: `⚙️ Manual Warning Settings\n\nCurrent Limit: ${currentLimit} warnings\nActive Warnings: ${warningStats.totalUsers} users\nTotal Warnings: ${warningStats.totalWarnings}\n\nUsage:\n• .setwarn 3 - Set to 3 warnings\n• .setwarn 5 - Set to 5 warnings\n• .setwarn 10 - Set to 10 warnings`
        }
      }

      // Set new warning limit
      const newLimit = parseInt(action)
      
      if (isNaN(newLimit) || newLimit < 3 || newLimit > 10) {
        return { response: "❌ Warning limit must be between 3 and 10!\n\nRecommended:\n• 3 - Strict\n• 4 - Balanced (default)\n• 5-7 - Lenient\n• 8-10 - Very lenient" }
      }

      // Update manual warning limit
      await GroupQueries.ensureGroupExists(m.chat)
      await GroupQueries.setAntiCommandWarningLimit(m.chat, "manual", newLimit)

      const warningStats = await WarningQueries.getWarningStats(m.chat, "manual")

      return { response: `✅ Manual warning limit updated!\n\nNew Limit: ${newLimit} warnings\nActive Warnings: ${warningStats.totalUsers} users\n\nℹ️ Users will be kicked after ${newLimit} warnings.` }

    } catch (error) {
      logger.error("Error in setwarn command:", error)
      return { response: "❌ Failed to update warning limit! Please try again." }
    }
  }
}