import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries } from "../../database/query.js"
import { GroupScheduler } from "../../database/groupscheduler.js"

const logger = createComponentLogger("OPENTIME-GROUP")

export default {
  name: "Open Time Group",
  description: "Set recurring daily time to automatically open group (Africa/Lagos timezone)",
  commands: ["opentime"],
  category: "groupmenu",
        permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• `.opentime <time>` - Set daily open time (e.g., 10am, 10:00)\n• `.opentime off` - Disable scheduled open\n• `.opentime` - Show current schedule",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat


    try {


      const timeInput = args[0]

      if (!timeInput) {
        // Show current schedule
        const schedule = await GroupQueries.getGroupSchedule(groupJid)
        const currentTime = GroupScheduler.getCurrentTime().format("hh:mm A")
        
        if (schedule && schedule.scheduled_open_time) {
          const closeTimeDisplay = schedule.scheduled_close_time
            ? GroupScheduler.formatTimeForDisplay(schedule.scheduled_close_time)
            : 'Not set'
          const openTimeDisplay = GroupScheduler.formatTimeForDisplay(schedule.scheduled_open_time)
            
          await sock.sendMessage(groupJid, {
            text: `⏰ *Current Schedule (Africa/Lagos)*\n\n` +
                  `Current Time: ${currentTime}\n` +
                  `Close Time: ${closeTimeDisplay}\n` +
                  `Open Time: ${openTimeDisplay}\n` +
                  `Status: ${schedule.is_closed ? '🔒 Closed' : '🔓 Open'}\n\n` +
                  `Use \`.opentime off\` to disable\n\n` +
                  `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
        } else {
          await sock.sendMessage(groupJid, {
            text: `⏰ *Schedule Group Open*\n\n` +
                  `Current Time: ${currentTime}\n` +
                  `No scheduled open time set.\n\n` +
                  `Examples:\n` +
                  `• \`.opentime 10am\` - Open at 10:00 AM\n` +
                  `• \`.opentime 10:00\` - Open at 10:00 AM\n` +
                  `• \`.opentime 10:30am\` - Open at 10:30 AM\n\n` +
                  `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
        }
        return
      }

      // Handle disable
      if (timeInput.toLowerCase() === 'off' || timeInput.toLowerCase() === 'disable') {
        await GroupQueries.removeScheduledTimes(groupJid, 'open')
        await sock.sendMessage(groupJid, {
          text: "✅ Scheduled open time has been disabled.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
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
                `• \`.opentime 10am\`\n` +
                `• \`.opentime 10:30am\`\n` +
                `• \`.opentime 10:00\`\n\n` +
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

      // Set scheduled open time
      await GroupQueries.setScheduledOpenTime(groupJid, parsedTime)

      const displayTime = GroupScheduler.formatTimeForDisplay(parsedTime)
      const currentTime = GroupScheduler.getCurrentTime().format("hh:mm A")

      await sock.sendMessage(groupJid, {
        text: `⏰ *Scheduled Open Set!*\n\n` +
              `Current Time: ${currentTime}\n` +
              `Open Time: ${displayTime}\n\n` +
              `Group will automatically open every day at *${displayTime}* (Africa/Lagos time).\n` +
              `All members will be able to send messages after that time.\n\n` +
              `Use \`.opentime off\` to disable this schedule.\n\n` +
              `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

    } catch (error) {
      logger.error("Error setting scheduled open time:", error)
      await sock.sendMessage(groupJid, {
        text: "❌ Error setting scheduled open time. Make sure bot is admin.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  }
}