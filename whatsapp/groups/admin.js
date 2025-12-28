import { createComponentLogger } from '../../utils/logger.js'
import { getGroupMetadataManager } from './metadata.js'
import { resolveLidToJid } from './lid-resolver.js'

const logger = createComponentLogger('GROUP_ADMIN')

/**
 * GroupAdminChecker - Consolidated admin checking functionality
 * All admin-related checks in one place
 */
export class GroupAdminChecker {
  constructor() {
    this.metadataManager = getGroupMetadataManager()
  }

  /**
   * Normalize JID for comparison
   * @private
   */
  _normalizeJid(jid) {
    if (!jid) return ''

    // Don't normalize LIDs - they need to be resolved first
    if (jid.endsWith('@lid')) {
      return jid
    }

    // Handle colon format like "1234567890:16@s.whatsapp.net"
    if (jid.includes(':')) {
      jid = jid.split(':')[0]
    }

    // Add @s.whatsapp.net if not present
    if (/^\d+$/.test(jid)) {
      return `${jid}@s.whatsapp.net`
    }

    return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
  }

  /**
   * Extract phone number from any JID format
   * @private
   */
  _extractPhoneNumber(jid) {
    if (!jid) return ''
    
    // Remove everything after @
    let phone = jid.split('@')[0]
    
    // Remove everything after : (for formats like "1234:16")
    if (phone.includes(':')) {
      phone = phone.split(':')[0]
    }
    
    return phone
  }

  /**
   * Check if user is group admin
   */
  async isGroupAdmin(sock, groupJid, userJid) {
    try {
      if (!groupJid.endsWith('@g.us')) {
        return false
      }

      // Resolve LID if necessary
      let resolvedJid = userJid
      if (userJid.endsWith('@lid')) {
        resolvedJid = await resolveLidToJid(sock, groupJid, userJid)
      }

      const normalizedUserJid = this._normalizeJid(resolvedJid)
      const userPhone = this._extractPhoneNumber(resolvedJid)
      
      const participants = await this.metadataManager.getParticipants(sock, groupJid)

      const isAdmin = participants.some(p => {
        const participantId = p.id || p.jid
        const participantJid = p.jid || p.id
        
        const normalizedParticipantId = this._normalizeJid(participantId)
        const normalizedParticipantJid = this._normalizeJid(participantJid)
        const participantPhone = this._extractPhoneNumber(participantId)
        
        const hasAdminRole = p.admin === 'admin' || p.admin === 'superadmin'
        
        const isMatch = (
          normalizedParticipantId === normalizedUserJid ||
          normalizedParticipantJid === normalizedUserJid ||
          participantPhone === userPhone ||
          participantId === userJid ||
          participantJid === userJid
        )
        
        return isMatch && hasAdminRole
      })

      logger.debug(`Admin check for ${userJid} in ${groupJid}: ${isAdmin}`)
      return isAdmin

    } catch (error) {
      logger.error(`Error checking admin status for ${userJid}:`, error)
      return false
    }
  }

  /**
   * ✅ FIXED: Check if bot is group admin - DIRECT CHECK
   */
  async isBotAdmin(sock, groupJid) {
    try {
      if (!groupJid.endsWith('@g.us')) {
        logger.debug(`Not a group JID: ${groupJid}`)
        return false
      }

      const rawBotId = sock.user?.id || ''
      if (!rawBotId) {
        logger.warn('Bot user ID not available')
        return false
      }

      // Extract bot phone number from various formats
      // sock.user.id can be: "1234567890:16@s.whatsapp.net" or "1234567890@s.whatsapp.net"
      const botPhone = this._extractPhoneNumber(rawBotId)
      const botJid = this._normalizeJid(botPhone)
      
      logger.debug(`Bot ID check - Raw: ${rawBotId}, Phone: ${botPhone}, Normalized: ${botJid}`)
      
      // Get participants directly
      const participants = await this.metadataManager.getParticipants(sock, groupJid)
      
      if (!participants || participants.length === 0) {
        logger.warn(`No participants found for group ${groupJid}`)
        return false
      }
      
      logger.debug(`Checking ${participants.length} participants for bot admin status`)
      
      // Check if bot is in participants with admin role
      const botParticipant = participants.find(p => {
        const participantId = p.id || p.jid
        const participantPhone = this._extractPhoneNumber(participantId)
        const participantJid = this._normalizeJid(participantId)
        
        const isMatch = (
          participantPhone === botPhone ||
          participantJid === botJid ||
          participantId === rawBotId ||
          participantId.includes(botPhone)
        )
        
        if (isMatch) {
          logger.debug(`Found bot participant - ID: ${participantId}, Admin: ${p.admin}`)
        }
        
        return isMatch
      })

      if (!botParticipant) {
        logger.warn(`Bot not found in group participants for ${groupJid}`)
        logger.debug(`Bot phone: ${botPhone}, Participant phones: ${participants.map(p => this._extractPhoneNumber(p.id || p.jid)).join(', ')}`)
        return false
      }

      const isAdmin = botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin'
      
      logger.debug(`Bot admin status in ${groupJid}: ${isAdmin} (role: ${botParticipant.admin})`)
      
      return isAdmin

    } catch (error) {
      logger.error(`Error checking bot admin status in ${groupJid}:`, error)
      return false
    }
  }

  /**
   * Check if user is group owner
   */
  async isGroupOwner(sock, groupJid, userJid) {
    try {
      if (!groupJid.endsWith('@g.us')) {
        return false
      }

      const owner = await this.metadataManager.getGroupOwner(sock, groupJid)
      if (!owner) return false

      // Resolve LID if necessary
      let resolvedJid = userJid
      if (userJid.endsWith('@lid')) {
        resolvedJid = await resolveLidToJid(sock, groupJid, userJid)
      }

      const normalizedUserJid = this._normalizeJid(resolvedJid)
      const normalizedOwner = this._normalizeJid(owner)
      const userPhone = this._extractPhoneNumber(resolvedJid)
      const ownerPhone = this._extractPhoneNumber(owner)

      const isOwner = (
        normalizedOwner === normalizedUserJid || 
        owner === userJid ||
        ownerPhone === userPhone
      )

      logger.debug(`Owner check for ${userJid} in ${groupJid}: ${isOwner}`)
      return isOwner

    } catch (error) {
      logger.error(`Error checking owner status for ${userJid}:`, error)
      return false
    }
  }

  /**
   * Get all group admins
   */
  async getGroupAdmins(sock, groupJid) {
    try {
      if (!groupJid.endsWith('@g.us')) {
        return []
      }

      return await this.metadataManager.getAdmins(sock, groupJid)

    } catch (error) {
      logger.error(`Error getting group admins for ${groupJid}:`, error)
      return []
    }
  }

  /**
   * Get admin count
   */
  async getAdminCount(sock, groupJid) {
    try {
      const admins = await this.getGroupAdmins(sock, groupJid)
      return admins.length
    } catch (error) {
      logger.error(`Error getting admin count for ${groupJid}:`, error)
      return 0
    }
  }

  /**
   * Check if user has admin privileges (admin or owner)
   */
  async hasAdminPrivileges(sock, groupJid, userJid) {
    try {
      const isAdmin = await this.isGroupAdmin(sock, groupJid, userJid)
      if (isAdmin) return true

      const isOwner = await this.isGroupOwner(sock, groupJid, userJid)
      return isOwner

    } catch (error) {
      logger.error(`Error checking admin privileges for ${userJid}:`, error)
      return false
    }
  }
}

// Singleton instance
let adminCheckerInstance = null

/**
 * Get admin checker singleton
 */
export function getGroupAdminChecker() {
  if (!adminCheckerInstance) {
    adminCheckerInstance = new GroupAdminChecker()
  }
  return adminCheckerInstance
}

// Convenience functions for direct use
export async function isGroupAdmin(sock, groupJid, userJid) {
  const checker = getGroupAdminChecker()
  return await checker.isGroupAdmin(sock, groupJid, userJid)
}

export async function isBotAdmin(sock, groupJid) {
  const checker = getGroupAdminChecker()
  return await checker.isBotAdmin(sock, groupJid)
}

export async function isGroupOwner(sock, groupJid, userJid) {
  const checker = getGroupAdminChecker()
  return await checker.isGroupOwner(sock, groupJid, userJid)
}

export async function getGroupAdmins(sock, groupJid) {
  const checker = getGroupAdminChecker()
  return await checker.getGroupAdmins(sock, groupJid)
}