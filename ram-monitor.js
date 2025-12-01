import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import v8 from 'v8'
import { createComponentLogger } from './utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = createComponentLogger('RAM_MONITOR')

/**
 * RAM Monitor - Comprehensive memory analysis and logging
 * Captures EVERYTHING in memory and saves to files
 */
class RAMMonitor {
  constructor(outputDir = './memory-logs') {
    this.outputDir = path.resolve(process.cwd(), outputDir)
    this.monitorInterval = null
    this.startTime = Date.now()
    
    this._ensureOutputDirectory()
    logger.info(`RAM Monitor initialized - logs saved to: ${this.outputDir}`)
  }

  _ensureOutputDirectory() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true })
    }
  }

  /**
   * Start monitoring - runs every 30 minutes
   */
  start(intervalMinutes = 30) {
    logger.info(`Starting RAM monitoring (every ${intervalMinutes} minutes)`)
    
    // Run immediately on start
    this.captureMemorySnapshot()
    
    // Then run periodically
    this.monitorInterval = setInterval(() => {
      this.captureMemorySnapshot()
    }, intervalMinutes * 60 * 1000)
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      logger.info('RAM monitoring stopped')
    }
  }

  /**
   * Capture complete memory snapshot
   */
  async captureMemorySnapshot() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const snapshotDir = path.join(this.outputDir, `snapshot-${timestamp}`)
    
    try {
      fs.mkdirSync(snapshotDir, { recursive: true })
      
      logger.info('📸 Capturing memory snapshot...')
      
      // 1. Basic process memory
      await this._captureProcessMemory(snapshotDir)
      
      // 2. V8 heap statistics
      await this._captureHeapStats(snapshotDir)
      
      // 3. V8 heap snapshot (FULL MEMORY DUMP)
      await this._captureHeapSnapshot(snapshotDir)
      
      // 4. Global objects analysis
      await this._captureGlobalObjects(snapshotDir)
      
      // 5. Event listeners analysis
      await this._captureEventListeners(snapshotDir)
      
      // 6. Cache analysis (all caches in app)
      await this._captureCacheAnalysis(snapshotDir)
      
      // 7. MongoDB/PostgreSQL connection pools
      await this._captureDatabaseConnections(snapshotDir)
      
      // 8. Active sessions & sockets
      await this._captureActiveSessions(snapshotDir)
      
      // 9. Module cache
      await this._captureModuleCache(snapshotDir)
      
      // 10. Timers & intervals
      await this._captureTimersAndIntervals(snapshotDir)
      
      // 11. System memory info
      await this._captureSystemMemory(snapshotDir)
      
      // 12. Summary report
      await this._generateSummaryReport(snapshotDir)
      
      logger.info(`✅ Memory snapshot saved to: ${snapshotDir}`)
      
    } catch (error) {
      logger.error('Failed to capture memory snapshot:', error)
    }
  }

  /**
   * 1. Basic process memory usage
   */
  async _captureProcessMemory(dir) {
    const memUsage = process.memoryUsage()
    const uptime = process.uptime()
    
    const data = {
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      uptimeSeconds: uptime,
      memory: {
        rss: {
          bytes: memUsage.rss,
          mb: (memUsage.rss / 1024 / 1024).toFixed(2),
          description: 'Resident Set Size - Total memory allocated'
        },
        heapTotal: {
          bytes: memUsage.heapTotal,
          mb: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
          description: 'Total heap allocated by V8'
        },
        heapUsed: {
          bytes: memUsage.heapUsed,
          mb: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
          description: 'Actual heap memory used'
        },
        external: {
          bytes: memUsage.external,
          mb: (memUsage.external / 1024 / 1024).toFixed(2),
          description: 'Memory used by C++ objects bound to JS'
        },
        arrayBuffers: {
          bytes: memUsage.arrayBuffers,
          mb: (memUsage.arrayBuffers / 1024 / 1024).toFixed(2),
          description: 'Memory allocated for ArrayBuffers'
        }
      },
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid
    }
    
    fs.writeFileSync(
      path.join(dir, '01-process-memory.json'),
      JSON.stringify(data, null, 2)
    )
  }

  /**
   * 2. V8 heap statistics
   */
  async _captureHeapStats(dir) {
    const heapStats = v8.getHeapStatistics()
    const heapSpaces = v8.getHeapSpaceStatistics()
    
    const data = {
      timestamp: new Date().toISOString(),
      heapStatistics: {
        totalHeapSize: (heapStats.total_heap_size / 1024 / 1024).toFixed(2) + ' MB',
        totalHeapSizeExecutable: (heapStats.total_heap_size_executable / 1024 / 1024).toFixed(2) + ' MB',
        totalPhysicalSize: (heapStats.total_physical_size / 1024 / 1024).toFixed(2) + ' MB',
        totalAvailableSize: (heapStats.total_available_size / 1024 / 1024).toFixed(2) + ' MB',
        usedHeapSize: (heapStats.used_heap_size / 1024 / 1024).toFixed(2) + ' MB',
        heapSizeLimit: (heapStats.heap_size_limit / 1024 / 1024).toFixed(2) + ' MB',
        mallocedMemory: (heapStats.malloced_memory / 1024 / 1024).toFixed(2) + ' MB',
        peakMallocedMemory: (heapStats.peak_malloced_memory / 1024 / 1024).toFixed(2) + ' MB',
        numberOfNativeContexts: heapStats.number_of_native_contexts,
        numberOfDetachedContexts: heapStats.number_of_detached_contexts
      },
      heapSpaces: heapSpaces.map(space => ({
        name: space.space_name,
        size: (space.space_size / 1024 / 1024).toFixed(2) + ' MB',
        used: (space.space_used_size / 1024 / 1024).toFixed(2) + ' MB',
        available: (space.space_available_size / 1024 / 1024).toFixed(2) + ' MB',
        physical: (space.physical_space_size / 1024 / 1024).toFixed(2) + ' MB'
      }))
    }
    
    fs.writeFileSync(
      path.join(dir, '02-heap-statistics.json'),
      JSON.stringify(data, null, 2)
    )
  }

  /**
   * 3. V8 heap snapshot (FULL MEMORY DUMP)
   * This is the MOST IMPORTANT - shows everything in memory
   */
  async _captureHeapSnapshot(dir) {
    const snapshotPath = path.join(dir, '03-heap-snapshot.heapsnapshot')
    
    try {
      const snapshot = v8.writeHeapSnapshot(snapshotPath)
      
      const stats = fs.statSync(snapshot)
      
      fs.writeFileSync(
        path.join(dir, '03-heap-snapshot-info.json'),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          snapshotFile: snapshot,
          snapshotSize: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
          instructions: [
            '1. Download this .heapsnapshot file',
            '2. Open Chrome DevTools',
            '3. Go to Memory tab',
            '4. Click "Load" and select this file',
            '5. Analyze what is taking up memory'
          ]
        }, null, 2)
      )
      
      logger.info(`Heap snapshot saved: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)
    } catch (error) {
      logger.error('Failed to capture heap snapshot:', error)
    }
  }

  /**
   * 4. Global objects analysis
   */
  async _captureGlobalObjects(dir) {
    const data = {
      timestamp: new Date().toISOString(),
      globalKeys: Object.keys(global).filter(key => 
        !['console', 'process', 'Buffer', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'].includes(key)
      ),
      globalObjectSizes: {}
    }
    
    // Analyze size of global objects
    for (const key of data.globalKeys) {
      try {
        const value = global[key]
        if (value && typeof value === 'object') {
          if (value instanceof Map) {
            data.globalObjectSizes[key] = {
              type: 'Map',
              size: value.size,
              keys: Array.from(value.keys()).slice(0, 10)
            }
          } else if (value instanceof Set) {
            data.globalObjectSizes[key] = {
              type: 'Set',
              size: value.size,
              sample: Array.from(value).slice(0, 10)
            }
          } else if (Array.isArray(value)) {
            data.globalObjectSizes[key] = {
              type: 'Array',
              length: value.length
            }
          } else {
            const keys = Object.keys(value)
            data.globalObjectSizes[key] = {
              type: 'Object',
              keyCount: keys.length,
              keys: keys.slice(0, 10)
            }
          }
        }
      } catch (error) {
        data.globalObjectSizes[key] = { error: error.message }
      }
    }
    
    fs.writeFileSync(
      path.join(dir, '04-global-objects.json'),
      JSON.stringify(data, null, 2)
    )
  }

  /**
   * 5. Event listeners analysis
   */
  async _captureEventListeners(dir) {
    const data = {
      timestamp: new Date().toISOString(),
      process: this._getEventListenerInfo(process),
      maxListeners: process.getMaxListeners(),
      warning: 'High listener counts can indicate memory leaks'
    }
    
    fs.writeFileSync(
      path.join(dir, '05-event-listeners.json'),
      JSON.stringify(data, null, 2)
    )
  }

  _getEventListenerInfo(emitter) {
    if (!emitter || typeof emitter.eventNames !== 'function') {
      return null
    }
    
    const info = {}
    const eventNames = emitter.eventNames()
    
    for (const event of eventNames) {
      const listeners = emitter.listenerCount(event)
      if (listeners > 0) {
        info[event] = listeners
      }
    }
    
    return info
  }

  /**
   * 6. Cache analysis (session cache, auth cache, etc.)
   */
  async _captureCacheAnalysis(dir) {
    const data = {
      timestamp: new Date().toISOString(),
      caches: {}
    }
    
    // Try to get storage stats if available
    try {
      const { getSessionStorage } = await import('./whatsapp/sessions/storage/coordinator.js')
      const storage = getSessionStorage()
      
      if (storage) {
        const stats = storage.getStats()
        data.caches.sessionStorage = stats
      }
    } catch (error) {
      data.caches.sessionStorageError = error.message
    }
    
    // Try to get auth cache stats
    try {
      const { getAuthCacheStats } = await import('./whatsapp/sessions/storage/auth-state.js')
      data.caches.authCache = getAuthCacheStats()
    } catch (error) {
      data.caches.authCacheError = error.message
    }
    
    fs.writeFileSync(
      path.join(dir, '06-cache-analysis.json'),
      JSON.stringify(data, null, 2)
    )
  }

  /**
   * 7. Database connections
   */
  async _captureDatabaseConnections(dir) {
    const data = {
      timestamp: new Date().toISOString(),
      connections: {}
    }
    
    // Try to get storage connection info
    try {
      const { getSessionStorage } = await import('./whatsapp/sessions/storage/coordinator.js')
      const storage = getSessionStorage()
      
      if (storage) {
        data.connections = storage.getConnectionStatus()
      }
    } catch (error) {
      data.connectionsError = error.message
    }
    
    fs.writeFileSync(
      path.join(dir, '07-database-connections.json'),
      JSON.stringify(data, null, 2)
    )
  }

  /**
   * 8. Active sessions & sockets
   */
  async _captureActiveSessions(dir) {
    const data = {
      timestamp: new Date().toISOString(),
      sessions: {}
    }
    
    // Try to get session manager stats
    try {
      const { quickSetup } = await import('./whatsapp/index.js')
      // This won't reinitialize, just get reference if exists
      if (global.sessionManager) {
        const stats = await global.sessionManager.getStats()
        data.sessions = stats
      }
    } catch (error) {
      data.sessionsError = error.message
    }
    
    fs.writeFileSync(
      path.join(dir, '08-active-sessions.json'),
      JSON.stringify(data, null, 2)
    )
  }

  /**
   * 9. Module cache
   */
  async _captureModuleCache(dir) {
    const modules = Object.keys(require.cache || {})
    
    const data = {
      timestamp: new Date().toISOString(),
      totalModules: modules.length,
      modules: modules.map(mod => ({
        path: mod,
        size: this._estimateModuleSize(mod)
      })).sort((a, b) => b.size - a.size).slice(0, 50) // Top 50
    }
    
    fs.writeFileSync(
      path.join(dir, '09-module-cache.json'),
      JSON.stringify(data, null, 2)
    )
  }

  _estimateModuleSize(modulePath) {
    try {
      const stats = fs.statSync(modulePath)
      return stats.size
    } catch {
      return 0
    }
  }

  /**
   * 10. Timers and intervals
   */
  async _captureTimersAndIntervals(dir) {
    const handles = process._getActiveHandles()
    const requests = process._getActiveRequests()
    
    const data = {
      timestamp: new Date().toISOString(),
      activeHandles: handles.length,
      activeRequests: requests.length,
      handleTypes: {},
      warning: 'High counts can indicate leaks or unclosed resources'
    }
    
    // Count handle types
    for (const handle of handles) {
      const type = handle.constructor.name
      data.handleTypes[type] = (data.handleTypes[type] || 0) + 1
    }
    
    fs.writeFileSync(
      path.join(dir, '10-timers-intervals.json'),
      JSON.stringify(data, null, 2)
    )
  }

  /**
   * 11. System memory info
   */
  async _captureSystemMemory(dir) {
    const os = await import('os')
    
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    
    const data = {
      timestamp: new Date().toISOString(),
      system: {
        totalMemory: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        freeMemory: (freeMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        usedMemory: (usedMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        usedPercentage: ((usedMem / totalMem) * 100).toFixed(2) + '%'
      },
      cpus: os.cpus().length,
      platform: os.platform(),
      arch: os.arch(),
      uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`
    }
    
    fs.writeFileSync(
      path.join(dir, '11-system-memory.json'),
      JSON.stringify(data, null, 2)
    )
  }

  /**
   * 12. Generate summary report
   */
  async _generateSummaryReport(dir) {
    const memUsage = process.memoryUsage()
    const uptime = process.uptime()
    
    const summary = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                  MEMORY SNAPSHOT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Timestamp: ${new Date().toISOString()}
Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s

MEMORY USAGE:
  RSS (Total):        ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB
  Heap Total:         ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB
  Heap Used:          ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB
  External:           ${(memUsage.external / 1024 / 1024).toFixed(2)} MB
  Array Buffers:      ${(memUsage.arrayBuffers / 1024 / 1024).toFixed(2)} MB

FILES GENERATED:
  01-process-memory.json       - Basic process memory stats
  02-heap-statistics.json      - V8 heap detailed stats
  03-heap-snapshot.heapsnapshot - FULL memory dump (open in Chrome DevTools)
  04-global-objects.json       - Global variables analysis
  05-event-listeners.json      - Event listener counts
  06-cache-analysis.json       - All caches (session, auth, etc.)
  07-database-connections.json - MongoDB/PostgreSQL pools
  08-active-sessions.json      - WhatsApp sessions & sockets
  09-module-cache.json         - Node.js module cache
  10-timers-intervals.json     - Active timers/intervals
  11-system-memory.json        - System-level memory info

ANALYSIS INSTRUCTIONS:
1. Check 03-heap-snapshot.heapsnapshot in Chrome DevTools
2. Look for large objects in 04-global-objects.json
3. Check cache sizes in 06-cache-analysis.json
4. Look for listener leaks in 05-event-listeners.json
5. Check for unclosed handles in 10-timers-intervals.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim()
    
    fs.writeFileSync(
      path.join(dir, '00-SUMMARY.txt'),
      summary
    )
  }

  /**
   * Get current memory usage summary
   */
  getCurrentMemory() {
    const mem = process.memoryUsage()
    return {
      rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      external: `${(mem.external / 1024 / 1024).toFixed(2)} MB`
    }
  }
}

// Export singleton
let monitorInstance = null

export function getRAMMonitor() {
  if (!monitorInstance) {
    monitorInstance = new RAMMonitor()
  }
  return monitorInstance
}

export { RAMMonitor }