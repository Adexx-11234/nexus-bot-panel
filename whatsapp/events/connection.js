import { createComponentLogger } from "../../utils/logger.js"
import {
  DisconnectReason,
  getDisconnectConfig,
  supports515Flow,
  getReconnectDelay,
  getMaxAttempts,
  shouldClearVoluntaryFlag,
  requiresAuthClear,
  requiresCleanup,
  requiresNotification,
  getUserAction,
  getDisconnectMessage,
} from "./types.js"
import { Boom } from "@hapi/boom"
import { getHealthMonitor } from "../utils/index.js"
import { get } from "http"

const logger = createComponentLogger("CONNECTION_EVENTS")

// Toggle for 515 complex flow
const ENABLE_515_FLOW = process.env.ENABLE_515_FLOW === "true"

/**
 * ConnectionEventHandler
 * Single source of truth for all connection state management
 * Handles all disconnect reasons based on configuration from types.js
 */
export class ConnectionEventHandler {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    this.reconnectionLocks = new Set()
    this.healthMonitor = getHealthMonitor(sessionManager)
    this.notificationFailures = new Map() // Track notification failures
     // ✅ NEW: Track active reconnection attempts to prevent conflicts
     this.activeReconnections = new Map() // sessionId -> { startTime, attempt, type }

    logger.info(`🔧 Connection Handler initialized`)
    logger.info(`📋 515 Flow Mode: ${ENABLE_515_FLOW ? "ENABLED" : "DISABLED"}`)
  }

  /**
 * Check if session is currently reconnecting
 */
_isReconnecting(sessionId) {
  if (!this.activeReconnections.has(sessionId)) return false
  
  const reconnection = this.activeReconnections.get(sessionId)
  const elapsed = Date.now() - reconnection.startTime
  
  // Consider stale if reconnection takes > 2 minutes
  if (elapsed > 120000) {
    logger.warn(`⏱️ Reconnection for ${sessionId} stale (${Math.round(elapsed/1000)}s) - clearing`)
    this.activeReconnections.delete(sessionId)
    this.reconnectionLocks.delete(sessionId)
    return false
  }
  
  return true
}

/**
 * Mark start of reconnection
 */
_startReconnection(sessionId, type = 'standard') {
  this.activeReconnections.set(sessionId, {
    startTime: Date.now(),
    attempt: (this.activeReconnections.get(sessionId)?.attempt || 0) + 1,
    type
  })
  this.reconnectionLocks.add(sessionId)
  logger.info(`🔄 Starting ${type} reconnection for ${sessionId}`)
}

/**
 * Mark end of reconnection
 */
_endReconnection(sessionId, success = false) {
  const reconnection = this.activeReconnections.get(sessionId)
  if (reconnection) {
    const elapsed = Date.now() - reconnection.startTime
    const status = success ? '✅' : '❌'
    logger.info(`${status} Reconnection for ${sessionId} ${success ? 'succeeded' : 'failed'} after ${Math.round(elapsed/1000)}s`)
  }
  
  this.activeReconnections.delete(sessionId)
  this.reconnectionLocks.delete(sessionId)
}

  // ==========================================
  // MAIN CONNECTION CLOSE HANDLER
  // ==========================================

  /**
   * Handle connection close - Configuration-driven approach using types.js
   */
  async _handleConnectionClose(sock, sessionId, lastDisconnect) {
    try {

          // ✅ CRITICAL: Check if already reconnecting
    if (this._isReconnecting(sessionId)) {
      logger.warn(`⚠️ ${sessionId} already reconnecting - skipping duplicate handler`)
      return
    }

      // ✅ Check if this is a health-triggered disconnect
      const isHealthTriggered = lastDisconnect?.isHealthTriggered === true
      
      if (isHealthTriggered) {
        logger.info(`🏥 Health-triggered disconnect detected for ${sessionId}`)
      }

      // ✅ Stop health monitoring immediately
      if (this.healthMonitor) {
        this.healthMonitor.stopMonitoring(sessionId)
        logger.debug(`Health monitoring stopped for ${sessionId}`)
      }

      // Prevent duplicate reconnection attempts
      if (this.reconnectionLocks.has(sessionId)) {
        logger.warn(`⚠️  Session ${sessionId} already has pending reconnection - skipping`)
        return
      }

      // Extract disconnect reason
      const error = lastDisconnect?.error
      const statusCode = error instanceof Boom ? error.output?.statusCode : null
      
      // Get configuration from types.js
      const config = getDisconnectConfig(statusCode)

      logger.warn(`📴 Session ${sessionId} disconnected`)
      logger.warn(`   Status Code: ${statusCode}`)
      logger.warn(`   Message: ${config.message}`)
      logger.warn(`   Should Reconnect: ${config.shouldReconnect}`)
      logger.warn(`   Requires Auth Clear: ${config.requiresAuthClear || false}`)

      // ============================================================
      // SKIP 405 ENTIRELY - DO NOTHING
      // ============================================================
      if (statusCode === 405) {
        logger.info(`⏭️  Skipping 405 disconnect for ${sessionId} - no action taken`)
        return
      }

      // Update session status
      await this.sessionManager.storage.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: "disconnected",
      })

      // ============================================================
      // HANDLE RECONNECTABLE STATUS CODES (BEFORE VOLUNTARY CHECK)
      // ============================================================

      // Special handling: 515/516 with optional complex flow
      if (supports515Flow(statusCode)) {
        return await this._handle515Flow(sessionId, statusCode, config)
      }

      // ✅ Special handling: Requires auth clear (but NOT bad session)
      // This includes: 428, 440, 408, 500, 404
    /*  if (requiresAuthClear(statusCode) && statusCode !== DisconnectReason.BAD_SESSION) {
        return await this._handleAuthClearReconnect(sessionId, statusCode, config, sock)
      }*/

      // Special handling: Bad Session (uses different method)
      if (statusCode === DisconnectReason.BAD_SESSION) {
        return await this._handleBadMac(sessionId, config)
      }

      // Check if should clear voluntary disconnect flag
      if (shouldClearVoluntaryFlag(statusCode)) {
        this.sessionManager.voluntarilyDisconnected?.delete(sessionId)
      }

      // ============================================================
      // CHECK VOLUNTARY DISCONNECT (AFTER RECONNECTABLE CODES)
      // ============================================================

      const isVoluntaryDisconnect = this.sessionManager.voluntarilyDisconnected?.has(sessionId)

   /*   if (isVoluntaryDisconnect && !shouldClearVoluntaryFlag(statusCode)) {
        logger.info(`✋ Session ${sessionId} voluntarily disconnected - skipping cleanup`)
        return
      }*/

      // ============================================================
      // HANDLE BASED ON CONFIGURATION FROM TYPES.JS
      // ============================================================

      // Permanent disconnects
      if (config.isPermanent) {
        logger.info(`🛑 Session ${sessionId} - Permanent disconnect (${statusCode}): ${config.message}`)
        return await this._handlePermanentDisconnect(sessionId, statusCode, config)
      }

      // Reconnectable disconnects (without auth clear)
      if (config.shouldReconnect) {
        logger.info(`🔄 Session ${sessionId} - Reconnectable disconnect (${statusCode}): ${config.message}`)
        return await this._handleReconnectableDisconnect(sessionId, statusCode, config, sock)
      }

      // Unknown/No specific handling
      logger.warn(`❓ Session ${sessionId} - Unknown disconnect handling (${statusCode})`)
      await this.sessionManager.disconnectSession(sessionId, true)
    } catch (error) {
      logger.error(`❌ Connection close handler error for ${sessionId}:`, error)
      this.reconnectionLocks.delete(sessionId)
    }
  }

  // ==========================================
  // ✅ NEW: AUTH CLEAR + RECONNECT HANDLER
  // ==========================================

  /**
   * Handle disconnects that require auth clear before reconnect
   * Includes: 428, 440, 408, 500, 404
   */
  async _handleAuthClearReconnect(sessionId, statusCode, config, sock) {
    try {
      logger.info(`🔧 ${config.message} for ${sessionId} - clearing auth`)

      const session = await this.sessionManager.storage.getSession(sessionId)
      if (!session) {
        logger.error(`❌ No session data found for ${sessionId}`)
        return
      }

      // ✅ Clean up socket first
      if (sock) {
        await this._cleanupSocketBeforeReconnect(sock, sessionId)
      }

      // ✅ Clear auth storage but preserve creds
     // await this._clearAuthStorageKeepCreds(sessionId)

      // Update session status
      await this.sessionManager.storage.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: "disconnected",
        reconnectAttempts: 0,
      })

      // ✅ Clear voluntary disconnect flag if needed
      if (shouldClearVoluntaryFlag(statusCode)) {
        this.sessionManager.voluntarilyDisconnected?.delete(sessionId)
      }

      // ✅ Schedule reconnection
      await this._scheduleReconnection(sessionId, config)
    } catch (error) {
      logger.error(`❌ Auth clear reconnect handler error for ${sessionId}:`, error)
      this.reconnectionLocks.delete(sessionId)
      await this.sessionManager.performCompleteUserCleanup(sessionId)
    }
  }

  // ==========================================
  // 515/516 FLOW HANDLER
  // ==========================================

  /**
   * Handle 515/516 disconnect with optional complex flow
   */
  async _handle515Flow(sessionId, statusCode, config) {
    logger.info(`🔄 Handling ${statusCode} for ${sessionId}: ${config.message}`)

    // Clear voluntary disconnect flag
    this.sessionManager.voluntarilyDisconnected?.delete(sessionId)

    // Lock to prevent duplicates
    this.reconnectionLocks.add(sessionId)

    // ✅ ALWAYS track 515/516 disconnects (regardless of flow mode)
    if (!this.sessionManager.sessions515Disconnect) {
      this.sessionManager.sessions515Disconnect = new Set()
    }
    this.sessionManager.sessions515Disconnect.add(sessionId)
    logger.info(`📝 Marked ${sessionId} as 515/516 disconnect`)

    // Mark for complex flow if enabled
    if (ENABLE_515_FLOW) {
      logger.info(`[515 COMPLEX FLOW] Marking ${sessionId} for complex restart`)

      if (!this.sessionManager.sessions515Restart) {
        this.sessionManager.sessions515Restart = new Set()
      }
      this.sessionManager.sessions515Restart.add(sessionId)
    } else {
      logger.info(`[SIMPLE FLOW] ${sessionId} will reconnect normally`)
    }

    // Schedule reconnection using config
    const delay = getReconnectDelay(statusCode)
    logger.info(`⏱️  Reconnecting ${sessionId} in ${delay}ms`)

    setTimeout(() => {
      this._attemptReconnection(sessionId)
        .catch((err) => logger.error(`❌ Reconnection failed for ${sessionId}:`, err))
        .finally(() => {
          this.reconnectionLocks.delete(sessionId)
        })
    }, delay)
  }

  // ==========================================
  // PERMANENT DISCONNECT HANDLER
  // ==========================================

  /**
   * Handle permanent disconnects using types.js config
   */
  async _handlePermanentDisconnect(sessionId, statusCode, config) {
    logger.info(`🛑 Handling permanent disconnect for ${sessionId}: ${config.message}`)

    // Route to specific handler based on status code
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
        // Generic permanent disconnect
        if (requiresCleanup(statusCode)) {
          await this.sessionManager.performCompleteUserCleanup(sessionId)
        }

        if (requiresNotification(statusCode)) {
          await this._sendDisconnectNotification(sessionId, config)
        }
    }
  }

  // ==========================================
  // RECONNECTABLE DISCONNECT HANDLER
  // ==========================================

  /**
   * Handle reconnectable disconnects using types.js config
   * ✅ Clean socket BEFORE reconnection
   */
  async _handleReconnectableDisconnect(sessionId, statusCode, config, sock) {
    // Check reconnection attempts
    const session = await this.sessionManager.storage.getSession(sessionId)
    const attempts = session?.reconnectAttempts || 0
    const maxAttempts = getMaxAttempts(statusCode)

    if (attempts >= maxAttempts) {
      logger.warn(`⚠️  Session ${sessionId} exceeded max reconnection attempts (${attempts}/${maxAttempts})`)
      await this.sessionManager.disconnectSession(sessionId, true)
      return
    }

    // ✅ Clean socket FIRST before reconnection
    if (sock) {
      await this._cleanupSocketBeforeReconnect(sock, sessionId)
    }

    // Lock and schedule reconnection
    await this._scheduleReconnection(sessionId, config, attempts)
  }

  // ==========================================
  // ✅ UNIFIED RECONNECTION SCHEDULER
  // ==========================================

  /**
   * Schedule reconnection attempt with proper cleanup and delay
   */
  async _scheduleReconnection(sessionId, config, attempts = 0) {
    this._startReconnection(sessionId, config.statusCode)
    this.reconnectionLocks.add(sessionId)

    const delay = getReconnectDelay(config.statusCode, attempts)
    const maxAttempts = getMaxAttempts(config.statusCode)
    
    logger.info(`🔄 Reconnecting ${sessionId} in ${delay}ms (attempt ${attempts + 1}/${maxAttempts})`)

    setTimeout(() => {
      this._attemptReconnection(sessionId)
        .catch((err) => logger.error(`❌ Reconnection failed for ${sessionId}:`, err))
        .finally(() => {
          this.reconnectionLocks.delete(sessionId)
        })
    }, delay)
  }

  // ==========================================
  // ✅ SOCKET CLEANUP BEFORE RECONNECT
  // ==========================================

  /**
   * Clean socket properly before reconnection attempt
   * Includes buffer flushing and proper event cleanup
   */
  async _cleanupSocketBeforeReconnect(sock, sessionId) {
    try {
      logger.info(`🧹 Cleaning socket before reconnect for ${sessionId}`)

      // ✅ Flush event buffer FIRST
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

      // Remove from active sockets
      this.sessionManager.activeSockets?.delete(sessionId)
      this.sessionManager.sessionState?.delete(sessionId)

      logger.debug(`✅ Socket cleaned for ${sessionId}`)
    } catch (error) {
      logger.error(`Socket cleanup error for ${sessionId}:`, error)
    }
  }

  // ==========================================
  // SPECIFIC DISCONNECT HANDLERS
  // ==========================================

  /**
   * Handle connection timeout (408) - Uses types.js config
   */
  /**
 * Handle connection timeout (408) - RECONNECT instead of cleanup
 */
async _handleConnectionTimeout(sessionId, config) {
  try {
    logger.info(`⏱️  ${config.message} for ${sessionId}`)

    // ✅ REMOVED: Complete cleanup
    // ✅ ADDED: Just reconnect
    
    const session = await this.sessionManager.storage.getSession(sessionId)
    if (!session) {
      logger.error(`❌ No session data found for ${sessionId}`)
      return
    }
      const sock = this.sessionManager.activeSockets?.get(sessionId)
      if (sock) {
        await this._cleanupSocketBeforeReconnect(sock, sessionId)
      }
    // Update status
    await this.sessionManager.storage.updateSession(sessionId, {
      isConnected: false,
      connectionStatus: "reconnecting",
    })

    // Schedule reconnection
    await this._scheduleReconnection(sessionId, config)

    logger.info(`✅ Reconnection scheduled for ${sessionId}`)
  } catch (error) {
    logger.error(`❌ Connection timeout handler error for ${sessionId}:`, error)
  }
}

  /**
   * Handle bad MAC/session error (500) - Uses types.js config
   */
  async _handleBadMac(sessionId, config) {
    try {
      logger.info(`🔧 ${config.message} for ${sessionId}`)

      const session = await this.sessionManager.storage.getSession(sessionId)
      if (!session) {
        logger.error(`❌ No session data found for ${sessionId}`)
        return
      }

      // Clean up socket
      const sock = this.sessionManager.activeSockets?.get(sessionId)
      if (sock) {
        await this._cleanupSocketBeforeReconnect(sock, sessionId)
      }

      // Clear auth storage but preserve creds
     // await this._clearAuthStorageKeepCreds(sessionId)

      // Update session status
      await this.sessionManager.storage.updateSession(sessionId, {
        isConnected: true,
        connectionStatus: "connected",
        reconnectAttempts: 0,
      })

      // Schedule reconnection
      await this._scheduleReconnection(sessionId, config)
    } catch (error) {
      logger.error(`❌ Bad MAC handler error for ${sessionId}:`, error)
      this.reconnectionLocks.delete(sessionId)
      await this.sessionManager.performCompleteUserCleanup(sessionId)
    }
  }

  /**
   * Handle forbidden/banned account state (403) - Uses types.js config
   */
  async _handleForbidden(sessionId, config) {
    try {
      logger.info(`🚫 ${config.message} for ${sessionId}`)

      const session = await this.sessionManager.storage.getSession(sessionId)

      await this.sessionManager.performCompleteUserCleanup(sessionId)

      // ✅ Better notification with fallback logging
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

  /**
   * Handle logged out state (401) - Uses types.js config
   */
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

        // ✅ Better notification handling
        if (requiresNotification(config.statusCode)) {
          await this._sendDisconnectNotification(sessionId, config)
        }
      }
    } catch (error) {
      logger.error(`❌ Logged out handler error for ${sessionId}:`, error)
    }
  }

  // ==========================================
  // RECONNECTION LOGIC
  // ==========================================

  /**
   * Attempt to reconnect session
   */
  async _attemptReconnection(sessionId) {
  try {
    
    const session = await this.sessionManager.storage.getSession(sessionId)

    if (!session) {
      logger.error(`❌ No session data found for ${sessionId} - cannot reconnect`)
      return false
    }

    // Increment reconnect attempts
    const newAttempts = (session.reconnectAttempts || 0) + 1
    await this.sessionManager.storage.updateSession(sessionId, {
      reconnectAttempts: newAttempts,
      connectionStatus: "connecting",
    }).catch(err => {
      logger.warn(`Failed to update attempts: ${err.message}`)
    })

    logger.info(`🔄 Reconnection attempt ${newAttempts} for ${sessionId}`)


    // Create new session
    const sock = await this.sessionManager.createSession(
      session.userId,
      session.phoneNumber,
      session.callbacks || {},
      true, // isReconnect
      session.source || "telegram",
      false, // Don't allow pairing on reconnect
    )
    
    if (sock) {
      logger.info(`✅ Reconnection successful for ${sessionId}`)
      return true
    }
    
    return false
  } catch (error) {
    logger.error(`❌ Reconnection failed for ${sessionId}:`, error)
    
    const session = await this.sessionManager.storage.getSession(sessionId)
    const attempts = session?.reconnectAttempts || 0
    const maxAttempts = getMaxAttempts(428)

    if (attempts >= maxAttempts) {
      logger.warn(`⚠️ Session ${sessionId} exceeded max reconnection attempts (${attempts}/${maxAttempts}) - stopping`)
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

  // ==========================================
  // UTILITY METHODS
  // ==========================================

  /**
   * ✅ Send disconnect notification with proper error handling
   * Uses types.js for all messages and user actions
   */
  async _sendDisconnectNotification(sessionId, config) {
    try {
      const session = await this.sessionManager.storage.getSession(sessionId)

      if (session?.source !== "telegram" || !this.sessionManager.telegramBot) {
        return false
      }

      const userId = sessionId.replace("session_", "")
      const userAction = getUserAction(config.statusCode)

      // Build message from types.js config
      let message = `⚠️ *WhatsApp Disconnected*\n\n${config.message}`
      
      if (session.phoneNumber) {
        message += `\n\nAccount: ${session.phoneNumber}`
      }
      
      if (userAction) {
        message += `\n\n${userAction}`
      }

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Notification timeout")), 8000)
      )

      const sendPromise = this.sessionManager.telegramBot.sendMessage(userId, message, { 
        parse_mode: "Markdown" 
      })

      await Promise.race([sendPromise, timeoutPromise])

      logger.info(`✅ Disconnect notification sent to ${userId}`)
      
      // Reset failure counter on success
      this.notificationFailures.delete(sessionId)
      
      return true
    } catch (error) {
      // ✅ Track notification failures
      const failures = (this.notificationFailures.get(sessionId) || 0) + 1
      this.notificationFailures.set(sessionId, failures)
      
      logger.error(`❌ Disconnect notification failed for ${sessionId} (${failures} failures):`, error.message)
      
      return false
    }
  }

  /**
 * Called by health monitor before reinitializing a session
 * Returns false if reconnection is already in progress
 */
canReinitialize(sessionId) {
  if (this._isReconnecting(sessionId)) {
    const reconnection = this.activeReconnections.get(sessionId)
    const elapsed = Math.round((Date.now() - reconnection.startTime) / 1000)
    logger.info(`⏭️ Skipping health reinitialization for ${sessionId} - reconnection in progress (${elapsed}s)`)
    return false
  }
  return true
}

/**
 * Cancel active reconnection (used when manual disconnect is requested)
 */
cancelReconnection(sessionId) {
  if (this.activeReconnections.has(sessionId)) {
    logger.info(`🛑 Cancelling reconnection for ${sessionId}`)
    this._endReconnection(sessionId, false)
  }
}

  /**
   * Clear auth storage but keep credentials
   */
  async _clearAuthStorageKeepCreds(sessionId) {
    try {
      // Clear MongoDB auth storage except creds
      if (this.sessionManager.connectionManager?.mongoClient) {
        try {
          const db = this.sessionManager.connectionManager.mongoClient.db()
          const collection = db.collection("auth_baileys")

          const result = await collection.deleteMany({
            sessionId: sessionId,
            key: { $ne: "creds.json" },
          })

          logger.info(`🧹 Cleared ${result.deletedCount} auth items for ${sessionId} (kept creds)`)
        } catch (mongoError) {
          logger.warn(`Failed to clear MongoDB auth for ${sessionId}:`, mongoError)
        }
      }

      // Clear file-based auth storage except creds.json
      if (this.sessionManager.connectionManager?.fileManager) {
        try {
          const sessionPath = this.sessionManager.connectionManager.fileManager.getSessionPath(sessionId)
          const fs = await import("fs").then((m) => m.promises)

          const files = await fs.readdir(sessionPath).catch(() => [])

          for (const file of files) {
            if (file !== "creds.json") {
              await fs.unlink(`${sessionPath}/${file}`).catch(() => {})
            }
          }

          logger.info(`🧹 Cleared file auth storage for ${sessionId} (kept creds.json)`)
        } catch (fileError) {
          logger.warn(`Failed to clear file auth for ${sessionId}:`, fileError)
        }
      }
    } catch (error) {
      logger.error(`Error clearing auth storage for ${sessionId}:`, error)
      throw error
    }
  }

  // ==========================================
  // OTHER EVENT HANDLERS
  // ==========================================

  async handleCredsUpdate(sock, sessionId) {
    try {
      await sock.sendPresenceUpdate("unavailable").catch(() => {})
      logger.debug(`🔑 Credentials updated for ${sessionId}`)
    } catch (error) {
      logger.error(`Creds update error for ${sessionId}:`, error)
    }
  }

  async handleContactsUpsert(sock, sessionId, contacts) {
    try {
      logger.debug(`👥 ${contacts.length} new contacts for ${sessionId}`)
    } catch (error) {
      logger.error(`Contacts upsert error:`, error)
    }
  }

  async handleContactsUpdate(sock, sessionId, updates) {
    try {
      logger.debug(`👥 ${updates.length} contact updates for ${sessionId}`)

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
      logger.debug(`💬 ${chats.length} new chats for ${sessionId}`)
    } catch (error) {
      logger.error(`Chats upsert error:`, error)
    }
  }

  async handleChatsUpdate(sock, sessionId, updates) {
    try {
      logger.debug(`💬 ${updates.length} chat updates for ${sessionId}`)
    } catch (error) {
      logger.error(`Chats update error:`, error)
    }
  }

  async handleChatsDelete(sock, sessionId, deletions) {
    try {
      logger.debug(`💬 ${deletions.length} chats deleted for ${sessionId}`)
    } catch (error) {
      logger.error(`Chats delete error:`, error)
    }
  }

  async handlePresenceUpdate(sock, sessionId, update) {
    try {
      // Usually just logged, not acted upon
    } catch (error) {
      logger.error(`Presence update error:`, error)
    }
  }
}