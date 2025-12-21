import { createComponentLogger } from '../../utils/logger.js'
import { getGroupMetadataManager } from './metadata.js'
import tools from '../../lib/tools/index.js'
import { uploadDeline } from '../../lib/tools/index.js'
import path from 'path'
import fs from 'fs'

const logger = createComponentLogger('MESSAGE_FORMATTER')

export class MessageFormatter {
  constructor() {
    this.metadataManager = getGroupMetadataManager()
    this.themeEmoji = "🌟"
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
      logger.debug(`No profile picture for ${jid}, using default`)
      
      // Try to find default image from possible paths
      const possiblePaths = [
        path.resolve(process.cwd(), "Defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "assets", "images", "menu.png"),
        path.resolve(process.cwd(), "Defaults", "images", "logo.png"),
        path.resolve(process.cwd(), "assets", "logo.png")
      ]
      
      // Find first existing file
      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          try {
            const defaultBuffer = fs.readFileSync(filePath)
            const defaultUrl = await uploadDeline(defaultBuffer, 'png', 'image/png')
            logger.debug(`Default avatar uploaded: ${defaultUrl}`)
            return defaultUrl
          } catch (uploadError) {
            logger.error(`Failed to upload default avatar from ${filePath}:`, uploadError)
          }
        }
      }
      
      // Final fallback - use a placeholder
      logger.warn('No local default image found, avatar generation may fail')
      throw error
    }
  }

  /**
   * Get background image - try local default first, fallback to avatar
   */
  async getBackgroundImage() {
    try {
      // Try to find default image from possible paths
      const possiblePaths = [
        path.resolve(process.cwd(), "Defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "assets", "images", "menu.png"),
        path.resolve(process.cwd(), "Defaults", "images", "logo.png"),
        path.resolve(process.cwd(), "assets", "logo.png")
      ]

      // Find first existing file
      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          try {
            logger.debug(`Loading background image from: ${filePath}`)
            const imageBuffer = fs.readFileSync(filePath)
            
            // Upload to deline and get URL
            const backgroundUrl = await uploadDeline(imageBuffer, 'png', 'image/png')
            logger.debug(`Background image uploaded: ${backgroundUrl}`)
            return backgroundUrl
          } catch (uploadError) {
            logger.error(`Failed to upload background image from ${filePath}:`, uploadError)
            // Continue to next path
          }
        }
      }
      
      logger.warn('No local background image found, will use avatar as fallback')
      return null
    } catch (error) {
      logger.error('Error getting background image:', error)
      return null
    }
  }

  async formatParticipants(sock, groupJid, participants, action) {
    try {
      const formattedMessages = []
      let groupName = await this.metadataManager.getGroupName(sock, groupJid)
      const timestamp = Math.floor(Date.now() / 1000) + 3600
      
      // Get group member count
      const groupMetadata = await sock.groupMetadata(groupJid)
      const memberCount = groupMetadata.participants.length

      // ✅ FIX: Truncate groupName to 30 characters (API requirement)
      if (groupName.length > 30) {
        groupName = groupName.substring(0, 27) + '...'
      }

      // ✅ Get background image once (try local default first)
      let backgroundUrl = null
      if (action === 'add') {
        backgroundUrl = await this.getBackgroundImage()
      }

      for (const participantData of participants) {
        try {
          const { jid, displayName } = participantData
          
          // Generate canvas image ONLY for welcome (add action)
          let canvasBuffer = null
          if (action === 'add') {
            try {
              // Get user avatar URL (uploaded to deline)
              const avatar = await this.getUserAvatar(sock, jid)
              
              // ✅ Use background from default image, fallback to avatar
              const background = backgroundUrl || avatar

              logger.debug(`Generating welcome canvas with background: ${background}`)

              const canvasResult = await tools.welcomeCanvas(
                displayName,
                groupName,  // Already truncated to 30 chars
                memberCount,
                avatar,
                background
              )
              if (canvasResult.success) {
                canvasBuffer = canvasResult.data.buffer
                logger.info(`Welcome canvas generated successfully for ${displayName}`)
              } else {
                logger.warn(`Canvas generation returned false for ${displayName}`)
              }
            } catch (canvasError) {
              logger.error(`Failed to generate welcome canvas for ${displayName}:`, canvasError.message)
              // Continue without canvas, don't fail the whole operation
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
          logger.error(`Failed to format participant ${participantData.displayName}:`, error)
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