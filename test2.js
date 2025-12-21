import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'

dotenv.config()

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  success: (...args) => console.log('[SUCCESS]', ...args)
}

async function resetWebUsersForDetection() {
  let mongoClient

  try {
    logger.info('='.repeat(70))
    logger.info('RESET WEB USERS FOR DETECTION')
    logger.info('='.repeat(70))
    logger.info('')

    // Connect to MongoDB
    logger.info('🔗 Connecting to MongoDB...')
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 80,
      minPoolSize: 2
    })
    await mongoClient.connect()

    const db = mongoClient.db()
    const sessionsCollection = db.collection('sessions')
    logger.success('✅ MongoDB connected')
    logger.info('')

    // Get all web user sessions
    logger.info('📊 Finding all web user sessions...')
    const webSessions = await sessionsCollection.find({
      source: 'web'
    }).toArray()

    logger.info(`Found ${webSessions.length} total web user sessions`)
    logger.info('')

    if (webSessions.length === 0) {
      logger.warn('⚠️  No web users found')
      return
    }

    // Show preview
    logger.info('PREVIEW (first 10):')
    logger.info('─'.repeat(70))
    webSessions.slice(0, 10).forEach(session => {
      logger.info(`  • Telegram: ${session.telegramId} | Session: ${session.sessionId}`)
      logger.info(`    Status: ${session.connectionStatus} | Connected: ${session.isConnected}`)
      logger.info(`    Detected: ${session.detected || false}`)
    })
    logger.info('')

    if (webSessions.length > 10) {
      logger.info(`  ... and ${webSessions.length - 10} more`)
      logger.info('')
    }

    // Update all web sessions to be detectable
    logger.info('🔄 Resetting all web users for detection...')
    logger.info('')

    const result = await sessionsCollection.updateMany(
      {
        source: 'web'
      },
      {
        $set: {
          // KEEP THESE AS IS - so detector finds them
          connectionStatus: 'connected',
          isConnected: true,
          
          // SET detected to false - so detector picks them up
          detected: false,
          
          // Update timestamp
          updatedAt: new Date(),
          lastDetectionAttempt: new Date()
        }
      }
    )

    logger.success(`✅ RESET COMPLETE`)
    logger.info('')
    logger.info('Results:')
    logger.info(`  Matched: ${result.matchedCount}`)
    logger.info(`  Modified: ${result.modifiedCount}`)
    logger.info('')

    if (result.modifiedCount === 0) {
      logger.warn('⚠️  No sessions were modified')
    } else {
      logger.success(`✅ Successfully reset ${result.modifiedCount} web user sessions!`)
      logger.info('')
      logger.info('These users will NOW be detected by getUndetectedWebSessions():')
      logger.info('  ✓ source: "web"')
      logger.info('  ✓ connectionStatus: "connected"')
      logger.info('  ✓ isConnected: true')
      logger.info('  ✓ detected: false')
      logger.info('')
      logger.info('Next detection cycle (within 10 seconds):')
      logger.info('  1. Detector finds these sessions')
      logger.info('  2. Takes over the connection')
      logger.info('  3. Reconnects the bot sockets')
      logger.info('  4. Marks as detected: true')
    }

    logger.info('')
    logger.info('='.repeat(70))

  } catch (error) {
    logger.error('Fatal error:', error.message)
    process.exit(1)
  } finally {
    if (mongoClient) {
      await mongoClient.close()
      logger.info('MongoDB connection closed')
    }
  }
}

resetWebUsersForDetection().catch(console.error)