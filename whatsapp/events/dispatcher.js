import { createComponentLogger } from '../../utils/logger.js'
import { EventTypes } from './types.js'
import { MessageEventHandler } from './message.js'
import { GroupEventHandler } from './group.js'
import { ConnectionEventHandler } from './connection.js'
import { UtilityEventHandler } from './utility.js'

const logger = createComponentLogger('EVENT_DISPATCHER')

/**
 * EventDispatcher - Central event routing and handler coordination
 * Manages all WhatsApp socket event listeners
 * 
 * IMPORTANT: This does NOT handle connection.update or creds.update
 * Those are handled by SessionEventHandlers to avoid duplicate listeners
 */
export class EventDispatcher {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    this.handlers = new Map() // sessionId -> handler instances
    
    // Initialize event handlers (stateless, can be shared)
    this.messageHandler = new MessageEventHandler()
    this.groupHandler = new GroupEventHandler()
    this.connectionHandler = new ConnectionEventHandler(sessionManager)
    this.utilityHandler = new UtilityEventHandler()
    
    logger.info('Event dispatcher initialized')
  }

  /**
   * Setup all event listeners for a session
   * NOTE: Connection events (connection.update, creds.update) are handled by SessionEventHandlers
   */
  setupEventHandlers(sock, sessionId) {
    if (!sock || !sessionId) {
      logger.error('Invalid socket or sessionId for event setup')
      return false
    }

    try {
      // Prevent duplicate setup
      if (sock.eventHandlersSetup) {
        logger.warn(`Event handlers already setup for ${sessionId}`)
        return true
      }

      logger.info(`Setting up event handlers for ${sessionId}`)

      // Message events (main business logic)
      this._setupMessageEvents(sock, sessionId)
      
      // Group events (metadata updates, participants)
      this._setupGroupEvents(sock, sessionId)
      
      // Contact and chat events
      this._setupContactEvents(sock, sessionId)
      this._setupChatEvents(sock, sessionId)
      
      // Presence events (low priority)
      this._setupPresenceEvents(sock, sessionId)
      
      // Utility events (calls, blocklist)
      this._setupUtilityEvents(sock, sessionId)

      // Mark as setup
      sock.eventHandlersSetup = true
      
      logger.info(`Event handlers setup complete for ${sessionId}`)
      return true

    } catch (error) {
      logger.error(`Failed to setup event handlers for ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Setup message events
   */
  _setupMessageEvents(sock, sessionId) {
    // New messages
    sock.ev.on(EventTypes.MESSAGES_UPSERT, async (messageUpdate) => {
      await this.messageHandler.handleMessagesUpsert(sock, sessionId, messageUpdate)
    })

    // Message updates (edit, delivery status)
    sock.ev.on(EventTypes.MESSAGES_UPDATE, async (updates) => {
      await this.messageHandler.handleMessagesUpdate(sock, sessionId, updates)
    })

    // Message deletions
    sock.ev.on(EventTypes.MESSAGES_DELETE, async (deletions) => {
      await this.messageHandler.handleMessagesDelete(sock, sessionId, deletions)
    })

    // Message reactions
    sock.ev.on(EventTypes.MESSAGES_REACTION, async (reactions) => {
      await this.messageHandler.handleMessagesReaction(sock, sessionId, reactions)
    })

    // Read receipts (optional - usually disabled)
    // sock.ev.on(EventTypes.MESSAGE_RECEIPT_UPDATE, async (receipts) => {
    //   await this.messageHandler.handleReceiptUpdate(sock, sessionId, receipts)
    // })
  }

  /**
   * Setup group events
   */
  _setupGroupEvents(sock, sessionId) {
    // New groups joined
    sock.ev.on(EventTypes.GROUPS_UPSERT, async (groups) => {
      await this.groupHandler.handleGroupsUpsert(sock, sessionId, groups)
    })

    // Group metadata changes (name, description, settings)
    sock.ev.on(EventTypes.GROUPS_UPDATE, async (updates) => {
      await this.groupHandler.handleGroupsUpdate(sock, sessionId, updates)
    })

    // Participant changes (add, remove, promote, demote)
    sock.ev.on(EventTypes.GROUP_PARTICIPANTS_UPDATE, async (update) => {
      await this.groupHandler.handleParticipantsUpdate(sock, sessionId, update)
    })
  }

  /**
   * Setup contact events
   */
  _setupContactEvents(sock, sessionId) {
    // New contacts
    sock.ev.on(EventTypes.CONTACTS_UPSERT, async (contacts) => {
      await this.connectionHandler.handleContactsUpsert(sock, sessionId, contacts)
    })

    // Contact updates (name changes)
    sock.ev.on(EventTypes.CONTACTS_UPDATE, async (updates) => {
      await this.connectionHandler.handleContactsUpdate(sock, sessionId, updates)
    })
  }

  /**
   * Setup chat events
   */
  _setupChatEvents(sock, sessionId) {
    // New chats
    sock.ev.on(EventTypes.CHATS_UPSERT, async (chats) => {
      await this.connectionHandler.handleChatsUpsert(sock, sessionId, chats)
    })

    // Chat updates
    sock.ev.on(EventTypes.CHATS_UPDATE, async (updates) => {
      await this.connectionHandler.handleChatsUpdate(sock, sessionId, updates)
    })

    // Chat deletions
    sock.ev.on(EventTypes.CHATS_DELETE, async (deletions) => {
      await this.connectionHandler.handleChatsDelete(sock, sessionId, deletions)
    })
  }

  /**
   * Setup presence events
   */
  _setupPresenceEvents(sock, sessionId) {
    sock.ev.on(EventTypes.PRESENCE_UPDATE, async (update) => {
      await this.connectionHandler.handlePresenceUpdate(sock, sessionId, update)
    })
  }

  /**
   * Setup utility events
   */
  _setupUtilityEvents(sock, sessionId) {
    // Incoming calls
    sock.ev.on(EventTypes.CALL, async (calls) => {
      await this.utilityHandler.handleCalls(sock, sessionId, calls)
    })

    // Blocklist changes
    sock.ev.on(EventTypes.BLOCKLIST_SET, async (blocklist) => {
      await this.utilityHandler.handleBlocklistSet(sock, sessionId, blocklist)
    })

    sock.ev.on(EventTypes.BLOCKLIST_UPDATE, async (update) => {
      await this.utilityHandler.handleBlocklistUpdate(sock, sessionId, update)
    })
  }

  /**
   * Cleanup all event listeners for a session
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
   * Get statistics
   */
  getStats() {
    return {
      activeSessions: this.handlers.size,
      handlers: {
        message: !!this.messageHandler,
        group: !!this.groupHandler,
        connection: !!this.connectionHandler,
        utility: !!this.utilityHandler
      }
    }
  }
}