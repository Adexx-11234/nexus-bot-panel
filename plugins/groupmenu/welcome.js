import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const log = createComponentLogger("WELCOME")

export default {
  name: "Welcome Settings",
  description: "Enable/disable welcome messages for new members and promotions",
  commands: ["welcome"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.welcome on` - Enable welcome messages\n• `.welcome off` - Disable welcome messages\n• `.welcome status` - Check welcome status",
  
  async execute(sock, sessionId, args, m) {
    // Add debug logging at the start
    log.info(`[WELCOME] Command triggered by ${m.sender} with args: ${JSON.stringify(args)}`)
    
    try {
      if (!m.isGroup) {
        log.warn(`[WELCOME] Command used outside group by ${m.sender}`)
        await sock.sendMessage(m.chat, { text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }
      
      // Debug: Log group info
      log.info(`[WELCOME] Processing in group: ${m.chat}`)
      
      // Use AdminChecker like in antilink and menu
      const adminChecker = new AdminChecker()
      const isUserAdmin = await adminChecker.isGroupAdmin(sock, m.chat, m.sender)
      
      log.info(`[WELCOME] Admin check result for ${m.sender}: ${isUserAdmin}`)
      
      if (!isUserAdmin) {
        await sock.sendMessage(m.chat, { text: "❌ Sorry, this command is only for admins ❌\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }
      
      const action = args[0]?.toLowerCase()
      log.info(`[WELCOME] Action: ${action}`)
      
      switch (action) {
        case "on":
          log.info(`[WELCOME] Enabling welcome for group: ${m.chat}`)
          await GroupQueries.setAntiCommand(m.chat, "welcome", true)
          await sock.sendMessage(
            m.chat,
            {
              text: "✨ *Welcome messages enabled!*\n\nNew members and promoted admins will receive welcome messages.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            },
            { quoted: m },
          )
          log.info(`[WELCOME] Successfully enabled welcome for group: ${m.chat}`)
          break
          
        case "off":
          log.info(`[WELCOME] Disabling welcome for group: ${m.chat}`)
          await GroupQueries.setAntiCommand(m.chat, "welcome", false)
          await sock.sendMessage(
            m.chat,
            {
              text: "✨ Welcome messages disabled.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            },
            { quoted: m },
          )
          log.info(`[WELCOME] Successfully disabled welcome for group: ${m.chat}`)
          break
          
        case "status":
          log.info(`[WELCOME] Checking status for group: ${m.chat}`)
          const welcomeStatus = await GroupQueries.isAntiCommandEnabled(m.chat, "welcome")
          log.info(`[WELCOME] Status result: ${welcomeStatus}`)
          await sock.sendMessage(
            m.chat,
            {
              text: `✨ Welcome Status\n\nStatus: ${welcomeStatus ? "✅ Enabled" : "❌ Disabled"}

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            },
            { quoted: m },
          )
          break
          
        default:
          log.info(`[WELCOME] Showing usage (no valid action provided)`)
          const currentStatus = await GroupQueries.isAntiCommandEnabled(m.chat, "welcome")
          await sock.sendMessage(
            m.chat,
            {
              text: "• `.welcome on` - Enable welcome messages\n• `.welcome off` - Disable welcome messages\n• `.welcome status` - Check welcome status\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            },
            { quoted: m },
          )
      }
    } catch (error) {
      log.error("Error in welcome command:", error)
      log.error("Error stack:", error.stack)
      await sock.sendMessage(m.chat, { text: "❌ Error managing welcome settings\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
    }
  },
}