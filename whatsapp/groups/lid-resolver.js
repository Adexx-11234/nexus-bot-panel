import { createComponentLogger } from '../../utils/logger.js'
import { getGroupMetadataManager } from './metadata.js'

const logger = createComponentLogger('LID_RESOLVER')

/**
 * Resolve LID (Lightweight ID) to actual phone number JID
 * LIDs are temporary identifiers used in groups
 * 
 * FAST PATH: If not a LID, return immediately without any processing
 */
export async function resolveLidToJid(sock, groupJid, lidJid) {
  try {
    // FAST PATH: Not a LID, return immediately
    if (!lidJid || !lidJid.endsWith('@lid')) {
      return lidJid
    }

    // Get group metadata (only if we have a LID to resolve)
    const metadataManager = getGroupMetadataManager()
    const metadata = await metadataManager.getMetadata(sock, groupJid)

    if (!metadata?.participants) {
      logger.warn(`No metadata found for ${groupJid}, cannot resolve LID`)
      return lidJid
    }

    // Find participant - p.jid is the actual JID we want
    // p.id or p.lid may contain the @lid identifier
    const participant = metadata.participants.find(p => 
      p.id === lidJid || p.lid === lidJid
    )

    if (participant && participant.jid) {
      return participant.jid
    }

    logger.warn(`Could not resolve LID ${lidJid} in ${groupJid}`)
    return lidJid

  } catch (error) {
    logger.error(`Error resolving LID ${lidJid}:`, error)
    return lidJid
  }
}

/**
 * Resolve multiple LIDs to JIDs
 * Optimized to skip non-LID entries immediately
 */
export async function resolveLidsToJids(sock, groupJid, lids) {
  const resolved = []

  // Filter out non-LIDs first (fast path)
  const lidsToResolve = lids.filter(lid => lid && lid.endsWith('@lid'))
  const nonLids = lids.filter(lid => !lid || !lid.endsWith('@lid'))

  // Add non-LIDs as-is (no processing needed)
  resolved.push(...nonLids)

  // Only fetch metadata if we have LIDs to resolve
  if (lidsToResolve.length > 0) {
    const metadataManager = getGroupMetadataManager()
    const metadata = await metadataManager.getMetadata(sock, groupJid)

    if (metadata?.participants) {
      for (const lid of lidsToResolve) {
        const participant = metadata.participants.find(p => 
          p.id === lid || p.lid === lid
        )

        if (participant && participant.jid) {
          resolved.push(participant.jid)
        } else {
          resolved.push(lid)
        }
      }
    } else {
      // No metadata, return LIDs as-is
      resolved.push(...lidsToResolve)
    }
  }

  return resolved
}

/**
 * Resolve participant information with LID support
 * Returns enriched participant data for welcome/goodbye messages
 * Optimized to skip unnecessary metadata calls
 */
export async function resolveParticipants(sock, groupJid, participants, action) {
  const resolved = []
  
  try {
    // Check if we have any LIDs to resolve
    const hasLids = participants.some(p => p && p.endsWith('@lid'))

    // Only fetch metadata if we have LIDs to resolve
    let metadata = null
    if (hasLids) {
      const metadataManager = getGroupMetadataManager()
      metadata = await metadataManager.getMetadata(sock, groupJid)
    }

    // Process all participants
    for (const participant of participants) {
      try {
        let actualJid = participant
        let displayName = participant.split('@')[0]

        // FAST PATH: Not a LID, minimal processing
        if (!participant.endsWith('@lid')) {
          resolved.push({
            jid: actualJid,
            originalId: participant,
            displayName: `@${displayName}`,
            action: action
          })
          continue
        }

        // Resolve LID using metadata
        if (metadata?.participants) {
          const participantInfo = metadata.participants.find(p => 
            p.id === participant || p.lid === participant
          )

          if (participantInfo) {
            // p.jid is the actual JID
            if (participantInfo.jid) {
              actualJid = participantInfo.jid
            }
            
            // Get display name
            if (participantInfo.notify) {
              displayName = participantInfo.notify
            } else if (participantInfo.jid) {
              displayName = participantInfo.jid.split('@')[0]
            }
          }
        }

        resolved.push({
          jid: actualJid,
          originalId: participant,
          displayName: `@${displayName}`,
          action: action
        })

      } catch (error) {
        logger.error(`Failed to resolve participant ${participant}:`, error)
        // Add fallback participant data
        resolved.push({
          jid: participant,
          originalId: participant,
          displayName: `@${participant.split('@')[0]}`,
          action: action
        })
      }
    }

    return resolved

  } catch (error) {
    logger.error(`Failed to resolve participants for ${groupJid}:`, error)
    return []
  }
}

/**
 * Get participant display name
 * Optimized to skip metadata call for non-LIDs
 */
export async function getParticipantName(sock, groupJid, participantJid) {
  try {
    // FAST PATH: Regular JID, just return formatted name
    if (!participantJid.endsWith('@lid')) {
      return `@${participantJid.split('@')[0]}`
    }

    // Only fetch metadata if we have a LID
    const metadataManager = getGroupMetadataManager()
    const metadata = await metadataManager.getMetadata(sock, groupJid)

    if (!metadata?.participants) {
      return `@${participantJid.split('@')[0]}`
    }

    const participant = metadata.participants.find(p =>
      p.id === participantJid || p.lid === participantJid
    )

    if (participant) {
      if (participant.notify) {
        return `@${participant.notify}`
      }
      if (participant.jid) {
        return `@${participant.jid.split('@')[0]}`
      }
    }

    return `@${participantJid.split('@')[0]}`

  } catch (error) {
    logger.error(`Failed to get participant name for ${participantJid}:`, error)
    return `@${participantJid.split('@')[0]}`
  }
}