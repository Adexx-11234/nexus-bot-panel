import fs from "fs/promises"
import path from "path"
import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("FILE_MANAGER")

/**
 * FileManager - Handles METADATA storage only
 *
 * DOES NOT HANDLE AUTH (creds.json, keys) - that's handled by auth-state.js
 *
 * Structure:
 * ./sessions/{sessionId}/metadata.json - Session metadata only
 *
 * Auth files (creds.json, keys) are in the same folder but managed by auth-state.js
 */
export class FileManager {
  constructor(sessionDir = "./sessions") {
    this.sessionDir = sessionDir
    this.ensureDirectoryExists(this.sessionDir)

    const storageMode = process.env.STORAGE_MODE || "mongodb"
    if (storageMode === "file") {
      logger.info("📁 File storage ACTIVE - handling metadata")
    } else {
      logger.info("📁 File storage BACKUP - metadata fallback only")
    }
  }

  async ensureDirectoryExists(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true })
    } catch (error) {
      if (error.code !== "EEXIST") {
        logger.error(`Failed to create directory ${dirPath}:`, error)
      }
    }
  }

  /**
   * Get session folder path
   */
  getSessionPath(sessionId) {
    return path.join(this.sessionDir, sessionId)
  }

  /**
   * Get metadata file path (NOT creds.json - that's auth-state.js)
   */
  getMetadataPath(sessionId) {
    return path.join(this.getSessionPath(sessionId), "metadata.json")
  }

  /**
   * Save session metadata ONLY
   * Does NOT touch auth files (creds.json, keys)
   */
  async saveSession(sessionId, sessionData) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      await this.ensureDirectoryExists(sessionPath)

      const metadata = {
        sessionId,
        telegramId: sessionData.telegramId || sessionData.userId,
        userId: sessionData.userId || sessionData.telegramId,
        phoneNumber: sessionData.phoneNumber,
        isConnected: sessionData.isConnected !== undefined ? sessionData.isConnected : false,
        connectionStatus: sessionData.connectionStatus || "disconnected",
        reconnectAttempts: sessionData.reconnectAttempts || 0,
        source: sessionData.source || "telegram",
        detected: sessionData.detected !== false,
        createdAt: sessionData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const metadataPath = this.getMetadataPath(sessionId)
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8")

      return true
    } catch (error) {
      logger.error(`Failed to save metadata ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Get session metadata ONLY
   */
  async getSession(sessionId) {
    try {
      const metadataPath = this.getMetadataPath(sessionId)

      try {
        const data = await fs.readFile(metadataPath, "utf8")
        const metadata = JSON.parse(data)

        return {
          sessionId: metadata.sessionId,
          userId: metadata.userId || metadata.telegramId,
          telegramId: metadata.telegramId || metadata.userId,
          phoneNumber: metadata.phoneNumber,
          isConnected: metadata.isConnected,
          connectionStatus: metadata.connectionStatus,
          reconnectAttempts: metadata.reconnectAttempts || 0,
          source: metadata.source || "telegram",
          detected: metadata.detected !== false,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
        }
      } catch (readError) {
        // Metadata doesn't exist
        return null
      }
    } catch (error) {
      logger.error(`Failed to get session ${sessionId}:`, error.message)
      return null
    }
  }

  /**
   * Update session metadata ONLY
   */
  async updateSession(sessionId, updates) {
    try {
      // Get existing metadata
      let metadata = await this.getSession(sessionId)

      if (!metadata) {
        // Create new metadata if doesn't exist
        metadata = {
          sessionId,
          userId: sessionId.replace("session_", ""),
          telegramId: sessionId.replace("session_", ""),
          phoneNumber: null,
          isConnected: false,
          connectionStatus: "disconnected",
          reconnectAttempts: 0,
          source: "telegram",
          detected: true,
          createdAt: new Date().toISOString(),
        }
      }

      // Apply updates
      const allowedFields = [
        "isConnected",
        "connectionStatus",
        "phoneNumber",
        "reconnectAttempts",
        "source",
        "detected",
        "detectedAt",
      ]

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          metadata[field] = updates[field]
        }
      }

      metadata.updatedAt = new Date().toISOString()

      // Save updated metadata
      const metadataPath = this.getMetadataPath(sessionId)
      await this.ensureDirectoryExists(path.dirname(metadataPath))
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8")

      return true
    } catch (error) {
      logger.error(`Failed to update session ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Delete session metadata ONLY
   * Does NOT delete auth files - that's handled by auth-state.js cleanup()
   */
  async deleteSession(sessionId) {
    try {
      const metadataPath = this.getMetadataPath(sessionId)

      try {
        await fs.unlink(metadataPath)
        logger.debug(`Deleted metadata for ${sessionId}`)
        return true
      } catch (error) {
        if (error.code !== "ENOENT") {
          logger.error(`Failed to delete metadata ${sessionId}:`, error.message)
        }
        return false
      }
    } catch (error) {
      logger.error(`Failed to delete session ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Complete cleanup - delete entire session folder
   * This includes metadata.json AND auth files (creds.json, keys)
   * Only use this for full logout/cleanup
   */
  async cleanupSessionFiles(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)

      try {
        await fs.rm(sessionPath, { recursive: true, force: true })
        logger.info(`Cleaned up session folder: ${sessionId}`)
        return true
      } catch (error) {
        if (error.code !== "ENOENT") {
          logger.error(`Failed to cleanup ${sessionId}:`, error.message)
        }
        return false
      }
    } catch (error) {
      logger.error(`Cleanup error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Check if session has valid credentials (creds.json with required fields)
   * Already async - this is CORRECT in your code
   */
  async hasValidCredentials(sessionId) {
    try {
      const credsPath = path.join(this.getSessionPath(sessionId), "creds.json")

      try {
        const data = await fs.readFile(credsPath, "utf8")
        const creds = JSON.parse(data)

        // Validate required fields
        const isValid = !!(creds?.noiseKey && creds?.signedIdentityKey)

        if (isValid) {
          logger.debug(`✅ Session ${sessionId} has valid file credentials`)
        } else {
          logger.debug(`❌ Session ${sessionId} file exists but missing required fields`)
        }

        return isValid
      } catch (error) {
        logger.debug(`❌ Session ${sessionId} has no creds.json: ${error.message}`)
        return false
      }
    } catch (error) {
      logger.error(`Failed to check credentials for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Ensure session directory exists (already async compatible)
   */
  async ensureSessionDirectory(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      await this.ensureDirectoryExists(sessionPath)
    } catch (error) {
      logger.error(`Failed to ensure directory for ${sessionId}:`, error.message)
    }
  }

  /**
   * Get credentials file path
   */
  getCredsPath(sessionId) {
    return path.join(this.getSessionPath(sessionId), "creds.json")
  }

  /**
   * Check if session has auth files
   */
  async hasAuthFiles(sessionId) {
    try {
      const credsPath = this.getCredsPath(sessionId)
      await fs.access(credsPath)

      // Read and validate
      const data = await fs.readFile(credsPath, "utf8")
      const creds = JSON.parse(data)

      return !!(creds?.noiseKey && creds?.signedIdentityKey)
    } catch (error) {
      return false
    }
  }

  /**
   * Get all sessions from file storage
   */
  async getAllSessions() {
    try {
      const entries = await fs.readdir(this.sessionDir, { withFileTypes: true })
      const sessionFolders = entries.filter((entry) => entry.isDirectory())

      const sessions = []

      for (const folder of sessionFolders) {
        const sessionId = folder.name
        const metadata = await this.getSession(sessionId)

        if (metadata) {
          sessions.push(metadata)
        }
      }

      return sessions
    } catch (error) {
      logger.error("Failed to get all sessions:", error.message)
      return []
    }
  }

  /**
   * Check if session folder exists
   */
  async sessionExists(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      await fs.access(sessionPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Cleanup orphaned sessions
   * A session is orphaned if it has neither metadata nor auth files
   */
  async cleanupOrphanedSessions(storageCoordinator) {
    try {
      const entries = await fs.readdir(this.sessionDir, { withFileTypes: true })
      const sessionFolders = entries.filter((entry) => entry.isDirectory())

      let cleanedCount = 0

      for (const folder of sessionFolders) {
        const sessionId = folder.name
        const sessionPath = this.getSessionPath(sessionId)

        // Check if folder has any files
        const files = await fs.readdir(sessionPath)

        // If folder is empty or only has old temp files, clean it up
        if (files.length === 0) {
          logger.warn(`Empty session folder detected: ${sessionId}`)
          await this.cleanupSessionFiles(sessionId)
          cleanedCount++
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} orphaned session folders`)
      }

      return { cleaned: cleanedCount, errors: 0 }
    } catch (error) {
      logger.error("Orphaned cleanup error:", error.message)
      return { cleaned: 0, errors: 1 }
    }
  }

  /**
   * Get storage stats
   */
  getStats() {
    return {
      sessionDir: this.sessionDir,
      storageMode: process.env.STORAGE_MODE || "mongodb",
      handles: "metadata.json only (auth handled by auth-state.js)",
    }
  }

  /**
   * 🆕 Delete old pre-key files
   * When pre-keys exceed maxToKeep, delete oldest ones
   */
  async deleteOldPreKeys(sessionId, maxToKeep = 500) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      const fs = await import("fs/promises")
      const path = await import("path")

      // Get all files in session folder
      const files = await fs.readdir(sessionPath)

      // Filter for pre-key files
      const preKeyFiles = files.filter(
        (f) =>
          f.toLowerCase().startsWith("pre-key") ||
          f.toLowerCase().startsWith("pre_key") ||
          f.toLowerCase().startsWith("prekey"),
      )

      if (preKeyFiles.length <= maxToKeep) {
        return { deleted: 0, total: preKeyFiles.length }
      }

      // Sort by pre-key ID (extract number from filename)
      const extractPreKeyId = (filename) => {
        const match = filename.match(/\d+/)
        return match ? Number.parseInt(match[0]) : 0
      }

      const sortedPreKeys = preKeyFiles.map((f) => ({ name: f, id: extractPreKeyId(f) })).sort((a, b) => a.id - b.id)

      // Delete oldest ones (lowest IDs)
      const toDeleteCount = preKeyFiles.length - maxToKeep
      const toDelete = sortedPreKeys.slice(0, toDeleteCount)

      let deleted = 0
      for (const { name } of toDelete) {
        try {
          const filePath = path.join(sessionPath, name)
          await fs.unlink(filePath)
          deleted++
        } catch (error) {
          logger.debug(`Failed to delete ${name}: ${error.message}`)
        }
      }

      if (deleted > 0) {
        logger.info(`✅ Deleted ${deleted} old pre-keys for ${sessionId}`)
      }

      return { deleted, total: preKeyFiles.length }
    } catch (error) {
      logger.error(`Failed to delete old pre-keys for ${sessionId}:`, error.message)
      return { deleted: 0, error: error.message }
    }
  }

  /**
   * 🆕 Get pre-key count
   */
  async getPreKeyCount(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      const fs = await import("fs/promises")

      const files = await fs.readdir(sessionPath)

      const preKeyCount = files.filter(
        (f) =>
          f.toLowerCase().startsWith("pre-key") ||
          f.toLowerCase().startsWith("pre_key") ||
          f.toLowerCase().startsWith("prekey"),
      ).length

      return preKeyCount
    } catch (error) {
      logger.debug(`Failed to count pre-keys for ${sessionId}: ${error.message}`)
      return 0
    }
  }
}