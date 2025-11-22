import { createComponentLogger } from '../../utils/logger.js'
import { getGroupMetadataManager } from './metadata.js'
import { resolveParticipants } from './lid-resolver.js'

const logger = createComponentLogger('GROUP_PARTICIPANTS')

/**
 * GroupParticipantsHandler - Handles group participant updates
 * Processes add, remove, promote, demote actions
 */
export class GroupParticipantsHandler {
  constructor() {
    this.metadataManager = getGroupMetadataManager()
    this.notifier = null // Lazy loaded
  }

  /**
   * Handle participant update
   */
  async handleParticipantsUpdate(sock, sessionId, update, m) {
    try {
      const { id: groupJid, participants, action, detailedMessages } = update

      logger.info(`Group ${groupJid} participants ${action}: ${participants.length} users`)

      // Invalidate cache before processing
      this.metadataManager.invalidateCache(groupJid, `participants_${action}`)

      // Get notifier
      if (!this.notifier) {
        const { getGroupNotifier } = await import('./notifier.js')
        this.notifier = getGroupNotifier()
      }

      // Handle action
      switch (action) {
        case 'add':
          await this.notifier.sendWelcomeMessages(
            sock,
            groupJid,
            detailedMessages || []
          )
          break

        case 'remove':
          await this.notifier.sendGoodbyeMessages(
            sock,
            groupJid,
            detailedMessages || []
          )
          break

        case 'promote':
          await this.handlePromotion(sock, groupJid, participants, detailedMessages)
          break

        case 'demote':
          await this.notifier.sendDemotionMessages(
            sock,
            groupJid,
            detailedMessages || []
          )
          break

        default:
          logger.warn(`Unknown participant action: ${action}`)
      }

      // Invalidate cache after processing to ensure fresh data on next fetch
      this.metadataManager.invalidateCache(groupJid, `participants_${action}_complete`)

    } catch (error) {
      logger.error(`Error handling participants update:`, error)
    }
  }

  /**
   * Handle promotion (with database logging)
   */
  async handlePromotion(sock, groupJid, participants, detailedMessages) {
    try {
      // Log admin promotions to database
      const { GroupQueries } = await import('../../database/query.js')

      for (const participant of participants) {
        try {
          await GroupQueries.logAdminPromotion(groupJid, participant, 'system')
        } catch (error) {
          logger.error(`Failed to log promotion for ${participant}:`, error)
        }
      }

      // Send promotion messages
      await this.notifier.sendPromotionMessages(
        sock,
        groupJid,
        detailedMessages || []
      )

    } catch (error) {
      logger.error('Error handling promotion:', error)
    }
  }
}

// Singleton instance
let participantsHandlerInstance = null

/**
 * Get participants handler singleton
 */
export function getGroupParticipantsHandler() {
  if (!participantsHandlerInstance) {
    participantsHandlerInstance = new GroupParticipantsHandler()
  }
  return participantsHandlerInstance
}