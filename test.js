import { MongoClient } from 'mongodb'
import bcryptjs from 'bcryptjs'
import dotenv from 'dotenv'

dotenv.config()

const logger = {
  info: (...args) => console.log('[INFO]', new Date().toISOString(), ...args),
  warn: (...args) => console.warn('[WARN]', new Date().toISOString(), ...args),
  error: (...args) => console.error('[ERROR]', new Date().toISOString(), ...args),
  success: (...args) => console.log('[SUCCESS]', new Date().toISOString(), ...args)
}

/**
 * COMPREHENSIVE CONFIGURATION
 */
const CONFIG = {
  // Global settings
  DRY_RUN: false, // Master switch - set false to execute
  BATCH_SIZE: 50,
  MONGODB_URI: process.env.MONGODB_URI,
  
  // Operation flags - Enable/disable each operation independently
  operations: {
    // OPERATION 1: Clean orphaned PostgreSQL users (not in MongoDB sessions)
    cleanOrphanedUsers: {
      enabled: true, // Set true to run this operation
      skipWebUsers: true, // Always keep web users safe
      onlyCleanTelegram: true // Only remove telegram users without sessions
    },
    
    // OPERATION 2: Sync from auth_baileys → sessions → PostgreSQL
    syncFromAuthBaileys: {
      enabled: true, // Set true to run this operation
      writeToSessions: true, // Update MongoDB sessions collection
      writeToPostgres: true, // Update PostgreSQL users table
      skipWebUsers: false, // Don't modify existing web users
      updateExisting: true // If false, only create new records
    },
    
    // OPERATION 3: Create default passwords for web users without auth
    createDefaultWebPasswords: {
      enabled: true, // Set true to run this operation
      defaultPassword: 'NexusBot', // Default password (will be hashed)
      forceReset: true, // Mark for password reset on next login
      saltRounds: 10 // bcrypt salt rounds
    },
    
    // OPERATION 4: Clean old auth_baileys files
    cleanOldAuthFiles: {
      enabled: false, // Set true to run this operation
      keepCredsJson: true, // Always keep creds.json
      maxFilesPerSession: 1000, // Keep this many most recent files + creds.json
      skipWebUsers: false // Set true to skip web users
    }
  }
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
 * Extract phone number from creds.json
 */
function extractPhoneFromCreds(credsData) {
  try {
    if (credsData?.me?.id) {
      const match = credsData.me.id.match(/^(\d+):/)
      if (match) return `+${match[1]}`
    }
  } catch (error) {
    logger.warn('Failed to extract phone from creds:', error.message)
  }
  return null
}

/**
 * Determine if telegram_id is web or telegram user
 */
function determineUserSource(telegramId) {
  const id = parseInt(telegramId)
  if (isNaN(id)) return 'unknown'
  
  // Web users: 1000000000 - 1999999999
  if (id >= 1000000000 && id < 2000000000) return 'web'
  
  // Telegram users: >= 2000000000
  if (id >= 2000000000) return 'telegram'
  
  return 'unknown'
}

// ============================================================
// OPERATION 1: CLEAN ORPHANED POSTGRESQL USERS
// ============================================================

async function cleanOrphanedUsers(sessionsCollection, postgresPool) {
  const opConfig = CONFIG.operations.cleanOrphanedUsers
  
  if (!opConfig.enabled) {
    logger.info('⏭️  Operation 1 (Clean Orphaned Users) - SKIPPED (disabled)')
    return { skipped: true }
  }
  
  logger.info('='.repeat(60))
  logger.info('OPERATION 1: CLEAN ORPHANED POSTGRESQL USERS')
  logger.info('='.repeat(60))
  logger.info(`Skip web users: ${opConfig.skipWebUsers}`)
  logger.info(`Only clean telegram: ${opConfig.onlyCleanTelegram}`)
  logger.info('')
  
  const stats = { deleted: 0, kept: 0, skipped: 0 }
  
  try {
    // Get all session IDs from MongoDB
    const mongoSessions = await sessionsCollection.find({}).toArray()
    const validTelegramIds = new Set(mongoSessions.map(s => s.telegramId))
    
    logger.info(`Valid sessions in MongoDB: ${validTelegramIds.size}`)
    
    // Get all users from PostgreSQL
    const pgResult = await postgresPool.query('SELECT id, telegram_id, source FROM users')
    const pgUsers = pgResult.rows
    
    logger.info(`Users in PostgreSQL: ${pgUsers.length}`)
    logger.info('')
    
    // Find orphaned users
    const orphanedUsers = []
    
    for (const user of pgUsers) {
      const telegramId = user.telegram_id.toString()
      
      // Skip web users if configured
      if (opConfig.skipWebUsers && user.source === 'web') {
        stats.kept++
        continue
      }
      
      // Skip if only cleaning telegram users
      if (opConfig.onlyCleanTelegram && user.source !== 'telegram') {
        stats.kept++
        continue
      }
      
      // Check if user has valid session
      if (!validTelegramIds.has(telegramId)) {
        orphanedUsers.push(user)
      } else {
        stats.kept++
      }
    }
    
    logger.info(`Orphaned users found: ${orphanedUsers.length}`)
    
    if (orphanedUsers.length > 0) {
      logger.info('Sample orphaned users:')
      for (let i = 0; i < Math.min(5, orphanedUsers.length); i++) {
        logger.info(`  - ID ${orphanedUsers[i].id}: telegram_id ${orphanedUsers[i].telegram_id} (${orphanedUsers[i].source})`)
      }
      logger.info('')
      
      if (!CONFIG.DRY_RUN) {
        const userIds = orphanedUsers.map(u => u.id)
        const deleteResult = await postgresPool.query(
          'DELETE FROM users WHERE id = ANY($1)',
          [userIds]
        )
        stats.deleted = deleteResult.rowCount
        logger.success(`✅ Deleted ${stats.deleted} orphaned users`)
      } else {
        stats.deleted = orphanedUsers.length
        logger.warn(`DRY RUN: Would delete ${orphanedUsers.length} orphaned users`)
      }
    } else {
      logger.info('No orphaned users found')
    }
    
    logger.info('')
    logger.info('Operation 1 Stats:', stats)
    return stats
    
  } catch (error) {
    logger.error('Operation 1 failed:', error)
    throw error
  }
}

// ============================================================
// OPERATION 2: SYNC FROM AUTH_BAILEYS
// ============================================================

async function syncFromAuthBaileys(authCollection, sessionsCollection, postgresPool) {
  const opConfig = CONFIG.operations.syncFromAuthBaileys
  
  if (!opConfig.enabled) {
    logger.info('⏭️  Operation 2 (Sync from auth_baileys) - SKIPPED (disabled)')
    return { skipped: true }
  }
  
  logger.info('')
  logger.info('='.repeat(60))
  logger.info('OPERATION 2: SYNC FROM AUTH_BAILEYS')
  logger.info('='.repeat(60))
  logger.info(`Write to sessions: ${opConfig.writeToSessions}`)
  logger.info(`Write to PostgreSQL: ${opConfig.writeToPostgres}`)
  logger.info(`Skip web users: ${opConfig.skipWebUsers}`)
  logger.info(`Update existing: ${opConfig.updateExisting}`)
  logger.info('')
  
  const stats = {
    sessionsCreated: 0,
    sessionsUpdated: 0,
    sessionsSkipped: 0,
    usersCreated: 0,
    usersUpdated: 0,
    usersSkipped: 0
  }
  
  try {
    // Get all creds.json files from auth_baileys
    const credsFiles = await authCollection.find({ filename: 'creds.json' }).toArray()
    logger.info(`Found ${credsFiles.length} sessions with creds.json`)
    
    // Get existing sessions and users
    const existingSessions = await sessionsCollection.find({}).toArray()
    const existingSessionIds = new Set(existingSessions.map(s => s.sessionId))
    
    const pgResult = await postgresPool.query('SELECT telegram_id, source FROM users')
    const existingPgUsers = new Map(pgResult.rows.map(u => [u.telegram_id.toString(), u.source]))
    
    // Process each session
    for (const credsFile of credsFiles) {
      try {
        const sessionId = credsFile.sessionId
        const telegramId = sessionId.replace('session_', '')
        const source = determineUserSource(telegramId)
        
        // Skip web users if configured
        if (opConfig.skipWebUsers && source === 'web') {
          stats.sessionsSkipped++
          stats.usersSkipped++
          continue
        }
        
        // Skip if already exists and not updating
        if (!opConfig.updateExisting && existingSessionIds.has(sessionId)) {
          stats.sessionsSkipped++
          stats.usersSkipped++
          continue
        }
        
        // Parse creds
        const credsData = JSON.parse(credsFile.datajson, BufferJSON.reviver)
        const phoneNumber = extractPhoneFromCreds(credsData)
        
        // Prepare session document
        const sessionDoc = {
          sessionId,
          telegramId,
          phoneNumber,
          isConnected: true,
          connectionStatus: 'connected',
          reconnectAttempts: 0,
          source,
          detected: source === 'telegram',
          updatedAt: new Date()
        }
        
        // Write to sessions
        if (opConfig.writeToSessions && !CONFIG.DRY_RUN) {
          const result = await sessionsCollection.updateOne(
            { sessionId },
            { 
              $set: sessionDoc,
              $setOnInsert: { createdAt: new Date() }
            },
            { upsert: true }
          )
          
          if (result.upsertedCount > 0) {
            stats.sessionsCreated++
          } else if (result.modifiedCount > 0) {
            stats.sessionsUpdated++
          }
        } else if (opConfig.writeToSessions) {
          if (existingSessionIds.has(sessionId)) {
            stats.sessionsUpdated++
          } else {
            stats.sessionsCreated++
          }
        }
        
        // Write to PostgreSQL
        if (opConfig.writeToPostgres) {
          const existingUser = existingPgUsers.get(telegramId)
          
          // Skip web users in PostgreSQL
          if (existingUser === 'web' && opConfig.skipWebUsers) {
            stats.usersSkipped++
            continue
          }
          
          if (!CONFIG.DRY_RUN) {
            const result = await postgresPool.query(`
              INSERT INTO users (
                telegram_id, session_id, phone_number, is_connected,
                connection_status, reconnect_attempts, source, detected,
                first_name, is_active, is_admin, created_at, updated_at
              ) VALUES ($1, $2, $3, true, 'connected', 0, $4, $5, $6, true, false, NOW(), NOW())
              ON CONFLICT (telegram_id) DO UPDATE SET
                session_id = EXCLUDED.session_id,
                phone_number = EXCLUDED.phone_number,
                source = EXCLUDED.source,
                detected = EXCLUDED.detected,
                updated_at = NOW()
              RETURNING (xmax = 0) AS inserted
            `, [
              parseInt(telegramId),
              sessionId,
              phoneNumber,
              source,
              source === 'telegram',
              source === 'web' ? `WebUser_${telegramId}` : null
            ])
            
            if (result.rows[0].inserted) {
              stats.usersCreated++
            } else {
              stats.usersUpdated++
            }
          } else {
            if (existingUser) {
              stats.usersUpdated++
            } else {
              stats.usersCreated++
            }
          }
        }
        
      } catch (error) {
        logger.error(`Error processing ${credsFile.sessionId}:`, error.message)
      }
    }
    
    logger.info('')
    logger.info('Operation 2 Stats:', stats)
    return stats
    
  } catch (error) {
    logger.error('Operation 2 failed:', error)
    throw error
  }
}

// ============================================================
// OPERATION 3: CREATE DEFAULT WEB PASSWORDS
// ============================================================

async function createDefaultWebPasswords(postgresPool) {
  const opConfig = CONFIG.operations.createDefaultWebPasswords
  
  if (!opConfig.enabled) {
    logger.info('⏭️  Operation 3 (Create Default Web Passwords) - SKIPPED (disabled)')
    return { skipped: true }
  }
  
  logger.info('')
  logger.info('='.repeat(60))
  logger.info('OPERATION 3: CREATE DEFAULT WEB PASSWORDS')
  logger.info('='.repeat(60))
  logger.info(`Default password: ${opConfig.defaultPassword}`)
  logger.info(`Force reset: ${opConfig.forceReset}`)
  logger.info('')
  
  const stats = { created: 0, skipped: 0, failed: 0 }
  
  try {
    // Find web users without auth entries
    const result = await postgresPool.query(`
      SELECT u.id, u.telegram_id, u.session_id
      FROM users u
      LEFT JOIN web_users_auth wa ON u.id = wa.user_id
      WHERE u.source = 'web' AND wa.user_id IS NULL
    `)
    
    const usersWithoutAuth = result.rows
    logger.info(`Found ${usersWithoutAuth.length} web users without passwords`)
    
    if (usersWithoutAuth.length === 0) {
      logger.info('All web users already have passwords')
      return stats
    }
    
    // Generate password hash
    let passwordHash
    if (!CONFIG.DRY_RUN) {
      passwordHash = await bcryptjs.hash(opConfig.defaultPassword, opConfig.saltRounds)
    }
    
    // Create auth entries
    for (const user of usersWithoutAuth) {
      try {
        if (!CONFIG.DRY_RUN) {
          await postgresPool.query(`
            INSERT INTO web_users_auth (user_id, password_hash, created_at, updated_at)
            VALUES ($1, $2, NOW(), NOW())
          `, [user.id, passwordHash])
          
          stats.created++
          logger.info(`✅ Created default password for user ${user.telegram_id}`)
        } else {
          stats.created++
        }
      } catch (error) {
        logger.error(`Failed to create auth for user ${user.telegram_id}:`, error.message)
        stats.failed++
      }
    }
    
    if (CONFIG.DRY_RUN) {
      logger.warn(`DRY RUN: Would create ${stats.created} default passwords`)
    } else {
      logger.success(`✅ Created ${stats.created} default passwords`)
    }
    
    logger.info('')
    logger.info('Operation 3 Stats:', stats)
    return stats
    
  } catch (error) {
    logger.error('Operation 3 failed:', error)
    throw error
  }
}

// ============================================================
// OPERATION 4: CLEAN OLD AUTH FILES
// ============================================================

async function cleanOldAuthFiles(authCollection, sessionsCollection) {
  const opConfig = CONFIG.operations.cleanOldAuthFiles
  
  if (!opConfig.enabled) {
    logger.info('⏭️  Operation 4 (Clean Old Auth Files) - SKIPPED (disabled)')
    return { skipped: true }
  }
  
  logger.info('')
  logger.info('='.repeat(60))
  logger.info('OPERATION 4: CLEAN OLD AUTH FILES')
  logger.info('='.repeat(60))
  logger.info(`Keep creds.json: ${opConfig.keepCredsJson}`)
  logger.info(`Max files per session: ${opConfig.maxFilesPerSession}`)
  logger.info(`Skip web users: ${opConfig.skipWebUsers}`)
  logger.info('')
  
  const stats = { filesDeleted: 0, filesKept: 0, sessionsProcessed: 0 }
  
  try {
    // Get all unique session IDs
    const sessionIds = await authCollection.distinct('sessionId')
    logger.info(`Found ${sessionIds.length} sessions in auth_baileys`)
    
    // Get web session IDs if skipping
    let webSessionIds = new Set()
    if (opConfig.skipWebUsers) {
      const webSessions = await sessionsCollection.find({ source: 'web' }).toArray()
      webSessionIds = new Set(webSessions.map(s => s.sessionId))
      logger.info(`Skipping ${webSessionIds.size} web user sessions`)
    }
    
    const deleteOperations = []
    
    for (const sessionId of sessionIds) {
      try {
        // Skip web users if configured
        if (opConfig.skipWebUsers && webSessionIds.has(sessionId)) {
          continue
        }
        
        // Get all files for this session, sorted by most recent
        const files = await authCollection.find({ sessionId })
          .sort({ updatedAt: -1 })
          .project({ _id: 1, filename: 1 })
          .toArray()
        
        // Separate creds.json from other files
        const credsFile = files.find(f => f.filename === 'creds.json')
        const otherFiles = files.filter(f => f.filename !== 'creds.json')
        
        if (!credsFile) {
          // No creds.json - delete all files for this session
          const fileIds = files.map(f => f._id)
          if (fileIds.length > 0) {
            deleteOperations.push({ sessionId, fileIds })
            stats.filesDeleted += fileIds.length
          }
          continue
        }
        
        // Keep: creds.json + X most recent files
        const filesToKeep = opConfig.keepCredsJson 
          ? [credsFile, ...otherFiles.slice(0, opConfig.maxFilesPerSession)]
          : otherFiles.slice(0, opConfig.maxFilesPerSession)
        
        const filesToDelete = otherFiles.slice(opConfig.maxFilesPerSession)
        
        if (filesToDelete.length > 0) {
          const fileIds = filesToDelete.map(f => f._id)
          deleteOperations.push({ sessionId, fileIds })
          stats.filesDeleted += filesToDelete.length
        }
        
        stats.filesKept += filesToKeep.length
        stats.sessionsProcessed++
        
      } catch (error) {
        logger.error(`Error processing ${sessionId}:`, error.message)
      }
    }
    
    // Execute deletes
    if (deleteOperations.length > 0) {
      if (!CONFIG.DRY_RUN) {
        const CHUNK_SIZE = 1000
        let deletedCount = 0
        
        for (let i = 0; i < deleteOperations.length; i += CHUNK_SIZE) {
          const chunk = deleteOperations.slice(i, i + CHUNK_SIZE)
          const allFileIds = chunk.flatMap(op => op.fileIds)
          
          if (allFileIds.length > 0) {
            await authCollection.deleteMany({ _id: { $in: allFileIds } })
            deletedCount += allFileIds.length
          }
        }
        
        logger.success(`✅ Deleted ${deletedCount} old auth files`)
      } else {
        logger.warn(`DRY RUN: Would delete ${stats.filesDeleted} old auth files`)
      }
    } else {
      logger.info('No old auth files to delete')
    }
    
    logger.info('')
    logger.info('Operation 4 Stats:', stats)
    return stats
    
  } catch (error) {
    logger.error('Operation 4 failed:', error)
    throw error
  }
}

// ============================================================
// MAIN EXECUTION
// ============================================================

async function main() {
  let mongoClient, postgresPool
  
  try {
    logger.info('='.repeat(60))
    logger.info('COMPREHENSIVE DATABASE CLEANUP & SYNC')
    logger.info('='.repeat(60))
    logger.info(`DRY RUN MODE: ${CONFIG.DRY_RUN ? 'YES (no changes)' : 'NO (will execute)'}`)
    logger.info('')
    
    logger.info('Enabled Operations:')
    const enabledOps = Object.entries(CONFIG.operations).filter(([_, config]) => config.enabled)
    if (enabledOps.length === 0) {
      logger.warn('⚠️  NO OPERATIONS ENABLED - Nothing to do!')
      logger.info('Enable operations by setting enabled: true in CONFIG.operations')
      return
    }
    
    enabledOps.forEach(([name, _]) => {
      logger.info(`  ✓ ${name}`)
    })
    logger.info('='.repeat(60))
    
    // Connect to MongoDB
    logger.info('Connecting to MongoDB...')
    mongoClient = new MongoClient(CONFIG.MONGODB_URI, {
      maxPoolSize: 80,
      minPoolSize: 2
    })
    await mongoClient.connect()
    
    const db = mongoClient.db()
    const authCollection = db.collection('auth_baileys')
    const sessionsCollection = db.collection('sessions')
    logger.success('✅ MongoDB connected')
    
    // Connect to PostgreSQL
    logger.info('Connecting to PostgreSQL...')
    const { pool } = await import('./config/database.js')
    postgresPool = pool
    await postgresPool.query('SELECT 1')
    logger.success('✅ PostgreSQL connected')
    logger.info('')
    
    // Execute enabled operations
    const results = {}
    
    if (CONFIG.operations.cleanOrphanedUsers.enabled) {
      results.cleanOrphanedUsers = await cleanOrphanedUsers(sessionsCollection, postgresPool)
    }
    
    if (CONFIG.operations.syncFromAuthBaileys.enabled) {
      results.syncFromAuthBaileys = await syncFromAuthBaileys(authCollection, sessionsCollection, postgresPool)
    }
    
    if (CONFIG.operations.createDefaultWebPasswords.enabled) {
      results.createDefaultWebPasswords = await createDefaultWebPasswords(postgresPool)
    }
    
    if (CONFIG.operations.cleanOldAuthFiles.enabled) {
      results.cleanOldAuthFiles = await cleanOldAuthFiles(authCollection, sessionsCollection)
    }
    
    // Final summary
    logger.info('')
    logger.info('='.repeat(60))
    logger.info('ALL OPERATIONS COMPLETED!')
    logger.info('='.repeat(60))
    logger.info('Results Summary:')
    Object.entries(results).forEach(([op, stats]) => {
      logger.info(`\n${op}:`, stats)
    })
    logger.info('='.repeat(60))
    
    if (CONFIG.DRY_RUN) {
      logger.warn('')
      logger.warn('⚠️  THIS WAS A DRY RUN - NO CHANGES WERE MADE')
      logger.warn('⚠️  Set CONFIG.DRY_RUN = false to execute for real')
      logger.warn('')
    }
    
  } catch (error) {
    logger.error('Fatal error:', error)
    process.exit(1)
  } finally {
    if (mongoClient) {
      await mongoClient.close()
      logger.info('MongoDB connection closed')
    }
  }
}

main().catch(console.error)