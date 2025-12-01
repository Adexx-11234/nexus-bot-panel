import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createComponentLogger } from '../../utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = createComponentLogger('FILE_MANAGER')

/**
 * FileManager - File-based storage (FALLBACK when DB unavailable)
 * Handles both auth state AND session data in files
 */
export class FileManager {
  constructor(sessionDir = './sessions') {
    this.sessionsDir = path.resolve(process.cwd(), sessionDir)
    this._ensureSessionsDirectory()
  }

  _ensureSessionsDirectory() {
    try {
      if (!fs.existsSync(this.sessionsDir)) {
        fs.mkdirSync(this.sessionsDir, { recursive: true })
        logger.info(`Created sessions directory: ${this.sessionsDir}`)
      }
    } catch (error) {
      logger.error('Failed to create sessions directory:', error)
      throw error
    }
  }

  getSessionPath(sessionId) {
    let normalizedSessionId = sessionId.startsWith('session_')
      ? sessionId
      : sessionId.startsWith('user_')
        ? sessionId.replace('user_', 'session_')
        : `session_${sessionId}`

    return path.join(this.sessionsDir, normalizedSessionId)
  }

  ensureSessionDirectory(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true })
      }
      return true
    } catch (error) {
      logger.error(`Failed to create session directory ${sessionId}:`, error)
      return false
    }
  }

  hasValidCredentials(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      const credsFile = path.join(sessionPath, 'creds.json')

      if (!fs.existsSync(credsFile)) return false

      const stats = fs.statSync(credsFile)
      if (stats.size === 0) return false

      const data = fs.readFileSync(credsFile, 'utf8')
      const parsed = JSON.parse(data)

      return !!(parsed?.noiseKey || parsed?.signedIdentityKey || parsed?.registrationId)

    } catch (error) {
      return false
    }
  }

  readCredentials(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      const credsFile = path.join(sessionPath, 'creds.json')

      if (!fs.existsSync(credsFile)) return null

      const data = fs.readFileSync(credsFile, 'utf8')
      if (!data.trim()) return null

      return JSON.parse(data)

    } catch (error) {
      logger.error(`Failed to read credentials ${sessionId}:`, error)
      return null
    }
  }

  writeCredentials(sessionId, credentials) {
    try {
      if (!credentials || typeof credentials !== 'object') return false

      const sessionPath = this.getSessionPath(sessionId)
      this.ensureSessionDirectory(sessionId)

      const credsFile = path.join(sessionPath, 'creds.json')
      const tempFile = credsFile + '.tmp'

      fs.writeFileSync(tempFile, JSON.stringify(credentials, null, 2))
      fs.renameSync(tempFile, credsFile)

      return true

    } catch (error) {
      logger.error(`Failed to write credentials ${sessionId}:`, error)
      return false
    }
  }

  // NEW: File-based session data storage (fallback)
  async saveSession(sessionId, sessionData) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      this.ensureSessionDirectory(sessionId)

      const metadataFile = path.join(sessionPath, 'session.json')
      const tempFile = metadataFile + '.tmp'

      const metadata = {
        sessionId,
        telegramId: sessionData.telegramId || sessionData.userId,
        phoneNumber: sessionData.phoneNumber,
        isConnected: sessionData.isConnected !== undefined ? sessionData.isConnected : false,
        connectionStatus: sessionData.connectionStatus || 'disconnected',
        reconnectAttempts: sessionData.reconnectAttempts || 0,
        source: sessionData.source || 'telegram',
        detected: sessionData.detected !== false,
        createdAt: sessionData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      fs.writeFileSync(tempFile, JSON.stringify(metadata, null, 2))
      fs.renameSync(tempFile, metadataFile)

      return true

    } catch (error) {
      logger.error(`Failed to save session ${sessionId}:`, error)
      return false
    }
  }

  // NEW: Read session data from file
  async getSession(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      const metadataFile = path.join(sessionPath, 'session.json')

      if (!fs.existsSync(metadataFile)) return null

      const data = fs.readFileSync(metadataFile, 'utf8')
      if (!data.trim()) return null

      const metadata = JSON.parse(data)

      return {
        sessionId: metadata.sessionId,
        userId: metadata.telegramId,
        telegramId: metadata.telegramId,
        phoneNumber: metadata.phoneNumber,
        isConnected: metadata.isConnected,
        connectionStatus: metadata.connectionStatus,
        reconnectAttempts: metadata.reconnectAttempts,
        source: metadata.source || 'telegram',
        detected: metadata.detected !== false,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt
      }

    } catch (error) {
      logger.error(`Failed to get session ${sessionId}:`, error)
      return null
    }
  }

  // NEW: Update session data in file
  async updateSession(sessionId, updates) {
    try {
      const existingSession = await this.getSession(sessionId)
      if (!existingSession) return false

      const updatedSession = {
        ...existingSession,
        ...updates,
        updatedAt: new Date().toISOString()
      }

      return await this.saveSession(sessionId, updatedSession)

    } catch (error) {
      logger.error(`Failed to update session ${sessionId}:`, error)
      return false
    }
  }

  // NEW: Get all sessions from files
  async getAllSessions() {
    try {
      if (!fs.existsSync(this.sessionsDir)) return []

      const sessionDirs = fs.readdirSync(this.sessionsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('session_'))
        .map(dirent => dirent.name)

      const sessions = []

      for (const dirName of sessionDirs) {
        const sessionData = await this.getSession(dirName)
        if (sessionData) {
          sessions.push(sessionData)
        }
      }

      return sessions.sort((a, b) => 
        new Date(b.updatedAt) - new Date(a.updatedAt)
      )

    } catch (error) {
      logger.error('Failed to get all sessions:', error)
      return []
    }
  }

  async cleanupSessionFiles(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      if (!fs.existsSync(sessionPath)) return true

      return await this._removeDirectory(sessionPath)

    } catch (error) {
      logger.error(`Failed to cleanup session files ${sessionId}:`, error)
      return false
    }
  }

  async _removeDirectory(dirPath, maxRetries = 3) {
    let attempt = 0

    while (attempt < maxRetries) {
      try {
        if (fs.rmSync) {
          fs.rmSync(dirPath, { recursive: true, force: true })
          return true
        }

        const files = fs.readdirSync(dirPath)
        for (const file of files) {
          const filePath = path.join(dirPath, file)
          const stat = fs.statSync(filePath)

          if (stat.isDirectory()) {
            await this._removeDirectory(filePath, 1)
          } else {
            fs.unlinkSync(filePath)
          }
        }

        fs.rmdirSync(dirPath)
        return true

      } catch (error) {
        attempt++
        if (attempt >= maxRetries) {
          logger.error(`Failed to remove directory ${dirPath}:`, error)
          return false
        }
        await new Promise(resolve => setTimeout(resolve, 500 * attempt))
      }
    }

    return false
  }

  async cleanupOrphanedSessions(database) {
    try {
      if (!fs.existsSync(this.sessionsDir)) return 0

      const sessionDirs = fs.readdirSync(this.sessionsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() &&
          (dirent.name.startsWith('user_') || dirent.name.startsWith('session_')))
        .map(dirent => dirent.name)

      let cleanedCount = 0

      for (const dirName of sessionDirs) {
        try {
          let sessionId

          if (dirName.startsWith('user_')) {
            const userId = dirName.replace('user_', '')
            if (!userId) continue
            sessionId = `session_${userId}`

            const oldPath = path.join(this.sessionsDir, dirName)
            const newPath = path.join(this.sessionsDir, sessionId)

            if (!fs.existsSync(newPath)) {
              fs.renameSync(oldPath, newPath)
            } else {
              await this._removeDirectory(oldPath)
            }

          } else if (dirName.startsWith('session_')) {
            sessionId = dirName
          } else {
            continue
          }

          const hasDbSession = database && await database.getSession?.(sessionId)

          if (!hasDbSession) {
            const dirPath = path.join(this.sessionsDir, sessionId)
            if (!fs.existsSync(dirPath)) continue

            const stats = fs.statSync(dirPath)
            const dirAge = Date.now() - stats.mtime.getTime()
            const twoHours = 2 * 60 * 60 * 1000

            if (dirAge > twoHours) {
              await this._removeDirectory(dirPath)
              cleanedCount++
            }
          }
        } catch (error) {
          logger.error(`Error processing directory ${dirName}:`, error)
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned ${cleanedCount} orphaned session directories`)
      }

      return cleanedCount

    } catch (error) {
      logger.error('Failed to cleanup orphaned sessions:', error)
      return 0
    }
  }

  getSessionSize(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      if (!fs.existsSync(sessionPath)) return 0

      let totalSize = 0
      const files = fs.readdirSync(sessionPath)

      for (const file of files) {
        const filePath = path.join(sessionPath, file)
        const stats = fs.statSync(filePath)
        totalSize += stats.size
      }

      return totalSize

    } catch (error) {
      return 0
    }
  }

  listSessionFiles(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      if (!fs.existsSync(sessionPath)) return []

      return fs.readdirSync(sessionPath).map(file => ({
        name: file,
        path: path.join(sessionPath, file),
        size: fs.statSync(path.join(sessionPath, file)).size
      }))

    } catch (error) {
      return []
    }
  }

  validateSessionDirectory(sessionId) {
    try {
      const sessionPath = this.getSessionPath(sessionId)

      return {
        exists: fs.existsSync(sessionPath),
        hasCredentials: this.hasValidCredentials(sessionId),
        size: this.getSessionSize(sessionId),
        files: this.listSessionFiles(sessionId).length,
        path: sessionPath
      }

    } catch (error) {
      return {
        exists: false,
        hasCredentials: false,
        size: 0,
        files: 0,
        path: null
      }
    }
  }

  getStats() {
    try {
      if (!fs.existsSync(this.sessionsDir)) return { total: 0, size: 0 }

      const sessionDirs = fs.readdirSync(this.sessionsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())

      let totalSize = 0
      let validSessions = 0

      for (const dir of sessionDirs) {
        const sessionId = dir.name
        const size = this.getSessionSize(sessionId)
        totalSize += size

        if (this.hasValidCredentials(sessionId)) {
          validSessions++
        }
      }

      return {
        total: sessionDirs.length,
        validSessions,
        totalSize,
        directory: this.sessionsDir
      }

    } catch (error) {
      return { total: 0, validSessions: 0, totalSize: 0 }
    }
  }
}