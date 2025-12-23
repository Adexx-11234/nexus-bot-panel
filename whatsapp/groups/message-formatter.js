import { createComponentLogger } from '../../utils/logger.js'
import { getGroupMetadataManager } from './metadata.js'
import tools from '../../lib/tools/index.js'
import { uploadDeline } from '../../lib/tools/index.js'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'

const logger = createComponentLogger('MESSAGE_FORMATTER')

export class MessageFormatter {
  constructor() {
    this.metadataManager = getGroupMetadataManager()
    this.themeEmoji = "🌟"
    this.botLogoUrl = null
    this.initializeBotLogo()
  }

  /**
   * Initialize bot logo by uploading to deline
   * Only called once during initialization
   */
  async initializeBotLogo() {
    try {
      const possiblePaths = [
        path.resolve(process.cwd(), "Defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "assets", "images", "menu.png"),
        path.resolve(process.cwd(), "Defaults", "images", "logo.png"),
        path.resolve(process.cwd(), "assets", "logo.png")
      ]

      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          try {
            logger.debug(`Loading bot logo from: ${filePath}`)
            
            // Read the image and convert to buffer with sharp
            let logoBuffer = fs.readFileSync(filePath)

            // Convert to buffer format (no quality enhancement)
            logoBuffer = await sharp(logoBuffer).toBuffer()
            
            // Upload to deline
            this.botLogoUrl = await uploadDeline(logoBuffer, 'png', 'image/png')
            logger.info(`✅ Bot logo uploaded successfully: ${this.botLogoUrl}`)
            return
          } catch (uploadError) {
            logger.error(`Failed to upload bot logo from ${filePath}:`, uploadError)
          }
        }
      }
      
      logger.warn('No local bot logo found, will use simple text fallback')
    } catch (error) {
      logger.error('Error initializing bot logo:', error)
    }
  }

  /**
   * Get user profile picture URL
   * ONLY called for groups with 900+ members
   */
  async getUserAvatar(sock, jid) {
    try {
      // Try to get profile picture buffer
      const ppUrl = await sock.profilePictureUrl(jid, 'image')
      
      // Download the image buffer
      const response = await fetch(ppUrl)
      const ppBuffer = Buffer.from(await response.arrayBuffer())
      
      // Upload to deline and get URL
      const avatarUrl = await uploadDeline(ppBuffer, 'jpg', 'image/jpeg')
      logger.debug(`Profile picture uploaded for ${jid}: ${avatarUrl}`)
      return avatarUrl
      
    } catch (error) {
      logger.debug(`No profile picture for ${jid}, using fallback`)
      
      // Use bot logo as fallback if available
      if (this.botLogoUrl) {
        logger.debug(`Using bot logo as fallback avatar`)
        return this.botLogoUrl
      }
      
      // Final fallback - use API default
      logger.warn('No local default image found, using API default')
      return 'https://api.deline.web.id/default-avatar.jpg'
    }
  }

  /**
   * Get group profile picture URL
   * ONLY called for groups with 900+ members
   */
  async getGroupAvatar(sock, groupJid) {
    try {
      // Try to get group profile picture buffer
      const ppUrl = await sock.profilePictureUrl(groupJid, 'image')
      
      // Download the image buffer
      const response = await fetch(ppUrl)
      const ppBuffer = Buffer.from(await response.arrayBuffer())
      
      // Upload to deline and get URL
      const avatarUrl = await uploadDeline(ppBuffer, 'jpg', 'image/jpeg')
      logger.debug(`Group profile picture uploaded for ${groupJid}: ${avatarUrl}`)
      return avatarUrl
      
    } catch (error) {
      logger.debug(`No group profile picture for ${groupJid}`)
      return null
    }
  }

  /**
   * Get user's display name (pushName) with fallbacks
   */
  async getUserDisplayName(sock, jid) {
    try {
      // Try to get pushName (preferred display name)
      // Method 1: Try to get from contact information
      const contact = await sock.onWhatsApp(jid)
      if (contact?.[0]?.exists) {
        // Method 2: Try to fetch the contact directly (some WhatsApp Web APIs)
        try {
          const contactInfo = await sock.fetchStatus(jid)
          if (contactInfo?.status) {
            // Some APIs return name with status
            return contactInfo.name || contactInfo.pushname || contact[0].name || jid.split('@')[0]
          }
        } catch (e) {
          // Fall through
        }
        
        // Return the name from the contact check
        return contact[0].name || contact[0].pushname || jid.split('@')[0]
      }
      
      // Method 3: Check if sock has a contacts store
      if (sock.contacts && sock.contacts[jid]) {
        return sock.contacts[jid].name || sock.contacts[jid].notify || jid.split('@')[0]
      }
      
      // Final fallback - use the phone number
      return jid.split('@')[0]
      
    } catch (error) {
      logger.debug(`Error getting display name for ${jid}:`, error)
      // Fallback to phone number
      return jid.split('@')[0]
    }
  }

  /**
   * Truncate group name to meet API requirements (max 30 chars)
   * Removes emojis and special characters if needed
   */
  truncateGroupName(groupName) {
    if (!groupName) return 'Group'
    
    // First, try to keep the name as is if it's under 30 chars
    if (groupName.length <= 30) {
      return groupName
    }
    
    // Remove emojis and special unicode characters
    let cleanName = groupName.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '')
    
    // Remove extra spaces
    cleanName = cleanName.replace(/\s+/g, ' ').trim()
    
    // If still too long, truncate and add ellipsis
    if (cleanName.length > 30) {
      cleanName = cleanName.substring(0, 27) + '...'
    }
    
    // If empty after cleaning, use generic name
    if (!cleanName || cleanName.length === 0) {
      cleanName = 'Group Chat'
    }
    
    logger.debug(`Group name truncated: "${groupName}" -> "${cleanName}"`)
    return cleanName
  }

  /**
   * Format participants with canvas only for large groups (900+ members)
   */
  async formatParticipants(sock, groupJid, participants, action) {
    try {
      const formattedMessages = []
      const groupName = await this.metadataManager.getGroupName(sock, groupJid)
      const timestamp = Math.floor(Date.now() / 1000) + 3600
      
      // ✅ Get group member count WITHOUT calling groupMetadata (use cached data)
      let memberCount = 0
      let shouldUseCanvas = false
      
      try {
        // Try to get from cache first
        const { getGroupCache } = await import('../core/config.js')
        const cachedMetadata = getGroupCache(groupJid)
        
        if (cachedMetadata && cachedMetadata.participants) {
          memberCount = cachedMetadata.participants.length
          logger.debug(`Got member count from cache: ${memberCount}`)
        } else {
          // Only fetch if not in cache
          const groupMetadata = await sock.groupMetadata(groupJid)
          memberCount = groupMetadata.participants.length
          logger.debug(`Got member count from fetch: ${memberCount}`)
        }
        
        // Only use canvas for groups with 900+ members AND action is 'add'
        shouldUseCanvas = action === 'add' && memberCount >= 900
        
      } catch (error) {
        logger.warn(`Could not get member count: ${error.message}, using simple messages`)
        shouldUseCanvas = false
      }

      logger.info(`Group ${groupJid} has ${memberCount} members. Canvas mode: ${shouldUseCanvas}`)

      // ✅ Only get group avatar if canvas is needed
      let groupAvatar = null
      if (shouldUseCanvas) {
        groupAvatar = await this.getGroupAvatar(sock, groupJid)
      }

      for (const participantData of participants) {
        try {
          const { jid } = participantData
          
          // Get the user's display name (pushName)
          const displayName = await this.getUserDisplayName(sock, jid)
          logger.debug(`Using display name for ${jid}: ${displayName}`)
          
          // ✅ Generate canvas image ONLY for welcome (add action) in large groups (900+)
          let canvasBuffer = null
          if (shouldUseCanvas) {
            // Get user avatar URL (uploaded to deline)
            const userAvatar = await this.getUserAvatar(sock, jid)
            
            // Priority for background: 1. Group Avatar, 2. User Avatar, 3. Bot Logo
            let background = null
            if (groupAvatar) {
              background = groupAvatar
              logger.debug(`Using group profile picture as background for ${groupJid}`)
            } else if (userAvatar) {
              background = userAvatar
              logger.debug(`Using user profile picture as background for ${jid}`)
            } else if (this.botLogoUrl) {
              background = this.botLogoUrl
              logger.debug(`Using bot logo as fallback background`)
            } else {
              logger.warn('No background image available, canvas may fail')
              background = 'https://api.deline.web.id/default-avatar.jpg'
            }

            // Truncate group name to meet API requirements
            const truncatedGroupName = this.truncateGroupName(groupName)

            const canvasResult = await tools.welcomeCanvas(
              displayName,
              truncatedGroupName,
              memberCount,
              userAvatar,
              background
            )
            if (canvasResult.success) {
              canvasBuffer = canvasResult.data.buffer
              logger.info(`✅ Canvas generated for ${displayName} in large group`)
            } else {
              logger.error(`Canvas generation failed: ${canvasResult.error}`)
            }
          }
          
          const message = this.createActionMessage(action, displayName, groupName, timestamp)
          const fakeQuotedMessage = this.createFakeQuotedMessage(action, displayName, jid, groupJid)

          formattedMessages.push({
            participant: jid,
            message: message,
            fakeQuotedMessage: fakeQuotedMessage,
            displayName: displayName,
            canvasImage: canvasBuffer, // Only populated for large groups
            shouldUseCanvas: shouldUseCanvas // Flag to indicate if canvas should be used
          })
        } catch (error) {
          logger.error(`Failed to format participant:`, error)
        }
      }

      return formattedMessages
    } catch (error) {
      logger.error('Error formatting participants:', error)
      return []
    }
  }

  createActionMessage(action, displayName, groupName, timestamp) {
    const messageDate = new Date(timestamp * 1000)
    const currentTime = messageDate.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })
    const currentDate = messageDate.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" })

    const messages = {
      add: `╚»˙·٠${this.themeEmoji}●♥ WELCOME ♥●${this.themeEmoji}٠·˙«╝\n\n✨ Welcome to ${groupName}! ✨\n\n👤 ${displayName}\n\n🕐 Joined at: ${currentTime}, ${currentDate}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      remove: `╚»˙·٠${this.themeEmoji}●♥ GOODBYE ♥●${this.themeEmoji}٠·˙«╝\n\n✨ Goodbye ${displayName}! ✨\n\nYou'll be missed from ⚡${groupName}⚡! 🥲\n\n🕐 Left at: ${currentTime}, ${currentDate}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      promote: `╚»˙·٠${this.themeEmoji}●♥ PROMOTION ♥●${this.themeEmoji}٠·˙«╝\n\n👑 Congratulations ${displayName}!\n\nYou have been promoted to admin in ⚡${groupName}⚡! 🎉\n\nPlease use your powers responsibly.\n\n🕐 Promoted at: ${currentTime}, ${currentDate}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      demote: `╚»˙·٠${this.themeEmoji}●♥ DEMOTION ♥●${this.themeEmoji}٠·˙«╝\n\n📉 ${displayName} have been demoted from admin in ⚡${groupName}⚡.\n\nYou can still participate normally.\n\n🕐 Demoted at: ${currentTime}, ${currentDate}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }

    return messages[action] || `Group ${action} notification for ${displayName} in ⚡${groupName}⚡`
  }

  createFakeQuotedMessage(action, displayName, participantJid, groupJid) {
    const actionMessages = {
      add: `${displayName} joined the group`,
      remove: `${displayName} left the group`, 
      promote: `${displayName} was promoted to admin`,
      demote: `${displayName} was demoted from admin`
    }

    return {
      key: {
        id: `FAKE_QUOTE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        remoteJid: groupJid,
        fromMe: false,
        participant: participantJid
      },
      message: {
        conversation: actionMessages[action] || `${action} event`
      },
      participant: participantJid
    }
  }
}

let formatterInstance = null

export function getMessageFormatter() {
  if (!formatterInstance) {
    formatterInstance = new MessageFormatter()
  }
  return formatterInstance
}