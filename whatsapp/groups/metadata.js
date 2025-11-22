import { createComponentLogger } from '../../utils/logger.js'
import {
  getGroupMetadata,
  invalidateGroupCache,
  refreshGroupMetadata
} from '../../config/baileys.js'

const logger = createComponentLogger('GROUP_METADATA')

/**
 * GroupMetadataManager - Wrapper around existing baileys cache
 * Uses the cache already implemented in config/baileys.js
 */
export class GroupMetadataManager {
  constructor() {
    // No separate cache - use existing one from baileys config
  }

  /**
   * Get group metadata (uses existing cache)
   */
  async getMetadata(sock, groupJid) {
    try {
      if (!groupJid || !groupJid.endsWith('@g.us')) {
        return null
      }

      return await getGroupMetadata(sock, groupJid)

    } catch (error) {
      logger.error(`Failed to get metadata for ${groupJid}:`, error)
      return null
    }
  }

  /**
   * Get group participants
   */
  async getParticipants(sock, groupJid) {
    try {
      const metadata = await this.getMetadata(sock, groupJid)
      return metadata?.participants || []
    } catch (error) {
      logger.error(`Failed to get participants for ${groupJid}:`, error)
      return []
    }
  }

  /**
   * Get group admins
   */
  async getAdmins(sock, groupJid) {
    try {
      const participants = await this.getParticipants(sock, groupJid)
      return participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin')
    } catch (error) {
      logger.error(`Failed to get admins for ${groupJid}:`, error)
      return []
    }
  }

  /**
   * Get group name
   */
  async getGroupName(sock, groupJid) {
    try {
      const metadata = await this.getMetadata(sock, groupJid)
      return metadata?.subject || 'Unknown Group'
    } catch (error) {
      logger.error(`Failed to get group name for ${groupJid}:`, error)
      return 'Unknown Group'
    }
  }

  /**
   * Get group owner
   */
  async getGroupOwner(sock, groupJid) {
    try {
      const metadata = await this.getMetadata(sock, groupJid)
      return metadata?.owner || null
    } catch (error) {
      logger.error(`Failed to get group owner for ${groupJid}:`, error)
      return null
    }
  }

  /**
   * Invalidate cache (uses existing function)
   */
  invalidateCache(groupJid, reason = 'manual') {
    invalidateGroupCache(groupJid, reason)
  }

  /**
   * Force refresh (uses existing function)
   */
  async forceRefresh(sock, groupJid) {
    try {
      return await refreshGroupMetadata(sock, groupJid)
    } catch (error) {
      logger.error(`Failed to force refresh ${groupJid}:`, error)
      return null
    }
  }
}

// Singleton instance
let metadataManagerInstance = null

export function getGroupMetadataManager() {
  if (!metadataManagerInstance) {
    metadataManagerInstance = new GroupMetadataManager()
  }
  return metadataManagerInstance
}