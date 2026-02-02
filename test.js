// ============================================================================
// Cleanup Invalid Sessions + Trim Files (MongoDB + Local Files)
// Requirements: creds.json + at least 4 pre-key files
// Also trims files based on configurable rules
// Save as: cleanup-and-trim-sessions.js
// Run: node cleanup-and-trim-sessions.js
// ============================================================================

import { MongoClient } from 'mongodb'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MONGODB_URI = process.env.MONGODB_URI
const MIN_PRE_KEYS = 4

// ============================================================================
// CONFIGURABLE FILE CLEANUP RULES
// ============================================================================
const FILE_CLEANUP_RULES = [
  {
    pattern: '^pre-key',        // Regex pattern for filename
    maxToKeep: 1000,             // Keep only this many (0 = delete all)
    sortBy: 'updatedAt',        // Sort by: 'updatedAt' or 'filename'
    description: 'Pre-key files'
  },
  {
    pattern: '^sender-key',
    maxToKeep: 100,
    sortBy: 'updatedAt',
    description: 'Sender keys'
  },
  {
    pattern: '^session-',
    maxToKeep: 50,
    sortBy: 'updatedAt',
    description: 'Session files'
  },
  {
    pattern: 'lid-mapping',
    maxToKeep: 20,
    sortBy: 'updatedAt',
    description: 'LID mapping files (delete all)'
  }
  // Add more rules here as needed:
  // {
  //   pattern: '^your-pattern',
  //   maxToKeep: 200,
  //   sortBy: 'updatedAt',
  //   description: 'Your custom files'
  // }
]

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env')
  process.exit(1)
}

// ============================================================================
// MAIN CLEANUP FUNCTION
// ============================================================================
async function cleanupAndTrimSessions() {
  let client
  let postgresPool

  try {
    console.log('🔍 Cleanup Invalid Sessions + Trim Files')
    console.log('=' .repeat(60))
    console.log(`Requirements: creds.json + at least ${MIN_PRE_KEYS} pre-key files`)
    console.log('\nFile cleanup rules:')
    FILE_CLEANUP_RULES.forEach(rule => {
      console.log(`  - ${rule.description}: keep ${rule.maxToKeep === 0 ? 'NONE (delete all)' : rule.maxToKeep}`)
    })
    console.log('=' .repeat(60))

    // Connect to MongoDB
    console.log('\n1️⃣ Connecting to MongoDB...')
    client = new MongoClient(MONGODB_URI)
    await client.connect()
    console.log('✅ MongoDB connected')

    const db = client.db()
    const authBaileys = db.collection('auth_baileys')
    const sessions = db.collection('sessions')

    // Connect to PostgreSQL
    console.log('\n2️⃣ Connecting to PostgreSQL...')
    const { pool } = await import('./config/database.js')
    postgresPool = pool
    const testClient = await postgresPool.connect()
    await testClient.query('SELECT 1')
    testClient.release()
    console.log('✅ PostgreSQL connected')

    // Get session IDs from BOTH MongoDB collections
    console.log('\n3️⃣ Getting session IDs from MongoDB collections...')
    const authBaileysSessionIds = await authBaileys.distinct('sessionId')
    const sessionsCollectionIds = await sessions.distinct('sessionId')
    
    // Get session IDs from local file system
    console.log('\n4️⃣ Getting session IDs from local files...')
    const localSessionIds = await getLocalSessionIds()
    
    // Combine all unique session IDs
    const allSessionIds = [...new Set([...authBaileysSessionIds, ...sessionsCollectionIds, ...localSessionIds])]
    
    console.log(`   - auth_baileys: ${authBaileysSessionIds.length} sessions`)
    console.log(`   - sessions collection: ${sessionsCollectionIds.length} sessions`)
    console.log(`   - local files: ${localSessionIds.length} sessions`)
    console.log(`   - Total unique: ${allSessionIds.length} sessions`)

    // Check each session
    console.log('\n5️⃣ Checking each session...')
    const invalidSessions = []
    const validSessionsNeedingTrim = []
    const orphanedSessions = []
    
    for (let i = 0; i < allSessionIds.length; i++) {
      const sessionId = allSessionIds[i]
      process.stdout.write(`\r   Progress: ${i + 1}/${allSessionIds.length} - Checking ${sessionId}...`)

      // Check MongoDB
      const inSessionsCollection = sessionsCollectionIds.includes(sessionId)
      const hasCredsInMongo = await authBaileys.countDocuments({
        sessionId: sessionId,
        filename: 'creds.json'
      })
      const preKeyCountMongo = await authBaileys.countDocuments({
        sessionId: sessionId,
        filename: { $regex: '^pre-key' }
      })
      const totalFilesMongo = await authBaileys.countDocuments({ sessionId })

      // Check local files
      const hasCredsLocal = await hasLocalCreds(sessionId)
      const preKeyCountLocal = await getLocalPreKeyCount(sessionId)
      const hasLocalFiles = await hasLocalSessionFiles(sessionId)

      // Determine if session is valid
      const hasValidCreds = hasCredsInMongo > 0 || hasCredsLocal
      const totalPreKeys = preKeyCountMongo + preKeyCountLocal
      const hasAnyFiles = totalFilesMongo > 0 || hasLocalFiles

      // Orphaned: exists in sessions collection but has NO files anywhere
      if (inSessionsCollection && !hasAnyFiles) {
        orphanedSessions.push({ sessionId })
      }
      // Invalid: has some files but missing creds or not enough pre-keys
      else if (hasAnyFiles && (!hasValidCreds || totalPreKeys < MIN_PRE_KEYS)) {
        invalidSessions.push({
          sessionId,
          hasCreds: hasValidCreds,
          preKeyCount: totalPreKeys,
          inSessionsCollection,
          inMongo: totalFilesMongo > 0,
          inLocal: hasLocalFiles
        })
      } 
      // Valid session - needs file trimming
      else if (hasValidCreds && totalPreKeys >= MIN_PRE_KEYS) {
        validSessionsNeedingTrim.push({
          sessionId,
          inMongo: totalFilesMongo > 0,
          inLocal: hasLocalFiles
        })
      }
    }

    console.log('\n')
    console.log(`\n   ✅ Check complete`)
    console.log(`   Orphaned sessions (in sessions collection, no files): ${orphanedSessions.length}`)
    console.log(`   Invalid sessions (has files but incomplete): ${invalidSessions.length}`)
    console.log(`   Valid sessions needing file trim: ${validSessionsNeedingTrim.length}`)

    // ========== PART 1: Cleanup Orphaned Sessions ==========
    if (orphanedSessions.length > 0) {
      console.log('\n6️⃣ Orphaned sessions (no auth files):')
      orphanedSessions.forEach(({ sessionId }) => {
        console.log(`   🗑️  ${sessionId}`)
      })

      console.log(`\n7️⃣ Cleaning up ${orphanedSessions.length} orphaned sessions...`)
      let mongoSessionsDeleted = 0
      let postgresUpdated = 0

      for (const { sessionId } of orphanedSessions) {
        try {
          // Delete from sessions collection
          const sessionsResult = await sessions.deleteMany({ sessionId })
          mongoSessionsDeleted += sessionsResult.deletedCount

          // Soft delete from PostgreSQL
          const telegramId = parseInt(sessionId.replace('session_', ''))
          const pgResult = await postgresPool.query(`
            UPDATE users
            SET session_id = NULL,
                is_connected = false,
                connection_status = 'disconnected',
                updated_at = NOW()
            WHERE telegram_id = $1
          `, [telegramId])

          if (pgResult.rowCount > 0) {
            postgresUpdated++
          }

          console.log(`   ✅ Cleaned: ${sessionId}`)
        } catch (error) {
          console.log(`   ❌ Error cleaning ${sessionId}: ${error.message}`)
        }
      }

      console.log(`\n   📊 Orphaned cleanup: ${mongoSessionsDeleted} session docs, ${postgresUpdated} postgres records`)
    } else {
      console.log('\n🎉 No orphaned sessions found!')
    }

    // ========== PART 2: Cleanup Invalid Sessions ==========
    if (invalidSessions.length > 0) {
      console.log('\n8️⃣ Invalid sessions to delete:')
      invalidSessions.forEach(({ sessionId, hasCreds, preKeyCount, inSessionsCollection, inMongo, inLocal }) => {
        console.log(`   ❌ ${sessionId}`)
        console.log(`      - creds.json: ${hasCreds ? '✓' : '✗'}`)
        console.log(`      - pre-keys: ${preKeyCount}/${MIN_PRE_KEYS}`)
        console.log(`      - in sessions collection: ${inSessionsCollection ? '✓' : '✗'}`)
        console.log(`      - in MongoDB: ${inMongo ? '✓' : '✗'}`)
        console.log(`      - in local files: ${inLocal ? '✓' : '✗'}`)
      })

      console.log(`\n9️⃣ Cleaning up ${invalidSessions.length} invalid sessions...`)
      let mongoAuthDeleted = 0
      let mongoSessionsDeleted = 0
      let localDeleted = 0
      let postgresUpdated = 0

      for (const { sessionId, inSessionsCollection, inMongo, inLocal } of invalidSessions) {
        try {
          // Delete from MongoDB auth_baileys
          if (inMongo) {
            const authResult = await authBaileys.deleteMany({ sessionId })
            mongoAuthDeleted += authResult.deletedCount
          }

          // Delete from sessions collection
          if (inSessionsCollection) {
            const sessionsResult = await sessions.deleteMany({ sessionId })
            mongoSessionsDeleted += sessionsResult.deletedCount
          }

          // Delete local session folder
          if (inLocal) {
            const deleted = await deleteLocalSessionFolder(sessionId)
            if (deleted) localDeleted++
          }

          // Soft delete from PostgreSQL
          const telegramId = parseInt(sessionId.replace('session_', ''))
          const pgResult = await postgresPool.query(`
            UPDATE users
            SET session_id = NULL,
                is_connected = false,
                connection_status = 'disconnected',
                updated_at = NOW()
            WHERE telegram_id = $1
          `, [telegramId])

          if (pgResult.rowCount > 0) {
            postgresUpdated++
          }

          console.log(`   ✅ Cleaned: ${sessionId}`)
        } catch (error) {
          console.log(`   ❌ Error cleaning ${sessionId}: ${error.message}`)
        }
      }

      console.log(`\n   📊 Invalid cleanup summary:`)
      console.log(`      - auth_baileys deleted: ${mongoAuthDeleted} docs`)
      console.log(`      - sessions deleted: ${mongoSessionsDeleted} docs`)
      console.log(`      - local folders deleted: ${localDeleted}`)
      console.log(`      - postgres updated: ${postgresUpdated} records`)
    } else {
      console.log('\n🎉 All sessions with files are valid!')
    }

    // ========== PART 2.5: Cleanup Empty Local Folders ==========
    console.log('\n🗂️  Checking for empty local session folders...')
    const emptyFolders = []
    
    for (const sessionId of localSessionIds) {
      try {
        const sessionPath = path.join(process.cwd(), 'sessions', sessionId)
        const files = await fs.readdir(sessionPath)
        
        // If folder is empty or only has metadata.json with no auth files
        if (files.length === 0) {
          emptyFolders.push(sessionId)
        } else if (files.length === 1 && files[0] === 'metadata.json') {
          // Check if has auth files
          const hasCreds = files.includes('creds.json')
          if (!hasCreds) {
            emptyFolders.push(sessionId)
          }
        } else {
          // Check if folder has any substantial files (not just metadata)
          const hasCredsLocal = await hasLocalCreds(sessionId)
          const preKeyCount = await getLocalPreKeyCount(sessionId)
          
          if (!hasCredsLocal && preKeyCount === 0) {
            emptyFolders.push(sessionId)
          }
        }
      } catch (error) {
        // Folder might have been deleted already
      }
    }
    
    if (emptyFolders.length > 0) {
      console.log(`   Found ${emptyFolders.length} empty/incomplete local folders`)
      
      let deletedEmpty = 0
      for (const sessionId of emptyFolders) {
        const deleted = await deleteLocalSessionFolder(sessionId)
        if (deleted) deletedEmpty++
      }
      
      console.log(`   ✅ Deleted ${deletedEmpty} empty local folders`)
    } else {
      console.log('   🎉 No empty local folders found!')
    }

    // ========== PART 3: Trim Files for Valid Sessions ==========
    if (validSessionsNeedingTrim.length > 0) {
      console.log(`\n🔟 Trimming files for ${validSessionsNeedingTrim.length} valid sessions...`)
      
      let totalMongoTrimmed = 0
      let totalLocalTrimmed = 0

      for (const { sessionId, inMongo, inLocal } of validSessionsNeedingTrim) {
        console.log(`\n   📦 Processing ${sessionId}...`)
        
        // Trim MongoDB files
        if (inMongo) {
          for (const rule of FILE_CLEANUP_RULES) {
            const trimmed = await trimMongoFiles(authBaileys, sessionId, rule)
            if (trimmed > 0) {
              totalMongoTrimmed += trimmed
              console.log(`      - ${rule.description}: trimmed ${trimmed} files (kept ${rule.maxToKeep})`)
            }
          }
        }

        // Trim local files
        if (inLocal) {
          for (const rule of FILE_CLEANUP_RULES) {
            const trimmed = await trimLocalFiles(sessionId, rule)
            if (trimmed > 0) {
              totalLocalTrimmed += trimmed
              console.log(`      - ${rule.description} (local): trimmed ${trimmed} files (kept ${rule.maxToKeep})`)
            }
          }
        }
      }

      console.log(`\n   📊 Trim summary:`)
      console.log(`      - MongoDB files trimmed: ${totalMongoTrimmed}`)
      console.log(`      - Local files trimmed: ${totalLocalTrimmed}`)
    } else {
      console.log('\n🎉 No valid sessions need file trimming!')
    }

    // ========== Final Summary ==========
    console.log('\n' + '='.repeat(60))
    console.log('📊 FINAL SUMMARY')
    console.log('='.repeat(60))
    console.log(`Orphaned sessions cleaned: ${orphanedSessions.length}`)
    console.log(`Invalid sessions cleaned: ${invalidSessions.length}`)
    console.log(`Valid sessions trimmed: ${validSessionsNeedingTrim.length}`)
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ ERROR:', error.message)
    console.error('Full error:', error.stack)
  } finally {
    if (client) {
      await client.close()
      console.log('\n🔌 MongoDB disconnected')
    }
    if (postgresPool) {
      await postgresPool.end()
      console.log('🔌 PostgreSQL disconnected')
    }
  }
}

// ============================================================================
// LOCAL FILE SYSTEM HELPERS
// ============================================================================

async function getLocalSessionIds() {
  try {
    const sessionsDir = './sessions'
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch (error) {
    return []
  }
}

async function hasLocalCreds(sessionId) {
  try {
    const credsPath = path.join('./sessions', sessionId, 'creds.json')
    const data = await fs.readFile(credsPath, 'utf8')
    const creds = JSON.parse(data)
    return !!(creds?.noiseKey && creds?.signedIdentityKey)
  } catch {
    return false
  }
}

async function getLocalPreKeyCount(sessionId) {
  try {
    const sessionPath = path.join('./sessions', sessionId)
    const files = await fs.readdir(sessionPath)
    return files.filter(f => f.match(/^pre-key/i)).length
  } catch {
    return 0
  }
}

async function hasLocalSessionFiles(sessionId) {
  try {
    const sessionPath = path.join('./sessions', sessionId)
    const files = await fs.readdir(sessionPath)
    return files.length > 0
  } catch {
    return false
  }
}

async function deleteLocalSessionFolder(sessionId) {
  try {
    const sessionPath = path.join(process.cwd(), 'sessions', sessionId)
    
    // Check if folder exists first
    try {
      await fs.access(sessionPath)
    } catch {
      console.log(`      ℹ️  Local folder doesn't exist: ${sessionId}`)
      return true // Already deleted or doesn't exist
    }
    
    // Delete the folder
    await fs.rm(sessionPath, { recursive: true, force: true })
    console.log(`      ✅ Deleted local folder: ${sessionId}`)
    return true
  } catch (error) {
    console.log(`      ❌ Failed to delete local folder ${sessionId}: ${error.message}`)
    return false
  }
}

async function trimLocalFiles(sessionId, rule) {
  try {
    const sessionPath = path.join('./sessions', sessionId)
    const files = await fs.readdir(sessionPath)
    
    // Filter files matching pattern
    const regex = new RegExp(rule.pattern, 'i')
    const matchingFiles = []
    
    for (const filename of files) {
      if (regex.test(filename)) {
        const filePath = path.join(sessionPath, filename)
        const stats = await fs.stat(filePath)
        matchingFiles.push({
          filename,
          filePath,
          updatedAt: stats.mtime
        })
      }
    }

    if (matchingFiles.length === 0) {
      return 0
    }

    // If maxToKeep is 0, delete all
    if (rule.maxToKeep === 0) {
      let deleted = 0
      for (const file of matchingFiles) {
        try {
          await fs.unlink(file.filePath)
          deleted++
        } catch (error) {
          console.log(`      ⚠️  Failed to delete ${file.filename}: ${error.message}`)
        }
      }
      return deleted
    }

    // If we have fewer files than maxToKeep, don't delete any
    if (matchingFiles.length <= rule.maxToKeep) {
      return 0
    }

    // Sort files
    if (rule.sortBy === 'updatedAt') {
      matchingFiles.sort((a, b) => b.updatedAt - a.updatedAt) // Newest first
    } else {
      matchingFiles.sort((a, b) => a.filename.localeCompare(b.filename))
    }

    // Delete oldest files (keep only maxToKeep)
    const toDelete = matchingFiles.slice(rule.maxToKeep)
    let deleted = 0

    for (const file of toDelete) {
      try {
        await fs.unlink(file.filePath)
        deleted++
      } catch (error) {
        console.log(`      ⚠️  Failed to delete ${file.filename}: ${error.message}`)
      }
    }

    return deleted
  } catch (error) {
    return 0
  }
}

// ============================================================================
// MONGODB HELPERS
// ============================================================================

async function trimMongoFiles(authBaileys, sessionId, rule) {
  try {
    // Get all files matching pattern
    const regex = new RegExp(rule.pattern)
    const matchingFiles = await authBaileys.find({
      sessionId: sessionId,
      filename: { $regex: regex }
    }).toArray()

    if (matchingFiles.length === 0) {
      return 0
    }

    // If maxToKeep is 0, delete all
    if (rule.maxToKeep === 0) {
      const idsToDelete = matchingFiles.map(doc => doc._id)
      const deleteResult = await authBaileys.deleteMany({
        _id: { $in: idsToDelete }
      })
      return deleteResult.deletedCount
    }

    // If we have fewer files than maxToKeep, don't delete any
    if (matchingFiles.length <= rule.maxToKeep) {
      return 0
    }

    // Sort files
    if (rule.sortBy === 'updatedAt') {
      matchingFiles.sort((a, b) => {
        const dateA = a.updatedAt || new Date(0)
        const dateB = b.updatedAt || new Date(0)
        return dateB - dateA // Newest first
      })
    } else {
      matchingFiles.sort((a, b) => a.filename.localeCompare(b.filename))
    }

    // Delete oldest files (keep only maxToKeep)
    const toDelete = matchingFiles.slice(rule.maxToKeep)
    const idsToDelete = toDelete.map(doc => doc._id)

    if (idsToDelete.length > 0) {
      const deleteResult = await authBaileys.deleteMany({
        _id: { $in: idsToDelete }
      })
      return deleteResult.deletedCount
    }

    return 0
  } catch (error) {
    return 0
  }
}

// ============================================================================
// RUN THE SCRIPT
// ============================================================================
cleanupAndTrimSessions().catch(console.error)