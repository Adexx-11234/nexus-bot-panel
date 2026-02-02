// ============================================================================
// Sync Sessions Across All Storage Locations
// Ensures auth_baileys, sessions collection, and local files are in sync
// Save as: sync-sessions.js
// Run: node sync-sessions.js
// ============================================================================

import { MongoClient } from 'mongodb'
import fs from 'fs/promises'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env')
  process.exit(1)
}

async function syncSessions() {
  let client
  let postgresPool

  try {
    console.log('🔄 Syncing Sessions Across All Storage')
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

    // Get all valid sessions from auth_baileys (sessions with creds.json)
    console.log('\n3️⃣ Getting valid sessions from auth_baileys...')
    const validSessionIds = await authBaileys.distinct('sessionId', {
      filename: 'creds.json'
    })
    console.log(`   Found ${validSessionIds.length} sessions with creds.json`)

    // Get existing sessions in collections
    const existingInSessionsCollection = await sessions.distinct('sessionId')
    const existingLocalFolders = await getLocalSessionIds()

    console.log(`   Existing in sessions collection: ${existingInSessionsCollection.length}`)
    console.log(`   Existing in local files: ${existingLocalFolders.length}`)

    // Find what's missing
    const missingInSessionsCollection = validSessionIds.filter(
      sid => !existingInSessionsCollection.includes(sid)
    )
    const missingInLocal = validSessionIds.filter(
      sid => !existingLocalFolders.includes(sid)
    )

    console.log('\n4️⃣ Analysis:')
    console.log(`   Missing in sessions collection: ${missingInSessionsCollection.length}`)
    console.log(`   Missing in local files: ${missingInLocal.length}`)

    // ========== PART 1: Create Missing Sessions Collection Entries ==========
    if (missingInSessionsCollection.length > 0) {
      console.log('\n5️⃣ Creating missing sessions collection entries...')
      let created = 0

      for (const sessionId of missingInSessionsCollection) {
        try {
          const telegramId = sessionId.replace('session_', '')
          
          // Get session info from PostgreSQL
          let phoneNumber = null
          let source = 'telegram' // Default
          let detected = true
          let isConnected = true
          let connectionStatus = 'connected'
          
          try {
            const pgResult = await postgresPool.query(
              'SELECT phone_number, source, detected, is_connected, connection_status FROM users WHERE telegram_id = $1',
              [parseInt(telegramId)]
            )
            if (pgResult.rows.length > 0) {
              const row = pgResult.rows[0]
              phoneNumber = row.phone_number
              source = row.source || 'telegram' // Can be 'telegram' or 'web'
              detected = row.detected !== false
              isConnected = row.is_connected !== false
              connectionStatus = row.connection_status || 'connected'
            }
          } catch (error) {
            console.log(`      ⚠️  No PostgreSQL record for ${sessionId}, defaulting to telegram`)
          }

          // Create session document
          const sessionDoc = {
            sessionId: sessionId,
            userId: telegramId,
            phoneNumber: phoneNumber,
            isConnected: isConnected,
            connectionStatus: connectionStatus,
            source: source, // 'telegram' or 'web'
            detected: detected,
            createdAt: new Date(),
            updatedAt: new Date()
          }

          await sessions.insertOne(sessionDoc)
          created++
          console.log(`   ✅ Created: ${sessionId} (source: ${source})`)
        } catch (error) {
          console.log(`   ❌ Error creating ${sessionId}: ${error.message}`)
        }
      }

      console.log(`\n   📊 Created ${created} sessions collection entries`)
    } else {
      console.log('\n✅ All sessions already in sessions collection')
    }

    // ========== PART 2: Create Missing Local Folders + metadata.json ==========
    if (missingInLocal.length > 0) {
      console.log('\n6️⃣ Creating missing local folders and metadata.json...')
      let created = 0

      for (const sessionId of missingInLocal) {
        try {
          const telegramId = sessionId.replace('session_', '')
          
          // Get session info from PostgreSQL
          let phoneNumber = null
          let source = 'telegram' // Default
          let detected = true
          let isConnected = true
          let connectionStatus = 'connected'
          let reconnectAttempts = 0
          
          try {
            const pgResult = await postgresPool.query(
              `SELECT phone_number, source, detected, is_connected, 
                      connection_status, reconnect_attempts 
               FROM users WHERE telegram_id = $1`,
              [parseInt(telegramId)]
            )
            if (pgResult.rows.length > 0) {
              const row = pgResult.rows[0]
              phoneNumber = row.phone_number
              source = row.source || 'telegram' // Can be 'telegram' or 'web'
              detected = row.detected !== false
              isConnected = row.is_connected !== false
              connectionStatus = row.connection_status || 'connected'
              reconnectAttempts = row.reconnect_attempts || 0
            }
          } catch (error) {
            console.log(`      ⚠️  No PostgreSQL record for ${sessionId}, defaulting to telegram`)
          }

          // Create session folder
          const sessionPath = path.join(process.cwd(), 'sessions', sessionId)
          await fs.mkdir(sessionPath, { recursive: true })

          // Create metadata.json
          const metadata = {
            sessionId: sessionId,
            telegramId: telegramId,
            userId: telegramId,
            phoneNumber: phoneNumber,
            isConnected: isConnected,
            connectionStatus: connectionStatus,
            reconnectAttempts: reconnectAttempts,
            source: source, // 'telegram' or 'web'
            detected: detected,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }

          const metadataPath = path.join(sessionPath, 'metadata.json')
          await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')

          created++
          console.log(`   ✅ Created: ${sessionId} (source: ${source}, folder + metadata.json)`)
        } catch (error) {
          console.log(`   ❌ Error creating ${sessionId}: ${error.message}`)
        }
      }

      console.log(`\n   📊 Created ${created} local folders with metadata.json`)
    } else {
      console.log('\n✅ All sessions already have local folders')
    }

    // ========== PART 3: Show Source Distribution ==========
    console.log('\n7️⃣ Session source distribution:')
    try {
      const sourceCount = await postgresPool.query(`
        SELECT source, COUNT(*) as count 
        FROM users 
        WHERE session_id IS NOT NULL 
        GROUP BY source
      `)
      
      sourceCount.rows.forEach(row => {
        console.log(`   - ${row.source}: ${row.count} sessions`)
      })
    } catch (error) {
      console.log('   Could not get source distribution')
    }

    // ========== PART 4: Verify Sync ==========
    console.log('\n8️⃣ Verifying sync...')
    const finalSessionsCollection = await sessions.distinct('sessionId')
    const finalLocalFolders = await getLocalSessionIds()

    console.log(`   auth_baileys (with creds): ${validSessionIds.length}`)
    console.log(`   sessions collection: ${finalSessionsCollection.length}`)
    console.log(`   local folders: ${finalLocalFolders.length}`)

    if (validSessionIds.length === finalSessionsCollection.length && 
        validSessionIds.length === finalLocalFolders.length) {
      console.log('\n🎉 All storage locations are now in sync!')
    } else {
      console.log('\n⚠️  Some discrepancies remain. Re-run to investigate.')
    }

    // ========== Final Summary ==========
    console.log('\n' + '='.repeat(60))
    console.log('📊 SYNC SUMMARY')
    console.log('='.repeat(60))
    console.log(`Sessions with valid auth: ${validSessionIds.length}`)
    console.log(`Created in sessions collection: ${missingInSessionsCollection.length}`)
    console.log(`Created local folders: ${missingInLocal.length}`)
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
// HELPER FUNCTIONS
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

// ============================================================================
// RUN THE SCRIPT
// ============================================================================
syncSessions().catch(console.error)