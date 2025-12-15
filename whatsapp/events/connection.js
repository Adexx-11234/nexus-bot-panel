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
} from "./types.js"
import { Boom } from "@hapi/boom"
import { getHealthMonitor } from "../utils/index.js"

const logger = createComponentLogger("CONNECTION_EVENTS")

// Toggle for 515 complex flow
const ENABLE_515_FLOW = process.env.ENABLE_515_FLOW === "true"

/**
 * ConnectionEventHandler
 * Single source of truth for all connection state management
 * Handles all disconnect reasons based on configuration
 */
export class ConnectionEventHandler {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    this.reconnectionLocks = new Set()
    this.healthMonitor = getHealthMonitor(sessionManager)

    logger.info(`🔧 Connection Handler initialized`)
    logger.info(`📋 515 Flow Mode: ${ENABLE_515_FLOW ? "ENABLED" : "DISABLED"}`)
  }

  // ==========================================
  // MAIN CONNECTION CLOSE HANDLER
  // ==========================================

  /**
   * Handle connection close - Configuration-driven approach
   */
  async _handleConnectionClose(sock, sessionId, lastDisconnect) {
    try {
      if (this.healthMonitor) {
        this.healthMonitor.stopMonitoring(sessionId)
      }

      // Prevent duplicate reconnection attempts
      if (this.reconnectionLocks.has(sessionId)) {
        logger.warn(`⚠️  Session ${sessionId} already has pending reconnection - skipping`)
        return
      }

      // Extract disconnect reason
      const error = lastDisconnect?.error
      const statusCode = error instanceof Boom ? error.output?.statusCode : null

      // ============================================================
      // ✅ CRITICAL: SKIP 405 ENTIRELY - DO NOTHING
      // ============================================================
      if (statusCode === 405) {
        logger.info(`⏭️  Skipping 405 disconnect for ${sessionId} - no action taken`)
        return
      }

      // Get configuration for this disconnect reason
      const config = getDisconnectConfig(statusCode)

      logger.warn(`📴 Session ${sessionId} disconnected`)
      logger.warn(`   Status Code: ${statusCode}`)
      logger.warn(`   Message: ${config.message}`)
      logger.warn(`   Should Reconnect: ${config.shouldReconnect}`)

      // ============================================================
      // HANDLE 428 (Connection Closed) - COMPLETE CLEANUP
      // ============================================================
      if (statusCode === 428) {
        logger.info(`🛑 Session ${sessionId} - Connection closed (428), performing complete cleanup`)
        
        // Get session data to check source
        const session = await this.sessionManager.storage.getSession(sessionId)
        const isWebUser = session?.source === "web"

        if (isWebUser) {
          // Web user: Keep PostgreSQL, delete MongoDB
          logger.info(`🌐 Web user ${sessionId} - preserving account, cleaning session`)
          await this.sessionManager.performCompleteUserCleanup(sessionId)
        } else {
          // Telegram user: Complete deletion
          logger.info(`📱 Telegram user ${sessionId} - complete cleanup`)
          await this.sessionManager.performCompleteUserCleanup(sessionId)
        }
        
        return
      }

      // Update session status (only if NOT 405 or 428)
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

      // Special handling: Bad Session (clear auth then reconnect)
      if (requiresAuthClear(statusCode)) {
        return await this._handleBadMac(sessionId)
      }

      // Check if should clear voluntary disconnect flag
      if (shouldClearVoluntaryFlag(statusCode)) {
        this.sessionManager.voluntarilyDisconnected?.delete(sessionId)
      }

      // ============================================================
      // CHECK VOLUNTARY DISCONNECT (AFTER RECONNECTABLE CODES)
      // ============================================================

      const isVoluntaryDisconnect = this.sessionManager.voluntarilyDisconnected?.has(sessionId)

      if (isVoluntaryDisconnect && !shouldClearVoluntaryFlag(statusCode)) {
        logger.info(`✋ Session ${sessionId} voluntarily disconnected - skipping cleanup`)
        return
      }

      // ============================================================
      // HANDLE BASED ON CONFIGURATION
      // ============================================================

      // Permanent disconnects
      if (config.isPermanent) {
        logger.info(`🛑 Session ${sessionId} - Permanent disconnect (${statusCode})`)
        return await this._handlePermanentDisconnect(sessionId, statusCode, config)
      }

      // Reconnectable disconnects
      if (config.shouldReconnect) {
        logger.info(`🔄 Session ${sessionId} - Reconnectable disconnect (${statusCode})`)
        return await this._handleReconnectableDisconnect(sessionId, statusCode, config)
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
  // 515/516 FLOW HANDLER
  // ==========================================

/**
 * Handle 515/516 disconnect with optional complex flow
 */
async _handle515Flow(sessionId, statusCode, config) {
  logger.info(`🔄 Handling ${statusCode} for ${sessionId}`)

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

  // Schedule reconnection
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
   * Handle permanent disconnects
   */
  async _handlePermanentDisconnect(sessionId, statusCode, config) {
    logger.info(`🛑 Handling permanent disconnect for ${sessionId}`)

    // Route to specific handler based on status code
    switch (statusCode) {
      case DisconnectReason.LOGGED_OUT:
        await this._handleLoggedOut(sessionId)
        break

      case DisconnectReason.FORBIDDEN:
        await this._handleForbidden(sessionId)
        break

      case DisconnectReason.TIMED_OUT:
        await this._handleConnectionTimeout(sessionId)
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
   * Handle reconnectable disconnects
   */
  async _handleReconnectableDisconnect(sessionId, statusCode, config) {
    // Check reconnection attempts
    const session = await this.sessionManager.storage.getSession(sessionId)
    const attempts = session?.reconnectAttempts || 0
    const maxAttempts = getMaxAttempts(statusCode)

    if (attempts >= maxAttempts) {
      logger.warn(`⚠️  Session ${sessionId} exceeded max reconnection attempts (${attempts}/${maxAttempts})`)
      await this.sessionManager.disconnectSession(sessionId, true)
      return
    }

    // Lock and schedule reconnection
    this.reconnectionLocks.add(sessionId)

    const delay = getReconnectDelay(statusCode, attempts)
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
  // SPECIFIC DISCONNECT HANDLERS
  // ==========================================

  /**
   * Handle connection timeout (408)
   */
  async _handleConnectionTimeout(sessionId) {
    try {
      logger.info(`⏱️  Handling connection timeout for ${sessionId}`)

      const session = await this.sessionManager.storage.getSession(sessionId)

      await this.sessionManager.performCompleteUserCleanup(sessionId)

      if (session?.source === "telegram" && this.sessionManager.telegramBot) {
        const userId = sessionId.replace("session_", "")
        try {
          await this.sessionManager.telegramBot.sendMessage(
            userId,
            `⏱️ *Connection Timeout*\n\nYour WhatsApp connection attempt timed out.\n\n` +
              `This usually means:\n` +
              `• The pairing code wasn't entered in time\n` +
              `• Network connection issues\n` +
              `• WhatsApp servers are slow\n\n` +
              `Use /connect to try again.`,
            { parse_mode: "Markdown" },
          )
        } catch (notifyError) {
          logger.error(`Failed to send timeout notification:`, notifyError)
        }
      }

      logger.info(`✅ Connection timeout cleanup completed for ${sessionId}`)
    } catch (error) {
      logger.error(`❌ Connection timeout handler error for ${sessionId}:`, error)
    }
  }

  /**
   * Handle bad MAC/session error (500)
   */
  async _handleBadMac(sessionId) {
    try {
      logger.info(`🔧 Handling bad MAC for ${sessionId} - clearing auth storage`)

      const session = await this.sessionManager.storage.getSession(sessionId)
      if (!session) {
        logger.error(`❌ No session data found for ${sessionId}`)
        return
      }

      // Clean up socket
      const sock = this.sessionManager.activeSockets?.get(sessionId)
      if (sock) {
        try {
          if (sock.ev && typeof sock.ev.removeAllListeners === "function") {
            sock.ev.removeAllListeners()
          }
          if (sock.ws) {
            sock.ws.close(1000, "Bad MAC cleanup")
          }
        } catch (error) {
          logger.error(`Error cleaning up socket for ${sessionId}:`, error)
        }
      }

      this.sessionManager.activeSockets?.delete(sessionId)
      this.sessionManager.sessionState?.delete(sessionId)

      // Clear auth storage but preserve creds
      await this._clearAuthStorageKeepCreds(sessionId)

      // Update session status
      await this.sessionManager.storage.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: "disconnected",
        reconnectAttempts: 0,
      })

      // Lock and attempt reconnection
      this.reconnectionLocks.add(sessionId)

      logger.info(`🔄 Attempting reconnection for ${sessionId} after bad MAC cleanup`)
      setTimeout(() => {
        this._attemptReconnection(sessionId)
          .catch((err) => logger.error(`Reconnection after bad MAC failed:`, err))
          .finally(() => {
            this.reconnectionLocks.delete(sessionId)
          })
      }, 2000)
    } catch (error) {
      logger.error(`❌ Bad MAC handler error for ${sessionId}:`, error)
      this.reconnectionLocks.delete(sessionId)
      await this.sessionManager.performCompleteUserCleanup(sessionId)
    }
  }

  /**
   * Handle forbidden/banned account state (403)
   */
  async _handleForbidden(sessionId) {
    try {
      logger.info(`🚫 Handling forbidden state for ${sessionId}`)

      const session = await this.sessionManager.storage.getSession(sessionId)

      await this.sessionManager.performCompleteUserCleanup(sessionId)

      if (session?.source === "telegram" && this.sessionManager.telegramBot) {
        const userId = sessionId.replace("session_", "")
        try {
          await this.sessionManager.telegramBot.sendMessage(
            userId,
            `🚫 *WhatsApp Account Restricted*\n\n` +
              `Your WhatsApp account ${session.phoneNumber || ""} has been banned or restricted.\n\n` +
              `This usually happens due to:\n` +
              `• Using unofficial WhatsApp versions\n` +
              `• Violating WhatsApp Terms of Service\n` +
              `• Suspicious activity detected\n\n` +
              `Please contact WhatsApp support or wait for the restriction to be lifted.`,
            { parse_mode: "Markdown" },
          )
        } catch (notifyError) {
          logger.error(`Failed to send forbidden notification:`, notifyError)
        }
      }
    } catch (error) {
      logger.error(`❌ Forbidden handler error for ${sessionId}:`, error)
    }
  }

  /**
   * Handle logged out state (401)
   */
  async _handleLoggedOut(sessionId) {
    try {
      logger.info(`👋 Handling logged out state for ${sessionId}`)

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

        if (this.sessionManager.telegramBot) {
          const telegramUserId = sessionId.replace("session_", "")
          try {
            await this.sessionManager.telegramBot.sendMessage(
              telegramUserId,
              `⚠️ *WhatsApp Disconnected*\n\n` +
                `Your WhatsApp ${session?.phoneNumber || ""} has been logged out.\n\n` +
                `Use /connect to reconnect.`,
              { parse_mode: "Markdown" },
            )
          } catch (notifyError) {
            logger.error(`Failed to send logout notification:`, notifyError)
          }
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
        return
      }

      // Increment reconnect attempts
      const newAttempts = (session.reconnectAttempts || 0) + 1
      await this.sessionManager.storage.updateSession(sessionId, {
        reconnectAttempts: newAttempts,
        connectionStatus: "connecting",
      })

      logger.info(`🔄 Reconnection attempt ${newAttempts} for ${sessionId}`)

      // Create new session
      await this.sessionManager.createSession(
        session.userId,
        session.phoneNumber,
        session.callbacks || {},
        true, // isReconnect
        session.source || "telegram",
        false, // Don't allow pairing on reconnect
      )
    } catch (error) {
      logger.error(`❌ Reconnection failed for ${sessionId}:`, error)

      // Schedule next attempt with exponential backoff
      const session = await this.sessionManager.storage.getSession(sessionId)
      const delay = Math.min(30000, 5000 * Math.pow(2, session?.reconnectAttempts || 0))

      setTimeout(() => {
        this._attemptReconnection(sessionId).catch(() => {})
      }, delay)
    }
  }

  // ==========================================
  // UTILITY METHODS
  // ==========================================

  /**
   * Send disconnect notification
   */
  async _sendDisconnectNotification(sessionId, config) {
    try {
      const session = await this.sessionManager.storage.getSession(sessionId)

      if (session?.source === "telegram" && this.sessionManager.telegramBot) {
        const userId = sessionId.replace("session_", "")
        const userAction = getUserAction(config.statusCode)

        const message = `⚠️ *WhatsApp Disconnected*\n\n` + `${config.message}\n\n` + (userAction ? `${userAction}` : "")

        try {
          await this.sessionManager.telegramBot.sendMessage(userId, message, { parse_mode: "Markdown" })
        } catch (notifyError) {
          logger.error(`Failed to send disconnect notification:`, notifyError)
        }
      }
    } catch (error) {
      logger.error(`Disconnect notification error:`, error)
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