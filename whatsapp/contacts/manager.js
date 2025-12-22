import { createComponentLogger } from '../../utils/logger.js'
import { normalizeJid } from '../utils/index.js'

const logger = createComponentLogger('CONTACT_MANAGER')

/**
 * ContactManager - Manages contact information
 * No caching for real-time accuracy
 */
export class ContactManager {
  constructor() {
    // No caching - always fetch fresh data for accuracy
  }

  /**
   * Get contact name from various sources
   */
  async getContactName(sock, jid) {
    try {
      const normalizedJid = normalizeJid(jid)

      // Try sock store first
      if (sock.store?.contacts?.[normalizedJid]) {
        const contact = sock.store.contacts[normalizedJid]
        if (contact.notify || contact.name) {
          return contact.notify || contact.name
        }
      }

      // Try WhatsApp query
      try {
        const phoneNumber = normalizedJid.split('@')[0]
        const [result] = await sock.onWhatsApp(phoneNumber)
        if (result?.notify) {
          return result.notify
        }
      } catch (error) {
        // Silent fail, use fallback
      }

      // Fallback to phone number
      return this._generateFallbackName(normalizedJid)

    } catch (error) {
      logger.error(`Error getting contact name for ${jid}:`, error)
      return this._generateFallbackName(jid)
    }
  }

  /**
   * Get contact info (name, verified name, etc.)
   */
  async getContactInfo(sock, jid) {
    try {
      const normalizedJid = normalizeJid(jid)

      const info = {
        jid: normalizedJid,
        name: null,
        notify: null,
        verifiedName: null,
        pushName: null
      }

      // Check sock store
      if (sock.store?.contacts?.[normalizedJid]) {
        const contact = sock.store.contacts[normalizedJid]
        info.name = contact.name
        info.notify = contact.notify
        info.verifiedName = contact.verifiedName
      }

      // Try WhatsApp query
      try {
        const phoneNumber = normalizedJid.split('@')[0]
        const [result] = await sock.onWhatsApp(phoneNumber)
        if (result) {
          if (result.notify) info.notify = result.notify
          if (result.verifiedName) info.verifiedName = result.verifiedName
        }
      } catch (error) {
        // Silent fail
      }

      // Set display name
      info.displayName = info.notify || info.name || info.verifiedName || 
                        this._generateFallbackName(normalizedJid)

      return info

    } catch (error) {
      logger.error(`Error getting contact info for ${jid}:`, error)
      return {
        jid: normalizeJid(jid),
        displayName: this._generateFallbackName(jid)
      }
    }
  }

  /**
   * Update contact information (from contact.update event)
   */
  async updateContact(sessionId, contactData) {
    try {
      const { jid, name, notify, verifiedName } = contactData

      logger.debug(`Contact updated: ${jid} - ${name || notify || verifiedName || 'Unknown'}`)

      // Could store in database if needed
      // const { ContactQueries } = await import('../../database/index.js')
      // await ContactQueries.updateContact(sessionId, contactData)

      return true

    } catch (error) {
      logger.error(`Error updating contact ${contactData.jid}:`, error)
      return false
    }
  }

  /**
   * Generate fallback name when no contact info available
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
   * Batch get contact names
   */
  async getContactNames(sock, jids) {
    const results = {}

    for (const jid of jids) {
      try {
        results[jid] = await this.getContactName(sock, jid)
      } catch (error) {
        results[jid] = this._generateFallbackName(jid)
      }
    }

    return results
  }

  /**
   * Check if contact exists on WhatsApp
   */
  async isOnWhatsApp(sock, phoneNumber) {
    try {
      const cleaned = phoneNumber.replace(/\D/g, '')
      const [result] = await sock.onWhatsApp(cleaned)
      return result?.exists || false
    } catch (error) {
      logger.error(`Error checking WhatsApp existence for ${phoneNumber}:`, error)
      return false
    }
  }
}

// Singleton instance
let contactManagerInstance = null

/**
 * Get contact manager singleton
 */
export function getContactManager() {
  if (!contactManagerInstance) {
    contactManagerInstance = new ContactManager()
  }
  return contactManagerInstance
}