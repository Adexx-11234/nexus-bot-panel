import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('GROUP_EVENTS')

/**
 * GroupEventHandler - Handles group-related events
 * Includes: group metadata updates, participant changes
 */
export class GroupEventHandler {
  constructor() {
    // Stateless handler
  }

  /**
   * Handle new groups joined
   */
  async handleGroupsUpsert(sock, sessionId, groups) {
    try {
      if (!groups || groups.length === 0) {
        return
      }

      logger.info(`Joined ${groups.length} new groups for ${sessionId}`)

      for (const group of groups) {
        try {
          logger.info(`New group: ${group.subject} (${group.id})`)

          // Can be extended to store group info
          // const { GroupQueries } = await import('../../database/query.js')
          // await GroupQueries.storeGroup(sessionId, group)

        } catch (error) {
          logger.error(`Failed to process new group:`, error)
        }
      }

    } catch (error) {
      logger.error(`Groups upsert error for ${sessionId}:`, error)
    }
  }

  /**
   * Handle group metadata updates
   * IMPORTANT: Invalidates group cache automatically
   */
async handleGroupsUpdate(sock, sessionId, updates) {
  try {
    if (!updates || updates.length === 0) {
      return
    }

    logger.debug(`Processing ${updates.length} group updates for ${sessionId}`)

    // Import cache update functions
    const { updateCacheFromEvent, invalidateGroupCache } = await import('../../config/baileys.js')

    for (const update of updates) {
      try {
        const { id } = update

        // Log what changed
        const changes = []
        if (update.subject !== undefined) changes.push(`name: ${update.subject}`)
        if (update.desc !== undefined) changes.push('description')
        if (update.announce !== undefined) changes.push(`announce: ${update.announce}`)
        if (update.restrict !== undefined) changes.push(`restrict: ${update.restrict}`)

        if (changes.length > 0) {
          logger.info(`Group ${id} updated: ${changes.join(', ')}`)
        }

        // OPTIMIZATION: Proactively update cache instead of just invalidating
        // This prevents rate limit issues since event data is already available
        const cacheUpdated = updateCacheFromEvent(id, update)
        
        if (!cacheUpdated) {
          // Cache didn't exist, invalidate to fetch fresh next time
          invalidateGroupCache(id, 'group_update')
        }

      } catch (error) {
        logger.error(`Failed to process group update:`, error)
      }
    }

  } catch (error) {
    logger.error(`Groups update error for ${sessionId}:`, error)
  }
}

  /**
   * Handle group participant changes
   * IMPORTANT: Invalidates group cache and sends welcome/goodbye messages
   */
async handleParticipantsUpdate(sock, sessionId, update) {
  try {
    const { id: groupJid, participants, action } = update

    logger.info(`Group ${groupJid} participants ${action}: ${participants.length} users`)

    const { updateParticipantsInCache } = await import('../../config/baileys.js')
    const { resolveParticipants, getMessageFormatter } = await import('../groups/index.js')

    await updateParticipantsInCache(sock, groupJid, update)

    // Step 1: Resolve JIDs and display names
    const resolvedParticipants = await resolveParticipants(sock, groupJid, participants, action)

    // Step 2: Format with messages and fake quotes (THIS WAS MISSING!)
    const formatter = getMessageFormatter()
    const detailedMessages = await formatter.formatParticipants(sock, groupJid, resolvedParticipants, action)

    logger.info(`Created ${detailedMessages.length} detailed messages for ${action}`)

    const enhancedUpdate = {
      ...update,
      participants: resolvedParticipants.map(p => p.jid),
      detailedMessages: detailedMessages
    }

    const systemMessage = {
      chat: groupJid,
      isGroup: true,
      sessionId: sessionId,
      key: {
        id: `SYSTEM_${Date.now()}_${action}`,
        remoteJid: groupJid,
        fromMe: false,
        participant: resolvedParticipants[0]?.jid
      },
      fromMe: false,
      messageTimestamp: Math.floor(Date.now() / 1000) + 3600,
      message: { conversation: `System notification: ${action} event` }
    }

    const { handleGroupParticipantsUpdate } = await import('../handlers/index.js')
    await handleGroupParticipantsUpdate(sessionId, enhancedUpdate, sock, systemMessage)

  } catch (error) {
    logger.error(`Participants update error for ${sessionId}:`, error)
  }
}
}