// Fixed VV Command Plugin - Streamlined with proper timestamp handling
import { ViewOnceHandler } from "../../whatsapp/utils/viewonce-handler.js"

export default {
  name: "ViewOnce Retrieval",
  description: "Reply to a ViewOnce message with .vv to retrieve it",
  commands: ["vv"],
  category: "both",
  adminOnly: false,
  usage: `• Reply to a ViewOnce message with \`.vv\` to retrieve it\n• \`.vv dm\` - Send to your DM instead`,

  async execute(sock, sessionId, args, m) {
    try {
      // Parse options
      const options = this.parseArguments(args)
      
      // Use ViewOnceHandler's comprehensive detection
      const detectionResult = await ViewOnceHandler.detectViewOnceMessage(m)

      if (!detectionResult.detected) {
        return {
          response: "❌ Please reply to a ViewOnce message with .vv to retrieve it.\n\n• `.vv` - Retrieve to current chat\n• `.vv dm` - Send to your DM",
          mentions: [],
        }
      }

      const chatJid = m.key.remoteJid
      const senderJid = m.key.participant || m.key.remoteJid
      
      // Determine target
      let targetJid = chatJid
      let responseMessage = "✅ ViewOnce message retrieved!"
      
      if (options.dm) {
        targetJid = senderJid
        responseMessage = "✅ ViewOnce message sent to your DM!"
      }

      // Process the ViewOnce message
      const processed = await ViewOnceHandler.processViewOnceMedia(m, sock, detectionResult, targetJid)

      if (processed) {
        // Send context message if not DM
        if (!options.dm) {
          await this.sendRetrievalSuccess(sock, chatJid, m, detectionResult)
        }
        
        return {
          response: responseMessage,
          mentions: [],
        }
      } else {
        return {
          response: "❌ Failed to retrieve ViewOnce message. It may have expired or be corrupted.",
          mentions: [],
        }
      }
    } catch (error) {
      console.error("[VV] Plugin error:", error.message)
      return {
        response: "❌ An error occurred while retrieving the ViewOnce message.",
        mentions: [],
      }
    }
  },

  /**
   * Send retrieval success notification with proper timestamp
   */
  async sendRetrievalSuccess(sock, chatJid, originalMessage, detectionResult) {
    try {
      const senderName = originalMessage.pushName || "Unknown"
      
      // Use message timestamp, not current time
      const messageTimestamp = originalMessage.messageTimestamp || originalMessage.timestamp || Math.floor(Date.now() / 1000)
      const timestamp = new Date(messageTimestamp * 1000).toLocaleString()
      
      const contextMessage = 
        `🔓 *ViewOnce Retrieved* 🔓\n\n` +
        `👤 Retrieved by: ${senderName}\n` +
        `📱 Type: ${detectionResult.mediaType?.toUpperCase() || "Unknown"}\n` +
        `🕒 Original: ${timestamp}\n` +
        `⚠️ Retrieved using .vv command`

      await sock.sendMessage(chatJid, {
        text: contextMessage
      }, { quoted: originalMessage })

    } catch (error) {
      console.error("[VV] Error sending context message:", error.message)
    }
  },

  /**
   * Parse command arguments
   */
  parseArguments(args) {
    const options = {
      dm: false,
      silent: false
    }

    if (args && args.length > 0) {
      const argString = args.join(' ').toLowerCase()
      options.dm = argString.includes('dm') || argString.includes('private')
      options.silent = argString.includes('silent') || argString.includes('quiet')
    }

    return options
  },

  /**
   * Health check for the plugin
   */
  async healthCheck() {
    try {
      const handlerAvailable = typeof ViewOnceHandler.detectViewOnceMessage === 'function' &&
                              typeof ViewOnceHandler.processViewOnceMedia === 'function'
      
      return {
        status: handlerAvailable ? 'healthy' : 'unhealthy',
        handlerIntegration: handlerAvailable,
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}