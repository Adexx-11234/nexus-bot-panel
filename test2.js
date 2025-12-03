import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'

dotenv.config()

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  success: (...args) => console.log('[SUCCESS]', ...args)
}

async function diagnose() {
  let mongoClient, postgresPool
  
  try {
    logger.info('='.repeat(70))
    logger.info('DIAGNOSING USER/SESSION MISMATCH')
    logger.info('='.repeat(70))
    logger.info('')
    
    // Connect to MongoDB
    logger.info('Connecting to MongoDB...')
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 80,
      minPoolSize: 2
    })
    await mongoClient.connect()
    
    const db = mongoClient.db()
    const sessionsCollection = db.collection('sessions')
    logger.success('✅ MongoDB connected')
    
    // Connect to PostgreSQL
    logger.info('Connecting to PostgreSQL...')
    const { pool } = await import('./config/database.js')
    postgresPool = pool
    await postgresPool.query('SELECT 1')
    logger.success('✅ PostgreSQL connected')
    logger.info('')
    
    // Get MongoDB sessions
    const mongoSessions = await sessionsCollection.find({}).toArray()
    const mongoTelegramIds = new Set(mongoSessions.map(s => s.telegramId))
    
    logger.info(`MongoDB Sessions: ${mongoSessions.length}`)
    logger.info('')
    
    // Breakdown by source
    const mongoBySource = {}
    mongoSessions.forEach(s => {
      const source = s.source || 'unknown'
      mongoBySource[source] = (mongoBySource[source] || 0) + 1
    })
    
    logger.info('MongoDB Sessions by Source:')
    Object.entries(mongoBySource).forEach(([source, count]) => {
      logger.info(`  ${source}: ${count}`)
    })
    logger.info('')
    
    // Get PostgreSQL users
    const pgResult = await postgresPool.query(`
      SELECT 
        id, 
        telegram_id, 
        session_id, 
        source, 
        phone_number,
        is_connected,
        created_at
      FROM users 
      ORDER BY source, telegram_id
    `)
    const pgUsers = pgResult.rows
    
    logger.info(`PostgreSQL Users: ${pgUsers.length}`)
    logger.info('')
    
    // Breakdown by source
    const pgBySource = {}
    pgUsers.forEach(u => {
      const source = u.source || 'unknown'
      pgBySource[source] = (pgBySource[source] || 0) + 1
    })
    
    logger.info('PostgreSQL Users by Source:')
    Object.entries(pgBySource).forEach(([source, count]) => {
      logger.info(`  ${source}: ${count}`)
    })
    logger.info('')
    
    logger.info('='.repeat(70))
    logger.info('FINDING DISCREPANCIES')
    logger.info('='.repeat(70))
    logger.info('')
    
    // Find users in PostgreSQL but NOT in MongoDB
    const orphanedUsers = []
    pgUsers.forEach(user => {
      if (!mongoTelegramIds.has(user.telegram_id.toString())) {
        orphanedUsers.push(user)
      }
    })
    
    logger.warn(`Users in PostgreSQL WITHOUT MongoDB sessions: ${orphanedUsers.length}`)
    logger.info('')
    
    if (orphanedUsers.length > 0) {
      // Group by source
      const orphanedBySource = {}
      orphanedUsers.forEach(u => {
        const source = u.source || 'unknown'
        if (!orphanedBySource[source]) {
          orphanedBySource[source] = []
        }
        orphanedBySource[source].push(u)
      })
      
      logger.info('Orphaned Users Breakdown by Source:')
      Object.entries(orphanedBySource).forEach(([source, users]) => {
        logger.info('')
        logger.info(`  ${source.toUpperCase()}: ${users.length} users`)
        logger.info(`  ${'─'.repeat(60)}`)
        
        users.slice(0, 10).forEach(u => {
          logger.info(`    • ID: ${u.id} | Telegram: ${u.telegram_id} | Session: ${u.session_id || 'NULL'}`)
          logger.info(`      Phone: ${u.phone_number || 'NULL'} | Connected: ${u.is_connected}`)
          logger.info(`      Created: ${u.created_at}`)
        })
        
        if (users.length > 10) {
          logger.info(`    ... and ${users.length - 10} more`)
        }
      })
    }
    
    logger.info('')
    logger.info('='.repeat(70))
    
    // Find sessions in MongoDB but NOT in PostgreSQL
    const pgTelegramIds = new Set(pgUsers.map(u => u.telegram_id.toString()))
    const missingSessions = []
    
    mongoSessions.forEach(session => {
      if (!pgTelegramIds.has(session.telegramId)) {
        missingSessions.push(session)
      }
    })
    
    logger.warn(`Sessions in MongoDB WITHOUT PostgreSQL users: ${missingSessions.length}`)
    
    if (missingSessions.length > 0) {
      logger.info('')
      logger.info('Missing Users (have session, no PostgreSQL user):')
      missingSessions.slice(0, 10).forEach(s => {
        logger.info(`  • Session: ${s.sessionId} | Telegram: ${s.telegramId}`)
        logger.info(`    Phone: ${s.phoneNumber || 'NULL'} | Source: ${s.source || 'unknown'}`)
      })
      
      if (missingSessions.length > 10) {
        logger.info(`  ... and ${missingSessions.length - 10} more`)
      }
    }
    
    logger.info('')
    logger.info('='.repeat(70))
    logger.info('SUMMARY')
    logger.info('='.repeat(70))
    logger.info(`Total MongoDB Sessions: ${mongoSessions.length}`)
    logger.info(`Total PostgreSQL Users: ${pgUsers.length}`)
    logger.info(`Difference: ${Math.abs(mongoSessions.length - pgUsers.length)}`)
    logger.info('')
    logger.info(`Orphaned PostgreSQL Users (no session): ${orphanedUsers.length}`)
    logger.info(`Missing PostgreSQL Users (have session): ${missingSessions.length}`)
    logger.info('='.repeat(70))
    
    // Recommendations
    logger.info('')
    logger.info('RECOMMENDATIONS:')
    logger.info('')
    
    if (orphanedUsers.length > 0) {
      const telegramOrphans = orphanedUsers.filter(u => u.source === 'telegram').length
      const webOrphans = orphanedUsers.filter(u => u.source === 'web').length
      
      if (telegramOrphans > 0) {
        logger.info(`✓ Clean ${telegramOrphans} orphaned Telegram users:`)
        logger.info('  Set: cleanOrphanedUsers.enabled = true')
        logger.info('  Set: cleanOrphanedUsers.onlyCleanTelegram = true')
      }
      
      if (webOrphans > 0) {
        logger.warn(`⚠️  Found ${webOrphans} orphaned Web users - review manually`)
        logger.info('  These might be legitimate users created through web interface')
      }
    }
    
    if (missingSessions.length > 0) {
      logger.info(`✓ Create ${missingSessions.length} missing PostgreSQL users:`)
      logger.info('  Set: syncFromAuthBaileys.enabled = true')
      logger.info('  OR manually create these users in PostgreSQL')
    }
    
    if (orphanedUsers.length === 0 && missingSessions.length === 0) {
      logger.success('✅ All users and sessions are in sync!')
    }
    
    logger.info('')
    
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

diagnose().catch(console.error)