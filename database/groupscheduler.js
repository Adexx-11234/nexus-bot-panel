import { GroupQueries } from "../database/query.js"
import { createComponentLogger } from "../utils/logger.js"
import moment from "moment-timezone"

const logger = createComponentLogger("GROUP-SCHEDULER")
const TIMEZONE = "Africa/Lagos"

export class GroupScheduler {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    this.checkInterval = 10000 // Check every 10 seconds
    this.isRunning = false
    this.intervalId = null
    this.lastCheckedMinute = null // Track last checked minute to prevent duplicate triggers
  }

  start() {
    if (this.isRunning) {
      logger.warn("Scheduler already running")
      return
    }

    logger.info(`Starting group scheduler with timezone: ${TIMEZONE}`)
    this.isRunning = true
    
    // Run immediately on start
    this.checkScheduledGroups()
    
    // Then run every 10 seconds
    this.intervalId = setInterval(() => {
      this.checkScheduledGroups()
    }, this.checkInterval)
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.isRunning = false
    logger.info("Stopped group scheduler")
  }

  async checkScheduledGroups() {
    try {
      const groups = await GroupQueries.getGroupsWithScheduledTimes()
      
      if (groups.length === 0) {
        return
      }

      const currentTime = moment.tz(TIMEZONE)
      const currentMinute = currentTime.format("HH:mm") // Only compare hour:minute
      
      // Prevent duplicate triggers in the same minute
      if (this.lastCheckedMinute === currentMinute) {
        return
      }
      this.lastCheckedMinute = currentMinute
      
      logger.info(`[Scheduler] Checking ${groups.length} groups at ${currentTime.format("HH:mm:ss")} (Lagos time)`)

      for (const group of groups) {
        await this.processGroup(group, currentMinute, currentTime)
      }
    } catch (error) {
      logger.error("Error checking scheduled groups:", error)
    }
  }

  async processGroup(group, currentMinute, currentTime) {
    try {
      // Extract HH:mm from scheduled times (remove seconds)
      const scheduledCloseMinute = group.scheduled_close_time 
        ? group.scheduled_close_time.substring(0, 5) // "23:00:00" -> "23:00"
        : null
      
      const scheduledOpenMinute = group.scheduled_open_time 
        ? group.scheduled_open_time.substring(0, 5) // "08:00:00" -> "08:00"
        : null

      const shouldClose = scheduledCloseMinute && 
                         currentMinute === scheduledCloseMinute &&
                         !group.is_closed

      const shouldOpen = scheduledOpenMinute && 
                        currentMinute === scheduledOpenMinute &&
                        group.is_closed

      if (shouldClose) {
        logger.info(`[Scheduler] Time to CLOSE group ${group.jid}`)
        logger.info(`  Current: ${currentMinute}, Scheduled: ${scheduledCloseMinute}, Is Closed: ${group.is_closed}`)
        await this.closeGroup(group.jid)
      } else if (shouldOpen) {
        logger.info(`[Scheduler] Time to OPEN group ${group.jid}`)
        logger.info(`  Current: ${currentMinute}, Scheduled: ${scheduledOpenMinute}, Is Closed: ${group.is_closed}`)
        await this.openGroup(group.jid)
      }
    } catch (error) {
      logger.error(`Error processing group ${group.jid}:`, error)
    }
  }

  /**
   * Get all active sessions from session manager
   */
  getAllActiveSessions() {
    try {
      // Check if sessionManager has activeSockets (Map)
      if (this.sessionManager.activeSockets && this.sessionManager.activeSockets instanceof Map) {
        return this.sessionManager.activeSockets
      }
      
      // Check if sessionManager has getAllSessions method
      if (typeof this.sessionManager.getAllSessions === 'function') {
        const sessions = this.sessionManager.getAllSessions()
        if (sessions && typeof sessions[Symbol.iterator] === 'function') {
          return sessions
        }
      }
      
      // Fallback: try to iterate activeSockets as object
      if (this.sessionManager.activeSockets && typeof this.sessionManager.activeSockets === 'object') {
        return new Map(Object.entries(this.sessionManager.activeSockets))
      }
      
      logger.error('Cannot get sessions from sessionManager - no valid method found')
      return new Map()
    } catch (error) {
      logger.error('Error getting active sessions:', error)
      return new Map()
    }
  }

async closeGroup(groupJid) {
    try {
      logger.info(`[Scheduler] Attempting to close group: ${groupJid}`)

      // STEP 1: Get group settings to find who set the schedule
      const groupSettings = await GroupQueries.getGroupSettings(groupJid)
      
      if (!groupSettings?.telegram_id) {
        logger.error(`❌ No telegram_id found for group ${groupJid} - cannot determine which session to use`)
        return
      }

      // STEP 2: Use ONLY the session that set the schedule
      const sessionId = `session_${groupSettings.telegram_id}`
      const sock = this.sessionManager.getSession(sessionId)
      
      if (!sock || !sock.user) {
        logger.error(`❌ Session ${sessionId} not available or not connected`)
        return
      }

      // STEP 3: Close the group using ONLY that session
      try {
        await sock.groupSettingUpdate(groupJid, 'announcement')
        
        // Update database
        await GroupQueries.updateGroupSettings(groupJid, { is_closed: true })
        
        const currentTime = moment.tz(TIMEZONE).format("hh:mm A")
        
        await sock.sendMessage(groupJid, {
          text: `🔒 *Scheduled Group Close*\n\n` +
                `Group has been automatically closed at ${currentTime}.\n` +
                `Only admins can send messages now.\n\n` +
                `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        })
        
        logger.info(`✅ Successfully closed group ${groupJid} via session ${sessionId}`)
      } catch (error) {
        logger.error(`❌ Failed to close group ${groupJid} via session ${sessionId}: ${error.message}`)
      }
    } catch (error) {
      logger.error(`Error closing group ${groupJid}:`, error)
    }
  }

  async openGroup(groupJid) {
    try {
      logger.info(`[Scheduler] Attempting to open group: ${groupJid}`)

      // STEP 1: Get group settings to find who set the schedule
      const groupSettings = await GroupQueries.getGroupSettings(groupJid)
      
      if (!groupSettings?.telegram_id) {
        logger.error(`❌ No telegram_id found for group ${groupJid} - cannot determine which session to use`)
        return
      }

      // STEP 2: Use ONLY the session that set the schedule
      const sessionId = `session_${groupSettings.telegram_id}`
      const sock = this.sessionManager.getSession(sessionId)
      
      if (!sock || !sock.user) {
        logger.error(`❌ Session ${sessionId} not available or not connected`)
        return
      }

      // STEP 3: Open the group using ONLY that session
      try {
        await sock.groupSettingUpdate(groupJid, 'not_announcement')
        
        // Update database
        await GroupQueries.updateGroupSettings(groupJid, { is_closed: false })
        
        const currentTime = moment.tz(TIMEZONE).format("hh:mm A")
        
        await sock.sendMessage(groupJid, {
          text: `🔓 *Scheduled Group Open*\n\n` +
                `Group has been automatically opened at ${currentTime}.\n` +
                `All members can now send messages.\n\n` +
                `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        })
        
        logger.info(`✅ Successfully opened group ${groupJid} via session ${sessionId}`)
      } catch (error) {
        logger.error(`❌ Failed to open group ${groupJid} via session ${sessionId}: ${error.message}`)
      }
    } catch (error) {
      logger.error(`Error opening group ${groupJid}:`, error)
    }
  }

  static parseTime(timeString) {
    const cleaned = timeString.toLowerCase().trim()
    
    const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*)?(am|pm)?$/)
    
    if (!match) {
      throw new Error("Invalid time format. Use: 11pm, 11:30pm, or 23:00")
    }

    let hours = parseInt(match[1])
    const minutes = match[2] ? parseInt(match[2]) : 0
    const period = match[3]

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new Error("Invalid time values")
    }

    if (period) {
      if (period === 'pm' && hours !== 12) {
        hours += 12
      } else if (period === 'am' && hours === 12) {
        hours = 0
      }
    }

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`
  }

  static formatTimeForDisplay(timeString) {
    const [hours, minutes] = timeString.split(':')
    const time = moment.tz(TIMEZONE).set({ hour: parseInt(hours), minute: parseInt(minutes), second: 0 })
    return time.format("hh:mm A")
  }

  static getCurrentTime() {
    return moment.tz(TIMEZONE)
  }
}