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
 * MessageLogger - Enhanced message logging with colors and FROM/TO format
 */
export class MessageLogger {
  constructor() {
    // No initialization needed
  }

  /**
   * Format timestamp to readable date-time
   */
  formatDateTime(timestamp) {
    try {
      const date = new Date(timestamp * 1000) // Convert to milliseconds
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const seconds = String(date.getSeconds()).padStart(2, '0')
      
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
    } catch (error) {
      return 'Unknown Time'
    }
  }

  /**
   * Extract phone number from JID
   */
  extractNumber(jid) {
    if (!jid) return 'Unknown'
    return jid.split('@')[0].split(':')[0]
  }

  /**
   * Get bot's phone number
   */
  getBotNumber(sock) {
    try {
      return sock.user?.id ? this.extractNumber(sock.user.id) : 'Bot'
    } catch (error) {
      return 'Bot'
    }
  }

  /**
   * Check if message is from bot (automated reply)
   */
  isBotReply(m) {
    // Bot replies have specific characteristics:
    // 1. Message ID ends with "NEXUSBOT" or similar suffix
    // 2. No pushName field
    // 3. Status is "PENDING" (string) instead of number
    const messageId = m.key?.id || ''
    const hasBotSuffix = messageId.includes('NEXUSBOT') || messageId.includes('BOT')
    const noPushName = !m.pushName
    const isPendingStatus = m.status === 'PENDING'
    
    return hasBotSuffix || (noPushName && isPendingStatus && m.key?.fromMe)
  }

  /**
   * Log message with enhanced formatting and colors
   */
  async logEnhancedMessageEntry(sock, sessionId, m) {
    try {
      // Get basic info
      const telegramId = m.sessionContext?.telegram_id || 'Unknown'
      const messageType = m.mtype || 'text'
      const content = m.body || m.text || '[Media/No text]'
      const truncatedContent = content.substring(0, 80)
      const timestamp = this.formatDateTime(m.messageTimestamp || Math.floor(Date.now() / 1000))

      // Get bot number
      const botNumber = this.getBotNumber(sock)
      
      // Check if this is a bot automated reply
      const isBotReply = this.isBotReply(m)

      // Determine FROM and TO
      let fromName = 'Unknown'
      let fromNumber = 'Unknown'
      let toName = 'Unknown'
      let toNumber = 'Unknown'
      let chatContext = 'Private'
      let isSelfMessage = false

      // Normalize sender
      let sender = m.sender || 'Unknown'
      try {
        if (sender.includes('@lid')) {
          const resolved = await resolveLidsToJids(sock, [sender])
          if (resolved && resolved[0]) {
            sender = cleanJID(resolved[0])
          }
        } else {
          sender = cleanJID(sender)
        }
      } catch (error) {
        sender = cleanJID(sender)
      }

      // Get remoteJid (the chat/recipient)
      const remoteJid = m.key?.remoteJid || m.chat

      if (m.isGroup && m.groupMetadata) {
        // GROUP MESSAGE
        chatContext = `Group: ${m.groupMetadata.subject || 'Unknown Group'}`
        const groupId = remoteJid.split('@')[0].substring(0, 15) + '...'
        
        if (m.key?.fromMe) {
          // You sending to group (or bot reply to group)
          if (isBotReply) {
            fromName = 'Bot'
            fromNumber = botNumber
          } else {
            fromName = m.pushName || 'You'
            fromNumber = this.extractNumber(sender)
          }
          toName = 'GROUP'
          toNumber = remoteJid
        } else {
          // Someone else sending to group
          fromName = m.pushName || 'Unknown'
          fromNumber = this.extractNumber(sender)
          toName = 'GROUP'
          toNumber = remoteJid
        }
      } else {
        // PRIVATE MESSAGE
        const remoteNumber = this.extractNumber(remoteJid)
        
        if (m.key?.fromMe) {
          // Message FROM you/bot TO someone (or yourself)
          if (isBotReply) {
            // Automated bot reply
            fromName = 'Bot'
            fromNumber = botNumber
          } else {
            // Manual message from you
            fromName = m.pushName || 'You'
            fromNumber = this.extractNumber(sender)
          }
          toNumber = remoteNumber
          
          // Check if self-message
          if (botNumber === remoteNumber) {
            toName = 'Self'
            chatContext = 'Private (Self)'
            isSelfMessage = true
          } else {
            // Get recipient name from contacts if possible
            toName = 'User'
          }
        } else {
          // Message FROM someone TO you
          fromName = m.pushName || 'Unknown'
          fromNumber = this.extractNumber(sender)
          toName = 'You'
          toNumber = botNumber
        }
      }

      // Build status badges (only show for relevant contexts)
      // ADMIN badge: Only in groups when sender is admin
      const adminBadge = (m.isGroup && m.isAdmin) ? `${colors.bgBlue} ADMIN ${colors.reset}` : ''
      // OWNER badge: Only when sender is bot owner and not a self-message
      const ownerBadge = (m.isCreator && !isSelfMessage) ? `${colors.bgRed} OWNER ${colors.reset}` : ''
      // CMD badge: When message is a command
      const commandBadge = m.isCommand ? `${colors.bgGreen} CMD ${colors.reset}` : ''

      // Build the log message
      const logMessage = 
        `${colors.bright}[MESSAGE]${colors.reset} ` +
        `${colors.dim}[${timestamp}]${colors.reset} ` +
        `${colors.cyan}TG:${telegramId}${colors.reset} | ` +
        `${colors.magenta}${chatContext}${colors.reset} | ` +
        `${colors.green}FROM: ${fromName} (${fromNumber})${colors.reset} ` +
        `${colors.yellow}→${colors.reset} ` +
        `${colors.blue}TO: ${toName} (${toNumber})${colors.reset} ` +
        `${adminBadge}${ownerBadge}${commandBadge}` +
        (adminBadge || ownerBadge || commandBadge ? ' | ' : ' | ') +
        `${colors.yellow}Type:${messageType}${colors.reset} | ` +
        `${colors.white}${truncatedContent}${colors.reset}${content.length > 80 ? '...' : ''}`

      logger.message(logMessage)

    } catch (error) {
      // Fallback logging on error
      logger.error('Error in message logging, using basic fallback:', error.message)
      
      const content = m.body || '[Media]'
      const truncatedContent = content.substring(0, 50)
      const telegramId = m.sessionContext?.telegram_id || 'Unknown'
      const timestamp = this.formatDateTime(m.messageTimestamp || Math.floor(Date.now() / 1000))
      
      logger.message(
        `${colors.bright}[MESSAGE-FALLBACK]${colors.reset} ` +
        `${colors.dim}[${timestamp}]${colors.reset} ` +
        `${colors.cyan}TG:${telegramId}${colors.reset} | ` +
        `${colors.white}${truncatedContent}${colors.reset}`
      )
    }
  }
}