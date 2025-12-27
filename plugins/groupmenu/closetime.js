import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries } from "../../database/query.js"
import { GroupScheduler } from "../../database/groupscheduler.js"

const logger = createComponentLogger("CLOSETIME-GROUP")

export default {
  name: "Close Time Group",
  description: "Set recurring daily time to automatically close group (Africa/Lagos timezone)",
  commands: ["closetime"],
  category: "group",
    permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• `.closetime <time>` - Set daily close time (e.g., 11pm, 23:00)\n• `.closetime off` - Disable scheduled close\n• `.closetime` - Show current schedule",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat


    try {


      const timeInput = args[0]

      if (!timeInput) {
        // Show current schedule
        const schedule = await GroupQueries.getGroupSchedule(groupJid)
        const currentTime = GroupScheduler.getCurrentTime().format("hh:mm A")
        
        if (schedule && schedule.scheduled_close_time) {
          const closeTimeDisplay = GroupScheduler.formatTimeForDisplay(schedule.scheduled_close_time)
          const openTimeDisplay = schedule.scheduled_open_time 
            ? GroupScheduler.formatTimeForDisplay(schedule.scheduled_open_time)
            : 'Not set'
            
          await sock.sendMessage(groupJid, {
            text: `⏰ *Current Schedule (Africa/Lagos)*\n\n` +
                  `Current Time: ${currentTime}\n` +
                  `Close Time: ${closeTimeDisplay}\n` +
                  `Open Time: ${openTimeDisplay}\n` +
                  `Status: ${schedule.is_closed ? '🔒 Closed' : '🔓 Open'}\n\n` +
                  `Use \`.closetime off\` to disable\n\n` +
                  `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
        } else {
          await sock.sendMessage(groupJid, {
            text: `⏰ *Schedule Group Close*\n\n` +
                  `Current Time: ${currentTime}\n` +
                  `No scheduled close time set.\n\n` +
                  `Examples:\n` +
                  `• \`.closetime 11pm\` - Close at 11:00 PM\n` +
                  `• \`.closetime 23:00\` - Close at 11:00 PM\n` +
                  `• \`.closetime 11:30pm\` - Close at 11:30 PM\n\n` +
                  `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
        }
        return
      }

      // Handle disable
      if (timeInput.toLowerCase() === 'off' || timeInput.toLowerCase() === 'disable') {
        await GroupQueries.removeScheduledTimes(groupJid, 'close')
        await sock.sendMessage(groupJid, {
          text: "✅ Scheduled close time has been disabled.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Parse and validate time
      let parsedTime
      try {
        parsedTime = GroupScheduler.parseTime(timeInput)
      } catch (error) {
        await sock.sendMessage(groupJid, {
          text: `❌ ${error.message}\n\n` +
                `Examples:\n` +
                `• \`.closetime 11pm\`\n` +
                `• \`.closetime 11:30pm\`\n` +
                `• \`.closetime 23:00\`\n\n` +
                `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return
      }

      // Ensure group exists in database
      await GroupQueries.ensureGroupExists(groupJid)

      // STORE TELEGRAM_ID: Save who set this schedule
      await GroupQueries.updateGroupSettings(groupJid, { 
        telegram_id: m.sessionContext.telegram_id 
      })

      // Set scheduled close time
      await GroupQueries.setScheduledCloseTime(groupJid, parsedTime)

      const displayTime = GroupScheduler.formatTimeForDisplay(parsedTime)
      const currentTime = GroupScheduler.getCurrentTime().format("hh:mm A")

      await sock.sendMessage(groupJid, {
        text: `⏰ *Scheduled Close Set!*\n\n` +
              `Current Time: ${currentTime}\n` +
              `Close Time: ${displayTime}\n\n` +
              `Group will automatically close every day at *${displayTime}* (Africa/Lagos time).\n` +
              `Only admins will be able to send messages after that time.\n\n` +
              `Use \`.closetime off\` to disable this schedule.\n\n` +
              `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

    } catch (error) {
      logger.error("Error setting scheduled close time:", error)
      await sock.sendMessage(groupJid, {
        text: "❌ Error setting scheduled close time. Make sure bot is admin.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  }
}