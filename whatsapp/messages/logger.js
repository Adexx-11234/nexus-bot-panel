import { createComponentLogger } from '../../utils/logger.js'
import { cleanJID } from '../../config/baileys.js'
import { resolveLidsToJids } from '../groups/lid-resolver.js'

const logger = createComponentLogger('MESSAGE_LOGGER')

// Color codes for enhanced logging
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m'
}

/**
 * MessageLogger - Enhanced message logging with colors
 */
export class MessageLogger {
  constructor() {
    // No initialization needed
  }

  /**
   * Log message with enhanced formatting and colors
   */
  async logEnhancedMessageEntry(sock, sessionId, m) {
    try {
      // Get basic info
      const telegramId = m.sessionContext?.telegram_id || 'Unknown'
      let sender = m.sender || 'Unknown'
      const pushName = m.pushName || 'Unknown'
      const messageType = m.mtype || 'text'
      const content = m.body || m.text || '[Media/No text]'
      const truncatedContent = content.substring(0, 80)

      // Normalize sender JID
      try {
        // Try to resolve LIDs to PNs if sender is LID format
        if (sender.includes('@lid')) {
          const resolved = await resolveLidsToJids(sock, [sender])
          if (resolved && resolved[0]) {
            sender = cleanJID(resolved[0]) // Clean any device ID suffixes
          }
        } else if (sender.includes('@s.whatsapp.net')) {
          // Clean PN format (remove device ID suffix like :0)
          sender = cleanJID(sender)
        }
      } catch (error) {
        logger.debug(`Failed to normalize sender JID:`, error.message)
        sender = cleanJID(sender) // At least clean the format
      }

      // Build status badges
      const adminBadge = m.isAdmin ? `${colors.bgBlue} ADMIN ${colors.reset}` : ''
      const ownerBadge = m.isCreator ? `${colors.bgRed} OWNER ${colors.reset}` : ''
      const commandBadge = m.isCommand ? `${colors.bgGreen} CMD ${colors.reset}` : ''

      if (m.isGroup && m.groupMetadata) {
        // Group message
        const groupId = m.chat
        const groupName = m.groupMetadata.subject || 'Unknown Group'

        logger.message(
          `${colors.bright}[MESSAGE]${colors.reset} ` +
          `${colors.cyan}TG:${telegramId}${colors.reset} | ` +
          `${colors.magenta}Group:${groupName}${colors.reset} ${colors.dim}(${groupId})${colors.reset} | ` +
          `${colors.green}${pushName}${colors.reset} ${colors.dim}(${sender})${colors.reset} ` +
          `${adminBadge}${ownerBadge}${commandBadge} | ` +
          `${colors.yellow}Type:${messageType}${colors.reset} | ` +
          `${colors.white}${truncatedContent}${colors.reset}${content.length > 80 ? '...' : ''}`
        )
      } else {
        // Private message
        logger.message(
          `${colors.bright}[MESSAGE]${colors.reset} ` +
          `${colors.cyan}TG:${telegramId}${colors.reset} | ` +
          `${colors.blue}Private:${pushName}${colors.reset} ${colors.dim}(${sender})${colors.reset} ` +
          `${ownerBadge}${commandBadge} | ` +
          `${colors.yellow}Type:${messageType}${colors.reset} | ` +
          `${colors.white}${truncatedContent}${colors.reset}${content.length > 80 ? '...' : ''}`
        )
      }
    } catch (error) {
      // Fallback logging on error
      const content = m.body || '[Media]'
      const pushName = m.pushName || 'Unknown'
      const truncatedContent = content.substring(0, 80)
      const telegramId = m.sessionContext?.telegram_id || 'Unknown'
      let sender = m.sender || 'Unknown'

      // Still try to clean sender in fallback
      try {
        sender = cleanJID(sender)
      } catch (e) {
        // Ignore cleanup errors in fallback
      }

      const adminBadge = m.isAdmin ? `${colors.bgBlue} ADMIN ${colors.reset}` : ''
      const ownerBadge = m.isCreator ? `${colors.bgRed} OWNER ${colors.reset}` : ''
      const commandBadge = m.isCommand ? `${colors.bgGreen} CMD ${colors.reset}` : ''

      if (m.isGroup) {
        logger.message(
          `${colors.bright}[MESSAGE]${colors.reset} ` +
          `${colors.cyan}TG:${telegramId}${colors.reset} | ` +
          `${colors.magenta}Group:${m.chat}${colors.reset} | ` +
          `${colors.green}${pushName}${colors.reset} ${colors.dim}(${sender})${colors.reset} ` +
          `${adminBadge}${ownerBadge}${commandBadge} | ` +
          `${colors.yellow}Type:${m.mtype}${colors.reset} | ` +
          `${colors.white}${truncatedContent}${colors.reset}${content.length > 80 ? '...' : ''}`
        )
      } else {
        logger.message(
          `${colors.bright}[MESSAGE]${colors.reset} ` +
          `${colors.cyan}TG:${telegramId}${colors.reset} | ` +
          `${colors.blue}Private:${pushName}${colors.reset} ${colors.dim}(${sender})${colors.reset} ` +
          `${ownerBadge}${commandBadge} | ` +
          `${colors.yellow}Type:${m.mtype}${colors.reset} | ` +
          `${colors.white}${truncatedContent}${colors.reset}${content.length > 80 ? '...' : ''}`
        )
      }
    }
  }
}