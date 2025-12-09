import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import util from 'util'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Safe JSON serialization for complex objects
 */
function safeSerialize(obj, maxDepth = 3, depth = 0, visited = new WeakSet()) {
  if (depth > maxDepth) return '[Max depth reached]'
  
  if (obj === null) return null
  if (obj === undefined) return '[undefined]'
  
  const type = typeof obj
  
  if (type === 'function') {
    const funcStr = obj.toString()
    const signature = funcStr.split('{')[0].trim()
    return {
      _type: 'function',
      _name: obj.name || 'anonymous',
      _signature: signature.length > 200 ? signature.slice(0, 200) + '...' : signature
    }
  }
  
  if (type === 'symbol') {
    return {
      _type: 'symbol',
      _value: obj.toString()
    }
  }
  
  if (type !== 'object') {
    return obj
  }
  
  // Handle circular references
  if (visited.has(obj)) {
    return '[Circular Reference]'
  }
  visited.add(obj)
  
  // Handle special types
  if (obj instanceof Date) {
    return { _type: 'Date', _value: obj.toISOString() }
  }
  
  if (obj instanceof RegExp) {
    return { _type: 'RegExp', _value: obj.toString() }
  }
  
  if (obj instanceof Error) {
    return {
      _type: 'Error',
      _name: obj.name,
      _message: obj.message,
      _stack: obj.stack?.split('\n').slice(0, 5)
    }
  }
  
  if (obj instanceof Map) {
    const entries = []
    let count = 0
    for (const [key, value] of obj.entries()) {
      if (count++ < 10) {
        entries.push({
          key: String(key),
          value: depth < maxDepth ? safeSerialize(value, maxDepth, depth + 1, visited) : '[Object]'
        })
      }
    }
    return {
      _type: 'Map',
      _size: obj.size,
      _entries: entries,
      _truncated: obj.size > 10
    }
  }
  
  if (obj instanceof Set) {
    const values = []
    let count = 0
    for (const value of obj.values()) {
      if (count++ < 10) {
        values.push(String(value))
      }
    }
    return {
      _type: 'Set',
      _size: obj.size,
      _values: values,
      _truncated: obj.size > 10
    }
  }
  
  if (obj instanceof Buffer) {
    return {
      _type: 'Buffer',
      _length: obj.length,
      _preview: obj.toString('base64', 0, Math.min(50, obj.length))
    }
  }
  
  if (Array.isArray(obj)) {
    if (depth >= maxDepth) {
      return {
        _type: 'Array',
        _length: obj.length
      }
    }
    return obj.slice(0, 20).map(item => safeSerialize(item, maxDepth, depth + 1, visited))
  }
  
  // Handle plain objects
  const result = {
    _type: obj.constructor?.name || 'Object'
  }
  
  try {
    const keys = Object.getOwnPropertyNames(obj)
    for (const key of keys) {
      try {
        const value = obj[key]
        if (depth < maxDepth) {
          result[key] = safeSerialize(value, maxDepth, depth + 1, visited)
        } else {
          result[key] = `[${typeof value}]`
        }
      } catch (e) {
        result[key] = `[Error: ${e.message}]`
      }
    }
  } catch (e) {
    result._error = e.message
  }
  
  return result
}

/**
 * Inspect Socket Plugin - JSON Output
 * Display and save complete sock object analysis as JSON
 */
export default {
  name: "inspectsock",
  commands: ["inspectsock", "sockinfo", "debugsock"],
  description: "Deep inspect sock object and save to JSON file",
  adminOnly: true,
  category: "owner",
  
  async execute(sock, sessionId, args, m) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const inspectionDir = path.join(process.cwd(), 'inspections')
      const jsonFile = path.join(inspectionDir, `sock-inspection-${timestamp}.json`)
      
      // Ensure directory exists
      await fs.mkdir(inspectionDir, { recursive: true })
      
      const inspection = {
        metadata: {
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
          nodeVersion: process.version,
          platform: process.platform
        },
        
        basicInfo: {
          sessionId: sock.sessionId || null,
          userId: sock.user?.id || null,
          userName: sock.user?.name || null,
          readyState: sock.readyState || null,
          wsReadyState: sock.ws?.readyState || null,
          authMethod: sock.authMethod || null,
          eventHandlersSetup: sock.eventHandlersSetup || false
        },
        
        properties: {},
        methods: {},
        
        eventEmitter: {
          exists: !!sock.ev,
          type: sock.ev ? typeof sock.ev : null,
          constructor: sock.ev?.constructor?.name || null,
          properties: {},
          methods: [],
          listenerMethods: {},
          currentListeners: {}
        },
        
        store: {
          exists: !!sock._sessionStore,
          data: null
        },
        
        getMessage: {
          exists: !!sock.getMessage,
          type: sock.getMessage ? typeof sock.getMessage : null
        },
        
        prototypeChain: [],
        
        messageRelatedMethods: [],
        
        statistics: {
          totalProperties: 0,
          totalMethods: 0,
          totalEvMethods: 0
        }
      }
      
      // 1. Collect all properties
      const allProps = Object.getOwnPropertyNames(sock)
      const properties = allProps.filter(key => typeof sock[key] !== 'function')
      const methods = allProps.filter(key => typeof sock[key] === 'function')
      
      inspection.statistics.totalProperties = properties.length
      inspection.statistics.totalMethods = methods.length
      
      // 2. Serialize properties
      for (const prop of properties.sort()) {
        try {
          const value = sock[prop]
          inspection.properties[prop] = {
            type: typeof value,
            value: safeSerialize(value, 2)
          }
        } catch (e) {
          inspection.properties[prop] = {
            type: 'error',
            error: e.message
          }
        }
      }
      
      // 3. Serialize methods
      for (const method of methods.sort()) {
        try {
          const func = sock[method]
          const funcStr = func.toString()
          const signature = funcStr.split('\n')[0].trim()
          
          inspection.methods[method] = {
            signature: signature.length > 200 ? signature.slice(0, 200) + '...' : signature,
            name: func.name || 'anonymous'
          }
        } catch (e) {
          inspection.methods[method] = {
            error: e.message
          }
        }
      }
      
      // 4. Deep inspect ev (Event Emitter)
      if (sock.ev) {
        const evProps = Object.getOwnPropertyNames(sock.ev)
        const evMethods = evProps.filter(p => typeof sock.ev[p] === 'function')
        
        inspection.statistics.totalEvMethods = evMethods.length
        
        // Serialize ev properties
        for (const prop of evProps) {
          try {
            const value = sock.ev[prop]
            if (typeof value !== 'function') {
              inspection.eventEmitter.properties[prop] = safeSerialize(value, 2)
            }
          } catch (e) {
            inspection.eventEmitter.properties[prop] = `[Error: ${e.message}]`
          }
        }
        
        // List all ev methods
        inspection.eventEmitter.methods = evMethods.sort()
        
        // Check for specific listener methods
        const listenerMethods = [
          'on', 'once', 'off', 'emit', 'removeListener', 'removeAllListeners', 
          'prependListener', 'prependOnceListener', 'listeners', 'eventNames',
          'listenerCount', 'setMaxListeners', 'getMaxListeners', 'addListener'
        ]
        
        for (const method of listenerMethods) {
          inspection.eventEmitter.listenerMethods[method] = typeof sock.ev[method] === 'function'
        }
        
        // Get current listeners
        try {
          if (typeof sock.ev.eventNames === 'function') {
            const events = sock.ev.eventNames()
            inspection.eventEmitter.totalEvents = events.length
            
            for (const event of events) {
              const count = typeof sock.ev.listenerCount === 'function' 
                ? sock.ev.listenerCount(event) 
                : null
              
              inspection.eventEmitter.currentListeners[String(event)] = {
                listenerCount: count,
                hasListeners: count > 0
              }
            }
          }
        } catch (e) {
          inspection.eventEmitter.currentListeners._error = e.message
        }
      }
      
      // 5. Inspect store
      if (sock._sessionStore) {
        try {
          inspection.store.data = safeSerialize(sock._sessionStore, 2)
        } catch (e) {
          inspection.store.error = e.message
        }
      }
      
      // 6. Prototype chain
      let proto = Object.getPrototypeOf(sock)
      let level = 0
      while (proto && level < 5) {
        const protoProps = Object.getOwnPropertyNames(proto)
        inspection.prototypeChain.push({
          level: level,
          constructor: proto.constructor?.name || 'Object',
          totalProperties: protoProps.length,
          totalMethods: protoProps.filter(p => typeof proto[p] === 'function').length,
          properties: protoProps.filter(p => typeof proto[p] !== 'function').slice(0, 20),
          methods: protoProps.filter(p => typeof proto[p] === 'function').slice(0, 20)
        })
        proto = Object.getPrototypeOf(proto)
        level++
      }
      
      // 7. Message-related methods
      const messageRelated = allProps.filter(key => 
        key.toLowerCase().includes('message') || 
        key.toLowerCase().includes('chat') ||
        key.toLowerCase().includes('group')
      )
      
      for (const item of messageRelated.sort()) {
        inspection.messageRelatedMethods.push({
          name: item,
          type: typeof sock[item],
          isFunction: typeof sock[item] === 'function'
        })
      }
      
      // Write JSON to file with pretty print
      await fs.writeFile(jsonFile, JSON.stringify(inspection, null, 2), 'utf-8')
      
      // Send summary to user
      let summary = `✅ *Sock Inspection Complete*\n\n`
      summary += `📊 *Summary:*\n`
      summary += `• Properties: ${inspection.statistics.totalProperties}\n`
      summary += `• Methods: ${inspection.statistics.totalMethods}\n`
      summary += `• Event Emitter (ev): ${sock.ev ? '✓ YES' : '✗ NO'}\n`
      
      if (sock.ev) {
        summary += `  - ev.on: ${inspection.eventEmitter.listenerMethods.on ? '✓' : '✗'}\n`
        summary += `  - ev.prependListener: ${inspection.eventEmitter.listenerMethods.prependListener ? '✓' : '✗'}\n`
        summary += `  - Active events: ${inspection.eventEmitter.totalEvents || 0}\n`
      }
      
      summary += `• Store: ${sock._sessionStore ? '✓ YES' : '✗ NO'}\n`
      summary += `• getMessage: ${sock.getMessage ? '✓ YES' : '✗ NO'}\n\n`
      summary += `📁 *JSON Report saved to:*\n\`${path.basename(jsonFile)}\`\n\n`
      summary += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      
      await sock.sendMessage(
        m.chat,
        { text: summary },
        { quoted: m }
      )
      
      // Console log
      console.log("\n" + "=".repeat(50))
      console.log("SOCK INSPECTION COMPLETE (JSON)")
      console.log("=".repeat(50))
      console.log(`File: ${jsonFile}`)
      console.log(`Properties: ${inspection.statistics.totalProperties}`)
      console.log(`Methods: ${inspection.statistics.totalMethods}`)
      console.log(`ev.on: ${inspection.eventEmitter.listenerMethods.on}`)
      console.log(`ev.prependListener: ${inspection.eventEmitter.listenerMethods.prependListener}`)
      console.log(`Active events: ${inspection.eventEmitter.totalEvents || 0}`)
      console.log("=".repeat(50) + "\n")
      
      return { success: true, file: jsonFile, data: inspection }
      
    } catch (error) {
      console.error("[InspectSock] Error:", error)
      await sock.sendMessage(
        m.chat,
        { text: `❌ Error inspecting sock.\n\n${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` },
        { quoted: m }
      )
      return { success: false, error: error.message }
    }
  }
}