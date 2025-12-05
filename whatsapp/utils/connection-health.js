import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("CONNECTION_HEALTH")

/**
 * ConnectionHealthMonitor
 * Monitors WebSocket health and implements self-ping mechanism
 */
export class ConnectionHealthMonitor {
  constructor(sessionManager) {
    this.sessionManager = sessionManager

    this.sessionActivity = new Map() // sessionId -> { lastActivity, lastPong, failedPings, monitorStarted }
    this.healthCheckIntervals = new Map() // sessionId -> intervalId

    // Config
    this.HEALTH_CHECK_INTERVAL = 30 * 1000 // Check every 30 seconds
    this.INACTIVITY_THRESHOLD = 30 * 60 * 1000 // 30 minutes no activity
    this.PING_TIMEOUT = 15 * 1000 // 15 seconds to respond
    this.MAX_FAILED_PINGS = 3 // Reconnect after 3 failed pings

    logger.info("ConnectionHealthMonitor initialized")
  }

  /**
   * Start monitoring a session
   */
  startMonitoring(sessionId, sock) {
    // Stop existing monitoring if any
    this.stopMonitoring(sessionId)

    const now = Date.now()

    this.sessionActivity.set(sessionId, {
      lastActivity: now,
      lastPong: now,
      failedPings: 0,
      monitorStarted: now,
    })

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
    logger.debug(`Stopped health monitoring for ${sessionId}`)
  }

  /**
   * Record activity for a session (call this on every message/event received)
   */
  recordActivity(sessionId) {
    const data = this.sessionActivity.get(sessionId)
    if (data) {
      data.lastActivity = Date.now()
      data.failedPings = 0 // Reset failed pings on activity
    } else {
      this.sessionActivity.set(sessionId, {
        lastActivity: Date.now(),
        lastPong: Date.now(),
        failedPings: 0,
        monitorStarted: Date.now(),
      })
    }
  }

  /**
   * Check health of a session
   */
  async _checkHealth(sessionId, sock) {
    try {
      // Check if socket is still valid
      if (!sock || !sock.ws) {
        logger.warn(`Socket not available for ${sessionId}, skipping health check`)
        return
      }

      // Check WebSocket ready state (1 = OPEN)
      if (sock.ws.readyState !== 1) {
        logger.warn(`Socket not ready for ${sessionId} (state: ${sock.ws.readyState}), skipping health check`)
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
        await this._sendSelfPing(sessionId, sock)
      }
    } catch (error) {
      logger.error(`Health check error for ${sessionId}:`, error.message)
    }
  }

  /**
   * Send a self-ping message using user's prefix
   */
  async _sendSelfPing(sessionId, sock) {
    try {
      const userJid = sock.user?.id
      if (!userJid) {
        logger.error(`No user JID for ${sessionId}`)
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
          // Send ping command with user's prefix
          const pingCommand = `${prefix}ping`
          await sock.sendMessage(userJid, {
            text: pingCommand,
          })

          logger.info(`Sent self-ping to ${sessionId} with command: ${pingCommand}`)

          // Set timeout to check for pong
          setTimeout(() => {
            this._checkPingResponse(sessionId, sock)
          }, this.PING_TIMEOUT)
        } catch (error) {
          logger.error(`Failed to send ping command for ${sessionId}:`, error.message)
          this._handlePingFailure(sessionId, sock)
        }
      }, 1000)
    } catch (error) {
      logger.error(`Self-ping error for ${sessionId}:`, error.message)
      this._handlePingFailure(sessionId, sock)
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
  _checkPingResponse(sessionId, sock) {
    const data = this.sessionActivity.get(sessionId)
    if (!data) return

    const now = Date.now()

    // If activity recorded after we sent ping, connection is alive
    if (now - data.lastActivity < this.PING_TIMEOUT) {
      logger.info(`Ping successful for ${sessionId}, connection alive`)
      data.failedPings = 0
      return
    }

    // No response - increment failure count
    this._handlePingFailure(sessionId, sock)
  }

  /**
   * Handle ping failure
   */
  async _handlePingFailure(sessionId, sock) {
    const data = this.sessionActivity.get(sessionId)
    if (!data) return

    data.failedPings = (data.failedPings || 0) + 1

    logger.warn(`Ping failed for ${sessionId} (${data.failedPings}/${this.MAX_FAILED_PINGS})`)

    if (data.failedPings >= this.MAX_FAILED_PINGS) {
      logger.error(`Max ping failures reached for ${sessionId}, triggering reconnect`)

      // Notify user
      try {
        const userJid = sock.user?.id
        if (userJid) {
          await sock
            .sendMessage(userJid, {
              text: `🔄 *Connection Lost*\n\nReconnecting to WhatsApp...\nPlease wait.`,
            })
            .catch(() => {})
        }
      } catch (e) {
        // Ignore notification errors
      }

      // Trigger reconnection
      await this._triggerReconnect(sessionId)
    } else {
      // Try another ping after 5 seconds
      logger.info(`Retrying ping for ${sessionId}`)
      setTimeout(() => {
        if (sock && sock.ws?.readyState === 1) {
          this._sendSelfPing(sessionId, sock)
        }
      }, 5000)
    }
  }

  /**
   * Trigger session reconnection
   */
  async _triggerReconnect(sessionId) {
    try {
      this.stopMonitoring(sessionId)

      if (!this.sessionManager) {
        logger.error(`No session manager for ${sessionId}`)
        return
      }

      // Get session data
      const session = await this.sessionManager.storage?.getSession(sessionId)
      if (!session) {
        logger.error(`No session data for ${sessionId}`)
        return
      }

      // Disconnect current socket
      const sock = this.sessionManager.activeSockets?.get(sessionId)
      if (sock) {
        try {
          sock.ws?.close()
        } catch (e) {
          // Ignore close errors
        }
      }

      // Wait a bit then reconnect
      setTimeout(async () => {
        try {
          await this.sessionManager.createSession(
            session.userId,
            session.phoneNumber,
            session.callbacks || {},
            true, // isReconnect
            session.source || "telegram",
            false,
          )
          logger.info(`Reconnection triggered for ${sessionId}`)
        } catch (error) {
          logger.error(`Reconnection failed for ${sessionId}:`, error.message)
        }
      }, 3000)
    } catch (error) {
      logger.error(`Trigger reconnect error for ${sessionId}:`, error.message)
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
   * Get count of active sessions
   */
  getActiveCount() {
    return this.sessionActivity.size
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
