import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries } from "../../database/query.js"

const log = createComponentLogger("WELCOME")

export default {
  name: "Welcome Settings",
  description: "Enable/disable welcome messages for new members and promotions",
  commands: ["welcome"],
  category: "group",
      permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage:
    "• `.welcome on` - Enable welcome messages\n• `.welcome off` - Disable welcome messages\n• `.welcome status` - Check welcome status",
  
  async execute(sock, sessionId, args, m) {
    // Add debug logging at the start
    log.info(`[WELCOME] Command triggered by ${m.sender} with args: ${JSON.stringify(args)}`)
    
    try {
      
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