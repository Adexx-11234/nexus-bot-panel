// Compatible Auto Anti-ViewOnce Plugin - Fixed version that works with ViewOnceHandler
// This plugin integrates seamlessly with the compatible ViewOnceHandler

import { AntiDeletedHandler } from "../whatsapp/index.js"
import { UserQueries } from "../database/query.js"

export default {
  name: "Auto Anti-Deleted",
  description: "Automatically detects and forwards deleted messages using enhanced AntiDeletedHandler",
  category: "utility",
  isAntiPlugin: true,
  commands: [],

  async execute(sock, sessionId, args, m) {
    return { response: "This plugin runs automatically and doesn't have manual commands." }
  },

async processMessage(sock, sessionId, m) {
    try {
        const deletedProcessed = await AntiDeletedHandler.handleDeletedMessage(m, sock)
        if (deletedProcessed) {
          this.log(`Deleted message processed for session ${sessionId}`, "info")
        }
      } catch (deletedError) {
        this.log(`Anti-deleted processing error: ${deletedError.message}`, "error")
      }
},

  /**
   * Enhanced shouldProcess method with better filtering
   */
  async shouldProcess(m) {
    try {
      // Always process messages to ensure we don't miss any ViewOnce
      // The actual filtering is done in processMessage method
      return true
    } catch (error) {
      return true // Process anyway if error
    }
  },

  /**
   * Enhanced isEnabled method
   */
  async isEnabled(chatId) {
    try {
      // Check if any users have antiviewonce enabled
      const enabledUsers = await UserQueries.getAntiDelteUsers()

      // Enable for all chats if there are any enabled users
      // The actual user-specific filtering happens in processMessage
      const isEnabled = enabledUsers.length > 0

      return isEnabled
    } catch (error) {
      return true // Enable by default if error
    }
  },

  /**
   * Plugin initialization (called when plugin loads)
   */
  async init() {
    // Verify ViewOnceHandler is available
    try {
      if (typeof AntiDeletedHandler.handleDeletedMessage === "function") {
        // ViewOnceHandler integration verified
      }
    } catch (error) {
      console.error("[AutoAntiViewOnce] ViewOnceHandler verification failed:", error.message)
    }
  },

  /**
   * Health check method for monitoring
   */
  async healthCheck() {
    try {
      const enabledUsers = await UserQueries.getAntiDelteUsers()
      return {
        status: "healthy",
        enabledUsers: enabledUsers.length,
        handlerAvailable: typeof AntiDeletedHandler.handleDeletedMessage === "function",
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      return {
        status: "unhealthy",
        error: error.message,
        timestamp: new Date().toISOString(),
      }
    }
  },
}
