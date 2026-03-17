// ============================================================================
// Pull Session Files from MongoDB → Local Sessions Folder
// Pulls all files from auth_baileys per sessionId and writes them locally
// Keeps only the MOST RECENT file per type based on limits below
// Only pulls sessions with AT LEAST 95 pre-key files
// Save as: test3.js
// Run: node test3.js
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

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env')
  process.exit(1)
}

// ============================================================================
// PULL LIMITS — mirrors test2.js FILE_CLEANUP_RULES but as max-to-pull
// Only the most recent N files per type are pulled (sorted by updatedAt DESC)
// ============================================================================
const MIN_PRE_KEYS = 95   // Session must have at least this many pre-keys to qualify

const PULL_RULES = [
  {
    pattern: '^pre-key',
    maxToPull: 1000,
    description: 'Pre-key files'
  },
  {
    pattern: '^sender-key',
    maxToPull: 100,
    description: 'Sender keys'
  },
  {
    pattern: '^session-',
    maxToPull: 50,
    description: 'Session files'
  },
  {
    pattern: 'lid-mapping',
    maxToPull: 20,
    description: 'LID mapping files'
  }
  // Files that match none of the above (e.g. creds.json, app-state-*)
  // are always pulled as-is (1 per unique filename, most recent)
]

// ============================================================================
// MAIN PULL FUNCTION
// ============================================================================
async function pullSessionsFromMongo() {
  let client

  try {
    console.log('📥 Pull Session Files: MongoDB → Local')
    console.log('='.repeat(60))
    console.log(`Minimum pre-keys required : ${MIN_PRE_KEYS}`)
    console.log('\nPull limits per session:')
    PULL_RULES.forEach(r => console.log(`  - ${r.description}: pull up to ${r.maxToPull} (most recent)`))
    console.log('  - Everything else (creds, app-state, etc): pull most recent copy')
    console.log('='.repeat(60))

    // Connect to MongoDB
    console.log('\n1️⃣  Connecting to MongoDB...')
    client = new MongoClient(MONGODB_URI)
    await client.connect()
    console.log('✅ MongoDB connected')

    const db = client.db()
    const authBaileys = db.collection('auth_baileys')
    const sessionsCol  = db.collection('sessions')

    // ---- Get all sessionIds that have a creds.json ----
    console.log('\n2️⃣  Fetching session IDs with creds.json...')
    const allValidIds = await authBaileys.distinct('sessionId', {
      filename: 'creds.json'
    })
    console.log(`   Found ${allValidIds.length} sessions with creds.json`)

    if (allValidIds.length === 0) {
      console.log('\n⚠️  No valid sessions found in MongoDB. Exiting.')
      return
    }

    // ---- Gate: only keep sessions with >= MIN_PRE_KEYS pre-keys ----
    console.log(`\n3️⃣  Filtering sessions with at least ${MIN_PRE_KEYS} pre-keys...`)
    const qualifiedIds = []
    const disqualifiedIds = []

    for (let i = 0; i < allValidIds.length; i++) {
      const sessionId = allValidIds[i]
      process.stdout.write(`\r   Checking ${i + 1}/${allValidIds.length}: ${sessionId}          `)

      const preKeyCount = await authBaileys.countDocuments({
        sessionId,
        filename: { $regex: /^pre-key/i }
      })

      if (preKeyCount >= MIN_PRE_KEYS) {
        qualifiedIds.push({ sessionId, preKeyCount })
      } else {
        disqualifiedIds.push({ sessionId, preKeyCount })
      }
    }

    console.log('\n')
    console.log(`   ✅ Qualified  : ${qualifiedIds.length} sessions`)
    console.log(`   ⛔ Disqualified (< ${MIN_PRE_KEYS} pre-keys): ${disqualifiedIds.length} sessions`)

    if (disqualifiedIds.length > 0) {
      console.log('\n   Disqualified sessions:')
      disqualifiedIds.forEach(({ sessionId, preKeyCount }) => {
        console.log(`     ❌ ${sessionId} — ${preKeyCount} pre-keys`)
      })
    }

    if (qualifiedIds.length === 0) {
      console.log('\n⚠️  No sessions meet the minimum pre-key requirement. Exiting.')
      return
    }

    // Ensure base sessions directory exists
    const sessionsDir = path.join(process.cwd(), 'sessions')
    await fs.mkdir(sessionsDir, { recursive: true })

    // ========== Stats ==========
    let totalSessionsProcessed = 0
    let totalFilesWritten = 0
    let totalFilesSkipped = 0
    const sessionSummaries = []
    const errors = []

    // ========== Process Each Qualified Session ==========
    console.log(`\n4️⃣  Pulling files for ${qualifiedIds.length} qualified sessions...\n`)

    for (let i = 0; i < qualifiedIds.length; i++) {
      const { sessionId, preKeyCount } = qualifiedIds[i]
      process.stdout.write(`\r   Progress: ${i + 1}/${qualifiedIds.length} — ${sessionId}          `)

      try {
        // Create session folder
        const sessionPath = path.join(sessionsDir, sessionId)
        await fs.mkdir(sessionPath, { recursive: true })

        let filesWritten = 0
        let filesSkipped = 0
        const writtenFilenames = []

        // ---- Pull rule-based file types (with limits) ----
        for (const rule of PULL_RULES) {
          const regex = new RegExp(rule.pattern, 'i')

          // Fetch most recent N docs for this pattern
          const docs = await authBaileys
            .find({ sessionId, filename: { $regex: regex } })
            .sort({ updatedAt: -1 })   // newest first
            .limit(rule.maxToPull)
            .toArray()

          // Deduplicate by filename within the batch (first = newest wins)
          const seenFilenames = new Set()
          for (const doc of docs) {
            if (!doc.filename) continue
            if (seenFilenames.has(doc.filename)) {
              filesSkipped++
              continue
            }
            seenFilenames.add(doc.filename)

            const written = await writeDocToFile(sessionPath, doc)
            if (written) {
              filesWritten++
              writtenFilenames.push(doc.filename)
            } else {
              filesSkipped++
              errors.push(`${sessionId}/${doc.filename}: write failed`)
            }
          }
        }

        // ---- Pull everything else (creds, app-state-*, etc) ----
        // Exclude filenames already covered by the rules above
        const combinedPattern = PULL_RULES.map(r => r.pattern).join('|')

        const otherDocs = await authBaileys
          .find({
            sessionId,
            filename: { $not: { $regex: new RegExp(combinedPattern, 'i') } }
          })
          .sort({ updatedAt: -1 })
          .toArray()

        const seenOther = new Set()
        for (const doc of otherDocs) {
          if (!doc.filename) continue
          if (seenOther.has(doc.filename)) {
            filesSkipped++
            continue
          }
          seenOther.add(doc.filename)

          const written = await writeDocToFile(sessionPath, doc)
          if (written) {
            filesWritten++
            writtenFilenames.push(doc.filename)
          } else {
            filesSkipped++
            errors.push(`${sessionId}/${doc.filename}: write failed`)
          }
        }

        // ---- Pull metadata.json from sessions collection (as-is) ----
        // Stored as: { sessionId, telegramId, userId, phoneNumber, isConnected,
        //              connectionStatus, reconnectAttempts, source, detected,
        //              createdAt, updatedAt }
        const sessionMeta = await sessionsCol.findOne(
          { sessionId },
          { sort: { updatedAt: -1 } }
        )

        if (sessionMeta) {
          const { _id, ...metaData } = sessionMeta   // strip _id, keep everything else as-is
          const metaPath = path.join(sessionPath, 'metadata.json')
          await fs.writeFile(metaPath, JSON.stringify(metaData, null, 2), 'utf8')
          filesWritten++
          writtenFilenames.push('metadata.json')
        }

        totalFilesWritten  += filesWritten
        totalFilesSkipped  += filesSkipped
        totalSessionsProcessed++

        sessionSummaries.push({
          sessionId,
          preKeyCount,
          filesWritten,
          filesSkipped,
          writtenFilenames
        })

      } catch (sessionErr) {
        errors.push(`${sessionId}: ${sessionErr.message}`)
      }
    }

    console.log('\n')

    // ========== Session Breakdown ==========
    console.log('5️⃣  Session breakdown:\n')
    for (const s of sessionSummaries) {
      console.log(`   📁 ${s.sessionId}`)
      console.log(`      Pre-keys in Mongo : ${s.preKeyCount}`)
      console.log(`      Files written     : ${s.filesWritten}`)
      console.log(`      Duplicates skipped: ${s.filesSkipped}`)
      console.log(`      Files: ${s.writtenFilenames.join(', ')}`)
    }

    // ========== Errors ==========
    if (errors.length > 0) {
      console.log(`\n⚠️  Errors (${errors.length}):`)
      errors.forEach(e => console.log(`   ❌ ${e}`))
    }

    // ========== Final Summary ==========
    console.log('\n' + '='.repeat(60))
    console.log('📊 PULL SUMMARY')
    console.log('='.repeat(60))
    console.log(`Total sessions found      : ${allValidIds.length}`)
    console.log(`Disqualified (< ${MIN_PRE_KEYS} keys) : ${disqualifiedIds.length}`)
    console.log(`Sessions pulled           : ${totalSessionsProcessed}`)
    console.log(`Files written             : ${totalFilesWritten}`)
    console.log(`Duplicates skipped        : ${totalFilesSkipped}`)
    console.log(`Errors                    : ${errors.length}`)
    console.log('='.repeat(60))
    console.log(`\n✅ Done! Files saved to: ${sessionsDir}`)

  } catch (error) {
    console.error('\n❌ ERROR:', error.message)
    console.error('Full error:', error.stack)
  } finally {
    if (client) {
      await client.close()
      console.log('\n🔌 MongoDB disconnected')
    }
  }
}

// ============================================================================
// HELPER: Write a single MongoDB doc as a file
// ============================================================================
async function writeDocToFile(sessionPath, doc) {
  try {
    const filePath = path.join(sessionPath, doc.filename)

    let content
    if (doc.data !== undefined && doc.data !== null) {
      content = typeof doc.data === 'string'
        ? JSON.stringify(JSON.parse(doc.datajson), null, 2)  // unwrap string → proper JSON
        : JSON.stringify(doc.data, null, 2)
    } else {
      // Strip MongoDB/internal fields, write the rest
      const { _id, sessionId, filename, updatedAt, createdAt, ...rest } = doc
      content = JSON.stringify(rest, null, 2)
    }

    await fs.writeFile(filePath, content, 'utf8')
    return true
  } catch {
    return false
  }
}

// ============================================================================
// RUN
// ============================================================================
pullSessionsFromMongo().catch(console.error)