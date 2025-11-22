import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('UTILITY_EVENTS')

/**
 * UtilityEventHandler - Handles miscellaneous events
 * Includes: calls, blocklist
 */
export class UtilityEventHandler {
  constructor() {
    // Stateless handler
  }

  /**
   * Handle incoming/outgoing calls
   */
  async handleCalls(sock, sessionId, calls) {
    try {
      if (!calls || calls.length === 0) {
        return
      }

      logger.debug(`Processing ${calls.length} calls for ${sessionId}`)

      for (const call of calls) {
        try {
          const { id, from, status, isVideo, isGroup } = call

          logger.info(
            `Call ${status}: ${id} from ${from} ` +
            `(${isVideo ? 'video' : 'voice'}${isGroup ? ', group' : ''})`
          )

          // Can be extended to:
          // 1. Auto-reject calls
          // 2. Store call logs
          // 3. Send notifications

          // Example: Auto-reject incoming calls
          // if (status === 'offer' && !call.fromMe) {
          //   await sock.rejectCall(id, from)
          //   logger.info(`Auto-rejected call from ${from}`)
          // }

        } catch (error) {
          logger.error(`Failed to process call:`, error)
        }
      }

    } catch (error) {
      logger.error(`Calls error for ${sessionId}:`, error)
    }
  }

  /**
   * Handle blocklist set (initial blocklist)
   */
  async handleBlocklistSet(sock, sessionId, blocklist) {
    try {
      logger.info(`Blocklist set for ${sessionId}: ${blocklist.length} contacts`)

      // Can be extended to store blocklist
      // const { UserQueries } = await import('../../database/query.js')
      // await UserQueries.setBlocklist(sessionId, blocklist)

    } catch (error) {
      logger.error(`Blocklist set error for ${sessionId}:`, error)
    }
  }

  /**
   * Handle blocklist updates (block/unblock)
   */
  async handleBlocklistUpdate(sock, sessionId, update) {
    try {
      const { added, removed } = update

      if (added && added.length > 0) {
        logger.info(`Blocked ${added.length} contacts: ${added.join(', ')}`)
      }

      if (removed && removed.length > 0) {
        logger.info(`Unblocked ${removed.length} contacts: ${removed.join(', ')}`)
      }

      // Can be extended to update blocklist in database
      // const { UserQueries } = await import('../../database/query.js')
      // if (added?.length) await UserQueries.addToBlocklist(sessionId, added)
      // if (removed?.length) await UserQueries.removeFromBlocklist(sessionId, removed)

    } catch (error) {
      logger.error(`Blocklist update error for ${sessionId}:`, error)
    }
  }

  /**
   * Manual control: Mark message as read
   */
  async markMessageAsRead(sock, messageKey) {
    try {
      await sock.readMessages([messageKey])
      logger.debug(`Marked message ${messageKey.id} as read`)
    } catch (error) {
      logger.error('Mark as read error:', error)
    }
  }

/**
 * Manual control: Set presence status
 */
async setPresence(sock, status = 'unavailable') {
  try {
    // Use presence manager if available
    const { getPresenceManager } = await import('../utils/index.js')
    const manager = getPresenceManager()
    await manager._sendPresence(sock, status)
    logger.debug(`Presence set to: ${status}`)
  } catch (error) {
    logger.error('Set presence error:', error)
  }
}

  /**
   * Manual control: Update typing status
   */
  async updateTypingStatus(sock, chatJid, isTyping) {
    try {
      const status = isTyping ? 'composing' : 'paused'
      await sock.sendPresenceUpdate(status, chatJid)
      logger.debug(`Typing status: ${status} for ${chatJid}`)
    } catch (error) {
      logger.error('Update typing status error:', error)
    }
  }
}