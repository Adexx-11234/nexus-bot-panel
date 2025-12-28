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
      const participants = await this.metadataManager.getParticipants(sock, groupJid)

      const isAdmin = participants.some(p => {
        const participantId = p.id || p.jid
        const participantJid = p.jid || p.id
        
        const normalizedParticipantId = this._normalizeJid(participantId)
        const normalizedParticipantJid = this._normalizeJid(participantJid)
        
        const hasAdminRole = p.admin === 'admin' || p.admin === 'superadmin'
        
        const isMatch = (
          normalizedParticipantId === normalizedUserJid ||
          normalizedParticipantJid === normalizedUserJid ||
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
   * Check if bot is group admin
   */
  async isBotAdmin(sock, groupJid) {
    try {
      if (!groupJid.endsWith('@g.us')) {
        return false
      }

      const rawBotId = sock.user?.id || ''
      if (!rawBotId) return false

      const botNumber = this._normalizeJid(rawBotId.split(':')[0])
      
      logger.debug(`Checking bot admin status - Bot JID: ${botNumber}`)
      
      return await this.isGroupAdmin(sock, groupJid, botNumber)

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

      const isOwner = normalizedOwner === normalizedUserJid || owner === userJid

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