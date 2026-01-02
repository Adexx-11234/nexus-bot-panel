// ============================================================================
// Honest MongoDB Test - Leaves data in DB so you can verify manually
// Save as: honest-test.js
// Run: node honest-test.js
// ============================================================================

import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI
const TEST_SESSION_ID = 'session_honest_test_' + Date.now()

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found')
  process.exit(1)
}

async function honestTest() {
  let client

  try {
    console.log('🔍 HONEST MongoDB Test\n')
    console.log('Session ID:', TEST_SESSION_ID)
    console.log('=' .repeat(60))

    // Connect
    console.log('\n1️⃣ Connecting...')
    client = new MongoClient(MONGODB_URI)
    await client.connect()
    console.log('✅ Connected')

    const db = client.db()
    const authBaileys = db.collection('auth_baileys')

    // Write test data
    console.log('\n2️⃣ Writing test document...')
    
    const testDoc = {
      sessionId: TEST_SESSION_ID,
      filename: 'creds.json',
      datajson: JSON.stringify({
        noiseKey: { type: 'Buffer', data: [1, 2, 3] },
        signedIdentityKey: { type: 'Buffer', data: [4, 5, 6] },
        testTime: new Date().toISOString()
      }),
      updatedAt: new Date()
    }

    console.log('   Writing to auth_baileys collection...')
    const writeResult = await authBaileys.insertOne(testDoc)
    
    console.log('   Insert result:')
    console.log('   - acknowledged:', writeResult.acknowledged)
    console.log('   - insertedId:', writeResult.insertedId)

    // Small delay
    await new Promise(r => setTimeout(r, 1000))

    // Try to read it back IMMEDIATELY
    console.log('\n3️⃣ Reading back immediately...')
    const readBack = await authBaileys.findOne({
      sessionId: TEST_SESSION_ID,
      filename: 'creds.json'
    })

    if (readBack) {
      console.log('✅ Document found!')
      console.log('   _id:', readBack._id)
      console.log('   sessionId:', readBack.sessionId)
      console.log('   filename:', readBack.filename)
      console.log('   datajson length:', readBack.datajson?.length)
    } else {
      console.log('❌ Document NOT FOUND!')
      console.log('🔴 THIS IS THE PROBLEM!')
    }

    // Count all documents for this session
    console.log('\n4️⃣ Counting documents...')
    const count = await authBaileys.countDocuments({ sessionId: TEST_SESSION_ID })
    console.log('   Count:', count)

    // List ALL sessions in collection
    console.log('\n5️⃣ All sessions in auth_baileys:')
    const allSessions = await authBaileys.distinct('sessionId')
    console.log('   Total unique sessions:', allSessions.length)
    allSessions.slice(0, 10).forEach(sid => {
      console.log('   -', sid)
    })

    // Check database name
    console.log('\n6️⃣ Database info:')
    console.log('   Database name:', db.databaseName)
    console.log('   Collections:')
    const collections = await db.listCollections().toArray()
    collections.forEach(col => {
      console.log('   -', col.name)
    })

    // DON'T cleanup - leave it for manual verification
    console.log('\n' + '='.repeat(60))
    console.log('⚠️  DATA LEFT IN DATABASE FOR VERIFICATION')
    console.log('='.repeat(60))
    console.log('\nSession ID:', TEST_SESSION_ID)
    console.log('\nGo check your MongoDB Atlas now!')
    console.log('Database:', db.databaseName)
    console.log('Collection: auth_baileys')
    console.log('Filter: { sessionId: "' + TEST_SESSION_ID + '" }')
    console.log('\nTo cleanup later, run:')
    console.log('db.auth_baileys.deleteMany({ sessionId: "' + TEST_SESSION_ID + '" })')

  } catch (error) {
    console.error('\n❌ ERROR:', error)
    console.error('\nFull error:', error.stack)
  } finally {
    if (client) {
      await client.close()
      console.log('\n🔌 Disconnected')
    }
  }
}

honestTest().catch(console.error)