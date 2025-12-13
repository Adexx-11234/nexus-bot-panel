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

    // Config - Made intervals more aggressive for better detection
    this.HEALTH_CHECK_INTERVAL = 60 * 1000 // Check every 60 seconds (was 30s, but we do more thorough checks now)
    this.INACTIVITY_THRESHOLD = 15 * 60 * 1000 // 15 minutes no activity (was 30min)
    this.PING_TIMEOUT = 30 * 1000 // 30 seconds to respond (was 15s)
    this.MAX_FAILED_PINGS = 3 // Reconnect after 2 failed pings (was 3)
    this.SOCKET_CHECK_INTERVAL = 30 * 1000 // Check socket state every 30 seconds

    this.globalHealthInterval = null
    this._startGlobalHealthCheck()

    logger.info("ConnectionHealthMonitor initialized with aggressive settings")
  }

  _startGlobalHealthCheck() {
    // Clear any existing interval
    if (this.globalHealthInterval) {
      clearInterval(this.globalHealthInterval)
    }

    this.globalHealthInterval = setInterval(
      async () => {
        try {
          await this._performGlobalHealthCheck()
        } catch (error) {
          logger.error("Global health check error:", error.message)
        }
      },
      2 * 60 * 1000,
    ) // Every 2 minutes

    logger.info("Global health check started (every 2 minutes)")
  }

async _performGlobalHealthCheck() {
    if (!this.sessionManager?.activeSockets) {
      return
    }

    const activeSockets = this.sessionManager.activeSockets
    const now = Date.now()
    let checkedCount = 0
    let issuesFound = 0

    for (const [sessionId, sock] of activeSockets.entries()) {
      try {
        checkedCount++

        // Check if socket exists and has basic properties
        if (!sock || !sock.ws) {
          logger.warn(`[GlobalCheck] ${sessionId} has no socket or ws`)
          issuesFound++
          continue
        }

        // Check if user is authenticated
        const hasUser = !!sock?.user
        if (!hasUser) {
          logger.warn(`[GlobalCheck] ${sessionId} has socket but no user (not authenticated)`)
          issuesFound++
          continue
        }

        // IMPORTANT: Don't check readyState since it's always undefined
        // If the socket exists and has a user, assume it's potentially connected

        // Ensure health monitoring is active for this session
        if (!this.healthCheckIntervals.has(sessionId)) {
          logger.info(`[GlobalCheck] Starting missing health monitoring for ${sessionId}`)
          this.startMonitoring(sessionId, sock)
        }

        // Check activity tracking - but DON'T trigger pings
        const activity = this.sessionActivity.get(sessionId)
        if (activity) {
          const timeSinceActivity = now - activity.lastActivity

          // Only log if very inactive (more than threshold)
          if (timeSinceActivity > this.INACTIVITY_THRESHOLD * 2) {
            logger.debug(
              `[GlobalCheck] ${sessionId} very inactive for ${Math.round(timeSinceActivity / 60000)}min`,
            )
          }
        }
      } catch (error) {
        logger.error(`[GlobalCheck] Error checking ${sessionId}:`, error.message)
      }
    }

    if (checkedCount > 0) {
      logger.debug(`[GlobalCheck] Checked ${checkedCount} sessions, found ${issuesFound} issues`)
    }
  }

 /**
   * Verify socket is truly dead by sending a ping
   * Returns true if socket responds, false if it's dead
   */
  async _verifySocketWithPing(sessionId, sock) {
    try {
      if (!sock || !sock.user?.id) {
        logger.warn(`[VerifyPing] No socket or user for ${sessionId}`)
        return false
      }

      logger.info(`[VerifyPing] Attempting first ping for ${sessionId}`)

      // First attempt
      const firstPing = await this._sendSelfPing(sessionId, sock, true)
      if (firstPing) {
        logger.info(`[VerifyPing] First ping successful for ${sessionId}`)
        return true
      }

      const firstError = firstPing === false ? "Send failed" : firstPing
      logger.warn(`[VerifyPing] First ping failed for ${sessionId}: ${firstError}`)

      // Check if error is "connection closed"
      if (typeof firstError === 'string' && firstError.toLowerCase().includes('connection closed')) {
        logger.info(`[VerifyPing] Connection closed detected, attempting socket reinitialization for ${sessionId}`)
        await this._reinitializeSocket(sessionId)
        return false // Return false to remove from tracking, reinitialization will create new socket
      }

      // Wait 10 seconds and retry
      await new Promise((resolve) => setTimeout(resolve, 10000))

      logger.info(`[VerifyPing] Attempting second ping for ${sessionId}`)
      const secondPing = await this._sendSelfPing(sessionId, sock, true)
      
      if (secondPing) {
        logger.info(`[VerifyPing] Second ping successful for ${sessionId}`)
        return true
      }

      const secondError = secondPing === false ? "Send failed" : secondPing
      logger.error(`[VerifyPing] Second ping failed for ${sessionId}: ${secondError}`)

      // Check if second error is also "connection closed"
      if (typeof secondError === 'string' && secondError.toLowerCase().includes('connection closed')) {
        logger.info(`[VerifyPing] Connection closed detected on retry, attempting socket reinitialization for ${sessionId}`)
        await this._reinitializeSocket(sessionId)
      }

      return false
    } catch (error) {
      logger.error(`[VerifyPing] Unexpected error for ${sessionId}: ${error.message}`)
      return false
    }
  }

  /**
   * Reinitialize socket when connection is closed but can be recovered
   */
  async _reinitializeSocket(sessionId) {
    try {
      logger.info(`[Reinitialize] Starting socket reinitialization for ${sessionId}`)

      if (!this.sessionManager) {
        logger.error(`[Reinitialize] No session manager available for ${sessionId}`)
        return false
      }

      // Get session data
      const session = await this.sessionManager.storage?.getSession(sessionId)
      if (!session) {
        logger.error(`[Reinitialize] No session data found for ${sessionId}`)
        return false
      }

      // Remove from active sockets
      this.sessionManager.activeSockets?.delete(sessionId)
      this.stopMonitoring(sessionId)

      // Clear voluntary disconnect flag
      this.sessionManager.voluntarilyDisconnected?.delete(sessionId)

      logger.info(`[Reinitialize] Recreating session for ${sessionId}`)

      // Recreate the session
      const newSock = await this.sessionManager.createSession(
        session.userId || session.telegramId,
        session.phoneNumber,
        session.callbacks || {},
        true, // isReconnect
        session.source || "telegram",
        false, // Don't allow pairing
      )

      if (newSock) {
        logger.info(`[Reinitialize] Successfully reinitialized socket for ${sessionId}`)
        return true
      } else {
        logger.error(`[Reinitialize] Failed to create new socket for ${sessionId}`)
        return false
      }
    } catch (error) {
      logger.error(`[Reinitialize] Error reinitializing socket for ${sessionId}: ${error.message}`)
      return false
    }
  }

  /**
   * Start monitoring a session
   */
  startMonitoring(sessionId, sock) {
    // Stop existing monitoring if any
    this.stopMonitoring(sessionId)

    if (!sock || !sock.ws) {
      logger.warn(`Cannot start monitoring for ${sessionId} - socket not ready`)
      return
    }

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
      if (!sock) {
        logger.warn(`Socket not available for ${sessionId}, stopping health check`)
        this.stopMonitoring(sessionId)
        return
      }

      // Check if socket reference is stale (get fresh reference from session manager)
      const currentSock = this.sessionManager?.activeSockets?.get(sessionId)
      if (currentSock !== sock) {
        logger.warn(`Socket reference stale for ${sessionId}, using current socket`)
        sock = currentSock
        if (!sock) {
          this.stopMonitoring(sessionId)
          return
        }
      }

      // Check WebSocket state
      if (!sock.ws) {
        logger.warn(`WebSocket not available for ${sessionId}`)
        await this._handleDeadSocket(sessionId)
        return
      }

      // Check WebSocket ready state - handle undefined as potentially ready
      const readyState = sock.ws.readyState
      if (readyState !== undefined && readyState !== 1) {
        logger.warn(`Socket not ready for ${sessionId} (state: ${readyState})`)

        if (readyState === 3) {
          // CLOSED
          await this._handleDeadSocket(sessionId)
        }
        return
      }

      // Check if user is authenticated
      if (!sock.user) {
        logger.warn(`Socket has no user for ${sessionId}`)
        return
      }

      const data = this.sessionActivity.get(sessionId)
      if (!data) {
        logger.warn(`No tracking data for ${sessionId}, re-initializing`)
        this.recordActivity(sessionId)
        return
      }

      const now = Date.now()
      const timeSinceActivity = now - data.lastActivity

      // If no activity for threshold, do a self-ping
      if (timeSinceActivity > this.INACTIVITY_THRESHOLD) {
        logger.info(`No activity for ${Math.round(timeSinceActivity / 60000)}min on ${sessionId}, sending self-ping`)
        await this._sendSelfPing(sessionId, sock, false)
      }
    } catch (error) {
      logger.error(`Health check error for ${sessionId}:`, error.message)
    }
  }

  async _handleDeadSocket(sessionId) {
    try {
      logger.warn(`Handling dead socket for ${sessionId}`)

      this.stopMonitoring(sessionId)

      // Update database
      await this.sessionManager?.storage
        ?.updateSession(sessionId, {
          isConnected: false,
          connectionStatus: "disconnected",
        })
        .catch(() => {})

      // Remove from active sockets
      this.sessionManager?.activeSockets?.delete(sessionId)

      // Attempt reconnection
      await this._triggerReconnect(sessionId)
    } catch (error) {
      logger.error(`Error handling dead socket for ${sessionId}:`, error.message)
    }
  }

/**
   * Send a self-ping message using user's prefix
   * @param {string} sessionId - The session ID
   * @param {object} sock - The socket object
   * @param {boolean} isVerification - If true, just send ping without follow-up checks
   * @returns {Promise<boolean|string>} - Returns true if successful, error message string if failed
   */
  async _sendSelfPing(sessionId, sock, isVerification = false) {
    try {
      const userJid = sock.user?.id
      if (!userJid) {
        logger.error(`No user JID for ${sessionId}`)
        if (!isVerification) {
          this._handlePingFailure(sessionId, sock)
        }
        return "No user JID"
      }

      // Get user's prefix from database
      const prefix = await this._getUserPrefix(sessionId)

      const data = this.sessionActivity.get(sessionId)
      if (data) {
        data.lastPingAttempt = Date.now()
      }

      // If this is a verification ping, just send the command
      if (isVerification) {
        try {
          const pingCommand = `${prefix}ping`
          await sock.sendMessage(userJid, {
            text: pingCommand,
          })
          logger.info(`Sent verification ping to ${sessionId} with command: ${pingCommand}`)
          return true
        } catch (error) {
          logger.error(`Failed to send verification ping for ${sessionId}:`, error.message)
          return error.message || "Send failed"
        }
      }

      // Regular health check ping
      // Send warning message first
      await sock.sendMessage(userJid, {
        text: `*Connection Health Check*\n\nNo activity detected for ${Math.round(this.INACTIVITY_THRESHOLD / 60000)} minutes.\nTesting connection...`,
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
      }, 2000) // Wait 2 seconds before sending ping

      return true
    } catch (error) {
      logger.error(`Self-ping error for ${sessionId}:`, error.message)
      if (!isVerification) {
        this._handlePingFailure(sessionId, sock)
      }
      return error.message || "Send failed"
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
          this._sendSelfPing(sessionId, sock, false)
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

      const telegramId = sessionId.replace("session_", "")
      if (session.source === "telegram" && this.sessionManager.telegramBot) {
        try {
          await this.sessionManager.telegramBot.sendMessage(
            telegramId,
            `*Connection Lost*\n\nYour WhatsApp connection was lost due to inactivity.\nAttempting to reconnect automatically...\n\nIf this fails, use /connect to reconnect manually.`,
            { parse_mode: "Markdown" },
          )
        } catch (notifyError) {
          logger.error(`Failed to send reconnect notification:`, notifyError.message)
        }
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

      // Remove from active sockets
      this.sessionManager.activeSockets?.delete(sessionId)

      // Wait a bit then reconnect
      setTimeout(async () => {
        try {
          // Clear voluntary disconnect flag to allow reconnection
          this.sessionManager.voluntarilyDisconnected?.delete(sessionId)

          await this.sessionManager.createSession(
            session.userId || session.telegramId,
            session.phoneNumber,
            session.callbacks || {},
            true, // isReconnect
            session.source || "telegram",
            false, // Don't allow pairing
          )
          logger.info(`Reconnection triggered for ${sessionId}`)
        } catch (error) {
          logger.error(`Reconnection failed for ${sessionId}:`, error.message)
        }
      }, 5000) // Wait 5 seconds before reconnecting
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

  /**
   * Shutdown the health monitor
   */
  shutdown() {
    // Stop global health check
    if (this.globalHealthInterval) {
      clearInterval(this.globalHealthInterval)
      this.globalHealthInterval = null
    }

    // Stop all individual session monitors
    for (const [sessionId, intervalId] of this.healthCheckIntervals.entries()) {
      clearInterval(intervalId)
    }
    this.healthCheckIntervals.clear()
    this.sessionActivity.clear()

    logger.info("ConnectionHealthMonitor shutdown complete")
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

export function isHealthMonitorInitialized() {
  return healthMonitor !== null
}