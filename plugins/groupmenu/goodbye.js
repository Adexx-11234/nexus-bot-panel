// ==================================================================================
// GOODBYE COMMAND
// ==================================================================================
import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries } from "../../database/query.js"

const goodbyeLog = createComponentLogger("GOODBYE")

export default {
  name: "Goodbye Settings",
  description: "Enable/disable goodbye messages when members leave or are removed",
  commands: ["goodbye", "left"],
  category: "group",
  permissions: {
    adminRequired: true, // User must be group admin (only applies in groups)
    botAdminRequired: false, // Bot doesn't need admin for this
    groupOnly: true, // Can only be used in groups
  },
  usage:
    "• `.goodbye on` - Enable goodbye messages\n• `.goodbye off` - Disable goodbye messages\n• `.goodbye status` - Check goodbye status",

  async execute(sock, sessionId, args, m) {
    try {
      const action = args[0]?.toLowerCase()
      switch (action) {
        case "on":
          goodbyeLog.info(`[GOODBYE] Enabling goodbye for group: ${m.chat}`)
          await GroupQueries.setAntiCommand(m.chat, "goodbye", true)
          await sock.sendMessage(
            m.chat,
            {
              text: "👋💙 *Goodbye messages enabled!*\n\nMembers who leave will receive farewell messages.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            },
            { quoted: m },
          )
          goodbyeLog.info(`[GOODBYE] Successfully enabled goodbye for group: ${m.chat}`)
          break

        case "off":
          goodbyeLog.info(`[GOODBYE] Disabling goodbye for group: ${m.chat}`)
          await GroupQueries.setAntiCommand(m.chat, "goodbye", false)
          await sock.sendMessage(
            m.chat,
            {
              text: "👋 Goodbye messages disabled.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            },
            { quoted: m },
          )
          goodbyeLog.info(`[GOODBYE] Successfully disabled goodbye for group: ${m.chat}`)
          break

        case "status":
          goodbyeLog.info(`[GOODBYE] Checking status for group: ${m.chat}`)
          const goodbyeStatus = await GroupQueries.isAntiCommandEnabled(m.chat, "goodbye")
          goodbyeLog.info(`[GOODBYE] Status result: ${goodbyeStatus}`)
          await sock.sendMessage(
            m.chat,
            {
              text: `👋 Goodbye Status\n\nStatus: ${goodbyeStatus ? "✅ Enabled" : "❌ Disabled"}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            },
            { quoted: m },
          )
          break

        default:
          goodbyeLog.info(`[GOODBYE] Showing usage (no valid action provided)`)
          await sock.sendMessage(
            m.chat,
            {
              text: "• `.goodbye on` - Enable goodbye messages\n• `.goodbye off` - Disable goodbye messages\n• `.goodbye status` - Check goodbye status\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            },
            { quoted: m },
          )
      }
    } catch (error) {
      goodbyeLog.error("Error in goodbye command:", error)
      goodbyeLog.error("Error stack:", error.stack)
      await sock.sendMessage(m.chat, { text: "❌ Error managing goodbye settings\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
    }
  },
}
