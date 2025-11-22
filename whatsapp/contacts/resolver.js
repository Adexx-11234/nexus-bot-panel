import { createComponentLogger } from '../../utils/logger.js'
import { normalizeJid } from '../utils/index.js'

const logger = createComponentLogger('CONTACT_RESOLVER')

/**
 * ContactResolver - Resolves push names from messages
 * Used in message processing pipeline
 */
export class ContactResolver {
  constructor() {
    // No state needed
  }

  /**
   * Extract push name from message
   * Sets m.pushName with fallback
   */
  async extractPushName(sock, m) {
    try {
      let pushName = null
      const senderJid = m.sender

      // Method 1: Direct from message (most reliable when available)
      pushName = m.pushName || 
                 m.message?.pushName || 
                 m.key?.notify

      // Method 2: Try to get from sock store if available
      if (!pushName && sock.store?.contacts?.[senderJid]) {
        const contact = sock.store.contacts[senderJid]
        pushName = contact.notify || contact.name || contact.pushName
      }

      // Method 3: Extract from participant info (groups) - direct API call
      if (!pushName && m.isGroup) {
        try {
          const groupMetadata = await sock.groupMetadata(m.chat)
          const participant = groupMetadata.participants?.find(
            p => normalizeJid(p.jid) === normalizeJid(senderJid) ||
                 normalizeJid(p.id) === normalizeJid(senderJid)
          )
          if (participant?.notify) {
            pushName = participant.notify
          }
        } catch (error) {
          // Silent fail - continue to fallback
        }
      }

      // Method 4: Try WhatsApp contact query (last resort)
      if (!pushName && sock.onWhatsApp) {
        try {
          const phoneNumber = senderJid.split('@')[0]
          const [result] = await sock.onWhatsApp(phoneNumber)
          if (result?.notify) {
            pushName = result.notify
          }
        } catch (error) {
          // Silent fail - use fallback
        }
      }

      // Set pushName with fallback
      m.pushName = pushName || this._generateFallbackName(senderJid)

      logger.debug(`Push name resolved for ${senderJid}: ${m.pushName}`)

    } catch (error) {
      logger.error('Push name extraction error:', error)
      // Ensure pushName is always set, even on error
      m.pushName = this._generateFallbackName(m.sender)
    }
  }

  /**
   * Generate fallback name
   * @private
   */
  _generateFallbackName(jid) {
    if (!jid) return 'Unknown'

    const phoneNumber = jid.split('@')[0]
    if (phoneNumber && phoneNumber.length > 4) {
      return `User ${phoneNumber.slice(-4)}`
    }
    return 'Unknown User'
  }

  /**
   * Resolve multiple push names
   */
  async resolvePushNames(sock, senders) {
    const results = {}

    for (const sender of senders) {
      try {
        const mockMessage = { sender, isGroup: false }
        await this.extractPushName(sock, mockMessage)
        results[sender] = mockMessage.pushName
      } catch (error) {
        results[sender] = this._generateFallbackName(sender)
      }
    }

    return results
  }

  /**
   * Get display name for JID (convenience method)
   */
  async getDisplayName(sock, jid, isGroup = false) {
    try {
      const mockMessage = { sender: jid, isGroup }
      await this.extractPushName(sock, mockMessage)
      return mockMessage.pushName
    } catch (error) {
      return this._generateFallbackName(jid)
    }
  }
}

// Singleton instance
let resolverInstance = null

/**
 * Get contact resolver singleton
 */
export function getContactResolver() {
  if (!resolverInstance) {
    resolverInstance = new ContactResolver()
  }
  return resolverInstance
}
