import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("CONNECTION_HEALTH")

/**
 * ConnectionHealthMonitor - Optimized for 150+ sessions
 * Checks for partial/stale sessions every 10 minutes
 * Sends self-ping for inactive sessions after 30 minutes
 */
export class ConnectionHealthMonitor {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    this.sessionActivity = new Map()
    this.healthCheckIntervals = new Map()
    this.activeMonitoredSessions = new Set()
    this.staleCheckInterval = null
    this.reinitializingNow = new Set()
    this.lastReinitAttempts = new Map()

    // Configuration
    this.HEALTH_CHECK_INTERVAL = 60 * 1000 // 60 seconds
    this.STALE_CHECK_INTERVAL = 10 * 60 * 1000 // 10 minutes
    this.INACTIVITY_THRESHOLD = 30 * 60 * 1000 // 30 minutes
    this.REINIT_COOLDOWN = 60000 // 1 minute
    this.MAX_FAILED_PINGS = 3

    this._startStaleSessionChecker()
    logger.info("ConnectionHealthMonitor initialized")
  }

  _startStaleSessionChecker() {
    this.staleCheckInterval = setInterval(async () => {
      await this._checkForStalePartialSessions()
    }, this.STALE_CHECK_INTERVAL)
  }

  async _checkForStalePartialSessions() {
    try {
      const activeSockets = Array.from(this.sessionManager.activeSockets.entries())
      
      if (activeSockets.length === 0) return

      logger.info(`Checking ${activeSockets.length} sessions...`)

      let healthyCount = 0
      let partialCount = 0

      for (const [sessionId, sock] of activeSockets) {
        try {
          const hasUserJid = !!sock?.user?.id
          const readyState = sock?.ws?.socket?._readyState
          const isOpen = readyState === 1

          if (hasUserJid && isOpen) {
            healthyCount++
          } else if (!hasUserJid) {
            partialCount++
            logger.warn(`Partial session detected: ${sessionId} - triggering cleanup`)
            
            const eventDispatcher = this.sessionManager.getEventDispatcher()
            const connectionHandler = eventDispatcher?.connectionHandler
            
            if (connectionHandler) {
              const loggedOutConfig = {
                statusCode: 401,
                message: "Session disconnected - no user information available",
                shouldReconnect: false,
                isPermanent: true
              }
              
              await connectionHandler._handlePermanentDisconnect(sessionId, 401, loggedOutConfig)
            } else {
              logger.warn(`ConnectionHandler not available, performing direct cleanup for ${sessionId}`)
              await this.sessionManager.performCompleteUserCleanup(sessionId)
            }
          }
        } catch (error) {
          logger.error(`Error checking ${sessionId}:`, error.message)
        }
      }

      logger.info(`Health check: ${healthyCount} healthy, ${partialCount} partial cleaned`)
    } catch (error) {
      logger.error("Error in health checker:", error)
    }
  }

  startMonitoring(sessionId, sock) {
    if (this.activeMonitoredSessions.has(sessionId)) return

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
    logger.info(`Started monitoring ${sessionId}`)
  }

  stopMonitoring(sessionId) {
    const intervalId = this.healthCheckIntervals.get(sessionId)
    if (intervalId) {
      clearInterval(intervalId)
      this.healthCheckIntervals.delete(sessionId)
    }

    this.sessionActivity.delete(sessionId)
    this.activeMonitoredSessions.delete(sessionId)
  }

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

  async _checkHealth(sessionId, sock) {
    try {
      const currentSock = this.sessionManager.activeSockets?.get(sessionId) || sock

      if (!currentSock?.ws) {
        this.stopMonitoring(sessionId)
        return
      }

      const data = this.sessionActivity.get(sessionId)
      if (!data) return

      const now = Date.now()
      const timeSinceActivity = now - data.lastActivity

      // Send self-ping if no activity for 30 minutes
      if (timeSinceActivity > this.INACTIVITY_THRESHOLD) {
        logger.info(`No activity for ${Math.round(timeSinceActivity / 60000)}min on ${sessionId}, sending ping`)
        await this._sendSelfPing(sessionId, currentSock, data)
      }
    } catch (error) {
      logger.error(`Health check error for ${sessionId}:`, error.message)
    }
  }

  async _reinitializeSession(sessionId) {
    if (this.reinitializingNow.has(sessionId)) {
      logger.info(`Already reinitializing ${sessionId}`)
      return false
    }

    const lastAttempt = this.lastReinitAttempts.get(sessionId)
    if (lastAttempt && Date.now() - lastAttempt < this.REINIT_COOLDOWN) {
      logger.info(`${sessionId} in cooldown period`)
      return false
    }

    const eventDispatcher = this.sessionManager.getEventDispatcher()
    const connectionHandler = eventDispatcher?.connectionEventHandler
    
    if (connectionHandler && !connectionHandler.canReinitialize(sessionId)) {
      logger.info(`Skipping reinitialization for ${sessionId} - reconnection handler active`)
      return false
    }

    try {
      this.reinitializingNow.add(sessionId)
      this.lastReinitAttempts.set(sessionId, Date.now())
      
      logger.info(`Reinitializing session: ${sessionId}`)
      
      const session = await this.sessionManager.storage.getSession(sessionId)
      if (!session) {
        logger.error(`No session data for ${sessionId}`)
        return false
      }

      const sock = this.sessionManager.activeSockets.get(sessionId)
      
      if (sock) {
        // Flush buffer before closing
        if (sock?.ev?.isBuffering?.()) {
          try {
            sock.ev.flush()
          } catch (e) {
            // Buffer flush failed
          }
        }
        
        // Close WebSocket only, preserve event listeners
        if (sock.ws?.socket && sock.ws.socket._readyState === 1) {
          sock.ws.close(1000, "Reinitialization")
        }
      }

      // Remove from tracking
      this.sessionManager.activeSockets.delete(sessionId)
      this.sessionManager.sessionState.delete(sessionId)

      await new Promise(resolve => setTimeout(resolve, 2000))

      // Create new session
      const newSock = await this.sessionManager.createSession(
        session.userId,
        session.phoneNumber,
        session.callbacks || {},
        true,
        session.source || "telegram",
        false
      )

      if (newSock) {
        logger.info(`Successfully reinitialized ${sessionId}`)
        return true
      } else {
        logger.error(`Failed to reinitialize ${sessionId}`)
        return false
      }
    } catch (error) {
      logger.error(`Reinitialization error for ${sessionId}:`, error)
      return false
    } finally {
      setTimeout(() => {
        this.reinitializingNow.delete(sessionId)
      }, 5000)
    }
  }

  async _sendSelfPing(sessionId, sock, data) {
    try {
      let userJid = sock.user?.id
      
      if (!userJid) {
        logger.warn(`No user JID for ${sessionId}`)
        return
      }
      
      // Remove device ID suffix (e.g., :0, :1, :7)
      userJid = userJid.split(':')[0]

      // Format JID properly
      if (!userJid.includes('@')) {
        userJid = userJid + '@s.whatsapp.net'
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

      logger.info(`Ping sent successfully to ${sessionId}`)
      data.failedPings = 0
      data.lastActivity = Date.now()

      if (sock.ev?.isBuffering?.()) {
        sock.ev.flush()
      }

    } catch (error) {
      logger.error(`Ping send failed for ${sessionId}:`, error.message)
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
    logger.warn(`Ping failed for ${sessionId} (${data.failedPings}/${this.MAX_FAILED_PINGS})`)

    if (data.failedPings >= this.MAX_FAILED_PINGS) {
      logger.error(`Max ping failures for ${sessionId}`)
      this.stopMonitoring(sessionId)
    } else {
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
      logger.info(`Cleaned up ${cleaned} stale health monitors`)
    }
  }

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
  return healthMonitor ? healthMonitor.getStats() : {}
}