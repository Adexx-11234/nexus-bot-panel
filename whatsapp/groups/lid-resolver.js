import { createComponentLogger } from '../../utils/logger.js'
import { getGroupMetadataManager } from './metadata.js'
import { normalizeJid, isLidJid } from '../utils/jid.js'

const logger = createComponentLogger('LID_RESOLVER')

/**
 * ============================================================================
 * LID RESOLUTION UTILITIES (BAILEYS 7.X)
 * ============================================================================
 */

/**
 * Helper to safely extract JID/LID from participant
 * Baileys 7.x changed participant structure to objects with 'id' field
 * Also normalizes JID to remove :0, :1 suffixes
 */
function getParticipantId(participant) {
  if (!participant) return null
  
  let id = null
  
  // Baileys 7.x: participant is an object with 'id' field
  if (typeof participant === 'object' && participant.id) {
    id = participant.id
  }
  // Legacy: participant is a string
  else if (typeof participant === 'string') {
    id = participant
  }
  
  // Normalize to remove :0 suffix (but keep LIDs as-is)
  return id ? normalizeJid(id) : null
}

/**
 * Use Baileys 7.x LID mapping store to resolve LID to PN (Phone Number)
 */
async function resolveLidWithStore(sock, lidJid) {
  try {
    if (!sock?.signalRepository?.lidMapping) {
      return null
    }
    
    const pn = await sock.signalRepository.lidMapping.getPNForLID(lidJid)
    if (pn) {
      const normalized = normalizeJid(pn)
      logger.debug(`Resolved LID ${lidJid} to PN ${normalized} using signal store`)
      return normalized
    }
  } catch (error) {
    logger.debug(`Signal store lookup failed for ${lidJid}: ${error.message}`)
  }
  
  return null
}

/**
 * ============================================================================
 * MAIN LID RESOLUTION FUNCTIONS
 * ============================================================================
 */

/**
 * Resolve LID (Lightweight ID) to actual phone number JID
 * LIDs are temporary identifiers used in groups
 * 
 * FAST PATH: If not a LID, return immediately without any processing
 * 
 * Resolution Strategy:
 * 1. Try Baileys 7.x signal repository (official LID mapping store)
 * 2. Try group metadata lookup
 * 3. Return original LID as fallback
 */
export async function resolveLidToJid(sock, groupJid, lidJid) {
  try {
    // FAST PATH: Not a LID, just normalize and return
    if (!lidJid || !isLidJid(lidJid)) {
      return normalizeJid(lidJid)
    }

    // TRY 1: Use Baileys 7.x signal repository LID mapping store
    const pnFromStore = await resolveLidWithStore(sock, lidJid)
    if (pnFromStore) {
      return pnFromStore // Already normalized in resolveLidWithStore
    }

    // TRY 2: Get group metadata (only if we have a LID to resolve)
    const metadataManager = getGroupMetadataManager()
    const metadata = await metadataManager.getMetadata(sock, groupJid)

    if (!metadata?.participants) {
      logger.debug(`No metadata found for ${groupJid}, returning original LID`)
      return lidJid // ✅ Return original LID instead of warning
    }

    // Find participant - handle both Baileys 6.x and 7.x structures
    const participant = metadata.participants.find(p => {
      const participantId = getParticipantId(p)
      return participantId === lidJid || p.lid === lidJid
    })

    if (participant) {
      // Baileys 7.x: p.phoneNumber is the PN when id is LID
      if (participant.phoneNumber) {
        const normalized = normalizeJid(participant.phoneNumber)
        logger.debug(`Resolved LID ${lidJid} to ${normalized} from metadata`)
        return normalized
      }
      
      // Baileys 6.x fallback: p.jid is the actual JID
      if (participant.jid) {
        const normalized = normalizeJid(participant.jid)
        logger.debug(`Resolved LID ${lidJid} to ${normalized} from metadata (legacy)`)
        return normalized
      }
    }

    // ✅ Return original LID if not found (no warning spam)
    logger.debug(`Could not resolve LID ${lidJid}, returning original`)
    return lidJid

  } catch (error) {
    // ✅ Return original LID on error instead of logging error
    logger.debug(`Error resolving LID ${lidJid}, returning original: ${error.message}`)
    return lidJid
  }
}

/**
 * Resolve multiple LIDs to JIDs
 * Optimized to skip non-LID entries immediately
 */
export async function resolveLidsToJids(sock, groupJid, lids) {
  const resolved = []

  // Handle array of strings OR array of objects (Baileys 7.x)
  const lidStrings = lids.map(lid => {
    const id = getParticipantId(lid)
    return id || lid
  })

  // Filter out non-LIDs first (fast path)
  const lidsToResolve = lidStrings.filter(lid => lid && typeof lid === 'string' && isLidJid(lid))
  const nonLids = lidStrings.filter(lid => !lid || typeof lid !== 'string' || !isLidJid(lid))

  // Add non-LIDs as-is (but normalized)
  resolved.push(...nonLids.map(jid => normalizeJid(jid)))

  // Only fetch metadata if we have LIDs to resolve
  if (lidsToResolve.length > 0) {
    try {
      const metadataManager = getGroupMetadataManager()
      const metadata = await metadataManager.getMetadata(sock, groupJid)

      if (metadata?.participants) {
        for (const lid of lidsToResolve) {
          // Try signal store first
          const pnFromStore = await resolveLidWithStore(sock, lid)
          if (pnFromStore) {
            resolved.push(pnFromStore) // Already normalized
            continue
          }

          // Find in metadata
          const participant = metadata.participants.find(p => {
            const participantId = getParticipantId(p)
            return participantId === lid || p.lid === lid
          })

          if (participant) {
            if (participant.phoneNumber) {
              resolved.push(normalizeJid(participant.phoneNumber))
            } else if (participant.jid) {
              resolved.push(normalizeJid(participant.jid))
            } else {
              resolved.push(lid)
            }
            logger.debug(`Resolved LID ${lid} in batch`)
          } else {
            // ✅ Return original LID if not found
            resolved.push(lid)
          }
        }
      } else {
        // ✅ No metadata, return LIDs as-is
        resolved.push(...lidsToResolve)
      }
    } catch (error) {
      // ✅ On error, return LIDs as-is
      logger.debug(`Error in batch LID resolution, returning originals: ${error.message}`)
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
    // Convert participants to string IDs (handle Baileys 7.x objects)
    const participantIds = participants.map(p => {
      const id = getParticipantId(p)
      return id || p
    }).filter(id => id && typeof id === 'string')

    // Check if we have any LIDs to resolve
    const hasLids = participantIds.some(p => isLidJid(p))

    // Only fetch metadata if we have LIDs to resolve
    let metadata = null
    if (hasLids) {
      try {
        const metadataManager = getGroupMetadataManager()
        metadata = await metadataManager.getMetadata(sock, groupJid)
      } catch (error) {
        logger.debug(`Failed to get metadata for participant resolution: ${error.message}`)
      }
    }

    // Process all participants
    for (const participantId of participantIds) {
      try {
        let actualJid = participantId
        let displayName = participantId.split('@')[0].split(':')[0] // Remove device suffix

        // FAST PATH: Not a LID, minimal processing
        if (!isLidJid(participantId)) {
          // Normalize to remove device suffix
          actualJid = normalizeJid(participantId)
          displayName = actualJid.split('@')[0]
          
          resolved.push({
            jid: actualJid,
            originalId: participantId,
            displayName: `@${displayName}`,
            action: action
          })
          continue
        }

        // Try signal store first for LIDs
        const pnFromStore = await resolveLidWithStore(sock, participantId)
        if (pnFromStore) {
          actualJid = pnFromStore // Already normalized
          displayName = actualJid.split('@')[0]
        } else if (metadata?.participants) {
          // Resolve LID using metadata
          const participantInfo = metadata.participants.find(p => {
            const pid = getParticipantId(p)
            return pid === participantId || p.lid === participantId
          })

          if (participantInfo) {
            // Baileys 7.x: phoneNumber when id is LID
            if (participantInfo.phoneNumber) {
              actualJid = normalizeJid(participantInfo.phoneNumber)
            } else if (participantInfo.jid) {
              // Baileys 6.x fallback
              actualJid = normalizeJid(participantInfo.jid)
            }
            
            // Get display name
            if (participantInfo.notify) {
              displayName = participantInfo.notify
            } else if (participantInfo.name) {
              displayName = participantInfo.name
            } else if (actualJid) {
              displayName = actualJid.split('@')[0]
            }
          }
        }

        resolved.push({
          jid: actualJid,
          originalId: participantId,
          displayName: `@${displayName}`,
          action: action
        })

      } catch (error) {
        logger.debug(`Failed to resolve participant ${participantId}: ${error.message}`)
        // ✅ Add fallback participant data with original ID
        const cleanId = participantId.split('@')[0].split(':')[0]
        resolved.push({
          jid: participantId,
          originalId: participantId,
          displayName: `@${cleanId}`,
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
    // Handle object participant (Baileys 7.x)
    const participantId = getParticipantId(participantJid) || participantJid
    
    // FAST PATH: Regular JID, just return formatted name
    if (!isLidJid(participantId)) {
      const normalized = normalizeJid(participantId)
      return `@${normalized.split('@')[0]}`
    }

    // Try signal store first
    const pnFromStore = await resolveLidWithStore(sock, participantId)
    if (pnFromStore) {
      return `@${pnFromStore.split('@')[0]}`
    }

    // Only fetch metadata if we have a LID
    try {
      const metadataManager = getGroupMetadataManager()
      const metadata = await metadataManager.getMetadata(sock, groupJid)

      if (!metadata?.participants) {
        return `@${participantId.split('@')[0]}`
      }

      const participant = metadata.participants.find(p => {
        const pid = getParticipantId(p)
        return pid === participantId || p.lid === participantId
      })

      if (participant) {
        if (participant.notify) {
          return `@${participant.notify}`
        }
        if (participant.name) {
          return `@${participant.name}`
        }
        if (participant.phoneNumber) {
          const normalized = normalizeJid(participant.phoneNumber)
          return `@${normalized.split('@')[0]}`
        }
        if (participant.jid) {
          const normalized = normalizeJid(participant.jid)
          return `@${normalized.split('@')[0]}`
        }
      }
    } catch (error) {
      logger.debug(`Error getting participant name: ${error.message}`)
    }

    // ✅ Fallback to original
    return `@${participantId.split('@')[0]}`

  } catch (error) {
    logger.debug(`Failed to get participant name: ${error.message}`)
    const participantId = getParticipantId(participantJid) || participantJid
    return `@${participantId.split('@')[0].split(':')[0]}`
  }
}