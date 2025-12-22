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
            
            // Read the image and enhance to maximum quality with sharp
            let logoBuffer = fs.readFileSync(filePath)
            
            // Use sharp to convert to highest quality PNG (lossless)
            // PNG is better than JPEG for preserving quality
            logoBuffer = await sharp(logoBuffer)
              .png({ 
                quality: 100,
                compressionLevel: 0, // No compression for maximum quality
                adaptiveFiltering: false,
                palette: false
              })
              .toBuffer()
            
            // Upload to deline
            this.botLogoUrl = await uploadDeline(logoBuffer, 'png', 'image/png')
            logger.info(`✅ Bot logo uploaded successfully: ${this.botLogoUrl}`)
            return
          } catch (uploadError) {
            logger.error(`Failed to upload bot logo from ${filePath}:`, uploadError)
          }
        }
      }
      
      logger.warn('No local bot logo found, will use user avatars as fallback')
    } catch (error) {
      logger.error('Error initializing bot logo:', error)
    }
  }

  /**
   * Get user profile picture URL
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

  async formatParticipants(sock, groupJid, participants, action) {
    try {
      const formattedMessages = []
      const groupName = await this.metadataManager.getGroupName(sock, groupJid)
      const timestamp = Math.floor(Date.now() / 1000) + 3600
      
      // Get group member count
      const groupMetadata = await sock.groupMetadata(groupJid)
      const memberCount = groupMetadata.participants.length

      for (const participantData of participants) {
        try {
          const { jid, displayName } = participantData
          
          // Generate canvas image ONLY for welcome (add action)
          let canvasBuffer = null
          if (action === 'add') {
            // Get user avatar URL (uploaded to deline)
            const avatar = await this.getUserAvatar(sock, jid)
            
            // Use bot logo as background if available, otherwise use user avatar
            const background = this.botLogoUrl || avatar

            // Truncate group name to meet API requirements
            const truncatedGroupName = this.truncateGroupName(groupName)

            const canvasResult = await tools.welcomeCanvas(
              displayName,
              truncatedGroupName,
              memberCount,
              avatar,
              background
            )
            if (canvasResult.success) {
              canvasBuffer = canvasResult.data.buffer
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
            canvasImage: canvasBuffer // Only for welcome
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