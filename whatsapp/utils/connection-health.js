import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("CONNECTION_HEALTH")

/**
 * ConnectionHealthMonitor
 * Monitors session activity and triggers health checks
 * Only monitors and triggers - does NOT handle disconnects directly
 */
export class ConnectionHealthMonitor {
  constructor(sessionManager) {
    this.sessionManager = sessionManager

    this.sessionActivity = new Map() // sessionId -> { lastActivity, monitorStarted }
    this.healthCheckIntervals = new Map() // sessionId -> intervalId
    this.activeMonitoredSessions = new Set() // Track which sessions are monitored (prevent duplicates)

    // Config
    this.HEALTH_CHECK_INTERVAL = 30 * 1000 // Check every 30 seconds
    this.INACTIVITY_THRESHOLD = 30 * 60 * 1000 // 30 minutes no activity
    this.PING_TIMEOUT = 15 * 1000 // 15 seconds to respond
    this.MAX_FAILED_PINGS = 3 // Trigger disconnect after 3 failed pings

    logger.info("ConnectionHealthMonitor initialized")
  }

  /**
   * Start monitoring a session
   */
  startMonitoring(sessionId, sock) {
    // Prevent duplicate monitoring
    if (this.activeMonitoredSessions.has(sessionId)) {
      logger.debug(`Already monitoring ${sessionId}`)
      return
    }

    // Stop existing monitoring if any (cleanup)
    this.stopMonitoring(sessionId)

    const now = Date.now()

    this.sessionActivity.set(sessionId, {
      lastActivity: now,
      monitorStarted: now,
      failedPings: 0,
    })

    this.activeMonitoredSessions.add(sessionId)

    // Start health check interval
    const intervalId = setInterval(() => {
      this._checkHealth(sessionId, sock)
    }, this.HEALTH_CHECK_INTERVAL)

    this.healthCheckIntervals.set(sessionId, intervalId)

    logger.info(`Started health monitoring for ${sessionId}`)
  }

  /**
   * Stop monitoring a session
   */
  stopMonitoring(sessionId) {
    const intervalId = this.healthCheckIntervals.get(sessionId)
    if (intervalId) {
      clearInterval(intervalId)
      this.healthCheckIntervals.delete(sessionId)
    }

    this.sessionActivity.delete(sessionId)
    this.activeMonitoredSessions.delete(sessionId)
    logger.debug(`Stopped health monitoring for ${sessionId}`)
  }

  /**
   * Record activity for a session (call this on message upsert)
   */
  recordActivity(sessionId) {
    const data = this.sessionActivity.get(sessionId)
    if (data) {
      data.lastActivity = Date.now()
      data.failedPings = 0 // Reset failed pings on activity
    } else {
      // Session not being monitored yet, initialize it
      this.sessionActivity.set(sessionId, {
        lastActivity: Date.now(),
        monitorStarted: Date.now(),
        failedPings: 0,
      })
    }
  }

  /**
   * Check health of a session
   */
  async _checkHealth(sessionId, sock) {
    try {
      // Check if socket still exists and has WebSocket
      if (!sock?.ws) {
        logger.warn(`Socket not available for ${sessionId}, stopping health check`)
        this.stopMonitoring(sessionId)
        return
      }

      const data = this.sessionActivity.get(sessionId)
      if (!data) {
        logger.warn(`No tracking data for ${sessionId}`)
        return
      }

      const now = Date.now()
      const timeSinceActivity = now - data.lastActivity

      // If no activity for 30 minutes, do a self-ping
      if (timeSinceActivity > this.INACTIVITY_THRESHOLD) {
        logger.info(`No activity for ${Math.round(timeSinceActivity / 60000)}min on ${sessionId}, sending self-ping`)
        await this._sendSelfPing(sessionId, sock, data)
      }
    } catch (error) {
      logger.error(`Health check error for ${sessionId}:`, error.message)
    }
  }

  /**
   * Send a self-ping message using user's prefix
   */
  async _sendSelfPing(sessionId, sock, data) {
    try {
      const userJid = sock.user?.id
      if (!userJid) {
        logger.error(`No user JID for ${sessionId}`)
        return
      }

      // Check if socket still valid
      if (!sock?.ws) {
        logger.warn(`Socket invalid for ${sessionId}`)
        await this._handlePingFailure(sessionId, data)
        return
      }

      // Get user's prefix from database
      const prefix = await this._getUserPrefix(sessionId)

      // Send warning message first
      await sock.sendMessage(userJid, {
        text: `⚠️ *Connection Health Check*\n\nNo activity detected for 30 minutes.\nTesting connection...`,
      })

      // Wait a bit then send ping command
      setTimeout(async () => {
        try {
          // Check socket still valid before sending ping
          if (!sock?.ws) {
            logger.warn(`Socket became invalid before ping for ${sessionId}`)
            await this._handlePingFailure(sessionId, data)
            return
          }

          // Send ping command with user's prefix
          const pingCommand = `${prefix}ping`
          await sock.sendMessage(userJid, {
            text: pingCommand,
          })

          logger.info(`Sent self-ping to ${sessionId} with command: ${pingCommand}`)

          // Set timeout to check for pong
          setTimeout(() => {
            this._checkPingResponse(sessionId, data)
          }, this.PING_TIMEOUT)
        } catch (error) {
          logger.error(`Failed to send ping command for ${sessionId}:`, error.message)
          await this._handlePingFailure(sessionId, data)
        }
      }, 1000)
    } catch (error) {
      logger.error(`Self-ping error for ${sessionId}:`, error.message)
      await this._handlePingFailure(sessionId, data)
    }
  }

  /**
   * Get user's prefix from database
   */
  async _getUserPrefix(sessionId) {
    try {
      // Extract telegram ID from session ID
      const telegramId = sessionId.replace("session_", "")

      const { UserQueries } = await import("../../database/query.js")
      const settings = await UserQueries.getUserSettings(telegramId)

      const prefix = settings?.custom_prefix || "."
      return prefix === "none" ? "" : prefix
    } catch (error) {
      logger.error("Error getting user prefix:", error.message)
      return "." // Default fallback
    }
  }

  /**
   * Check if ping got a response
   */
  _checkPingResponse(sessionId, data) {
    if (!data) return

    const now = Date.now()

    // If activity recorded after we sent ping, connection is alive
    if (now - data.lastActivity < this.PING_TIMEOUT) {
      logger.info(`Ping successful for ${sessionId}, connection alive`)
      data.failedPings = 0
      return
    }

    // No response - increment failure count
    this._handlePingFailure(sessionId, data)
  }

  /**
   * Handle ping failure
   */
  async _handlePingFailure(sessionId, data) {
    if (!data) return

    data.failedPings = (data.failedPings || 0) + 1

    logger.warn(`Ping failed for ${sessionId} (${data.failedPings}/${this.MAX_FAILED_PINGS})`)

    if (data.failedPings >= this.MAX_FAILED_PINGS) {
      logger.error(`Max ping failures reached for ${sessionId}, triggering disconnect`)

      // Stop monitoring this session
      this.stopMonitoring(sessionId)

      // Trigger disconnect through ConnectionEventHandler (status 428 = Connection Closed)
      await this._triggerHealthDisconnect(sessionId)
    } else {
      // Retry ping after 5 seconds
      logger.info(`Will retry ping for ${sessionId} in 5 seconds`)
      setTimeout(() => {
        const sock = this.sessionManager.activeSockets?.get(sessionId)
        if (sock?.ws) {
          this._sendSelfPing(sessionId, sock, data)
        } else {
          logger.warn(`Socket no longer available for retry ping: ${sessionId}`)
        }
      }, 5000)
    }
  }

  /**
   * Trigger disconnect through proper handler (don't handle directly)
   */
  async _triggerHealthDisconnect(sessionId) {
    try {
      logger.info(`Triggering health-based disconnect for ${sessionId}`)

      const sock = this.sessionManager.activeSockets?.get(sessionId)
      
      if (!sock) {
        logger.warn(`No socket found for ${sessionId}`)
        return
      }

      // Create a disconnect event (428 = Connection Closed)
      const lastDisconnect = {
        error: {
          output: {
            statusCode: 428,
            payload: {
              message: 'Connection health check failed - no activity',
            },
          },
          isBoom: true,
        },
      }

      // Let ConnectionEventHandler handle it properly
      const { ConnectionEventHandler } = await import("../events/index.js")

      if (!this.sessionManager.connectionEventHandler) {
        this.sessionManager.connectionEventHandler = new ConnectionEventHandler(this.sessionManager)
      }

      await this.sessionManager.connectionEventHandler._handleConnectionClose(
        sock,
        sessionId,
        lastDisconnect
      )

      logger.info(`Health disconnect triggered for ${sessionId}`)
    } catch (error) {
      logger.error(`Failed to trigger health disconnect for ${sessionId}:`, error.message)
    }
  }

  /**
   * Get health stats
   */
  getStats() {
    const stats = {}
    for (const [sessionId, data] of this.sessionActivity.entries()) {
      stats[sessionId] = {
        lastActivity: new Date(data.lastActivity).toISOString(),
        minutesSinceActivity: Math.round((Date.now() - data.lastActivity) / 60000),
        failedPings: data.failedPings || 0,
        isHealthy: Date.now() - data.lastActivity < this.INACTIVITY_THRESHOLD,
      }
    }
    return stats
  }

  /**
   * Get count of active monitored sessions
   */
  getActiveCount() {
    return this.activeMonitoredSessions.size
  }

  /**
   * Cleanup stale monitoring (for sessions that no longer exist)
   */
  cleanupStale() {
    const activeSockets = this.sessionManager.activeSockets
    let cleaned = 0

    for (const sessionId of this.activeMonitoredSessions) {
      if (!activeSockets.has(sessionId)) {
        this.stopMonitoring(sessionId)
        cleaned++
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} stale health monitors`)
    }
  }
}

// Singleton instance
let healthMonitor = null

export function getHealthMonitor(sessionManager) {
  if (!healthMonitor && sessionManager) {
    healthMonitor = new ConnectionHealthMonitor(sessionManager)
  }
  return healthMonitor
}

export function recordSessionActivity(sessionId) {
  if (healthMonitor) {
    healthMonitor.recordActivity(sessionId)
  }
}

export function getHealthStats() {
  if (healthMonitor) {
    return healthMonitor.getStats()
  }
  return {}
}