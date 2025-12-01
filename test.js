import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

/**
 * Simple logger
 */
const logger = {
  info: (...args) => console.log('[INFO]', new Date().toISOString(), ...args),
  warn: (...args) => console.warn('[WARN]', new Date().toISOString(), ...args),
  error: (...args) => console.error('[ERROR]', new Date().toISOString(), ...args),
  debug: (...args) => console.log('[DEBUG]', new Date().toISOString(), ...args)
}

/**
 * Configuration
 */
const CONFIG = {
  // MongoDB
  MONGODB_URI: process.env.MONGODB_URI,
  
  // Cleanup settings
  MAX_AUTH_FILES_PER_SESSION: 200, // Keep 200 most recent + creds.json
  WEB_USER_ID_PREFIX: 1000000000,  // Web users: 1000000xxx
  TELEGRAM_USER_MIN_ID: 2000000000, // Real Telegram IDs: > 2 billion
  
  // Safety
  DRY_RUN: false // Set to false to actually execute changes
}

/**
 * Buffer JSON helpers for parsing WhatsApp auth data
 */
const BufferJSON = {
  reviver: (_, value) => {
    if (typeof value === 'object' && !!value && (value.buffer === true || value.type === 'Buffer')) {
      const val = value.data || value.value
      return typeof val === 'string' ? Buffer.from(val, 'base64') : Buffer.from(val || [])
    }
    return value
  }
}

/**
 * Determine if a telegram_id belongs to a web user or real Telegram user
 */
function determineUserSource(telegramId) {
  const id = parseInt(telegramId)
  
  if (isNaN(id)) {
    return 'unknown'
  }
  
  // Web users: 1000000000 - 1999999999
  if (id >= CONFIG.WEB_USER_ID_PREFIX && id < CONFIG.TELEGRAM_USER_MIN_ID) {
    return 'web'
  }
  
  // Real Telegram IDs: >= 2000000000 (adjust based on your real IDs)
  if (id >= CONFIG.TELEGRAM_USER_MIN_ID) {
    return 'telegram'
  }
  
  return 'unknown'
}

/**
 * Extract phone number from creds.json data
 */
function extractPhoneFromCreds(credsData) {
  try {
    if (credsData?.me?.id) {
      // Format: "2349113659498:40@s.whatsapp.net"
      const match = credsData.me.id.match(/^(\d+):/)
      if (match) {
        return `+${match[1]}`
      }
    }
  } catch (error) {
    logger.warn('Failed to extract phone from creds:', error.message)
  }
  return null
}

/**
 * PART 1: Clean auth_baileys - Keep only recent 200 files + creds.json
 */
async function cleanAuthFiles(authCollection) {
  logger.info('=' .repeat(60))
  logger.info('PART 1: CLEANING AUTH FILES')
  logger.info('='.repeat(60))
  
  const stats = {
    sessionsProcessed: 0,
    filesDeleted: 0,
    filesKept: 0,
    errors: 0
  }
  
  try {
    // Get all unique sessionIds
    const sessionIds = await authCollection.distinct('sessionId')
    logger.info(`Found ${sessionIds.length} unique sessions in auth_baileys`)
    
    // Process in batches for better performance
    const BATCH_SIZE = 10
    const deleteOperations = []
    
    for (let i = 0; i < sessionIds.length; i += BATCH_SIZE) {
      const batch = sessionIds.slice(i, i + BATCH_SIZE)
      
      await Promise.all(batch.map(async (sessionId) => {
        try {
          // Get all files for this session, sorted by most recent first
          const files = await authCollection.find({ sessionId })
            .sort({ updatedAt: -1 })
            .project({ _id: 1, filename: 1, updatedAt: 1 })
            .toArray()
          
          // Separate creds.json from other files
          const credsFile = files.find(f => f.filename === 'creds.json')
          const otherFiles = files.filter(f => f.filename !== 'creds.json')
          
          if (!credsFile) {
            logger.warn(`⚠️  No creds.json for ${sessionId} - session will be removed`)
            stats.sessionsProcessed++
            return
          }
          
          // Keep: creds.json + 200 most recent files
          const filesToKeep = [credsFile, ...otherFiles.slice(0, CONFIG.MAX_AUTH_FILES_PER_SESSION)]
          const filesToDelete = otherFiles.slice(CONFIG.MAX_AUTH_FILES_PER_SESSION)
          
          if (i % 50 === 0) {
            logger.info(`Progress: ${i}/${sessionIds.length} - ${sessionId}: Keep ${filesToKeep.length}, Delete ${filesToDelete.length}`)
          }
          
          // Collect delete operations
          if (filesToDelete.length > 0) {
            const fileIds = filesToDelete.map(f => f._id)
            deleteOperations.push({ sessionId, fileIds, count: filesToDelete.length })
            stats.filesDeleted += filesToDelete.length
          }
          
          stats.filesKept += filesToKeep.length
          stats.sessionsProcessed++
          
        } catch (error) {
          logger.error(`Error processing ${sessionId}:`, error.message)
          stats.errors++
        }
      }))
    }
    
    // Execute all deletes in bulk
    if (deleteOperations.length > 0 && !CONFIG.DRY_RUN) {
      logger.info(`Executing bulk delete of ${stats.filesDeleted} files...`)
      
      // Delete in chunks to avoid memory issues
      const DELETE_CHUNK_SIZE = 1000
      for (let i = 0; i < deleteOperations.length; i += DELETE_CHUNK_SIZE) {
        const chunk = deleteOperations.slice(i, i + DELETE_CHUNK_SIZE)
        const allFileIds = chunk.flatMap(op => op.fileIds)
        
        if (allFileIds.length > 0) {
          await authCollection.deleteMany({ _id: { $in: allFileIds } })
          logger.info(`Deleted chunk ${i / DELETE_CHUNK_SIZE + 1}: ${allFileIds.length} files`)
        }
      }
    }
    
    logger.info('✅ Auth files cleanup completed:', stats)
    return stats
    
  } catch (error) {
    logger.error('❌ Auth files cleanup failed:', error)
    throw error
  }
}


/**
 * PART 2: Rebuild MongoDB sessions collection (DROP & RECREATE)
 */
async function rebuildMongoSessions(authCollection, sessionsCollection) {
  logger.info('='.repeat(60))
  logger.info('PART 2: REBUILDING MONGODB SESSIONS (DROP & RECREATE)')
  logger.info('='.repeat(60))
  
  const stats = {
    oldSessionsDropped: 0,
    validSessions: 0,
    invalidSessions: 0,
    sessionsCreated: 0,
    errors: 0
  }
  
  try {
    // Drop existing sessions collection
    if (!CONFIG.DRY_RUN) {
      try {
        const existingCount = await sessionsCollection.countDocuments()
        await sessionsCollection.drop()
        stats.oldSessionsDropped = existingCount
        logger.info(`Dropped ${existingCount} old sessions from MongoDB`)
        
        // Wait a bit for MongoDB to fully process the drop
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error) {
        if (!error.message.includes('ns not found')) {
          logger.error('Error dropping collection:', error.message)
        }
        logger.info('Sessions collection did not exist or already dropped')
      }
    } else {
      stats.oldSessionsDropped = await sessionsCollection.countDocuments()
      logger.info(`DRY RUN: Would drop ${stats.oldSessionsDropped} sessions`)
    }
    
    // Get all sessions with creds.json (valid sessions only)
    const credsFiles = await authCollection.find({ 
      filename: 'creds.json' 
    }).toArray()
    
    logger.info(`Found ${credsFiles.length} sessions with creds.json`)
    
    const validSessions = []
    const seenSessionIds = new Set()
    
    for (const credsFile of credsFiles) {
      try {
        const sessionId = credsFile.sessionId
        
        // Skip duplicates
        if (seenSessionIds.has(sessionId)) {
          logger.warn(`Duplicate sessionId found: ${sessionId}, skipping...`)
          continue
        }
        seenSessionIds.add(sessionId)
        
        // Parse and validate creds
        const credsData = JSON.parse(credsFile.datajson, BufferJSON.reviver)
        
        if (!credsData?.noiseKey || !credsData?.signedIdentityKey) {
          logger.warn(`Invalid creds structure for ${sessionId}`)
          stats.invalidSessions++
          continue
        }
        
        // Extract telegram_id from sessionId (format: session_123456789)
        const telegramId = sessionId.replace('session_', '')
        
        // Determine source (web or telegram)
        const source = determineUserSource(telegramId)
        
        if (source === 'unknown') {
          logger.warn(`Unknown source for ${sessionId} (telegram_id: ${telegramId})`)
        }
        
        // Extract phone number
        const phoneNumber = extractPhoneFromCreds(credsData)
        
        // Build session document
        const sessionDoc = {
          sessionId,
          telegramId,
          phoneNumber,
          isConnected: false,
          connectionStatus: 'disconnected',
          reconnectAttempts: 0,
          source,
          detected: source === 'telegram',
          createdAt: credsFile.updatedAt || new Date(),
          updatedAt: new Date()
        }
        
        validSessions.push(sessionDoc)
        stats.validSessions++
        
        if (stats.validSessions % 100 === 0) {
          logger.info(`Progress: Processed ${stats.validSessions} valid sessions`)
        }
        
      } catch (error) {
        logger.error(`Error processing ${credsFile.sessionId}:`, error.message)
        stats.errors++
      }
    }
    
    // Create fresh sessions collection
    if (!CONFIG.DRY_RUN && validSessions.length > 0) {
      logger.info(`Creating ${validSessions.length} fresh sessions...`)
      
      // Create indexes first
      try {
        await sessionsCollection.createIndex({ sessionId: 1 }, { unique: true })
        await sessionsCollection.createIndex({ telegramId: 1 })
        await sessionsCollection.createIndex({ phoneNumber: 1 })
        await sessionsCollection.createIndex({ source: 1, detected: 1 })
        await sessionsCollection.createIndex({ isConnected: 1, connectionStatus: 1 })
        logger.info('Created indexes')
      } catch (error) {
        logger.warn('Error creating indexes (may already exist):', error.message)
      }
      
      // Insert in batches to avoid memory issues
      const BATCH_SIZE = 500
      for (let i = 0; i < validSessions.length; i += BATCH_SIZE) {
        const batch = validSessions.slice(i, i + BATCH_SIZE)
        
        try {
          await sessionsCollection.insertMany(batch, { ordered: false })
          logger.info(`Inserted batch: ${Math.min(i + BATCH_SIZE, validSessions.length)}/${validSessions.length}`)
        } catch (error) {
          // If some inserts fail, count successful ones
          if (error.code === 11000) {
            logger.warn(`Duplicate key errors in batch ${i}-${i + BATCH_SIZE}, continuing...`)
          } else {
            throw error
          }
        }
      }
      
      stats.sessionsCreated = await sessionsCollection.countDocuments()
      logger.info(`✅ Created ${stats.sessionsCreated} fresh sessions in MongoDB`)
    } else if (CONFIG.DRY_RUN) {
      stats.sessionsCreated = validSessions.length
      logger.info(`DRY RUN: Would create ${validSessions.length} sessions`)
    }
    
    logger.info('✅ MongoDB sessions rebuild completed:', stats)
    return { stats, validSessions }
    
  } catch (error) {
    logger.error('❌ MongoDB sessions rebuild failed:', error)
    throw error
  }
}

/**
 * PART 3: Rebuild PostgreSQL users table (DELETE ALL & RECREATE)
 */
async function rebuildPostgresUsers(pool, validSessions) {
  logger.info('='.repeat(60))
  logger.info('PART 3: REBUILDING POSTGRESQL USERS (DELETE ALL & RECREATE)')
  logger.info('='.repeat(60))
  
  const stats = {
    usersDeleted: 0,
    usersCreated: 0,
    errors: 0
  }
  
  try {
    // Delete all existing users
    if (!CONFIG.DRY_RUN) {
      const deleteResult = await pool.query('DELETE FROM users')
      stats.usersDeleted = deleteResult.rowCount
      logger.info(`Deleted ${stats.usersDeleted} existing users from PostgreSQL`)
      
      // Try to reset sequence (may not exist or have different name)
      try {
        await pool.query('ALTER SEQUENCE users_id_seq RESTART WITH 1')
        logger.info('Reset users_id_seq sequence')
      } catch (error) {
        logger.debug('Could not reset sequence:', error.message)
      }
    } else {
      const countResult = await pool.query('SELECT COUNT(*) as count FROM users')
      stats.usersDeleted = parseInt(countResult.rows[0].count)
      logger.info(`DRY RUN: Would delete ${stats.usersDeleted} users`)
    }
    
    // Insert fresh users from valid sessions using batch inserts
    logger.info(`Creating ${validSessions.length} fresh users...`)
    
   if (!CONFIG.DRY_RUN && validSessions.length > 0) {
      logger.info(`Inserting ${validSessions.length} users one by one...`)
      
      for (let i = 0; i < validSessions.length; i++) {
        const session = validSessions[i]
        
        try {
          const telegramId = parseInt(session.telegramId)
          
          if (isNaN(telegramId)) {
            logger.warn(`Invalid telegram_id: ${session.telegramId}`)
            stats.errors++
            continue
          }
          
          const firstName = session.source === 'web' 
            ? `WebUser_${session.telegramId}` 
            : null
          
          await pool.query(`
            INSERT INTO users (
              telegram_id, session_id, phone_number, is_connected,
              connection_status, reconnect_attempts, source, detected,
              first_name, is_active, is_admin, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, false, NOW(), NOW())
          `, [
            telegramId,
            session.sessionId,
            session.phoneNumber,
            Boolean(session.isConnected),
            session.connectionStatus,
            parseInt(session.reconnectAttempts) || 0,
            session.source,
            Boolean(session.detected),
            firstName
          ])
          
          stats.usersCreated++
          
          if ((i + 1) % 50 === 0) {
            logger.info(`Progress: ${i + 1}/${validSessions.length} users created`)
          }
        } catch (error) {
          logger.error(`Error inserting user ${session.sessionId}:`, error.message)
          stats.errors++
        }
      }
    } else if (CONFIG.DRY_RUN) {
      stats.usersCreated = validSessions.length
    }
      
    logger.info('✅ PostgreSQL users rebuild completed:', stats)
    return stats
    
  } catch (error) {
    logger.error('❌ PostgreSQL users rebuild failed:', error)
    throw error
  }
}

/**
 * PART 4: Clean up orphaned auth files (sessions without creds.json)
 */
async function cleanupOrphanedAuth(authCollection) {
  logger.info('='.repeat(60))
  logger.info('PART 4: CLEANING ORPHANED AUTH FILES')
  logger.info('='.repeat(60))
  
  const stats = {
    orphanedAuthFiles: 0
  }
  
  try {
    // Get all sessionIds with valid creds.json
    const validSessionIds = new Set(
      await authCollection.distinct('sessionId', { filename: 'creds.json' })
    )
    
    logger.info(`Valid sessions with creds.json: ${validSessionIds.size}`)
    
    // Find all sessionIds in auth_baileys
    const allAuthSessionIds = await authCollection.distinct('sessionId')
    
    // Find orphaned sessions (no creds.json)
    const orphanedSessionIds = allAuthSessionIds.filter(sid => !validSessionIds.has(sid))
    
    if (orphanedSessionIds.length > 0) {
      logger.info(`Found ${orphanedSessionIds.length} orphaned sessions without creds.json`)
      
      if (!CONFIG.DRY_RUN) {
        const result = await authCollection.deleteMany({
          sessionId: { $in: orphanedSessionIds }
        })
        stats.orphanedAuthFiles = result.deletedCount
        logger.info(`✅ Deleted ${result.deletedCount} orphaned auth files`)
      } else {
        const countResult = await authCollection.countDocuments({
          sessionId: { $in: orphanedSessionIds }
        })
        stats.orphanedAuthFiles = countResult
        logger.info(`DRY RUN: Would delete ${countResult} orphaned auth files`)
      }
    } else {
      logger.info('No orphaned auth files found')
    }
    
    logger.info('✅ Orphaned auth cleanup completed:', stats)
    return stats
    
  } catch (error) {
    logger.error('❌ Orphaned auth cleanup failed:', error)
    throw error
  }
}

/**
 * Main execution
 */
async function main() {
  let mongoClient, postgresPool
  
  try {
    logger.info('='.repeat(60))
    logger.info('SESSION CLEANUP & REBUILD SCRIPT')
    logger.info('='.repeat(60))
    logger.info(`DRY RUN MODE: ${CONFIG.DRY_RUN ? 'YES (no changes will be made)' : 'NO (will execute changes)'}`)
    logger.info(`Max auth files per session: ${CONFIG.MAX_AUTH_FILES_PER_SESSION}`)
    logger.info(`Web user ID range: ${CONFIG.WEB_USER_ID_PREFIX} - ${CONFIG.TELEGRAM_USER_MIN_ID - 1}`)
    logger.info(`Telegram user ID range: >= ${CONFIG.TELEGRAM_USER_MIN_ID}`)
    logger.info('='.repeat(60))
    
    // Validate configuration
    if (!CONFIG.MONGODB_URI) {
      throw new Error('MONGODB_URI not set in environment variables')
    }
    
    // Connect to MongoDB using same method as MongoDBStorage
    logger.info('Connecting to MongoDB...')
    
    const mongoOptions = {
      maxPoolSize: 80,
      minPoolSize: 2,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      retryWrites: true,
      retryReads: true
    }
    
    mongoClient = new MongoClient(CONFIG.MONGODB_URI, mongoOptions)
    
    await Promise.race([
      mongoClient.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('MongoDB connection timeout')), 30000)
      )
    ])
    
    // Verify connection
    await mongoClient.db('admin').command({ ping: 1 })
    
    const db = mongoClient.db()
    const authCollection = db.collection('auth_baileys')
    const sessionsCollection = db.collection('sessions')
    
    logger.info('✅ MongoDB connected')
    
    // Connect to PostgreSQL using existing pool
    logger.info('Connecting to PostgreSQL...')
    const { pool: postgresPool } = await import('./config/database.js')
    const testClient = await postgresPool.connect()
    await testClient.query('SELECT 1 as test')
    testClient.release()
    
    logger.info('✅ PostgreSQL connected')
    logger.info('')
    
    // PART 1: Clean auth files
    const authStats = await cleanAuthFiles(authCollection)
    logger.info('')
    
    // PART 2: Rebuild MongoDB sessions
    const { stats: sessionStats, validSessions } = await rebuildMongoSessions(
      authCollection, 
      sessionsCollection
    )
    logger.info('')
    
    // PART 3: Rebuild PostgreSQL users
    const pgStats = await rebuildPostgresUsers(postgresPool, validSessions)
    logger.info('')
    
    // PART 4: Cleanup orphaned auth
    const orphanStats = await cleanupOrphanedAuth(authCollection)
    logger.info('')
    
    // Final summary
    logger.info('='.repeat(60))
    logger.info('CLEANUP & REBUILD COMPLETED!')
    logger.info('='.repeat(60))
    logger.info('Summary:')
    logger.info(`- Auth files deleted: ${authStats.filesDeleted}`)
    logger.info(`- Auth files kept: ${authStats.filesKept}`)
    logger.info(`- Valid sessions found: ${sessionStats.validSessions}`)
    logger.info(`- Invalid sessions: ${sessionStats.invalidSessions}`)
    logger.info(`- MongoDB old sessions dropped: ${sessionStats.oldSessionsDropped}`)
    logger.info(`- MongoDB new sessions created: ${sessionStats.sessionsCreated}`)
    logger.info(`- PostgreSQL users deleted: ${pgStats.usersDeleted}`)
    logger.info(`- PostgreSQL users created: ${pgStats.usersCreated}`)
    logger.info(`- Orphaned auth files deleted: ${orphanStats.orphanedAuthFiles}`)
    logger.info('='.repeat(60))
    
    if (CONFIG.DRY_RUN) {
      logger.info('')
      logger.info('⚠️  THIS WAS A DRY RUN - NO CHANGES WERE MADE')
      logger.info('⚠️  Set CONFIG.DRY_RUN = false to execute for real')
      logger.info('')
    }
    
  } catch (error) {
    logger.error('❌ Fatal error:', error)
    process.exit(1)
  } finally {
    // Close connections
    if (mongoClient) {
      await mongoClient.close()
      logger.info('MongoDB connection closed')
    }
    // Don't close PostgreSQL pool - it's managed by your app
    if (postgresPool) {
      logger.info('PostgreSQL pool remains open (managed by app)')
    }
  }
}

// Run script
main().catch(console.error)