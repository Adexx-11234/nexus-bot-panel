import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("GROUPONLY")

export default {
  name: "GroupOnly",
  description: "Control bot responses in groups - enable/disable group commands",
  commands: ["grouponly", "go"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.grouponly on` - Enable bot responses in group\n• `.grouponly off` - Disable bot responses in group\n• `.grouponly status` - Check current status",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    if (!m.isGroup) {
      return { response: "❌ This command can only be used in groups!" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
    }

    // Check if user is admin or bot owner
    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
    
    // Check bot owner
    let isBotOwner = false
    try {
      if (sock?.user?.id && m.sender) {
        let botUserId = sock.user.id
        if (botUserId.includes(':')) {
          botUserId = botUserId.split(':')[0]
        }
        if (botUserId.includes('@')) {
          botUserId = botUserId.split('@')[0]
        }

        let userNumber = m.sender
        if (userNumber.includes(':')) {
          userNumber = userNumber.split(':')[0]
        }
        if (userNumber.includes('@')) {
          userNumber = userNumber.split('@')[0]
        }

        isBotOwner = botUserId === userNumber
      }
    } catch (error) {
      logger.error("Error checking bot owner:", error)
    }
    
    logger.info(`[GroupOnly] User: ${m.sender}, isAdmin: ${isAdmin}, isBotOwner: ${isBotOwner}`)
    
    if (!isAdmin && !isBotOwner) {
      return { response: "❌ Only group admins or bot owner can use this command!" }
    }

    try {
      switch (action) {
        case "on":
          await GroupQueries.setGroupOnly(groupJid, true)
          return {
            response:
              "✅ *Group Commands Enabled!*\n\n" +
              "🤖 Bot will now respond to commands in this group\n" +
              "👑 Admins and bot owner can use all commands\n" +
              "👥 Regular users can use basic commands" +
               `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }

        case "off":
          await GroupQueries.setGroupOnly(groupJid, false)
          return {
            response:
              "❌ *Group Commands Disabled!*\n\n" +
              "🔇 Bot will not respond to commands in this group\n" +
              "💡 Use `.grouponly on` to re-enable commands" +
               `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }

        case "status":
          const status = await GroupQueries.isGroupOnlyEnabled(groupJid)
          return {
            response:
              `🤖 *Group Commands Status*\n\n` +
              `Status: ${status ? "✅ Enabled" : "❌ Disabled"}\n` +
              `Group: ${groupJid}\n\n` +
              `${status ? 
                "Bot is responding to commands in this group" : 
                "Bot is not responding to commands in this group"}` +
                 `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }

        default:
          const currentStatus = await GroupQueries.isGroupOnlyEnabled(groupJid)
          return {
            response:
              "🤖 *GroupOnly Commands*\n\n" +
              "• `.grouponly on` - Enable group commands\n" +
              "• `.grouponly off` - Disable group commands\n" +
              "• `.grouponly status` - Check current status\n\n" +
              `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}\n\n` +
              "💡 When disabled, bot won't respond to any commands except this one" +
               `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }
      }
    } catch (error) {
      logger.error("Error in grouponly command:", error)
      return { response: "❌ Error managing group command settings" }
    }
  }
}