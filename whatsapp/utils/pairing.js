import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('PAIRING')

// Custom pairing code prefix (optional)
const CUSTOM_PAIRING_CODE = 'NEXUSBOT'

/**
 * Handle WhatsApp pairing code generation with custom code
 * No artificial timeouts - let baileys/WhatsApp handle connection timeout (408)
 */
export async function handlePairing(sock, sessionId, phoneNumber, pairingState, callbacks) {
  try {
    if (!phoneNumber) {
      logger.warn(`No phone number provided for pairing ${sessionId}`)
      return
    }

    // Check if pairing already exists and is active
    const existingPair = pairingState.get(sessionId)
    
    if (existingPair && existingPair.active) {
      if (callbacks?.onPairingCode) {
        await callbacks.onPairingCode(existingPair.code)
      }
      return
    }

    // Format phone number - remove all non-numeric characters
    const formattedPhone = phoneNumber.replace(/[^0-9]/g, '')
    logger.info(`Pairing: Original: ${phoneNumber}, Formatted: ${formattedPhone}`)

    // Wait before requesting pairing code
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Request pairing code from WhatsApp with custom code
    const code = await sock.requestPairingCode(formattedPhone, CUSTOM_PAIRING_CODE)
    const formattedCode = code.match(/.{1,4}/g)?.join('-') || code

    // Store pairing state WITHOUT timeout - let 408 handle it
    pairingState.set(sessionId, {
      code: formattedCode,
      active: true,
      phoneNumber: formattedPhone,
      createdAt: Date.now()
    })

    logger.info(`Pairing code generated for ${sessionId}: ${formattedCode}`)

    // Invoke callback
    if (callbacks?.onPairingCode) {
      await callbacks.onPairingCode(formattedCode)
    }

  } catch (error) {
    logger.error(`Pairing error for ${sessionId}:`, error)
    
    if (callbacks?.onError) {
      callbacks.onError(error)
    }
  }
}

/**
 * Mark pairing restart as handled
 */
export function markPairingRestartHandled(pairingState, sessionId) {
  const pair = pairingState.get(sessionId)
  if (pair) {
    pairingState.set(sessionId, { ...pair, active: false })
  }
}

/**
 * Clear pairing state
 */
export function clearPairing(pairingState, sessionId) {
  pairingState.delete(sessionId)
  logger.debug(`Pairing state cleared for ${sessionId}`)
}

/**
 * Check if pairing is active
 */
export function isPairingActive(pairingState, sessionId) {
  const pair = pairingState.get(sessionId)
  return pair ? pair.active : false
}

/**
 * Get pairing code
 */
export function getPairingCode(pairingState, sessionId) {
  const pair = pairingState.get(sessionId)
  return pair ? pair.code : null
}

/**
 * Cleanup old pairing codes (for maintenance only)
 */
export function cleanupExpiredPairing(pairingState) {
  // Keep codes around - let 408 handle cleanup when connection fails
  // This is just for very old codes (24+ hours)
  const now = Date.now()
  const maxAge = 24 * 60 * 60 * 1000 // 24 hours
  let cleanedCount = 0

  for (const [sessionId, pair] of pairingState.entries()) {
    if (now - pair.createdAt > maxAge) {
      pairingState.delete(sessionId)
      cleanedCount++
      logger.debug(`Old pairing code cleaned up for ${sessionId}`)
    }
  }

  if (cleanedCount > 0) {
    logger.info(`Cleaned up ${cleanedCount} old pairing codes`)
  }

  return cleanedCount
}