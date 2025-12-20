/**
 * UPDATED WEB SESSION DETECTOR - FIXED WITH FORCE PROCESS
 * For Main Server - Detects connections created by Web Session Server
 * 
 * How it works:
 * 1. Web server creates connection and marks detected=false
 * 2. Main server detects the connection
 * 3. Main server takes over and sets up event handlers
 * 4. Main server marks detected=true
 */

import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('WEB_SESSION_DETECTOR')

export class WebSessionDetector {
  constructor(storage, sessionManager) {
    this.storage = storage
    this.sessionManager = sessionManager
    this.pollingInterval = null
    this.running = false
    this.processedSessions = new Set()
    this.pollIntervalMs = 10000 // Check every 10 seconds
    this.processingNow = new Set() // Track sessions currently being processed
  }

  /**
   * Start detection polling
   */
  start() {
    if (this.running) {
      logger.warn('Web session detector already running')
      return
    }

    this.running = true
    logger.info('Starting web session detector')

    // Run immediate check
    this._pollForWebSessions().catch(error => {
      logger.error('Initial detection error:', error)
    })

    // Setup interval
    this.pollingInterval = setInterval(() => {
      this._pollForWebSessions().catch(error => {
        logger.error('Polling error:', error)
      })
    }, this.pollIntervalMs)

    logger.info('Web session detector started')
  }

  /**
   * Stop detection polling
   */
  stop() {
    if (!this.running) {
      return
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }

    this.running = false
    this.processedSessions.clear()
    this.processingNow.clear()
    
    logger.info('Web session detector stopped')
  }

  /**
   * Poll for undetected web sessions
   * @private
   */
  async _pollForWebSessions() {
    try {
      // Get undetected web sessions from storage
      const undetectedSessions = await this.storage.getUndetectedWebSessions()
      
      if (undetectedSessions.length === 0) {
        return
      }

      logger.info(`Found ${undetectedSessions.length} undetected web sessions - FORCING IMMEDIATE TAKEOVER`)

      // Process each session - FORCE PROCESS, NO SKIPPING
      for (const sessionData of undetectedSessions) {
        // CRITICAL: Clear any previous processing flags
        this.processingNow.delete(sessionData.sessionId)
        this.processedSessions.delete(sessionData.sessionId)
        
        logger.warn(`🚨 FORCING takeover for ${sessionData.sessionId}`)

        await this._processWebSession(sessionData, true).catch(error => {
          logger.error(`Failed to process ${sessionData.sessionId}:`, error)
        })
      }

    } catch (error) {
      logger.error('Error polling for web sessions:', error)
    }
  }

  /**
   * Process individual web session - Take over from web server
   * @private
   */
  async _processWebSession(sessionData, forceProcess = false) {
    const { sessionId, phoneNumber, userId } = sessionData

    try {
      // FORCE MODE: Skip all checks, go straight to takeover
      if (forceProcess) {
        logger.warn(`🚨 FORCE MODE - Taking over ${sessionId} immediately`)
        
        // Mark as currently processing
        this.processingNow.add(sessionId)
        
        // Take over the session from web server
        const success = await this._takeOverSession(sessionData)

        if (!success) {
          logger.warn(`❌ Failed to take over web session: ${sessionId}`)
          this.processingNow.delete(sessionId)
        } else {
          logger.info(`✅ Successfully took over web session: ${sessionId}`)
          this.processedSessions.add(sessionId)
          this.processingNow.delete(sessionId)
        }
        
        return
      }

      // NORMAL MODE: Regular checks
      // Skip if already processed in this session
      if (this.processedSessions.has(sessionId)) {
        logger.debug(`Session ${sessionId} already processed, skipping`)
        return
      }

      // Mark as currently processing
      this.processingNow.add(sessionId)

      // Check database for current session state
      const sessionInDB = await this.storage.getSession(sessionId);
      
      // Skip if session doesn't exist
      if (!sessionInDB) {
        logger.debug(`Session ${sessionId} not found in database, skipping`)
        this.processingNow.delete(sessionId)
        return;
      }
      
      // Skip if already detected
      if (sessionInDB.detected) {
        logger.debug(`Session ${sessionId} already detected, skipping`)
        this.processedSessions.add(sessionId)
        this.processingNow.delete(sessionId)
        return;
      }

      // CRITICAL FIX: Don't skip disconnected sessions - they need takeover!
      logger.info(`Taking over web session: ${sessionId} (status: ${sessionInDB.connectionStatus})`)

      // Check if session already has active socket in main server
      const existingSocket = this.sessionManager.activeSockets.get(sessionId)
      if (existingSocket && existingSocket.user && existingSocket.readyState === existingSocket.ws?.OPEN) {
        logger.info(`Session ${sessionId} already active in main server, marking as detected`)
        await this.storage.markSessionAsDetected(sessionId, true)
        this.processedSessions.add(sessionId)
        this.processingNow.delete(sessionId)
        return
      }

      // Take over the session from web server
      const success = await this._takeOverSession(sessionData)

      if (!success) {
        logger.warn(`Failed to take over web session: ${sessionId}`)
        // Remove from processing but NOT from processed - allow retry on next poll
        this.processingNow.delete(sessionId)
      } else {
        logger.info(`Successfully took over web session: ${sessionId}`)
        // Mark as processed
        this.processedSessions.add(sessionId)
        this.processingNow.delete(sessionId)
      }

    } catch (error) {
      logger.error(`Error processing web session ${sessionId}:`, error)
      // Remove from processing to allow retry
      this.processingNow.delete(sessionId)
    }
  }

  /**
   * Take over a web session from web server
   * @private
   */
  async _takeOverSession(sessionData) {
    const { sessionId, phoneNumber, userId, telegramId } = sessionData
   logger.warn(`DEBUG - Looking for session with ID: "${sessionId}"`)
  logger.warn(`DEBUG - Session data received:`, JSON.stringify(sessionData))

    try {
      const actualUserId = userId || telegramId || sessionId.replace('session_', '')
logger.warn(`DEBUG - getSession returned:`, JSON.stringify(currentSession))
      // Get current session state from database
      const currentSession = await this.storage.getSession(sessionId);
      if (!currentSession) {
        logger.warn(`Session ${sessionId} no longer exists`)
        return false;
      }

      // Wait briefly for any pending web server operations
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check again if session is already active
      const existingSocket = this.sessionManager.activeSockets.get(sessionId)
      if (existingSocket && existingSocket.user && existingSocket.readyState === existingSocket.ws?.OPEN) {
        logger.info(`Session ${sessionId} already connected, marking as detected`)
        await this.storage.markSessionAsDetected(sessionId, true)
        return true
      }

      logger.info(`Creating takeover connection for ${sessionId} (previous status: ${currentSession.connectionStatus})`)

      // Create session with takeover callbacks
      const sock = await this.sessionManager.createSession(
        actualUserId,
        phoneNumber,
        {
          onConnected: async () => {
            logger.info(`✅ Successfully took over ${sessionId}`)
            
            // Mark as detected in database
            await this.storage.markSessionAsDetected(sessionId, true)
            
            // Setup full event handlers if enabled
            if (this.sessionManager.eventHandlersEnabled && !sock.eventHandlersSetup) {
              await this.sessionManager._setupEventHandlers(sock, sessionId).catch(error => {
                logger.error(`Failed to setup handlers for ${sessionId}:`, error)
              })
            }
          },
          onError: (error) => {
            logger.error(`Takeover error for ${sessionId}:`, error)
            // Remove from processed to allow retry
            this.processedSessions.delete(sessionId)
            this.processingNow.delete(sessionId)
          }
        },
        true, // isReconnect - use existing auth from web server
        'web', // source
        false // Don't allow pairing - already paired by web server
      )

      if (!sock) {
        logger.warn(`Failed to create socket for takeover: ${sessionId}`)
        return false
      }

      logger.info(`Successfully initiated takeover for ${sessionId}`)
      return true

    } catch (error) {
      logger.error(`Takeover failed for ${sessionId}:`, error.message)
      
      // Update session with error info
      await this.storage.updateSession(sessionId, {
        detected: false,
        detectionError: error.message,
        lastDetectionAttempt: new Date()
      }).catch(() => {})
      
      return false
    }
  }

  /**
   * Check if detector is running
   */
  isRunning() {
    return this.running
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      running: this.running,
      processedSessions: this.processedSessions.size,
      processingNow: this.processingNow.size,
      pollInterval: this.pollIntervalMs
    }
  }

  /**
   * Manually trigger detection
   */
  async triggerDetection() {
    if (!this.running) {
      logger.warn('Detector not running, triggering manual detection')
    }

    await this._pollForWebSessions()
  }

  /**
   * Reset processed sessions list
   */
  resetProcessed() {
    const count = this.processedSessions.size
    this.processedSessions.clear()
    this.processingNow.clear()
    logger.info(`Reset ${count} processed sessions`)
  }

  /**
   * Force take over a specific session
   */
  async forceTakeOver(sessionId) {
    try {
      const session = await this.storage.getSession(sessionId)
      
      if (!session) {
        logger.error(`Session ${sessionId} not found`)
        return false
      }

      if (session.detected) {
        logger.warn(`Session ${sessionId} already detected`)
        return false
      }

      if (session.source !== 'web') {
        logger.warn(`Session ${sessionId} is not a web session`)
        return false
      }

      logger.info(`Force taking over session: ${sessionId}`)
      
      // Remove from processed to allow reprocessing
      this.processedSessions.delete(sessionId)
      this.processingNow.delete(sessionId)
      
      // Process the session with force mode
      const success = await this._processWebSession(session, true)
      
      return success

    } catch (error) {
      logger.error(`Force takeover failed for ${sessionId}:`, error)
      return false
    }
  }
}

export default WebSessionDetector