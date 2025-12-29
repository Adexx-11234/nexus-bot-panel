import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('TRANSACTION_HANDLER')

/**
 * Enhances transaction handling with automatic retry and error recovery
 * Detects Signal key write failures and attempts automatic recovery
 * 
 * Problem: Transaction failures occur when:
 * - File system is slow or temporarily unavailable
 * - Disk is full (ENOSPC)
 * - Permission issues (EACCES)
 * - Read-only file system (EROFS)
 * 
 * Solution: Add retry logic and detailed error logging
 */
export function enhanceTransactionHandling(sock, sessionId) {
  if (!sock?.ev) return
  
  const originalTransaction = sock.ev.transaction
  
  if (!originalTransaction || typeof originalTransaction !== 'function') {
    logger.warn(`[${sessionId}] Socket transaction not available for enhancement`)
    return
  }
  
  // ✅ Override transaction to add retry logic
  sock.ev.transaction = async function(work, key) {
    let attempt = 0
    const maxAttempts = 3
    
    while (attempt < maxAttempts) {
      try {
        // Execute transaction with original implementation
        const result = await originalTransaction.call(this, work, key)
        
        if (attempt > 0) {
        //  logger.info(`[${sessionId}] ✅ Transaction succeeded after ${attempt} retries for key: ${key}`)
        }
        
        return result
      } catch (error) {
        attempt++
        const isLastAttempt = attempt >= maxAttempts
        
        // Identify the specific transaction error type
        const errorMsg = error?.message || error?.toString() || ''
        const errorCode = error?.code || 'UNKNOWN'
        
        const isFileSystemError = 
          errorMsg.includes('ENOSPC') || // Disk full
          errorMsg.includes('EACCES') || // Permission denied
          errorMsg.includes('EROFS') ||  // Read-only file system
          errorMsg.includes('EAGAIN') || // Resource temporarily unavailable
          errorMsg.includes('ENOMEM')    // Out of memory
        
        const isSignalError = 
          errorMsg.includes('session') || 
          errorMsg.includes('pre-key') || 
          errorMsg.includes('sender-key') ||
          errorMsg.includes('Signal') ||
          errorMsg.includes('cipher')
        
        const transactionError = 
          errorMsg.includes('transaction') ||
          errorMsg.includes('rolling back')
        
        logger.warn({
          sessionId,
          attempt,
          key,
          errorCode,
          errorMsg: errorMsg.substring(0, 100),
          isFileSystem: isFileSystemError,
          isSignal: isSignalError,
          isTransaction: transactionError,
          isLastAttempt
        }, `⚠️  Transaction attempt ${attempt}/${maxAttempts} failed`)
        
        if (isLastAttempt) {
          // Last attempt failed - log critical error
          logger.error({
            sessionId,
            key,
            errorCode,
            fullError: error?.stack || error
          }, `❌ Transaction FAILED after ${maxAttempts} attempts - Signal keys may be out of sync!`)
          
          // Log guidance
          if (isFileSystemError) {
            logger.error(`[${sessionId}] FILE SYSTEM ERROR - Check disk space, permissions, or file system status`)
          }
          if (isSignalError) {
            logger.error(`[${sessionId}] SIGNAL PROTOCOL ERROR - Session might be corrupted, may need reconnection`)
          }
          
          throw error
        }
        
        // Wait before retrying (exponential backoff)
        const delayMs = 2000 * attempt // 2s, 4s, 6s
        logger.debug(`[${sessionId}] ⏳ Waiting ${delayMs}ms before retry...`)
        
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }
  
  logger.debug(`[${sessionId}] ✅ Transaction error handling enhanced`)
}

/**
 * Monitors key store health and detects storage issues early
 */
export function monitorKeyStoreHealth(authState, sessionId) {
  const writeTest = async () => {
    try {
      // ✅ FIX: Safely access keys from authState
      // authState can have different structures: { keys: {...} } or direct keys
      const keyStore = authState?.keys || authState
      
      if (!keyStore || typeof keyStore.set !== 'function') {
        logger.warn(`[${sessionId}] Key store unavailable for health check`)
        return { healthy: true } // Assume healthy if can't test
      }
      
      // Test write a dummy key
      const testKey = `_health_check_${Date.now()}`
      const testValue = Buffer.from('OK')
      
      await keyStore.set({
        'session': {
          [testKey]: testValue
        }
      })
      
      // Clean up the test key
      await keyStore.set({
        'session': {
          [testKey]: null
        }
      })
      
      logger.debug(`[${sessionId}] ✅ Key store health check: OK`)
      return { healthy: true }
    } catch (error) {
      logger.error({
        sessionId,
        error: error?.message,
        code: error?.code,
        stack: error?.stack?.substring(0, 200)
      }, `❌ Key store health check FAILED`)
      
      return { 
        healthy: false, 
        error: error?.message,
        type: error?.code || 'UNKNOWN'
      }
    }
  }
  
  // Run health check every 5 minutes
  const healthCheckInterval = setInterval(async () => {
    const health = await writeTest()
    if (!health.healthy) {
      logger.warn(`[${sessionId}] ⚠️  KEY STORE UNHEALTHY - Messages may not be delivered!`)
      logger.warn(`[${sessionId}] Error type: ${health.type} - ${health.error}`)
    }
  }, 5 * 60 * 1000)
  
  return {
    stop: () => clearInterval(healthCheckInterval),
    test: writeTest
  }
}
