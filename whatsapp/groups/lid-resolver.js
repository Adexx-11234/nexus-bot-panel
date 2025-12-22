import { createComponentLogger } from '../../utils/logger.js'
import { getGroupMetadataManager } from './metadata.js'

const logger = createComponentLogger('LID_RESOLVER')

/**
 * Check if a JID is a LID (Baileys v7+)
 */
export function isLid(jid) {
  return jid && jid.endsWith('@lid')
}

/**
 * Check if a JID is a phone number (PN)
 */
export function isPn(jid) {
  return jid && jid.endsWith('@s.whatsapp.net')
}

/**
 * Get LID from phone number using Baileys v7 signal repository
 */
export async function getLidForPn(sock, phoneNumber) {
  try {
    // Baileys v7+ method
    if (sock.signalRepository?.lidMapping?.getLIDForPN) {
      const lid = await sock.signalRepository.lidMapping.getLIDForPN(phoneNumber)
      if (lid) return lid
    }
    
    // Fallback: phone number is still valid
    return phoneNumber
  } catch (error) {
    logger.error(`Error getting LID for ${phoneNumber}:`, error)
    return phoneNumber
  }
}

/**
 * Get phone number from LID using Baileys v7 signal repository
 */
export async function getPnForLid(sock, lid) {
  try {
    // Baileys v7+ method
    if (sock.signalRepository?.lidMapping?.getPNForLID) {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(lid)
      if (pn) return pn
    }
    
    // Fallback: return LID as-is
    return lid
  } catch (error) {
    logger.error(`Error getting PN for ${lid}:`, error)
    return lid
  }
}

/**
 * Resolve LID to actual phone number JID (backward compatible)
 * Supports both Baileys v6 and v7
 * 
 * FAST PATH: If not a LID, return immediately without any processing
 */
export async function resolveLidToJid(sock, groupJid, lidJid) {
  try {
    // FAST PATH: Not a LID, return immediately
    if (!isLid(lidJid)) {
      return lidJid
    }

    // Try Baileys v7 method first
    const pn = await getPnForLid(sock, lidJid)
    if (pn && pn !== lidJid) {
      return pn
    }

    // Fallback to group metadata method (v6 and v7)
    const metadataManager = getGroupMetadataManager()
    const metadata = await metadataManager.getMetadata(sock, groupJid)

    if (!metadata?.participants) {
      logger.warn(`No metadata found for ${groupJid}, cannot resolve LID`)
      return lidJid
    }

    // v7: Check both 'id' and 'lid' fields, prefer phoneNumber
    const participant = metadata.participants.find(p => 
      p.id === lidJid || p.lid === lidJid
    )

    if (participant) {
      // v7: phoneNumber field exists when id is a LID
      if (participant.phoneNumber) {
        return participant.phoneNumber
      }
      // v6: jid field
      if (participant.jid) {
        return participant.jid
      }
    }

    logger.warn(`Could not resolve LID ${lidJid} in ${groupJid}`)
    return lidJid

  } catch (error) {
    logger.error(`Error resolving LID ${lidJid}:`, error)
    return lidJid
  }
}

/**
 * Resolve multiple LIDs to JIDs (backward compatible)
 * Optimized to skip non-LID entries immediately
 */
export async function resolveLidsToJids(sock, groupJid, lids) {
  const resolved = []

  // Filter LIDs and non-LIDs
  const lidsToResolve = lids.filter(lid => isLid(lid))
  const nonLids = lids.filter(lid => !isLid(lid))

  // Add non-LIDs as-is (no processing needed)
  resolved.push(...nonLids)

  // Try Baileys v7 batch method first
  if (lidsToResolve.length > 0 && sock.signalRepository?.lidMapping?.getPNForLID) {
    for (const lid of lidsToResolve) {
      const pn = await getPnForLid(sock, lid)
      resolved.push(pn)
    }
    return resolved
  }

  // Fallback to metadata method
  if (lidsToResolve.length > 0) {
    const metadataManager = getGroupMetadataManager()
    const metadata = await metadataManager.getMetadata(sock, groupJid)

    if (metadata?.participants) {
      for (const lid of lidsToResolve) {
        const participant = metadata.participants.find(p => 
          p.id === lid || p.lid === lid
        )

        if (participant) {
          // v7: phoneNumber field
          if (participant.phoneNumber) {
            resolved.push(participant.phoneNumber)
            continue
          }
          // v6: jid field
          if (participant.jid) {
            resolved.push(participant.jid)
            continue
          }
        }
        
        // Couldn't resolve, keep LID
        resolved.push(lid)
      }
    } else {
      // No metadata, return LIDs as-is
      resolved.push(...lidsToResolve)
    }
  }

  return resolved
}

/**
 * Resolve participant information with LID support (v6 & v7 compatible)
 * Returns enriched participant data for welcome/goodbye messages
 */
export async function resolveParticipants(sock, groupJid, participants, action) {
  const resolved = []
  
  try {
    // Check if we have any LIDs to resolve
    const hasLids = participants.some(p => isLid(p))

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
        let phoneNumber = null
        let displayName = participant.split('@')[0]

        // FAST PATH: Not a LID, minimal processing
        if (!isLid(participant)) {
          resolved.push({
            jid: actualJid,
            phoneNumber: isPn(actualJid) ? actualJid : null,
            lid: null,
            originalId: participant,
            displayName: `@${displayName}`,
            action: action
          })
          continue
        }

        // Try Baileys v7 signal repository first
        const pn = await getPnForLid(sock, participant)
        if (pn && pn !== participant) {
          actualJid = pn
          phoneNumber = pn
        }

        // Resolve using metadata
        if (metadata?.participants) {
          const participantInfo = metadata.participants.find(p => 
            p.id === participant || p.lid === participant
          )

          if (participantInfo) {
            // v7: Use 'id' as the preferred identifier
            if (participantInfo.id) {
              actualJid = participantInfo.id
            }
            
            // v7: phoneNumber field when id is LID
            if (participantInfo.phoneNumber) {
              phoneNumber = participantInfo.phoneNumber
              // Use phone number as actual JID if available
              actualJid = participantInfo.phoneNumber
            }
            
            // v6 fallback: jid field
            if (!phoneNumber && participantInfo.jid) {
              actualJid = participantInfo.jid
              if (isPn(participantInfo.jid)) {
                phoneNumber = participantInfo.jid
              }
            }
            
            // Get display name
            if (participantInfo.notify) {
              displayName = participantInfo.notify
            } else if (phoneNumber) {
              displayName = phoneNumber.split('@')[0]
            } else if (participantInfo.jid) {
              displayName = participantInfo.jid.split('@')[0]
            }
          }
        }

        resolved.push({
          jid: actualJid,
          phoneNumber: phoneNumber,
          lid: isLid(participant) ? participant : null,
          originalId: participant,
          displayName: `@${displayName}`,
          action: action
        })

      } catch (error) {
        logger.error(`Failed to resolve participant ${participant}:`, error)
        // Add fallback participant data
        resolved.push({
          jid: participant,
          phoneNumber: isPn(participant) ? participant : null,
          lid: isLid(participant) ? participant : null,
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
 * Get participant display name (v6 & v7 compatible)
 * Optimized to skip metadata call for non-LIDs
 */
export async function getParticipantName(sock, groupJid, participantJid) {
  try {
    // FAST PATH: Regular phone number JID, just return formatted name
    if (isPn(participantJid)) {
      return `@${participantJid.split('@')[0]}`
    }

    // For LIDs, try to get phone number first
    if (isLid(participantJid)) {
      const pn = await getPnForLid(sock, participantJid)
      if (pn && pn !== participantJid) {
        return `@${pn.split('@')[0]}`
      }
    }

    // Fetch metadata for detailed info
    const metadataManager = getGroupMetadataManager()
    const metadata = await metadataManager.getMetadata(sock, groupJid)

    if (!metadata?.participants) {
      return `@${participantJid.split('@')[0]}`
    }

    const participant = metadata.participants.find(p =>
      p.id === participantJid || p.lid === participantJid || p.jid === participantJid
    )

    if (participant) {
      // Priority: notify > phoneNumber > jid
      if (participant.notify) {
        return `@${participant.notify}`
      }
      if (participant.phoneNumber) {
        return `@${participant.phoneNumber.split('@')[0]}`
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

/**
 * Get preferred identifier for a participant (v7)
 * Returns the 'id' field which is the preferred one by WhatsApp
 */
export function getPreferredId(participant) {
  if (!participant) return null
  
  // v7: id field is the preferred identifier
  if (participant.id) return participant.id
  
  // v6 fallback
  if (participant.jid) return participant.jid
  
  return null
}

/**
 * Get all identifiers for a participant (for matching)
 */
export function getAllIdentifiers(participant) {
  const identifiers = new Set()
  
  if (participant.id) identifiers.add(participant.id)
  if (participant.jid) identifiers.add(participant.jid)
  if (participant.lid) identifiers.add(participant.lid)
  if (participant.phoneNumber) identifiers.add(participant.phoneNumber)
  
  return Array.from(identifiers)
}

/**
 * Check if two JIDs refer to the same user (v7 compatible)
 */
export async function isSameUser(sock, jid1, jid2) {
  if (jid1 === jid2) return true
  
  // Try to resolve both to phone numbers
  const pn1 = isLid(jid1) ? await getPnForLid(sock, jid1) : jid1
  const pn2 = isLid(jid2) ? await getPnForLid(sock, jid2) : jid2
  
  return pn1 === pn2
}