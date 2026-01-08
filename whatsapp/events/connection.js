// ============================================================================
// connection-events.js - Connection State Management
// ============================================================================

import { createComponentLogger } from "../../utils/logger.js"
import {
  DisconnectReason,
  getDisconnectConfig,
  supports515Flow,
  getReconnectDelay,
  getMaxAttempts,
  shouldClearVoluntaryFlag,
  requiresCleanup,
  requiresNotification,
  getUserAction,
} from "./types.js"
import { Boom } from "@hapi/boom"
import { getHealthMonitor } from "../utils/index.js"

const logger = createComponentLogger("CONNECTION_EVENTS")
const ENABLE_515_FLOW = process.env.ENABLE_515_FLOW === "true"
const RECONNECTION_STALE_TIMEOUT = 120000 // 2 minutes
const NOTIFICATION_TIMEOUT = 8000

// ============================================================================
// CONNECTION EVENT HANDLER
// ============================================================================

export class ConnectionEventHandler {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    this.reconnectionLocks = new Set()
    this.healthMonitor = getHealthMonitor(sessionManager)
    this.notificationFailures = new Map()
    this.activeReconnections = new Map()

    logger.info(`🔧 Connection Handler initialized`)
    logger.info(`📋 515 Flow Mode: ${ENABLE_515_FLOW ? "ENABLED" : "DISABLED"}`)
  }

  // ============================================================================
  // RECONNECTION STATE MANAGEMENT
  // ============================================================================

  _isReconnecting(sessionId) {
    if (!this.activeReconnections.has(sessionId)) return false

    const reconnection = this.activeReconnections.get(sessionId)
    const elapsed = Date.now() - reconnection.startTime

    if (elapsed > RECONNECTION_STALE_TIMEOUT) {
      logger.warn(`⏱️ Reconnection for ${sessionId} stale (${Math.round(elapsed / 1000)}s) - clearing`)
      this.activeReconnections.delete(sessionId)
      this.reconnectionLocks.delete(sessionId)
      return false
    }

    return true
  }

  _startReconnection(sessionId, type = "standard") {
    this.activeReconnections.set(sessionId, {
      startTime: Date.now(),
      attempt: (this.activeReconnections.get(sessionId)?.attempt || 0) + 1,
      type,
    })
    this.reconnectionLocks.add(sessionId)
    logger.info(`🔄 Starting ${type} reconnection for ${sessionId}`)
  }

  _endReconnection(sessionId, success = false) {
    const reconnection = this.activeReconnections.get(sessionId)
    if (reconnection) {
      const elapsed = Date.now() - reconnection.startTime
      const status = success ? "✅" : "❌"
      logger.info(`${status} Reconnection for ${sessionId} ${success ? "succeeded" : "failed"} after ${Math.round(elapsed / 1000)}s`)
    }

    this.activeReconnections.delete(sessionId)
    this.reconnectionLocks.delete(sessionId)
  }

  canReinitialize(sessionId) {
    if (this._isReconnecting(sessionId)) {
      const reconnection = this.activeReconnections.get(sessionId)
      const elapsed = Math.round((Date.now() - reconnection.startTime) / 1000)
      logger.info(`⏭️ Skipping health reinitialization for ${sessionId} - reconnection in progress (${elapsed}s)`)
      return false
    }
    return true
  }

  cancelReconnection(sessionId) {
    if (this.activeReconnections.has(sessionId)) {
      logger.info(`🛑 Cancelling reconnection for ${sessionId}`)
      this._endReconnection(sessionId, false)
    }
  }

  // ============================================================================
  // MAIN CONNECTION CLOSE HANDLER
  // ============================================================================

  async _handleConnectionClose(sock, sessionId, lastDisconnect) {
    try {
      const isHealthTriggered = lastDisconnect?.isHealthTriggered === true

      if (isHealthTriggered) {
        logger.info(`🏥 Health-triggered disconnect detected for ${sessionId}`)
      }

      if (this.healthMonitor) {
        this.healthMonitor.stopMonitoring(sessionId)
      }

      if (this.reconnectionLocks.has(sessionId)) {
        logger.warn(`⚠️  Session ${sessionId} already has pending reconnection - skipping`)
        return
      }

      const error = lastDisconnect?.error
      const statusCode = error instanceof Boom ? error.output?.statusCode : null
      const config = getDisconnectConfig(statusCode)

      logger.warn(`📴 Session ${sessionId} disconnected`)
      logger.warn(`   Status Code: ${statusCode}`)
      logger.warn(`   Message: ${config.message}`)
      logger.warn(`   Should Reconnect: ${config.shouldReconnect}`)

      // Skip 405 entirely
      if (statusCode === 405) {
        logger.info(`⏭️  Skipping 405 disconnect for ${sessionId} - no action taken`)
        return
      }

      await this.sessionManager.storage.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: "disconnected",
      })

      // Handle special cases first
      if (supports515Flow(statusCode)) {
        return await this._handle515Flow(sessionId, statusCode, config)
      }

      if (statusCode === DisconnectReason.BAD_SESSION) {
        return await this._handleBadMac(sessionId, config)
      }

      if (shouldClearVoluntaryFlag(statusCode)) {
        this.sessionManager.voluntarilyDisconnected?.delete(sessionId)
      }

      // Route based on configuration
      if (config.isPermanent) {
        logger.info(`🛑 Session ${sessionId} - Permanent disconnect (${statusCode}): ${config.message}`)
        return await this._handlePermanentDisconnect(sessionId, statusCode, config)
      }

      if (config.shouldReconnect) {
        logger.info(`🔄 Session ${sessionId} - Reconnectable disconnect (${statusCode}): ${config.message}`)
        return await this._handleReconnectableDisconnect(sessionId, statusCode, config, sock)
      }

      logger.warn(`❓ Session ${sessionId} - Unknown disconnect handling (${statusCode})`)
      await this.sessionManager.disconnectSession(sessionId, true)
    } catch (error) {
      logger.error(`❌ Connection close handler error for ${sessionId}:`, error)
      this.reconnectionLocks.delete(sessionId)
    }
  }

  // ============================================================================
  // DISCONNECT TYPE HANDLERS
  // ============================================================================

  async _handle515Flow(sessionId, statusCode, config) {
    logger.info(`🔄 Handling ${statusCode} for ${sessionId}: ${config.message}`)

    this.sessionManager.voluntarilyDisconnected?.delete(sessionId)
    this.reconnectionLocks.add(sessionId)

    if (!this.sessionManager.sessions515Disconnect) {
      this.sessionManager.sessions515Disconnect = new Set()
    }
    this.sessionManager.sessions515Disconnect.add(sessionId)
    logger.info(`📝 Marked ${sessionId} as 515/516 disconnect`)

    if (ENABLE_515_FLOW) {
      logger.info(`[515 COMPLEX FLOW] Marking ${sessionId} for complex restart`)
      if (!this.sessionManager.sessions515Restart) {
        this.sessionManager.sessions515Restart = new Set()
      }
      this.sessionManager.sessions515Restart.add(sessionId)
    } else {
      logger.info(`[SIMPLE FLOW] ${sessionId} will reconnect normally`)
    }

    const delay = getReconnectDelay(statusCode)
    logger.info(`⏱️  Reconnecting ${sessionId} in ${delay}ms`)

    setTimeout(() => {
      this._attemptReconnection(sessionId)
        .catch((err) => logger.error(`❌ Reconnection failed for ${sessionId}:`, err))
        .finally(() => this.reconnectionLocks.delete(sessionId))
    }, delay)
  }

  async _handlePermanentDisconnect(sessionId, statusCode, config) {
    logger.info(`🛑 Handling permanent disconnect for ${sessionId}: ${config.message}`)

    switch (statusCode) {
      case DisconnectReason.LOGGED_OUT:
        await this._handleLoggedOut(sessionId, config)
        break

      case DisconnectReason.FORBIDDEN:
        await this._handleForbidden(sessionId, config)
        break

      case DisconnectReason.TIMED_OUT:
        await this._handleConnectionTimeout(sessionId, config)
        break

      default:
        if (requiresCleanup(statusCode)) {
          await this.sessionManager.performCompleteUserCleanup(sessionId)
        }
        if (requiresNotification(statusCode)) {
          await this._sendDisconnectNotification(sessionId, config)
        }
    }
  }

  async _handleReconnectableDisconnect(sessionId, statusCode, config, sock) {
    const session = await this.sessionManager.storage.getSession(sessionId)
    const attempts = session?.reconnectAttempts || 0
    const maxAttempts = getMaxAttempts(statusCode)

    if (attempts >= maxAttempts) {
      logger.warn(`⚠️  Session ${sessionId} exceeded max reconnection attempts (${attempts}/${maxAttempts})`)
      await this.sessionManager.disconnectSession(sessionId, true)
      return
    }

    await this._scheduleReconnection(sessionId, config, attempts)
  }

  // ============================================================================
  // SPECIFIC DISCONNECT HANDLERS
  // ============================================================================

  async _handleConnectionTimeout(sessionId, config) {
    try {
      logger.info(`⏱️  ${config.message} for ${sessionId}`)

      const session = await this.sessionManager.storage.getSession(sessionId)
      if (!session) {
        logger.error(`❌ No session data found for ${sessionId}`)
        return
      }

      const sock = this.sessionManager.activeSockets?.get(sessionId)
      if (sock) {
        await this._cleanupSocketBeforeReconnect(sock, sessionId)
      }

      await this.sessionManager.storage.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: "reconnecting",
      })

      await this._scheduleReconnection(sessionId, config)
      logger.info(`✅ Reconnection scheduled for ${sessionId}`)
    } catch (error) {
      logger.error(`❌ Connection timeout handler error for ${sessionId}:`, error)
    }
  }

  async _handleBadMac(sessionId, config) {
    try {
      logger.info(`🔧 ${config.message} for ${sessionId}`)

      const session = await this.sessionManager.storage.getSession(sessionId)
      if (!session) {
        logger.error(`❌ No session data found for ${sessionId}`)
        return
      }

      const sock = this.sessionManager.activeSockets?.get(sessionId)
      if (sock) {
        await this._cleanupSocketBeforeReconnect(sock, sessionId)
      }

      await this.sessionManager.storage.updateSession(sessionId, {
        isConnected: true,
        connectionStatus: "connected",
        reconnectAttempts: 0,
      })

      await this._scheduleReconnection(sessionId, config)
    } catch (error) {
      logger.error(`❌ Bad MAC handler error for ${sessionId}:`, error)
      this.reconnectionLocks.delete(sessionId)
      await this.sessionManager.performCompleteUserCleanup(sessionId)
    }
  }

  async _handleForbidden(sessionId, config) {
    try {
      logger.info(`🚫 ${config.message} for ${sessionId}`)

      await this.sessionManager.storage.getSession(sessionId)
      await this.sessionManager.performCompleteUserCleanup(sessionId)

      if (requiresNotification(config.statusCode)) {
        const notificationSent = await this._sendDisconnectNotification(sessionId, config)
        if (!notificationSent) {
          logger.error(`⚠️  Failed to notify user about ban for ${sessionId}`)
        }
      }
    } catch (error) {
      logger.error(`❌ Forbidden handler error for ${sessionId}:`, error)
    }
  }

  async _handleLoggedOut(sessionId, config) {
    try {
      logger.info(`👋 ${config.message} for ${sessionId}`)

      const session = await this.sessionManager.storage.getSession(sessionId)
      const isWebUser = session?.source === "web"

      if (isWebUser) {
        logger.info(`🌐 Web user ${sessionId} logged out - preserving PostgreSQL, deleting MongoDB`)

        await this.sessionManager.connectionManager.cleanupAuthState(sessionId)

        const sock = this.sessionManager.activeSockets.get(sessionId)
        if (sock) {
          await this.sessionManager._cleanupSocket(sessionId, sock)
        }

        this.sessionManager.activeSockets.delete(sessionId)
        this.sessionManager.sessionState.delete(sessionId)

        await this.sessionManager.storage.deleteSessionKeepUser(sessionId)

        logger.info(`✅ Web user ${sessionId} - MongoDB deleted, PostgreSQL preserved`)
      } else {
        logger.info(`📱 Telegram user ${sessionId} logged out - full cleanup`)
        await this.sessionManager.performCompleteUserCleanup(sessionId)

        if (requiresNotification(config.statusCode)) {
          await this._sendDisconnectNotification(sessionId, config)
        }
      }
    } catch (error) {
      logger.error(`❌ Logged out handler error for ${sessionId}:`, error)
    }
  }

  // ============================================================================
  // RECONNECTION LOGIC
  // ============================================================================

  async _scheduleReconnection(sessionId, config, attempts = 0) {
    this._startReconnection(sessionId, config.statusCode)
    this.reconnectionLocks.add(sessionId)

    const delay = getReconnectDelay(config.statusCode, attempts)
    const maxAttempts = getMaxAttempts(config.statusCode)

    logger.info(`🔄 Reconnecting ${sessionId} in ${delay}ms (attempt ${attempts + 1}/${maxAttempts})`)

    setTimeout(() => {
      this._attemptReconnection(sessionId)
        .catch((err) => logger.error(`❌ Reconnection failed for ${sessionId}:`, err))
        .finally(() => this.reconnectionLocks.delete(sessionId))
    }, delay)
  }

  async _attemptReconnection(sessionId) {
  try {
    const session = await this.sessionManager.storage.getSession(sessionId)

    if (!session) {
      logger.error(`❌ No session data found for ${sessionId} - performing complete cleanup`)
      
      // Clear reconnection state
      this._endReconnection(sessionId, false)
      this.reconnectionLocks.delete(sessionId)
      
      // Perform complete user cleanup
      await this.sessionManager.performCompleteUserCleanup(sessionId)
      
      return false
    }

    const newAttempts = (session.reconnectAttempts || 0) + 1
    await this.sessionManager.storage
      .updateSession(sessionId, {
        reconnectAttempts: newAttempts,
        connectionStatus: "connecting",
      })
      .catch((err) => logger.warn(`Failed to update attempts: ${err.message}`))

    logger.info(`🔄 Reconnection attempt ${newAttempts} for ${sessionId}`)

    const sock = await this.sessionManager.createSession(
      session.userId,
      session.phoneNumber,
      session.callbacks || {},
      true,
      session.source || "telegram",
      false
    )

    if (sock) {
      logger.info(`✅ Reconnection successful for ${sessionId}`)
      this._endReconnection(sessionId, true)
      return true
    }

    return false
  } catch (error) {
    logger.error(`❌ Reconnection failed for ${sessionId}:`, error)

    const session = await this.sessionManager.storage.getSession(sessionId).catch(() => null)
    
    // If session doesn't exist after error, cleanup completely
    if (!session) {
      logger.error(`❌ Session ${sessionId} no longer exists after error - performing complete cleanup`)
      
      this._endReconnection(sessionId, false)
      this.reconnectionLocks.delete(sessionId)
      
      await this.sessionManager.performCompleteUserCleanup(sessionId)
      
      return false
    }
    
    const attempts = session.reconnectAttempts || 0
    const maxAttempts = getMaxAttempts(428)

    if (attempts >= maxAttempts) {
      logger.warn(`⚠️ Session ${sessionId} exceeded max reconnection attempts (${attempts}/${maxAttempts}) - stopping`)
      this._endReconnection(sessionId, false)
      return false
    }

    const delay = getReconnectDelay(428, attempts)
    logger.info(`⏱️ Scheduling retry for ${sessionId} in ${delay}ms (attempt ${attempts + 1}/${maxAttempts})`)

    setTimeout(() => {
      if (this._isReconnecting(sessionId)) {
        this._attemptReconnection(sessionId)
      }
    }, delay)

    return false
  }
}

  // ============================================================================
  // SOCKET CLEANUP
  // ============================================================================

  async _cleanupSocketBeforeReconnect(sock, sessionId) {
    try {
      logger.info(`🧹 Cleaning socket before reconnect for ${sessionId}`)

     /* if (sock?.ev?.isBuffering?.()) {
        try {
          sock.ev.flush()
        } catch (flushError) {
          logger.warn(`Failed to flush buffer for ${sessionId}:`, flushError.message)
        }
      }*/

      if (this.sessionManager._cleanupSocket) {
        await this.sessionManager._cleanupSocket(sessionId, sock)
      }

      this.sessionManager.activeSockets?.delete(sessionId)
      this.sessionManager.sessionState?.delete(sessionId)
    } catch (error) {
      logger.error(`Socket cleanup error for ${sessionId}:`, error)
    }
  }

  // ============================================================================
  // NOTIFICATION
  // ============================================================================

  async _sendDisconnectNotification(sessionId, config) {
    try {
      const session = await this.sessionManager.storage.getSession(sessionId)

      if (session?.source !== "telegram" || !this.sessionManager.telegramBot) {
        return false
      }

      const userId = sessionId.replace("session_", "")
      const userAction = getUserAction(config.statusCode)

      let message = `⚠️ *WhatsApp Disconnected*\n\n${config.message}`

      if (session.phoneNumber) {
        message += `\n\nAccount: ${session.phoneNumber}`
      }

      if (userAction) {
        message += `\n\n${userAction}`
      }

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Notification timeout")), NOTIFICATION_TIMEOUT))

      const sendPromise = this.sessionManager.telegramBot.sendMessage(userId, message, {
        parse_mode: "Markdown",
      })

      await Promise.race([sendPromise, timeoutPromise])

      logger.info(`✅ Disconnect notification sent to ${userId}`)
      this.notificationFailures.delete(sessionId)

      return true
    } catch (error) {
      const failures = (this.notificationFailures.get(sessionId) || 0) + 1
      this.notificationFailures.set(sessionId, failures)

      logger.error(`❌ Disconnect notification failed for ${sessionId} (${failures} failures):`, error.message)

      return false
    }
  }

  // ============================================================================
  // OTHER EVENT HANDLERS
  // ============================================================================

  async handleCredsUpdate(sock, sessionId) {
    try {
      await sock.sendPresenceUpdate("unavailable").catch(() => {})
    } catch (error) {
      logger.error(`Creds update error for ${sessionId}:`, error)
    }
  }

  async handleContactsUpsert(sock, sessionId, contacts) {
    try {
      // Contact insertion handled elsewhere
    } catch (error) {
      logger.error(`Contacts upsert error:`, error)
    }
  }

  async handleContactsUpdate(sock, sessionId, updates) {
    try {
      const { getContactManager } = await import("../contacts/index.js").catch(() => ({}))

      if (getContactManager) {
        const contactManager = getContactManager()

        for (const update of updates) {
          try {
            await contactManager.updateContact(sessionId, {
              jid: update.id,
              name: update.name,
              notify: update.notify,
              verifiedName: update.verifiedName,
            })
          } catch (error) {
            logger.error(`Failed to update contact ${update.id}:`, error)
          }
        }
      }
    } catch (error) {
      logger.error(`Contacts update error:`, error)
    }
  }

  async handleChatsUpsert(sock, sessionId, chats) {
    try {
      // Chat insertion handled elsewhere
    } catch (error) {
      logger.error(`Chats upsert error:`, error)
    }
  }

  async handleChatsUpdate(sock, sessionId, updates) {
    try {
      // Chat updates handled elsewhere
    } catch (error) {
      logger.error(`Chats update error:`, error)
    }
  }

  async handleChatsDelete(sock, sessionId, deletions) {
    try {
      // Chat deletion handled elsewhere
    } catch (error) {
      logger.error(`Chats delete error:`, error)
    }
  }

  async handlePresenceUpdate(sock, sessionId, update) {
    try {
      // Presence updates handled elsewhere
    } catch (error) {
      logger.error(`Presence update error:`, error)
    }
  }
}