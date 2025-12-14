// ==================== UPDATED ConnectionHealthMonitor ====================
// File: whatsapp/utils/health-monitor.js

import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("CONNECTION_HEALTH")

/**
 * ConnectionHealthMonitor with deduplication and single entry point
 */
export class ConnectionHealthMonitor {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    this.sessionActivity = new Map()
    this.healthCheckIntervals = new Map()
    this.monitoringLocks = new Set() // Prevent duplicate monitoring

    // Configuration - ADJUSTED for stability
    this.HEALTH_CHECK_INTERVAL = 180 * 1000 // 3 minutes
    this.INACTIVITY_THRESHOLD = 45 * 60 * 1000 // 45 minutes
    this.PING_TIMEOUT = 60 * 1000 // 60 seconds
    this.MAX_FAILED_PINGS = 3
    this.MAX_CONCURRENT_PINGS = 5

    // Ping queue management
    this.pingQueue = []
    this.activePings = 0
    this.processingQueue = false

    this.globalHealthInterval = null
    this._startGlobalHealthCheck()

    logger.info("ConnectionHealthMonitor initialized with deduplication")
  }

  // ==================== SINGLE ENTRY POINT ====================

  /**
   * ✅ ONLY PUBLIC METHOD - All monitoring starts here
   * This is the ONLY place that should call startMonitoring
   */
  startMonitoring(sessionId, sock) {
    // ✅ CRITICAL: Prevent duplicates with multiple checks
    
    // Check 1: Already locked?
    if (this.monitoringLocks.has(sessionId)) {
      logger.debug(`[DEDUPE] Monitoring already locked for ${sessionId}`)
      return false
    }

    // Check 2: Already has interval?
    if (this.healthCheckIntervals.has(sessionId)) {
      logger.debug(`[DEDUPE] Health check interval already exists for ${sessionId}`)
      return false
    }

    // Check 3: Socket validation
    if (!sock || !sock.ws) {
      logger.warn(`[DEDUPE] Cannot start monitoring - socket not ready for ${sessionId}`)
      return false
    }

    // ✅ All checks passed - START monitoring
    logger.info(`✅ Starting health monitoring for ${sessionId}`)
    
    // Lock immediately to prevent race conditions
    this.monitoringLocks.add(sessionId)

    const now = Date.now()
    this.sessionActivity.set(sessionId, {
      lastActivity: now,
      lastPong: now,
      failedPings: 0,
      monitorStarted: now,
    })

    const intervalId = setInterval(() => {
      this._checkHealth(sessionId, sock)
    }, this.HEALTH_CHECK_INTERVAL)

    this.healthCheckIntervals.set(sessionId, intervalId)
    
    return true
  }

  /**
   * Stop monitoring - cleans up all state
   */
  stopMonitoring(sessionId) {
    const intervalId = this.healthCheckIntervals.get(sessionId)
    if (intervalId) {
      clearInterval(intervalId)
      this.healthCheckIntervals.delete(sessionId)
    }
    
    this.sessionActivity.delete(sessionId)
    this.monitoringLocks.delete(sessionId) // Release lock
    
    // Remove from ping queue if present
    this.pingQueue = this.pingQueue.filter(item => item.sessionId !== sessionId)
    
    logger.debug(`Stopped health monitoring for ${sessionId}`)
  }

  /**
   * Record activity (with deduplication)
   */
  recordActivity(sessionId) {
    const data = this.sessionActivity.get(sessionId)
    if (data) {
      data.lastActivity = Date.now()
      data.failedPings = 0
    }
  }

  // ==================== GLOBAL HEALTH CHECK ====================

  _startGlobalHealthCheck() {
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
      15 * 60 * 1000, // Every 15 minutes
    )

    logger.info("Global health check started (every 15 minutes)")
  }

  async _performGlobalHealthCheck() {
    if (!this.sessionManager?.activeSockets) return

    const activeSockets = this.sessionManager.activeSockets
    let checkedCount = 0
    let issuesFound = 0

    for (const [sessionId, sock] of activeSockets.entries()) {
      try {
        checkedCount++

        if (!sock || !sock.ws || !sock.user) {
          issuesFound++
          continue
        }

        // ✅ ONLY start if not already monitoring
        if (!this.healthCheckIntervals.has(sessionId) && !this.monitoringLocks.has(sessionId)) {
          logger.info(`[GlobalCheck] Starting missing health monitoring for ${sessionId}`)
          this.startMonitoring(sessionId, sock) // Will be deduplicated by startMonitoring itself
        }
      } catch (error) {
        logger.error(`[GlobalCheck] Error checking ${sessionId}:`, error.message)
      }
    }

    if (checkedCount > 0) {
      logger.debug(`[GlobalCheck] Checked ${checkedCount} sessions, found ${issuesFound} issues`)
    }
  }

  // ==================== SESSION MONITORING ====================

  startMonitoring(sessionId, sock) {
    // CRITICAL FIX: Check if already monitoring
    if (this.monitoringLocks.has(sessionId)) {
      logger.debug(`Monitoring already active for ${sessionId} - skipping duplicate`)
      return
    }

    // CRITICAL FIX: Check if interval already exists
    if (this.healthCheckIntervals.has(sessionId)) {
      logger.debug(`Health check interval already exists for ${sessionId} - skipping duplicate`)
      return
    }

    if (!sock || !sock.ws) {
      logger.warn(`Cannot start monitoring for ${sessionId} - socket not ready`)
      return
    }

    // Lock to prevent duplicates
    this.monitoringLocks.add(sessionId)

    const now = Date.now()
    this.sessionActivity.set(sessionId, {
      lastActivity: now,
      lastPong: now,
      failedPings: 0,
      monitorStarted: now,
    })

    const intervalId = setInterval(() => {
      this._checkHealth(sessionId, sock)
    }, this.HEALTH_CHECK_INTERVAL)

    this.healthCheckIntervals.set(sessionId, intervalId)
    logger.info(`Started health monitoring for ${sessionId}`)
  }

  stopMonitoring(sessionId) {
    const intervalId = this.healthCheckIntervals.get(sessionId)
    if (intervalId) {
      clearInterval(intervalId)
      this.healthCheckIntervals.delete(sessionId)
    }
    this.sessionActivity.delete(sessionId)
    this.monitoringLocks.delete(sessionId) // Release lock
    
    // Remove from ping queue if present
    this.pingQueue = this.pingQueue.filter(item => item.sessionId !== sessionId)
    
    logger.debug(`Stopped health monitoring for ${sessionId}`)
  }

  recordActivity(sessionId) {
    const data = this.sessionActivity.get(sessionId)
    if (data) {
      data.lastActivity = Date.now()
      data.failedPings = 0
    } else {
      this.sessionActivity.set(sessionId, {
        lastActivity: Date.now(),
        lastPong: Date.now(),
        failedPings: 0,
        monitorStarted: Date.now(),
      })
    }
  }

  // ==================== HEALTH CHECKING ====================

  async _checkHealth(sessionId, sock) {
    try {
      if (!sock) {
        logger.warn(`Socket not available for ${sessionId}, stopping health check`)
        this.stopMonitoring(sessionId)
        return
      }

      // Get fresh socket reference
      const currentSock = this.sessionManager?.activeSockets?.get(sessionId)
      if (currentSock !== sock) {
        logger.warn(`Socket reference stale for ${sessionId}, using current socket`)
        sock = currentSock
        if (!sock) {
          this.stopMonitoring(sessionId)
          return
        }
      }

      // Validate socket
      if (!sock.ws || !sock.user) {
        logger.warn(`WebSocket not available for ${sessionId}`)
        await this._handleDeadSocket(sessionId)
        return
      }

      // Check activity
      const data = this.sessionActivity.get(sessionId)
      if (!data) {
        logger.warn(`No tracking data for ${sessionId}, re-initializing`)
        this.recordActivity(sessionId)
        return
      }

      const now = Date.now()
      const timeSinceActivity = now - data.lastActivity

      // NEW: Queue ping instead of sending immediately
      if (timeSinceActivity > this.INACTIVITY_THRESHOLD) {
        logger.info(`Queueing ping for ${sessionId} (inactive ${Math.round(timeSinceActivity / 60000)}min)`)
        this._queuePing(sessionId, sock)
      }
    } catch (error) {
      logger.error(`Health check error for ${sessionId}:`, error.message)
    }
  }

  // ==================== PING QUEUE MANAGEMENT ====================

  _queuePing(sessionId, sock) {
    // Check if already in queue
    const alreadyQueued = this.pingQueue.some(item => item.sessionId === sessionId)
    if (alreadyQueued) {
      logger.debug(`Ping already queued for ${sessionId}`)
      return
    }

    this.pingQueue.push({
      sessionId,
      sock,
      queuedAt: Date.now()
    })

    // Start processing if not already running
    if (!this.processingQueue) {
      this._processPingQueue()
    }
  }

  async _processPingQueue() {
    if (this.processingQueue) return
    
    this.processingQueue = true

    try {
      while (this.pingQueue.length > 0) {
        // Wait if at max concurrent pings
        while (this.activePings >= this.MAX_CONCURRENT_PINGS) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }

        const item = this.pingQueue.shift()
        if (!item) break

        // Check if item is still valid (not too old)
        const age = Date.now() - item.queuedAt
        if (age > 5 * 60 * 1000) { // 5 minutes max queue time
          logger.warn(`Ping for ${item.sessionId} too old, skipping`)
          continue
        }

        // Send ping without blocking
        this._sendSelfPingQueued(item.sessionId, item.sock)
          .catch(err => logger.error(`Queued ping failed for ${item.sessionId}:`, err))

        // Small delay between pings
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    } finally {
      this.processingQueue = false
    }
  }

  async _sendSelfPingQueued(sessionId, sock) {
    this.activePings++
    
    try {
      await this._sendSelfPing(sessionId, sock, false)
    } finally {
      this.activePings--
    }
  }

  // ==================== PING MECHANISM ====================

  async _sendSelfPing(sessionId, sock, isVerification = false) {
    try {
      const userJid = sock.user?.id
      if (!userJid) {
        logger.error(`No user JID for ${sessionId}`)
        if (!isVerification) this._handlePingFailure(sessionId, sock)
        return "No user JID"
      }

      const prefix = await this._getUserPrefix(sessionId)
      const data = this.sessionActivity.get(sessionId)
      if (data) data.lastPingAttempt = Date.now()

      // Send warning message
      try {
        await sock.sendMessage(userJid, {
          text: `*Connection Health Check*\n\nNo activity detected. Testing connection...`,
        })
      } catch (warningError) {
        logger.warn(`Failed to send warning for ${sessionId}:`, warningError.message)
      }

      // Wait before ping command
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const pingCommand = `${prefix}ping`
      
      try {
        await sock.sendMessage(userJid, { text: pingCommand })
        logger.info(`Sent ping to ${sessionId}`)

        if (isVerification) return true

        // Schedule response check
        setTimeout(() => {
          this._checkPingResponse(sessionId, sock)
        }, this.PING_TIMEOUT)

        return true
      } catch (error) {
        logger.error(`Failed to send ping for ${sessionId}:`, error.message)
        
        if (!isVerification) {
          this._handlePingFailure(sessionId, sock)
        }
        
        return error.message || "Send failed"
      }
    } catch (error) {
      logger.error(`Self-ping error for ${sessionId}:`, error.message)
      if (!isVerification) this._handlePingFailure(sessionId, sock)
      return error.message || "Send failed"
    }
  }

  _checkPingResponse(sessionId, sock) {
    const data = this.sessionActivity.get(sessionId)
    if (!data) return

    const now = Date.now()

    if (now - data.lastActivity < this.PING_TIMEOUT) {
      logger.info(`Ping successful for ${sessionId}`)
      data.failedPings = 0
      return
    }

    this._handlePingFailure(sessionId, sock)
  }

  async _handlePingFailure(sessionId, sock) {
    const data = this.sessionActivity.get(sessionId)
    if (!data) return

    data.failedPings = (data.failedPings || 0) + 1
    logger.warn(`Ping failed for ${sessionId} (${data.failedPings}/${this.MAX_FAILED_PINGS})`)

    if (data.failedPings >= this.MAX_FAILED_PINGS) {
      logger.error(`Max ping failures for ${sessionId}, triggering reconnect`)

      try {
        const userJid = sock.user?.id
        if (userJid) {
          await sock.sendMessage(userJid, {
            text: `🔄 *Reconnecting*\n\nConnection lost. Reconnecting...`,
          }).catch(() => {})
        }
      } catch (e) {
        // Ignore
      }

      await this._triggerReconnect(sessionId)
    } else {
      logger.info(`Retrying ping for ${sessionId} in 10 seconds`)
      setTimeout(() => {
        if (sock && sock.ws) {
          this._queuePing(sessionId, sock) // Use queue instead of direct send
        }
      }, 10000)
    }
  }

  // ==================== SOCKET VERIFICATION ====================

  async _verifySocketWithPing(sessionId, sock) {
    try {
      if (!sock || !sock.user?.id) {
        logger.warn(`[VerifyPing] No socket or user for ${sessionId}`)
        return false
      }

      logger.info(`[VerifyPing] Attempting first ping for ${sessionId}`)

      // First attempt
      const firstPing = await this._sendSelfPing(sessionId, sock, true)
      if (firstPing === true) {
        logger.info(`[VerifyPing] First ping successful for ${sessionId}`)
        return true
      }

      const firstError = firstPing || "Send failed"
      logger.warn(`[VerifyPing] First ping failed for ${sessionId}: ${firstError}`)

      // Check for connection closed
      if (typeof firstError === "string" && firstError.toLowerCase().includes("connection closed")) {
        logger.info(`[VerifyPing] Connection closed detected, attempting reinitialization for ${sessionId}`)
        await this._reinitializeSocket(sessionId)
        return false
      }

      // Wait 10 seconds and retry
      await new Promise((resolve) => setTimeout(resolve, 10000))

      logger.info(`[VerifyPing] Attempting second ping for ${sessionId}`)
      const secondPing = await this._sendSelfPing(sessionId, sock, true)

      if (secondPing === true) {
        logger.info(`[VerifyPing] Second ping successful for ${sessionId}`)
        return true
      }

      const secondError = secondPing || "Send failed"
      logger.error(`[VerifyPing] Second ping failed for ${sessionId}: ${secondError}`)

      // Check for connection closed again
      if (typeof secondError === "string" && secondError.toLowerCase().includes("connection closed")) {
        logger.info(`[VerifyPing] Connection closed on retry, attempting reinitialization for ${sessionId}`)
        await this._reinitializeSocket(sessionId)
      }

      return false
    } catch (error) {
      logger.error(`[VerifyPing] Unexpected error for ${sessionId}: ${error.message}`)
      return false
    }
  }

  // ==================== RECONNECTION ====================

  async _handleDeadSocket(sessionId) {
    try {
      logger.warn(`Handling dead socket for ${sessionId}`)
      this.stopMonitoring(sessionId)

      await this.sessionManager?.storage?.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: "disconnected",
      }).catch(() => {})

      this.sessionManager?.activeSockets?.delete(sessionId)
      await this._triggerReconnect(sessionId)
    } catch (error) {
      logger.error(`Error handling dead socket for ${sessionId}:`, error.message)
    }
  }

  async _reinitializeSocket(sessionId) {
    try {
      logger.info(`[Reinitialize] Starting socket reinitialization for ${sessionId}`)

      if (!this.sessionManager) {
        logger.error(`[Reinitialize] No session manager available`)
        return false
      }

      const session = await this.sessionManager.storage?.getSession(sessionId)
      if (!session) {
        logger.error(`[Reinitialize] No session data found for ${sessionId}`)
        return false
      }

      this.sessionManager.activeSockets?.delete(sessionId)
      this.stopMonitoring(sessionId)
      this.sessionManager.voluntarilyDisconnected?.delete(sessionId)

      logger.info(`[Reinitialize] Recreating session for ${sessionId}`)

      const newSock = await this.sessionManager.createSession(
        session.userId || session.telegramId,
        session.phoneNumber,
        session.callbacks || {},
        true,
        session.source || "telegram",
        false,
      )

      if (newSock) {
        logger.info(`[Reinitialize] Successfully reinitialized ${sessionId}`)
        return true
      } else {
        logger.error(`[Reinitialize] Failed to create new socket for ${sessionId}`)
        return false
      }
    } catch (error) {
      logger.error(`[Reinitialize] Error for ${sessionId}: ${error.message}`)
      return false
    }
  }

  async _triggerReconnect(sessionId) {
    try {
      this.stopMonitoring(sessionId)

      if (!this.sessionManager) {
        logger.error(`No session manager for ${sessionId}`)
        return
      }

      const session = await this.sessionManager.storage?.getSession(sessionId)
      if (!session) {
        logger.error(`No session data for ${sessionId}`)
        return
      }

      // Notify user
      if (session.source === "telegram" && this.sessionManager.telegramBot) {
        const telegramId = sessionId.replace("session_", "")
        try {
          await this.sessionManager.telegramBot.sendMessage(
            telegramId,
            `*Connection Lost*\n\nAttempting to reconnect...`,
            { parse_mode: "Markdown" },
          )
        } catch (notifyError) {
          logger.error(`Failed to send reconnect notification: ${notifyError.message}`)
        }
      }

      // Cleanup current socket
      const sock = this.sessionManager.activeSockets?.get(sessionId)
      if (sock) {
        try {
          sock.ws?.close()
        } catch (e) {
          // Ignore
        }
      }

      this.sessionManager.activeSockets?.delete(sessionId)

      // Reconnect after delay
      setTimeout(async () => {
        try {
          this.sessionManager.voluntarilyDisconnected?.delete(sessionId)

          await this.sessionManager.createSession(
            session.userId || session.telegramId,
            session.phoneNumber,
            session.callbacks || {},
            true,
            session.source || "telegram",
            false,
          )
          logger.info(`Reconnection triggered for ${sessionId}`)
        } catch (error) {
          logger.error(`Reconnection failed for ${sessionId}: ${error.message}`)
        }
      }, 5000)
    } catch (error) {
      logger.error(`Trigger reconnect error for ${sessionId}: ${error.message}`)
    }
  }

  // ==================== UTILITY METHODS ====================

  async _getUserPrefix(sessionId) {
    try {
      const telegramId = sessionId.replace("session_", "")
      const { UserQueries } = await import("../../database/query.js")
      const settings = await UserQueries.getUserSettings(telegramId)
      const prefix = settings?.custom_prefix || "."
      return prefix === "none" ? "" : prefix
    } catch (error) {
      logger.error("Error getting user prefix:", error.message)
      return "."
    }
  }

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

  getActiveCount() {
    return this.sessionActivity.size
  }

  shutdown() {
    if (this.globalHealthInterval) {
      clearInterval(this.globalHealthInterval)
      this.globalHealthInterval = null
    }

    for (const [sessionId, intervalId] of this.healthCheckIntervals.entries()) {
      clearInterval(intervalId)
    }
    
    this.healthCheckIntervals.clear()
    this.sessionActivity.clear()
    logger.info("ConnectionHealthMonitor shutdown complete")
  }
}

// ==================== SINGLETON ====================

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