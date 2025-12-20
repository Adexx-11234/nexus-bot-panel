import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("CONNECTION_HEALTH")

/**
 * ConnectionHealthMonitor - Optimized for 150+ sessions
 * 
 * PURPOSE:
 * - Check for partial/stale sessions every 5 minutes (not constantly)
 * - Reinitialize sessions with no user JID
 * - Send self-ping for inactive but healthy sessions
 * - NO duplicate health monitoring (handlers already do it)
 */
export class ConnectionHealthMonitor {
  constructor(sessionManager) {
    this.sessionManager = sessionManager

    this.sessionActivity = new Map()
    this.healthCheckIntervals = new Map()
    this.activeMonitoredSessions = new Set()
    this.staleCheckInterval = null

  this.reinitializingNow = new Set() // ✅ ADD THIS LINE

  // Config
  this.HEALTH_CHECK_INTERVAL = 60 * 1000 // ✅ CHANGED: 60 seconds instead of 30
  this.STALE_CHECK_INTERVAL = 10 * 60 * 1000 // ✅ CHANGED: 10 minutes instead of 5
  this.INACTIVITY_THRESHOLD = 30 * 60 * 1000
  this.REINIT_COOLDOWN = 60000 // ✅ ADD THIS LINE
  this.MAX_FAILED_PINGS = 3

  this.lastReinitAttempts = new Map() // ✅ ADD THIS LINE

    // ✅ Start periodic stale session checker
    this._startStaleSessionChecker()

    logger.info("ConnectionHealthMonitor initialized (stale check: every 5 minutes)")
  }

  /**
   * ✅ NEW: Periodic checker for stale/partial sessions (every 5 minutes)
   */
  _startStaleSessionChecker() {
    this.staleCheckInterval = setInterval(async () => {
      await this._checkForStalePartialSessions()
    }, this.STALE_CHECK_INTERVAL)

    logger.info("✅ Stale session checker started (runs every 5 minutes)")
  }

  /**
   * ✅ NEW: Check all active sessions for stale/partial state
   */
  async _checkForStalePartialSessions() {
    try {
      const activeSockets = Array.from(this.sessionManager.activeSockets.entries())
      
      if (activeSockets.length === 0) {
        return
      }

      logger.info(`🔍 Checking ${activeSockets.length} sessions for stale/partial state...`)

      let partialCount = 0
      let staleCount = 0

      for (const [sessionId, sock] of activeSockets) {
  try {
    // ✅ Skip if already reinitializing
    if (this.reinitializingNow.has(sessionId)) {
      logger.debug(`⏭️ Skipping ${sessionId} - already reinitializing`)
      continue
    }

    // ✅ Skip if reconnection in progress
    const eventDispatcher = this.sessionManager.getEventDispatcher()
    const connectionHandler = eventDispatcher?.connectionEventHandler
    
    if (connectionHandler && !connectionHandler.canReinitialize(sessionId)) {
      logger.debug(`⏭️ Skipping ${sessionId} - reconnection handler active`)
      continue
    }

    const hasUserJid = !!sock?.user?.id
    const readyState = sock?.ws?.socket?._readyState
    const isOpen = readyState === 1

    // Only reinit if genuinely stale/partial
    if (!hasUserJid) {
      partialCount++
      logger.warn(`🚨 Partial session detected: ${sessionId} (no user JID)`)
      await this._reinitializeSession(sessionId)
      continue
    }

    if (hasUserJid && !isOpen) {
      staleCount++
      logger.warn(`🚨 Stale session detected: ${sessionId} (readyState: ${readyState})`)
      await this._reinitializeSession(sessionId)
      continue
    }

  } catch (error) {
    logger.error(`Error checking ${sessionId}:`, error.message)
  }
}

      if (partialCount > 0 || staleCount > 0) {
        logger.info(`✅ Stale check complete: ${partialCount} partial, ${staleCount} stale - triggered reinitialization`)
      } else {
        logger.info(`✅ Stale check complete: All ${activeSockets.length} sessions healthy`)
      }

    } catch (error) {
      logger.error("Error in stale session checker:", error)
    }
  }

  /**
   * Start monitoring a session for inactivity
   */
  startMonitoring(sessionId, sock) {
    if (this.activeMonitoredSessions.has(sessionId)) {
      logger.debug(`Already monitoring ${sessionId}`)
      return
    }

    this.stopMonitoring(sessionId)

    const now = Date.now()

    this.sessionActivity.set(sessionId, {
      lastActivity: now,
      monitorStarted: now,
      failedPings: 0,
    })

    this.activeMonitoredSessions.add(sessionId)

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
   * Record activity for a session
   */
  recordActivity(sessionId) {
    const data = this.sessionActivity.get(sessionId)
    if (data) {
      data.lastActivity = Date.now()
      data.failedPings = 0
    } else {
      this.sessionActivity.set(sessionId, {
        lastActivity: Date.now(),
        monitorStarted: Date.now(),
        failedPings: 0,
      })
    }
  }

  /**
   * Check health - only for inactivity ping test
   */
  async _checkHealth(sessionId, sock) {
    try {
      const currentSock = this.sessionManager.activeSockets?.get(sessionId) || sock

      if (!currentSock?.ws) {
        logger.warn(`Socket not available for ${sessionId}, stopping health check`)
        this.stopMonitoring(sessionId)
        return
      }

      // ✅ Stale/partial checks are now done by periodic checker (every 5 min)
      // This only checks for inactivity

      const data = this.sessionActivity.get(sessionId)
      if (!data) {
        return
      }

      const now = Date.now()
      const timeSinceActivity = now - data.lastActivity

      // If no activity for 30 minutes, do a self-ping
      if (timeSinceActivity > this.INACTIVITY_THRESHOLD) {
        logger.info(`No activity for ${Math.round(timeSinceActivity / 60000)}min on ${sessionId}, sending self-ping`)
        await this._sendSelfPing(sessionId, currentSock, data)
      }
    } catch (error) {
      logger.error(`Health check error for ${sessionId}:`, error.message)
    }
  }

  /**
   * ✅ OPTIMIZED: Reinitialize session with longer wait time
   */
  async _reinitializeSession(sessionId) {
  // ✅ CRITICAL: Check if already reinitializing
  if (this.reinitializingNow.has(sessionId)) {
    logger.info(`⏭️ Already reinitializing ${sessionId} - skipping duplicate`)
    return false
  }

  // ✅ Check cooldown period
  const lastAttempt = this.lastReinitAttempts.get(sessionId)
  if (lastAttempt && Date.now() - lastAttempt < this.REINIT_COOLDOWN) {
    logger.info(`⏸️ ${sessionId} in cooldown period - skipping reinit`)
    return false
  }

  // ✅ CRITICAL: Check if reconnection handler is already working
  const eventDispatcher = this.sessionManager.getEventDispatcher()
  const connectionHandler = eventDispatcher?.connectionEventHandler
  
  if (connectionHandler && !connectionHandler.canReinitialize(sessionId)) {
    logger.info(`⛔ Skipping reinitialization for ${sessionId} - reconnection handler active`)
    return false
  }

  try {
    this.reinitializingNow.add(sessionId)
    this.lastReinitAttempts.set(sessionId, Date.now())
    
    logger.info(`🔄 Reinitializing session: ${sessionId}`)
    
    const session = await this.sessionManager.storage.getSession(sessionId)
    if (!session) {
      logger.error(`❌ No session data for ${sessionId}`)
      return false
    }

    // Cleanup socket first
    const sock = this.sessionManager.activeSockets.get(sessionId)
    if (sock) {
      logger.info(`🧹 Cleaning socket before reinitialization for ${sessionId}`)
      await this.sessionManager._cleanupSocket(sessionId, sock)
    }

    this.sessionManager.activeSockets.delete(sessionId)
    this.sessionManager.sessionState.delete(sessionId)

    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 2000))

    logger.info(`🔄 Starting reinitialization for ${sessionId}`)

    const newSock = await this.sessionManager.createSession(
      session.userId,
      session.phoneNumber,
      session.callbacks || {},
      true, // isReconnect
      session.source || "telegram",
      false // Don't allow pairing
    )

    if (newSock) {
      logger.info(`✅ Successfully reinitialized ${sessionId}`)
      return true
    } else {
      logger.error(`❌ Failed to reinitialize ${sessionId}`)
      return false
    }
  } catch (error) {
    logger.error(`❌ Reinitialization error for ${sessionId}:`, error)
    return false
  } finally {
    // ✅ Always remove from reinitializing set
    setTimeout(() => {
      this.reinitializingNow.delete(sessionId)
    }, 5000) // Keep flag for 5 seconds to prevent rapid retries
  }
}

  /**
   * Cleanup socket before reinitialization
   */
  async _cleanupSocketBeforeReinit(sock, sessionId) {
    try {
      logger.info(`🧹 Cleaning socket before reinitialization for ${sessionId}`)

      // Flush event buffer FIRST
      if (sock?.ev?.isBuffering?.()) {
        try {
          sock.ev.flush()
          logger.debug(`📤 Event buffer flushed for ${sessionId}`)
        } catch (flushError) {
          logger.warn(`Failed to flush buffer for ${sessionId}:`, flushError.message)
        }
      }

      // Call session manager's cleanup socket
      if (this.sessionManager._cleanupSocket) {
        await this.sessionManager._cleanupSocket(sessionId, sock)
      }

      logger.debug(`✅ Socket cleaned for reinitialization: ${sessionId}`)
    } catch (error) {
      logger.error(`Socket cleanup error for ${sessionId}:`, error)
    }
  }

  /**
   * Send a self-ping message
   */
  async _sendSelfPing(sessionId, sock, data) {
    try {
      const userJid = sock.user?.id
      
      if (!userJid) {
        logger.warn(`No user JID for ${sessionId} - will be caught on next 5min stale check`)
        return
      }

      if (!sock?.ws || sock.ws.socket?._readyState !== 1) {
        logger.warn(`Socket invalid for ${sessionId}`)
        await this._handlePingFailure(sessionId, data, sock)
        return
      }

      const prefix = await this._getUserPrefix(sessionId)

      await sock.sendMessage(userJid, {
        text: `⚠️ *Connection Health Check*\n\nNo activity detected for 30 minutes.\nTesting connection...`,
      })

      logger.info(`📤 Warning message sent to ${sessionId}`)

      await new Promise(resolve => setTimeout(resolve, 1000))

      if (!sock?.ws || sock.ws.socket?._readyState !== 1) {
        logger.warn(`Socket became invalid before ping for ${sessionId}`)
        await this._handlePingFailure(sessionId, data, sock)
        return
      }

      const pingCommand = `${prefix}ping`
      await sock.sendMessage(userJid, {
        text: pingCommand,
      })

      logger.info(`✅ Ping sent successfully to ${sessionId} - connection alive`)
      data.failedPings = 0
      data.lastActivity = Date.now()

      if (sock.ev?.isBuffering?.()) {
        sock.ev.flush()
      }

    } catch (error) {
      logger.error(`❌ Ping send failed for ${sessionId}:`, error.message)
      await this._handlePingFailure(sessionId, data, sock)
    }
  }

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

  async _handlePingFailure(sessionId, data, sock) {
    if (!data) return

    data.failedPings = (data.failedPings || 0) + 1
    logger.warn(`❌ Ping failed for ${sessionId} (${data.failedPings}/${this.MAX_FAILED_PINGS})`)

    if (data.failedPings >= this.MAX_FAILED_PINGS) {
      logger.error(`🚨 Max ping failures for ${sessionId}, will be handled on next 5min check`)
      this.stopMonitoring(sessionId)
    } else {
      logger.info(`Will retry ping for ${sessionId} in 5 seconds`)
      setTimeout(async () => {
        const currentSock = this.sessionManager.activeSockets?.get(sessionId)
        const currentData = this.sessionActivity.get(sessionId)
        
        if (currentSock?.ws && currentSock.ws.socket?._readyState === 1 && currentData) {
          await this._sendSelfPing(sessionId, currentSock, currentData)
        }
      }, 5000)
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
    return this.activeMonitoredSessions.size
  }

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

  /**
   * Cleanup on shutdown
   */
  shutdown() {
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval)
      this.staleCheckInterval = null
    }

    for (const intervalId of this.healthCheckIntervals.values()) {
      clearInterval(intervalId)
    }

    this.healthCheckIntervals.clear()
    this.sessionActivity.clear()
    this.activeMonitoredSessions.clear()

    logger.info("Health monitor shutdown complete")
  }
}

// Singleton
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