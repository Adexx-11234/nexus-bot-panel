import { createComponentLogger } from '../../utils/logger.js'
import { VIPQueries } from '../../database/query.js'
import { getSessionManager } from '../sessions/index.js'
import { resolveLidToJid } from '../groups/index.js'

const logger = createComponentLogger('VIP_HELPER')

export class VIPHelper {
  /**
   * Get default VIP telegram ID from environment
   */
  static getDefaultVIPTelegramId() {
    const defaultVipId = process.env.DEFAULT_ADMIN_ID
    
    if (!defaultVipId) {
      logger.warn('DEFAULT_ADMIN_ID not set in environment variables')
      return null
    }
    
    return parseInt(defaultVipId)
  }

  /**
   * Check if telegram ID is the default VIP
   */
  static isDefaultVIP(telegramId) {
    const defaultVipId = this.getDefaultVIPTelegramId()
    return defaultVipId && telegramId === defaultVipId
  }

  /**
   * Initialize default VIP in database (called on startup)
   */
  /**
 * Initialize default VIP in database (called on startup)
 */
static async initializeDefaultVIP() {
  try {
    const defaultVipId = this.getDefaultVIPTelegramId();
    
    if (!defaultVipId) {
      logger.warn('Cannot initialize default VIP - DEFAULT_ADMIN_ID not set');
      return false;
    }

    const sessionManager = getSessionManager();
    await VIPQueries.setDefaultVIP(defaultVipId, true, sessionManager);
    logger.info(`Default VIP initialized: ${defaultVipId}`);
    
    return true;
  } catch (error) {
    logger.error('Failed to initialize default VIP:', error);
    return false;
  }
}
    
  /**
   * Check if a WhatsApp account is banned
   */
  static async checkAccountStatus(sock, jid) {
    try {
      const status = await sock.checkStatusWa(jid)
      
      return {
        jid: status.jid || jid,
        isBanned: status.ban || false,
        bio: status.bio || '',
        updatedAt: status.updateAt || null
      }
    } catch (error) {
      logger.error(`Error checking account status for ${jid}:`, error)
      return {
        jid,
        isBanned: false,
        bio: null,
        updatedAt: null
      }
    }
  }

  /**
   * Get default VIP's socket from session manager
   */
  static async getDefaultVIPSocket() {
    try {
      const defaultVipId = this.getDefaultVIPTelegramId()
      
      if (!defaultVipId) {
        return null
      }

      const sessionManager = getSessionManager()
      const sessionId = `session_${defaultVipId}`
      const sock = sessionManager.getSession(sessionId)
      
      if (!sock || !sock.user) {
        logger.warn(`Default VIP socket not available for telegram ID: ${defaultVipId}`)
        return null
      }
      
      return sock
    } catch (error) {
      logger.error('Error getting default VIP socket:', error)
      return null
    }
  }

  /**
   * Check if user can control target
   */
  static async canControl(vipTelegramId, targetTelegramId) {
    try {
      if (this.isDefaultVIP(vipTelegramId)) {
        return { allowed: true, reason: 'default_vip_env' }
      }

      const vipStatus = await VIPQueries.isVIP(vipTelegramId)
      
      if (vipStatus.isDefault || vipStatus.level === 99) {
        return { allowed: true, reason: 'default_vip_db' }
      }
      
      if (!vipStatus.isVIP) {
        return { allowed: false, reason: 'not_vip' }
      }
      
      const targetStatus = await VIPQueries.isVIP(targetTelegramId)
      if (targetStatus.isVIP) {
        return { allowed: false, reason: 'target_is_vip' }
      }
      
      const owns = await VIPQueries.ownsUser(vipTelegramId, targetTelegramId)
      if (!owns) {
        return { allowed: false, reason: 'not_owned' }
      }
      
      return { allowed: true, reason: 'owns_user' }
    } catch (error) {
      logger.error('Error checking control permission:', error)
      return { allowed: false, reason: 'error' }
    }
  }

  /**
   * Get user's session socket from session manager
   */
  static async getUserSocket(telegramId) {
    try {
      const sessionManager = getSessionManager()
      const sessionId = `session_${telegramId}`
      const sock = sessionManager.getSession(sessionId)
      
      if (!sock || !sock.user) {
        return null
      }
      
      return sock
    } catch (error) {
      logger.error('Error getting user socket:', error)
      return null
    }
  }

  /**
   * Get VIP's socket
   */
  static async getVIPSocket(vipTelegramId) {
    return await this.getUserSocket(vipTelegramId)
  }

  /**
   * Get user's phone number from session
   */
  static async getUserPhoneFromSession(telegramId) {
    try {
      const sock = await this.getUserSocket(telegramId)
      
      if (!sock || !sock.user || !sock.user.id) {
        return null
      }
      
      return sock.user.id.split('@')[0].split(':')[0]
    } catch (error) {
      logger.error('Error getting user phone from session:', error)
      return null
    }
  }

  /**
   * Get all connected VIP sessions
   */
  static async getAllConnectedVIPs() {
    try {
      const sessionManager = getSessionManager()
      const allVIPs = await VIPQueries.getAllVIPs()
      const connectedVIPs = []

      for (const vip of allVIPs) {
        const sessionId = `session_${vip.telegram_id}`
        const sock = sessionManager.getSession(sessionId)
        
        if (sock && sock.user) {
          connectedVIPs.push({
            telegramId: vip.telegram_id,
            phone: sock.user.id.split('@')[0],
            level: vip.vip_level,
            isDefault: vip.is_default_vip,
            ownedUsers: vip.owned_users_count
          })
        }
      }

      return connectedVIPs
    } catch (error) {
      logger.error('Error getting connected VIPs:', error)
      return []
    }
  }

/**
 * Get groups where the user is an admin (optimized for speed)
 */
static async getUserGroups(sock) {
  try {
    if (!sock || !sock.user) {
      return []
    }

    const chats = await sock.groupFetchAllParticipating()
    const adminGroups = []
    
    const botJid = sock.user.id
    const botPhone = botJid.split('@')[0].split(':')[0]
    
    const groupEntries = Object.entries(chats).filter(([jid]) => jid.endsWith('@g.us'))
    
    logger.info(`Processing ${groupEntries.length} groups`)
    
    for (const [jid, chat] of groupEntries) {
      try {
        if (!chat.participants || !Array.isArray(chat.participants)) continue

        const adminParticipants = chat.participants.filter(p => 
          p.admin === 'admin' || p.admin === 'superadmin'
        )
        
        let botParticipant = null
        let groupOwner = null
        
        // Check all admin participants
        for (const participant of adminParticipants) {
          // Use p.jid first, fall back to p.id
          const participantId = participant.jid || participant.id || ''
          
          if (!participantId) continue
          
          const participantPhone = participantId.split('@')[0].split(':')[0]
          
          if (participantPhone === botPhone || participantId === botJid) {
            botParticipant = participant
            if (participant.admin === 'superadmin') {
              // Bot is owner, no need to check other participants
              break
            }
          } else if (participant.admin === 'superadmin') {
            groupOwner = participant
          }
        }

        if (botParticipant) {
          const isBotOwner = botParticipant.admin === 'superadmin'
          const hasOtherOwner = groupOwner !== null && groupOwner !== botParticipant
          const canTakeover = isBotOwner || !hasOtherOwner
          
          adminGroups.push({
            jid,
            name: chat.subject || 'Unknown Group',
            participants: chat.participants.length || 0,
            desc: chat.desc || '',
            createdAt: chat.creation || null,
            isBotOwner: isBotOwner,
            hasOtherOwner: hasOtherOwner,
            ownerIsBanned: false,
            canTakeover: canTakeover
          })
        }
      } catch (groupError) {
        logger.error(`Error processing group ${jid}:`, groupError)
      }
    }
    
    logger.info(`Found ${adminGroups.length} admin groups`)
    return adminGroups
    
  } catch (error) {
    logger.error('Error getting user groups:', error)
    return []
  }
}

  /**
   * Get group invite link
   */
  static async getGroupInviteLink(sock, groupJid) {
    try {
      const code = await sock.groupInviteCode(groupJid)
      return `https://chat.whatsapp.com/${code}`
    } catch (error) {
      logger.error(`Error getting invite link for ${groupJid}:`, error)
      return null
    }
  }

  /**
   * Extract phone number from JID (sync version)
   */
  static extractPhone(jid, sock = null, groupJid = null) {
    if (!jid) return null
    
    if (jid.endsWith('@lid') && sock && groupJid) {
      logger.warn(`LID detected but cannot resolve synchronously: ${jid}`)
      return jid.split('@')[0].split(':')[0]
    }
    
    return jid.split('@')[0].split(':')[0]
  }

  /**
   * Extract phone number from JID with async LID resolution
   */
  static async extractPhoneAsync(jid, sock = null, groupJid = null) {
    if (!jid) return null
    
    if (jid.endsWith('@lid') && sock && groupJid) {
      try {
        const resolvedJid = await resolveLidToJid(sock, groupJid, jid)
        return resolvedJid.split('@')[0].split(':')[0]
      } catch (error) {
        logger.error(`Failed to resolve LID ${jid}:`, error)
        return jid.split('@')[0].split(':')[0]
      }
    }
    
    return jid.split('@')[0].split(':')[0]
  }

  /**
   * Resolve JID (handle LIDs)
   */
  static async resolveJid(jid, sock, groupJid = null) {
    if (!jid) return null
    
    if (jid.endsWith('@lid')) {
      if (!sock || !groupJid) {
        logger.warn(`Cannot resolve LID without sock and groupJid: ${jid}`)
        return jid
      }
      
      try {
        return await resolveLidToJid(sock, groupJid, jid)
      } catch (error) {
        logger.error(`Failed to resolve LID: ${error.message}`)
        return jid
      }
    }
    
    return jid
  }

  /**
   * Format telegram ID to session ID
   */
  static toSessionId(telegramId) {
    return `session_${telegramId}`
  }

  /**
   * Extract telegram ID from session ID
   */
  static fromSessionId(sessionId) {
    const match = sessionId.match(/session_(-?\d+)/)
    return match ? parseInt(match[1]) : null
  }
}

export default VIPHelper