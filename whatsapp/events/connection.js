import { createComponentLogger } from '../../utils/logger.js'
import { DisconnectReason } from './types.js'
import { Boom } from '@hapi/boom'

const logger = createComponentLogger('CONNECTION_EVENTS')

/**
 * ConnectionEventHandler - FIXED
 * Handles ONLY reconnection logic and disconnect handling
 * Initial connection is handled by SessionEventHandlers
 */
export class ConnectionEventHandler {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    this.reconnectionLocks = new Set() // Prevent duplicate reconnection attempts
  }

/**
 * Handle connection close - FIXED voluntary disconnect check order
 */
async _handleConnectionClose(sock, sessionId, lastDisconnect) {
  try {
    // CRITICAL FIX: Prevent duplicate reconnection attempts
    if (this.reconnectionLocks.has(sessionId)) {
      logger.warn(`Session ${sessionId} already has pending reconnection - skipping`)
      return
    }

    // Update session status first
    await this.sessionManager.storage.updateSession(sessionId, {
      isConnected: false,
      connectionStatus: 'disconnected'
    })

    // Extract disconnect reason
    const error = lastDisconnect?.error
    const statusCode = error instanceof Boom ? error.output?.statusCode : null
    
    logger.warn(`Session ${sessionId} disconnected - Status: ${statusCode}`)

    // ✅ FIX: Handle reconnectable status codes BEFORE voluntary disconnect check
    // This ensures 515/516/408 always trigger reconnection regardless of voluntary flag
    
    // Handle 408 (Connection Timeout) - Perform complete cleanup
    if (statusCode === DisconnectReason.TIMED_OUT) {
      logger.error(`Session ${sessionId} connection timeout (408) - performing complete cleanup`)
      await this._handleConnectionTimeout(sessionId)
      return
    }

    // Handle 515 and 516 with reconnection lock to prevent duplicates
    if (statusCode === DisconnectReason.RESTART_REQUIRED || 
        statusCode === DisconnectReason.STREAM_ERROR_UNKNOWN) {
      logger.info(`Session ${sessionId} needs restart (${statusCode}) - reconnecting`)
      
      // Clear voluntary disconnect flag if present (user completed pairing)
      this.sessionManager.voluntarilyDisconnected?.delete(sessionId)
      
      // Lock to prevent duplicates
      this.reconnectionLocks.add(sessionId)
      
      // Shorter delay for restart scenarios (2 seconds)
      setTimeout(() => {
        this._attemptReconnection(sessionId)
          .catch(err => logger.error(`Reconnection failed for ${sessionId}:`, err))
          .finally(() => {
            // Remove lock after reconnection attempt
            this.reconnectionLocks.delete(sessionId)
          })
      }, 2000)
      return
    }

    // ✅ NOW check for voluntary disconnect (after handling reconnectable codes)
    const isVoluntaryDisconnect = this.sessionManager.voluntarilyDisconnected?.has(sessionId)
    
    if (isVoluntaryDisconnect) {
      logger.info(`Session ${sessionId} voluntarily disconnected - skipping cleanup`)
      return
    }

    // Handle specific permanent disconnect reasons
    if (statusCode === DisconnectReason.LOGGED_OUT) {
      logger.info(`Session ${sessionId} logged out - performing full cleanup`)
      await this._handleLoggedOut(sessionId)
      return
    }

    if (statusCode === DisconnectReason.CONNECTION_REPLACED) {
      logger.info(`Session ${sessionId} replaced by another device`)
      await this.sessionManager.disconnectSession(sessionId, true)
      return
    }

    if (statusCode === DisconnectReason.BAD_SESSION) {
      logger.warn(`Session ${sessionId} has bad MAC/session - clearing auth storage`)
      await this._handleBadMac(sessionId)
      return
    }

    if (statusCode === DisconnectReason.FORBIDDEN) {
      logger.error(`Session ${sessionId} is forbidden/banned - performing full cleanup`)
      await this._handleForbidden(sessionId)
      return
    }

    // For other disconnect reasons, check if should reconnect
    const shouldReconnect = await this._shouldReconnect(statusCode, sessionId)
    
    if (shouldReconnect) {
      logger.info(`Session ${sessionId} will attempt reconnection (status: ${statusCode})`)
      
      // Lock to prevent duplicates
      this.reconnectionLocks.add(sessionId)
      
      setTimeout(() => {
        this._attemptReconnection(sessionId)
          .catch(err => logger.error(`Reconnection failed for ${sessionId}:`, err))
          .finally(() => {
            this.reconnectionLocks.delete(sessionId)
          })
      }, 5000)
    } else {
      logger.warn(`Session ${sessionId} will not reconnect - permanent failure`)
      await this.sessionManager.disconnectSession(sessionId, true)
    }

  } catch (error) {
    logger.error(`Connection close handler error for ${sessionId}:`, error)
    this.reconnectionLocks.delete(sessionId) // Clean up lock on error
  }
}

  /**
 * Handle connection timeout (408) - NEW METHOD
 */
async _handleConnectionTimeout(sessionId) {
  try {
    const session = await this.sessionManager.storage.getSession(sessionId)
    
    // Perform complete cleanup
    await this.sessionManager.performCompleteUserCleanup(sessionId)
    
    // Notify via Telegram if it's a telegram session
    if (session?.source === 'telegram' && this.sessionManager.telegramBot) {
      const userId = sessionId.replace('session_', '')
      try {
        await this.sessionManager.telegramBot.sendMessage(
          userId,
          `⏱️ *Connection Timeout*\n\nYour WhatsApp connection attempt timed out. This usually means:\n\n• The pairing code wasn't entered in time\n• Network connection issues\n• WhatsApp servers are slow\n\nPlease use /connect to try again.`,
          { parse_mode: 'Markdown' }
        )
      } catch (notifyError) {
        logger.error(`Failed to send timeout notification:`, notifyError)
      }
    }

    logger.info(`Connection timeout cleanup completed for ${sessionId}`)

  } catch (error) {
    logger.error(`Connection timeout handler error for ${sessionId}:`, error)
  }
}

  /**
   * Handle bad MAC/session error
   */
  async _handleBadMac(sessionId) {
    try {
      logger.info(`Handling bad MAC for ${sessionId} - clearing auth storage`)
      
      const session = await this.sessionManager.storage.getSession(sessionId)
      if (!session) {
        logger.error(`No session data found for ${sessionId}`)
        return
      }

      // Clear the socket and in-memory state
      const sock = this.sessionManager.activeSockets?.get(sessionId)
      if (sock) {
        try {
          if (sock.ev && typeof sock.ev.removeAllListeners === 'function') {
            sock.ev.removeAllListeners()
          }
          if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
            sock.ws.close(1000, 'Bad MAC cleanup')
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
        connectionStatus: 'disconnected',
        reconnectAttempts: 0
      })

      // Lock and attempt reconnection
      this.reconnectionLocks.add(sessionId)
      
      logger.info(`Attempting reconnection for ${sessionId} after bad MAC cleanup`)
      setTimeout(() => {
        this._attemptReconnection(sessionId)
          .catch(err => logger.error(`Reconnection after bad MAC failed:`, err))
          .finally(() => {
            this.reconnectionLocks.delete(sessionId)
          })
      }, 2000)

    } catch (error) {
      logger.error(`Bad MAC handler error for ${sessionId}:`, error)
      this.reconnectionLocks.delete(sessionId)
      await this.sessionManager.performCompleteUserCleanup(sessionId)
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
          const collection = db.collection('auth_baileys')
          
          const result = await collection.deleteMany({
            sessionId: sessionId,
            key: { $ne: 'creds.json' }
          })
          
          logger.info(`Cleared ${result.deletedCount} auth items for ${sessionId} (kept creds)`)
        } catch (mongoError) {
          logger.warn(`Failed to clear MongoDB auth for ${sessionId}:`, mongoError)
        }
      }

      // Clear file-based auth storage except creds.json
      if (this.sessionManager.connectionManager?.fileManager) {
        try {
          const sessionPath = this.sessionManager.connectionManager.fileManager.getSessionPath(sessionId)
          const fs = await import('fs').then(m => m.promises)
          
          const files = await fs.readdir(sessionPath).catch(() => [])
          
          for (const file of files) {
            if (file !== 'creds.json') {
              await fs.unlink(`${sessionPath}/${file}`).catch(() => {})
            }
          }
          
          logger.info(`Cleared file auth storage for ${sessionId} (kept creds.json)`)
        } catch (fileError) {
          logger.warn(`Failed to clear file auth for ${sessionId}:`, fileError)
        }
      }

    } catch (error) {
      logger.error(`Error clearing auth storage for ${sessionId}:`, error)
      throw error
    }
  }

  /**
   * Handle forbidden/banned account state
   */
  async _handleForbidden(sessionId) {
    try {
      const session = await this.sessionManager.storage.getSession(sessionId)
      
      // Perform full cleanup
      await this.sessionManager.performCompleteUserCleanup(sessionId)
      
      // Notify via Telegram if it's a telegram session
      if (session?.source === 'telegram' && this.sessionManager.telegramBot) {
        const userId = sessionId.replace('session_', '')
        try {
          await this.sessionManager.telegramBot.sendMessage(
            userId,
            `🚫 *WhatsApp Account Restricted*\n\nYour WhatsApp account ${session.phoneNumber || ''} has been banned or restricted by WhatsApp.\n\nThis usually happens due to:\n- Using unofficial WhatsApp versions\n- Violating WhatsApp Terms of Service\n- Suspicious activity detected\n\nPlease contact WhatsApp support or wait for the restriction to be lifted.`,
            { parse_mode: 'Markdown' }
          )
        } catch (notifyError) {
          logger.error(`Failed to send forbidden notification:`, notifyError)
        }
      }

    } catch (error) {
      logger.error(`Forbidden handler error for ${sessionId}:`, error)
    }
  }

/**
 * Handle logged out state
 */
async _handleLoggedOut(sessionId) {
  try {
    const session = await this.sessionManager.storage.getSession(sessionId)
    
    // Check session source property instead of user ID
    const isWebUser = session?.source === 'web'
    
    if (isWebUser) {
      // For web users: Delete from MongoDB but preserve PostgreSQL user account
      logger.info(`Web user ${sessionId} logged out - preserving PostgreSQL account, deleting MongoDB session`)
      
      // Clear auth state from MongoDB (auth_baileys collection)
      await this.sessionManager.connectionManager.cleanupAuthState(sessionId)
      
      // Clear socket
      const sock = this.sessionManager.activeSockets.get(sessionId)
      if (sock) {
        await this.sessionManager._cleanupSocket(sessionId, sock)
      }
      
      // Remove from tracking
      this.sessionManager.activeSockets.delete(sessionId)
      this.sessionManager.sessionState.delete(sessionId)
      
      // DELETE from MongoDB sessions collection BUT UPDATE PostgreSQL to keep user record
      await this.sessionManager.storage.deleteSessionKeepUser(sessionId)
      
      logger.info(`Web user ${sessionId} - MongoDB deleted, PostgreSQL account preserved`)
      
    } else {
      // For Telegram users: Full cleanup as before
      logger.info(`Telegram user ${sessionId} logged out - performing full cleanup`)
      await this.sessionManager.performCompleteUserCleanup(sessionId)
      
      // Notify via Telegram
      if (this.sessionManager.telegramBot) {
        const telegramUserId = sessionId.replace('session_', '')
        try {
          await this.sessionManager.telegramBot.sendMessage(
            telegramUserId,
            `⚠️ *WhatsApp Disconnected*\n\nYour WhatsApp ${session?.phoneNumber || ''} has been logged out.\n\nUse /connect to reconnect.`,
            { parse_mode: 'Markdown' }
          )
        } catch (notifyError) {
          logger.error(`Failed to send logout notification:`, notifyError)
        }
      }
    }

  } catch (error) {
    logger.error(`Logged out handler error for ${sessionId}:`, error)
  }
}

  /**
   * Determine if reconnection should be attempted
   */
  async _shouldReconnect(statusCode, sessionId) {
    // Get current reconnect attempts
    const session = await this.sessionManager.storage.getSession(sessionId)
    const reconnectAttempts = session?.reconnectAttempts || 0

    // Don't reconnect for these permanent failure status codes
    const noReconnectCodes = [
      DisconnectReason.LOGGED_OUT,           // 401 - User logged out
      DisconnectReason.CONNECTION_REPLACED,  // 440 - Another device connected
      DisconnectReason.FORBIDDEN             // 403 - Account banned/restricted
    ]

    if (noReconnectCodes.includes(statusCode)) {
      return false
    }

    // Allow more attempts for RESTART_REQUIRED (515) which happens after pairing
    if (statusCode === DisconnectReason.RESTART_REQUIRED || 
        statusCode === DisconnectReason.STREAM_ERROR_UNKNOWN) {
      // Allow many reconnection attempts for 515/516
      if (reconnectAttempts >= 10) {
        logger.warn(`Session ${sessionId} exceeded max reconnection attempts for restart required`)
        return false
      }
      return true
    }

    // Limit reconnection attempts for other errors
    if (reconnectAttempts >= 5) {
      logger.warn(`Session ${sessionId} exceeded max reconnection attempts`)
      return false
    }

    return true
  }

  /**
   * Attempt to reconnect session
   */
  async _attemptReconnection(sessionId) {
    try {
      const session = await this.sessionManager.storage.getSession(sessionId)
      
      if (!session) {
        logger.error(`No session data found for ${sessionId} - cannot reconnect`)
        return
      }

      // Increment reconnect attempts
      const newAttempts = (session.reconnectAttempts || 0) + 1
      await this.sessionManager.storage.updateSession(sessionId, {
        reconnectAttempts: newAttempts,
        connectionStatus: 'reconnecting'
      })

      logger.info(`Reconnection attempt ${newAttempts} for ${sessionId}`)

      // Create new session
      await this.sessionManager.createSession(
        session.userId,
        session.phoneNumber,
        session.callbacks || {},
        true, // isReconnect
        session.source || 'telegram',
        false // Don't allow pairing on reconnect
      )

    } catch (error) {
      logger.error(`Reconnection failed for ${sessionId}:`, error)
      
      // Schedule next attempt with exponential backoff
      const session = await this.sessionManager.storage.getSession(sessionId)
      const delay = Math.min(30000, 5000 * Math.pow(2, session?.reconnectAttempts || 0))
      
      setTimeout(() => {
        this._attemptReconnection(sessionId).catch(() => {})
      }, delay)
    }
  }

  /**
   * Handle credentials update
   */
  async handleCredsUpdate(sock, sessionId) {
    try {
      // Set bot presence
      await sock.sendPresenceUpdate('unavailable').catch(() => {})
      
      logger.debug(`Credentials updated for ${sessionId}`)
    } catch (error) {
      logger.error(`Creds update error for ${sessionId}:`, error)
    }
  }

  /**
   * Handle new contacts
   */
  async handleContactsUpsert(sock, sessionId, contacts) {
    try {
      logger.debug(`${contacts.length} new contacts for ${sessionId}`)
    } catch (error) {
      logger.error(`Contacts upsert error:`, error)
    }
  }

  /**
   * Handle contact updates
   */
  async handleContactsUpdate(sock, sessionId, updates) {
    try {
      logger.debug(`${updates.length} contact updates for ${sessionId}`)
      
      const { getContactManager } = await import('../contacts/index.js').catch(() => ({}))
      
      if (getContactManager) {
        const contactManager = getContactManager()
        
        for (const update of updates) {
          try {
            await contactManager.updateContact(sessionId, {
              jid: update.id,
              name: update.name,
              notify: update.notify,
              verifiedName: update.verifiedName
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

  /**
   * Handle new chats
   */
  async handleChatsUpsert(sock, sessionId, chats) {
    try {
      logger.debug(`${chats.length} new chats for ${sessionId}`)
    } catch (error) {
      logger.error(`Chats upsert error:`, error)
    }
  }

  /**
   * Handle chat updates
   */
  async handleChatsUpdate(sock, sessionId, updates) {
    try {
      logger.debug(`${updates.length} chat updates for ${sessionId}`)
    } catch (error) {
      logger.error(`Chats update error:`, error)
    }
  }

  /**
   * Handle chat deletions
   */
  async handleChatsDelete(sock, sessionId, deletions) {
    try {
      logger.debug(`${deletions.length} chats deleted for ${sessionId}`)
    } catch (error) {
      logger.error(`Chats delete error:`, error)
    }
  }

  /**
   * Handle presence updates
   */
  async handlePresenceUpdate(sock, sessionId, update) {
    try {
      // Usually just logged, not acted upon
    } catch (error) {
      logger.error(`Presence update error:`, error)
    }
  }
}