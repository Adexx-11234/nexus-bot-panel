import { createComponentLogger } from "../../utils/logger.js"
import { UserQueries } from "../../database/query.js"

const logger = createComponentLogger("SETPREFIX")

export default {
  name: "Set Prefix",
  description: "Set custom command prefix for your bot session",
  commands: ["setprefix"],
  aliases: ["prefix", "changeprefix"],
  category: "ownermenu",
  ownerOnly: true,
  usage: 
    "• `.setprefix <prefix>` - Set custom prefix (e.g., `.setprefix !`)\n" +
    "• `.setprefix 💡` - Use emoji as prefix\n" +
    "• `.setprefix none` - Remove prefix (all messages are commands)\n" +
    "• `.setprefix .` - Reset to default prefix",

  async execute(sock, sessionId, args, m) {
    try {
      const telegramId = m.sessionContext?.telegram_id

      if (!telegramId) {
        return {
          response: "❌ Could not identify your session.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }
      }

      // Show current prefix if no argument
      if (args.length === 0) {
        const settings = await UserQueries.getUserSettings(telegramId)
        const currentPrefix = settings?.custom_prefix || '.'
        
        const displayPrefix = currentPrefix === '' ? '(none - no prefix required)' : `'${currentPrefix}'`
        
        return {
          response: 
            `⚙️ *Current Prefix*\n\n` +
            `Your current prefix: ${displayPrefix}\n\n` +
            `*Examples:*\n` +
            `• \`.setprefix !\` - Change to !\n` +
            `• \`.setprefix 💡\` - Use emoji\n` +
            `• \`.setprefix none\` - Remove prefix\n` +
            `• \`.setprefix .\` - Reset to default\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }
      }

      // Get new prefix
      const newPrefix = args[0]

      // Validate prefix length
      if (newPrefix !== 'none' && newPrefix.length > 10) {
        return {
          response: "❌ Prefix cannot be longer than 10 characters!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }
      }

      // Update prefix in database
      await UserQueries.updateUserPrefix(telegramId, newPrefix)

      // ✅ IMMEDIATELY UPDATE IN-MEMORY CACHE (NO WAITING!)
      try {
        const { getMessageProcessor } = await import('../../whatsapp/index.js')
        const processor = await getMessageProcessor()
        processor.updatePrefixCache(telegramId, newPrefix)
        logger.info(`✅ Prefix cache updated immediately for user ${telegramId}`)
      } catch (cacheError) {
        logger.warn('Failed to update prefix cache immediately:', cacheError)
        // Continue anyway - it will be reloaded in 10 minutes
      }

      // Prepare response based on what was set
      let response = "✅ *Prefix Updated Successfully!*\n\n"

      if (newPrefix === 'none' || newPrefix === '') {
        response += 
          `New prefix: *(none)*\n\n` +
          `⚠️ All your messages will be treated as commands now!\n` +
          `Example: Just type \`ping\` (no prefix needed)\n\n` +
          `To re-enable prefix, use: \`setprefix .\`\n\n`
      } else {
        response += 
          `New prefix: \`${newPrefix}\`\n\n` +
          `*Example commands:*\n` +
          `• \`${newPrefix}ping\`\n` +
          `• \`${newPrefix}antilink on\`\n` +
          `• \`${newPrefix}menu\`\n\n` +
          `✅ *Prefix active immediately!* No restart needed.\n\n`
      }

      response += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      return { response }

    } catch (error) {
      logger.error("Error in setprefix command:", error)
      return {
        response: "❌ Error updating prefix. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }
    }
  }
}