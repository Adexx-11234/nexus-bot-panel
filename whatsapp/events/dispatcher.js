import { createComponentLogger } from "../../utils/logger.js"
import { EventTypes } from "./types.js"
import { MessageEventHandler } from "./message.js"
import { GroupEventHandler } from "./group.js"
import { ConnectionEventHandler } from "./connection.js"
import { UtilityEventHandler } from "./utility.js"
import { recordSessionActivity } from "../utils/index.js"

const logger = createComponentLogger("EVENT_DISPATCHER")

/**
 * EventDispatcher - Central event routing and handler coordination
 *
 * IMPORTANT: This does NOT handle connection.update or creds.update
 * Those are handled by SessionEventHandlers to avoid duplicate listeners
 */
export class EventDispatcher {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    this.handlers = new Map()

    // Initialize event handlers (stateless, can be shared)
    this.messageHandler = new MessageEventHandler()
    this.groupHandler = new GroupEventHandler()
    this.connectionHandler = new ConnectionEventHandler(sessionManager)
    this.utilityHandler = new UtilityEventHandler()

    logger.info("Event dispatcher initialized")
  }

  /**
   * Setup all event listeners for a session
   * NOTE: Connection events are handled by SessionEventHandlers
   */
  setupEventHandlers(sock, sessionId) {
    if (!sock || !sessionId) {
      logger.error("Invalid socket or sessionId for event setup")
      return false
    }

    try {
      if (sock.eventHandlersSetup) {
        logger.warn(`Event handlers already setup for ${sessionId}`)
        return true
      }

      logger.info(`Setting up event handlers for ${sessionId}`)

      this._setupMessageEvents(sock, sessionId)
      this._setupGroupEvents(sock, sessionId)
      this._setupContactEvents(sock, sessionId)
      this._setupChatEvents(sock, sessionId)
      this._setupPresenceEvents(sock, sessionId)
      this._setupUtilityEvents(sock, sessionId)

      sock.eventHandlersSetup = true

      // ✅ CRITICAL FIX: Process any deferred events that were captured before handlers were ready
      this._processDeferredEvents(sock, sessionId)

      logger.info(`Event handlers setup complete for ${sessionId}`)
      return true
    } catch (error) {
      logger.error(`Failed to setup event handlers for ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Process events that were deferred before handlers were set up
   * @private
   */
  _processDeferredEvents(sock, sessionId) {
    try {
      const deferred = sock._deferredEvents || []
      
      if (deferred.length === 0) {
        return
      }

      logger.info(`[${sessionId}] Processing ${deferred.length} deferred events`)

      // Sort by timestamp to maintain order
      deferred.sort((a, b) => a.timestamp - b.timestamp)

      // Process each deferred event
      for (const event of deferred) {
        if (event.type === 'messages.upsert') {
          try {
            recordSessionActivity(sessionId)
            this.messageHandler
              .handleMessagesUpsert(sock, sessionId, event.data)
              .catch((err) => {
                logger.error(`Error processing deferred message upsert for ${sessionId}:`, err)
              })
          } catch (error) {
            logger.error(`Error handling deferred message upsert:`, error)
          }
        }
      }

      // Clear deferred events
      sock._deferredEvents = []
      logger.debug(`[${sessionId}] Deferred events cleared`)

    } catch (error) {
      logger.error(`Failed to process deferred events for ${sessionId}:`, error)
    }
  }

  /**
   * Setup message event listeners with optimized filtering
   */
  _setupMessageEvents(sock, sessionId) {
    // ============= MESSAGES_UPSERT =============
    sock.ev.on(EventTypes.MESSAGES_UPSERT, async (messageUpdate) => {
      try {
        recordSessionActivity(sessionId)


        // Fire and forget - process without blocking
        this.messageHandler
          .handleMessagesUpsert(sock, sessionId, messageUpdate)
          .then(() => {
          })
          .catch((err) => {
          })
      } catch (error) {
        logger.error(`Error in MESSAGES_UPSERT handler for ${sessionId}:`, error)
      }
    })

    // ============= MESSAGES_UPDATE =============
    sock.ev.on(EventTypes.MESSAGES_UPDATE, async (updates) => {
      try {
        // Fast filter: Remove useless updates
        if (updates && updates.length > 0) {
          updates = updates.filter((update) => {
            // Skip empty updates
            if (!update.update) {
              return false
            }

            // Skip status-only updates (read receipts)
            const updateKeys = Object.keys(update.update)
            if (updateKeys.length === 1 && updateKeys[0] === "status") {
              return false
            }

            // Skip edited message placeholders with null content
            if (update.update.message?.editedMessage?.message === null) {
              return false
            }

            return true
          })

          // Skip if no updates left
          if (updates.length === 0) {
            return
          }
        }

       // recordSessionActivity(sessionId)

        // Fire and forget
        this.messageHandler
          .handleMessagesUpdate(sock, sessionId, updates)
          .catch((err) => logger.error(`Error processing message update for ${sessionId}:`, err))
      } catch (error) {
        logger.error(`Error in MESSAGES_UPDATE handler for ${sessionId}:`, error)
      }
    })

    // ============= MESSAGES_DELETE =============
    sock.ev.on(EventTypes.MESSAGES_DELETE, async (deletions) => {
      try {
      //  recordSessionActivity(sessionId)

        // Fire and forget
        this.messageHandler
          .handleMessagesDelete(sock, sessionId, deletions)
          .catch((err) => logger.error(`Error processing message delete for ${sessionId}:`, err))
      } catch (error) {
        logger.error(`Error in MESSAGES_DELETE handler for ${sessionId}:`, error)
      }
    })

    // ============= MESSAGES_REACTION =============
    sock.ev.on(EventTypes.MESSAGES_REACTION, async (reactions) => {
      try {
      //  recordSessionActivity(sessionId)

        // Fire and forget
        this.messageHandler
          .handleMessagesReaction(sock, sessionId, reactions)
          .catch((err) => logger.error(`Error processing message reaction for ${sessionId}:`, err))
      } catch (error) {
        logger.error(`Error in MESSAGES_REACTION handler for ${sessionId}:`, error)
      }
    })
  }

 /**
   * Setup group event listeners
   */
  _setupGroupEvents(sock, sessionId) {
    sock.ev.on(EventTypes.GROUPS_UPSERT, async (groups) => {
      this.groupHandler
        .handleGroupsUpsert(sock, sessionId, groups)
        .catch((err) => logger.error(`Error in GROUPS_UPSERT for ${sessionId}:`, err))
    })

    sock.ev.on(EventTypes.GROUPS_UPDATE, async (updates) => {
      this.groupHandler
        .handleGroupsUpdate(sock, sessionId, updates)
        .catch((err) => logger.error(`Error in GROUPS_UPDATE for ${sessionId}:`, err))
    })

    sock.ev.on(EventTypes.GROUP_PARTICIPANTS_UPDATE, async (update) => {
      this.groupHandler
        .handleParticipantsUpdate(sock, sessionId, update)
        .catch((err) => logger.error(`Error in GROUP_PARTICIPANTS_UPDATE for ${sessionId}:`, err))
      
      // ✅ ACTIVITY TRACKING: Detect when users leave/are removed
      if (update.action === 'remove' && update.participants) {
        const { ActivityQueries } = await import("../../database/query.js")
        
        for (const userJid of update.participants) {
          ActivityQueries.setUserLeftGroup(update.id, userJid).catch((err) => {
            logger.debug(`Failed to mark user as left: ${err.message}`)
          })
        }
      }
    })
  }

  /**
   * Setup contact event listeners
   */
  _setupContactEvents(sock, sessionId) {
    sock.ev.on(EventTypes.CONTACTS_UPSERT, async (contacts) => {
      this.connectionHandler
        .handleContactsUpsert(sock, sessionId, contacts)
        .catch((err) => logger.error(`Error in CONTACTS_UPSERT for ${sessionId}:`, err))
    })

    sock.ev.on(EventTypes.CONTACTS_UPDATE, async (updates) => {
      this.connectionHandler
        .handleContactsUpdate(sock, sessionId, updates)
        .catch((err) => logger.error(`Error in CONTACTS_UPDATE for ${sessionId}:`, err))
    })
  }

  /**
   * Setup chat event listeners
   */
  _setupChatEvents(sock, sessionId) {
    sock.ev.on(EventTypes.CHATS_UPSERT, async (chats) => {
      this.connectionHandler
        .handleChatsUpsert(sock, sessionId, chats)
        .catch((err) => logger.error(`Error in CHATS_UPSERT for ${sessionId}:`, err))
    })

    sock.ev.on(EventTypes.CHATS_UPDATE, async (updates) => {
      this.connectionHandler
        .handleChatsUpdate(sock, sessionId, updates)
        .catch((err) => logger.error(`Error in CHATS_UPDATE for ${sessionId}:`, err))
    })

    sock.ev.on(EventTypes.CHATS_DELETE, async (deletions) => {
      this.connectionHandler
        .handleChatsDelete(sock, sessionId, deletions)
        .catch((err) => logger.error(`Error in CHATS_DELETE for ${sessionId}:`, err))
    })
  }

  /**
   * Setup presence event listeners
   */
  _setupPresenceEvents(sock, sessionId) {
    sock.ev.on(EventTypes.PRESENCE_UPDATE, async (update) => {
     // recordSessionActivity(sessionId)
      this.connectionHandler
        .handlePresenceUpdate(sock, sessionId, update)
        .catch((err) => logger.error(`Error in PRESENCE_UPDATE for ${sessionId}:`, err))
    })
  }

  /**
   * Setup utility event listeners
   */
  _setupUtilityEvents(sock, sessionId) {
    sock.ev.on(EventTypes.CALL, async (calls) => {
      this.utilityHandler
        .handleCalls(sock, sessionId, calls)
        .catch((err) => logger.error(`Error in CALL for ${sessionId}:`, err))
    })

    sock.ev.on(EventTypes.BLOCKLIST_SET, async (blocklist) => {
      this.utilityHandler
        .handleBlocklistSet(sock, sessionId, blocklist)
        .catch((err) => logger.error(`Error in BLOCKLIST_SET for ${sessionId}:`, err))
    })

    sock.ev.on(EventTypes.BLOCKLIST_UPDATE, async (update) => {
      this.utilityHandler
        .handleBlocklistUpdate(sock, sessionId, update)
        .catch((err) => logger.error(`Error in BLOCKLIST_UPDATE for ${sessionId}:`, err))
    })
  }

  /**
   * Cleanup handlers for a session
   */
  cleanup(sessionId) {
    try {
      const handlers = this.handlers.get(sessionId)
      if (handlers) {
        this.handlers.delete(sessionId)
      }

      logger.info(`Event handlers cleaned up for ${sessionId}`)
      return true
    } catch (error) {
      logger.error(`Failed to cleanup event handlers for ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Get dispatcher statistics
   */
  getStats() {
    return {
      activeSessions: this.handlers.size,
      handlers: {
        message: !!this.messageHandler,
        group: !!this.groupHandler,
        connection: !!this.connectionHandler,
        utility: !!this.utilityHandler,
      },
    }
  }
}