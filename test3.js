/**
 * DELETE FAILED WEB SESSIONS SCRIPT
 * 
 * This script:
 * 1. Takes a list of failed session IDs
 * 2. Deletes them from MongoDB (sessions collection)
 * 3. Updates PostgreSQL to mark them as disconnected (is_connected=false)
 * 4. Shows before/after comparison
 * 
 * Usage: node delete-failed-sessions.js
 */

import { MongoClient } from 'mongodb'
import { pool } from './config/database.js'
import dotenv from 'dotenv'

dotenv.config()

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  success: (...args) => console.log('[SUCCESS]', ...args)
}

/**
 * List of failed session IDs that have no auth
 * Add/Remove session IDs here
 */
const FAILED_SESSIONS = [
  'session_1000000019',
  'session_1000000001',
  'session_1000000029',
  'session_1000000026'
  // Add more if needed
]

async function deleteFailedSessions() {
  let mongoClient

  try {
    logger.info('='.repeat(70))
    logger.info('DELETE FAILED WEB SESSIONS')
    logger.info('='.repeat(70))
    logger.info('')

    logger.info(`📋 Sessions to delete: ${FAILED_SESSIONS.length}`)
    FAILED_SESSIONS.forEach((sid, i) => {
      logger.info(`  ${i + 1}. ${sid}`)
    })
    logger.info('')

    // ==========================================
    // CONNECT TO DATABASES
    // ==========================================

    logger.info('🔗 Connecting to MongoDB...')
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 80,
      minPoolSize: 2
    })
    await mongoClient.connect()
    const db = mongoClient.db()
    const sessionsCollection = db.collection('sessions')
    logger.success('✅ MongoDB connected')

    logger.info('🔗 Connecting to PostgreSQL...')
    const client = await pool.connect()
    await client.query('SELECT 1')
    client.release()
    logger.success('✅ PostgreSQL connected')
    logger.info('')

    // ==========================================
    // COLLECT BEFORE STATISTICS
    // ==========================================

    logger.info('📊 Collecting before statistics...')
    logger.info('─'.repeat(70))

    const beforeStats = {
      mongoSessions: 0,
      postgresUsers: 0,
      bySession: {}
    }

    // Check MongoDB before
    for (const sessionId of FAILED_SESSIONS) {
      const mongoSession = await sessionsCollection.findOne({ sessionId })
      const pgResult = await pool.query(
        'SELECT * FROM users WHERE session_id = $1',
        [sessionId]
      )

      beforeStats.bySession[sessionId] = {
        mongoExists: !!mongoSession,
        postgresExists: pgResult.rows.length > 0,
        postgresData: pgResult.rows[0] || null
      }

      if (mongoSession) beforeStats.mongoSessions++
      if (pgResult.rows.length > 0) beforeStats.postgresUsers++
    }

    logger.info(`MongoDB sessions to delete: ${beforeStats.mongoSessions}`)
    logger.info(`PostgreSQL users to disconnect: ${beforeStats.postgresUsers}`)
    logger.info('')

    // ==========================================
    // DELETE FROM MONGODB
    // ==========================================

    logger.info('🗑️  DELETING FROM MONGODB...')
    logger.info('─'.repeat(70))

    let mongoDeleted = 0
    let mongoErrors = 0

    for (const sessionId of FAILED_SESSIONS) {
      try {
        const result = await sessionsCollection.deleteOne({ sessionId })

        if (result.deletedCount > 0) {
          logger.success(`  ✅ Deleted: ${sessionId}`)
          mongoDeleted++
        } else {
          logger.warn(`  ⚠️  Not found: ${sessionId}`)
        }
      } catch (error) {
        logger.error(`  ❌ Error deleting ${sessionId}: ${error.message}`)
        mongoErrors++
      }
    }

    logger.info('')
    logger.info(`MongoDB Results: ${mongoDeleted} deleted, ${mongoErrors} errors`)
    logger.info('')

    // ==========================================
    // UPDATE POSTGRESQL
    // ==========================================

    logger.info('🔄 UPDATING POSTGRESQL...')
    logger.info('─'.repeat(70))

    let postgresUpdated = 0
    let postgresErrors = 0

    for (const sessionId of FAILED_SESSIONS) {
      try {
        const result = await pool.query(
          `UPDATE users 
           SET is_connected = false,
               connection_status = 'disconnected',
               detected = false,
               updated_at = NOW()
           WHERE session_id = $1`,
          [sessionId]
        )

        if (result.rowCount > 0) {
          logger.success(`  ✅ Disconnected: ${sessionId}`)
          postgresUpdated++
        } else {
          logger.warn(`  ⚠️  Not found in users: ${sessionId}`)
        }
      } catch (error) {
        logger.error(`  ❌ Error updating ${sessionId}: ${error.message}`)
        postgresErrors++
      }
    }

    logger.info('')
    logger.info(`PostgreSQL Results: ${postgresUpdated} updated, ${postgresErrors} errors`)
    logger.info('')

    // ==========================================
    // COLLECT AFTER STATISTICS
    // ==========================================

    logger.info('📊 Collecting after statistics...')
    logger.info('─'.repeat(70))

    const afterStats = {
      mongoSessions: 0,
      postgresUsers: 0,
      bySession: {}
    }

    for (const sessionId of FAILED_SESSIONS) {
      const mongoSession = await sessionsCollection.findOne({ sessionId })
      const pgResult = await pool.query(
        'SELECT * FROM users WHERE session_id = $1',
        [sessionId]
      )

      afterStats.bySession[sessionId] = {
        mongoExists: !!mongoSession,
        postgresExists: pgResult.rows.length > 0,
        postgresData: pgResult.rows[0] || null
      }

      if (mongoSession) afterStats.mongoSessions++
      if (pgResult.rows.length > 0) afterStats.postgresUsers++
    }

    logger.info('')

    // ==========================================
    // SHOW DETAILED RESULTS
    // ==========================================

    logger.info('='.repeat(70))
    logger.info('DETAILED RESULTS')
    logger.info('='.repeat(70))
    logger.info('')

    for (const sessionId of FAILED_SESSIONS) {
      const before = beforeStats.bySession[sessionId]
      const after = afterStats.bySession[sessionId]
      const telegramId = sessionId.replace('session_', '')

      logger.info(`📌 ${sessionId} (Telegram: ${telegramId})`)
      logger.info('─'.repeat(70))

      // MongoDB status
      logger.info('  MongoDB:')
      logger.info(`    Before: ${before.mongoExists ? '✅ EXISTS' : '❌ NOT FOUND'}`)
      logger.info(`    After:  ${after.mongoExists ? '✅ EXISTS' : '❌ DELETED'}`)

      // PostgreSQL status
      logger.info('  PostgreSQL:')
      if (before.postgresExists) {
        const beforeData = before.postgresData
        logger.info(`    Before: Connected=${beforeData.is_connected}, Status=${beforeData.connection_status}`)
      } else {
        logger.info(`    Before: ❌ NOT FOUND`)
      }

      if (after.postgresExists) {
        const afterData = after.postgresData
        logger.info(`    After:  Connected=${afterData.is_connected}, Status=${afterData.connection_status}`)
      } else {
        logger.info(`    After:  ❌ DELETED`)
      }

      logger.info('')
    }

    // ==========================================
    // SUMMARY
    // ==========================================

    logger.info('='.repeat(70))
    logger.info('SUMMARY')
    logger.info('='.repeat(70))
    logger.info('')
    logger.info('MongoDB:')
    logger.info(`  Before: ${beforeStats.mongoSessions} sessions`)
    logger.info(`  After:  ${afterStats.mongoSessions} sessions`)
    logger.info(`  Deleted: ${beforeStats.mongoSessions - afterStats.mongoSessions}`)
    logger.info('')
    logger.info('PostgreSQL:')
    logger.info(`  Before: ${beforeStats.postgresUsers} users connected`)
    logger.info(`  After:  ${afterStats.postgresUsers} users disconnected`)
    logger.info('')

    if (mongoDeleted > 0 || postgresUpdated > 0) {
      logger.success(`✅ CLEANUP COMPLETE - ${mongoDeleted + postgresUpdated} operations`)
    } else {
      logger.warn('⚠️  No changes made')
    }

    logger.info('')
    logger.info('='.repeat(70))

  } catch (error) {
    logger.error('Fatal error:', error.message)
    logger.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    // Close connections
    if (mongoClient) {
      await mongoClient.close()
      logger.info('MongoDB connection closed')
    }

    try {
      await pool.end()
      logger.info('PostgreSQL connection closed')
    } catch (error) {
      logger.error('Error closing PostgreSQL:', error.message)
    }
  }
}

// Run the script
deleteFailedSessions().catch(error => {
  logger.error('Uncaught error:', error)
  process.exit(1)
})