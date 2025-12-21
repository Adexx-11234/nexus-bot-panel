import { createComponentLogger } from '../../utils/logger.js'
import { getGroupMetadataManager } from './metadata.js'
import tools from '../../lib/tools/index.js'
import { uploadDeline } from '../../lib/tools/index.js'
import path from 'path'
import fs from 'fs'
import { promises as fsPromises } from 'fs'

const logger = createComponentLogger('MESSAGE_FORMATTER')

export class MessageFormatter {
  constructor() {
    this.metadataManager = getGroupMetadataManager()
    this.themeEmoji = "🌟"
  }

  /**
   * Get user profile picture URL with dual fallback methods
   * Method 1: Try direct WhatsApp URL
   * Method 2: If Method 1 fails, download buffer and upload to deline
   */
  async getUserAvatar(sock, jid) {
    try {
      // METHOD 1: Try direct WhatsApp URL (fastest)
      try {
        const ppUrl = await sock.profilePictureUrl(jid, 'image')
        if (ppUrl) {
          logger.debug(`[METHOD 1] Profile picture URL (high) for ${jid}: ${ppUrl}`)
          return ppUrl
        }
      } catch (highQualityError) {
        logger.debug(`[METHOD 1] High quality failed, trying preview`)
        
        try {
          const ppUrl = await sock.profilePictureUrl(jid, 'preview')
          if (ppUrl) {
            logger.debug(`[METHOD 1] Profile picture URL (preview) for ${jid}: ${ppUrl}`)
            return ppUrl
          }
        } catch (previewError) {
          logger.debug(`[METHOD 1] Both WhatsApp URLs failed, falling back to METHOD 2`)
        }
      }

      // METHOD 2: Download buffer and upload to deline (fallback)
      try {
        logger.debug(`[METHOD 2] Attempting to fetch and upload profile picture for ${jid}`)
        
        let profilePicUrl
        
        // Try to get the URL first
        try {
          profilePicUrl = await sock.profilePictureUrl(jid, 'image')
        } catch (error) {
          profilePicUrl = await sock.profilePictureUrl(jid, 'preview')
        }

        // Download the image
        const response = await fetch(profilePicUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // Upload to deline
        const uploadedUrl = await uploadDeline(buffer, 'jpg', 'image/jpeg')
        logger.info(`[METHOD 2] Profile picture uploaded to deline for ${jid}: ${uploadedUrl}`)
        return uploadedUrl
      } catch (method2Error) {
        logger.warn(`[METHOD 2] Upload method failed: ${method2Error.message}`)
      }

      // Both methods failed, use default
      logger.warn(`No profile picture available for ${jid}, using default`)
      return await this.getDefaultAvatarUrl()

    } catch (error) {
      logger.error(`Error getting user avatar for ${jid}:`, error)
      return await this.getDefaultAvatarUrl()
    }
  }

  /**
   * Get default avatar URL from local file
   * Uploads local image to deline and caches the URL
   */
  async getDefaultAvatarUrl() {
    try {
      // Define possible local image paths
      const possiblePaths = [
        path.resolve(process.cwd(), "Defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "Defaults", "images", "logo.png"),
        path.resolve(process.cwd(), "defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "defaults", "images", "logo.png"),
        path.resolve(process.cwd(), "assets", "images", "menu.png"),
        path.resolve(process.cwd(), "assets", "images", "logo.png"),
        path.resolve(process.cwd(), "assets", "logo.png"),
        path.resolve(process.cwd(), "public", "logo.png"),
        path.resolve(process.cwd(), "public", "images", "menu.png")
      ]

      logger.debug(`Searching for default avatar in ${possiblePaths.length} paths`)

      for (const filePath of possiblePaths) {
        try {
          // Check if file exists
          const exists = fs.existsSync(filePath)
          if (!exists) {
            logger.debug(`Path not found: ${filePath}`)
            continue
          }

          // Read file
          logger.debug(`Reading file: ${filePath}`)
          const imageBuffer = await fsPromises.readFile(filePath)

          if (!imageBuffer || imageBuffer.length === 0) {
            logger.warn(`File is empty: ${filePath}`)
            continue
          }

          // Get file extension
          const ext = path.extname(filePath).substring(1) || 'png'
          const mimeType = ext.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg'

          logger.debug(`Uploading default image: ${filePath} (${imageBuffer.length} bytes, ${mimeType})`)

          // Upload to deline
          const uploadedUrl = await uploadDeline(imageBuffer, ext, mimeType)

          if (!uploadedUrl) {
            logger.warn(`Upload returned empty URL for ${filePath}`)
            continue
          }

          logger.info(`✅ Default avatar successfully uploaded: ${uploadedUrl}`)
          return uploadedUrl

        } catch (pathError) {
          logger.warn(`Failed to process ${filePath}: ${pathError.message}`)
          continue
        }
      }

      // No local file found, use deline default
      logger.warn(`No local default image found, using deline default avatar`)
      return 'https://api.deline.web.id/default-avatar.jpg'

    } catch (error) {
      logger.error('Error getting default avatar URL:', error)
      return 'https://api.deline.web.id/default-avatar.jpg'
    }
  }

  /**
   * Get background image URL
   * Tries local files first, then uploads to deline
   * Falls back to deline default if all fail
   */
  async getBackgroundImage() {
    try {
      // Define possible background image paths
      const possiblePaths = [
        path.resolve(process.cwd(), "Defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "Defaults", "images", "background.png"),
        path.resolve(process.cwd(), "defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "defaults", "images", "background.png"),
        path.resolve(process.cwd(), "assets", "images", "menu.png"),
        path.resolve(process.cwd(), "assets", "images", "background.png"),
        path.resolve(process.cwd(), "assets", "background.png"),
        path.resolve(process.cwd(), "public", "background.png"),
        path.resolve(process.cwd(), "public", "images", "menu.png")
      ]

      logger.debug(`Searching for background image in ${possiblePaths.length} paths`)

      for (const filePath of possiblePaths) {
        try {
          // Check if file exists
          const exists = fs.existsSync(filePath)
          if (!exists) {
            logger.debug(`Background path not found: ${filePath}`)
            continue
          }

          // Read file
          logger.debug(`Reading background file: ${filePath}`)
          const imageBuffer = await fsPromises.readFile(filePath)

          if (!imageBuffer || imageBuffer.length === 0) {
            logger.warn(`Background file is empty: ${filePath}`)
            continue
          }

          // Get file extension
          const ext = path.extname(filePath).substring(1) || 'png'
          const mimeType = ext.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg'

          logger.debug(`Uploading background: ${filePath} (${imageBuffer.length} bytes, ${mimeType})`)

          // Upload to deline
          const uploadedUrl = await uploadDeline(imageBuffer, ext, mimeType)

          if (!uploadedUrl) {
            logger.warn(`Background upload returned empty URL for ${filePath}`)
            continue
          }

          logger.info(`✅ Background image successfully uploaded: ${uploadedUrl}`)
          return uploadedUrl

        } catch (pathError) {
          logger.warn(`Failed to process background ${filePath}: ${pathError.message}`)
          continue
        }
      }

      // No local background found, use default
      logger.warn(`No local background image found, using deline default`)
      return 'https://api.deline.web.id/default-avatar.jpg'

    } catch (error) {
      logger.error('Error getting background image:', error)
      return 'https://api.deline.web.id/default-avatar.jpg'
    }
  }

  /**
   * Format participants for welcome/goodbye messages
   */
  async formatParticipants(sock, groupJid, participants, action) {
    try {
      const formattedMessages = []
      let groupName = await this.metadataManager.getGroupName(sock, groupJid)
      const timestamp = Math.floor(Date.now() / 1000) + 3600

      // Get group member count
      const groupMetadata = await sock.groupMetadata(groupJid)
      const memberCount = groupMetadata.participants.length

      // Truncate groupName to 30 characters (API requirement)
      if (groupName.length > 30) {
        groupName = groupName.substring(0, 27) + '...'
      }

      // Get background image URL once for welcome messages
      let backgroundUrl = null
      if (action === 'add') {
        try {
          backgroundUrl = await this.getBackgroundImage()
          logger.debug(`Background URL obtained: ${backgroundUrl}`)
        } catch (bgError) {
          logger.warn(`Failed to get background image: ${bgError.message}`)
          backgroundUrl = null
        }
      }

      // Process each participant
      for (const participantData of participants) {
        try {
          const { jid, displayName } = participantData

          // Generate canvas image for welcome messages
          let canvasBuffer = null
          if (action === 'add') {
            try {
              // Get user avatar URL
              const avatar = await this.getUserAvatar(sock, jid)
              logger.debug(`Avatar URL for ${displayName}: ${avatar}`)

              // Use background URL, fallback to avatar if no background
              const background = backgroundUrl || avatar
              logger.debug(`Canvas config - display: ${displayName}, group: ${groupName}, members: ${memberCount}, avatar: ${avatar}, bg: ${background}`)

              // Generate welcome canvas
              const canvasResult = await tools.welcomeCanvas(
                displayName,
                groupName,
                memberCount,
                avatar,
                background
              )

              if (canvasResult && canvasResult.success && canvasResult.data && canvasResult.data.buffer) {
                canvasBuffer = canvasResult.data.buffer
                logger.info(`✅ Welcome canvas generated for ${displayName}`)
              } else {
                logger.warn(`Canvas generation failed for ${displayName}: invalid response`)
              }
            } catch (canvasError) {
              logger.error(`Canvas generation error for ${displayName}: ${canvasError.message}`)
              // Continue without canvas
            }
          }

          // Create action message
          const message = this.createActionMessage(action, displayName, groupName, timestamp)
          const fakeQuotedMessage = this.createFakeQuotedMessage(action, displayName, jid, groupJid)

          formattedMessages.push({
            participant: jid,
            message: message,
            fakeQuotedMessage: fakeQuotedMessage,
            displayName: displayName,
            canvasImage: canvasBuffer
          })

        } catch (participantError) {
          logger.error(`Failed to format participant ${participantData.displayName}: ${participantError.message}`)
          // Continue with next participant
        }
      }

      logger.info(`Formatted ${formattedMessages.length} participants for action: ${action}`)
      return formattedMessages

    } catch (error) {
      logger.error('Error formatting participants:', error)
      return []
    }
  }

  /**
   * Create action message text
   */
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

  /**
   * Create fake quoted message for group events
   */
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