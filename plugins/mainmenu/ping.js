import os from 'os'
import fs from 'fs'

/**
 * Simple Status Plugin
 * Display basic bot information with accurate container stats
 */
export default {
  name: "status",
  commands: ["status", "ping", "botinfo", "alive"],
  description: "Display basic bot status",
  adminOnly: false,
  category: "both",
  
  async execute(sock, sessionId, args, m) {
    try {
      const startTime = Date.now()
      
      // Get container memory stats (for Docker/Pterodactyl)
      const memStats = await this.getContainerMemory()
      
      // Get process memory (Node.js heap)
      const processMemMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
      
      // Calculate response time
      const responseTime = Date.now() - startTime
      
      // Get uptime
      const uptime = this.formatUptime(process.uptime())
      
      // Get CPU info
      const cpuCount = os.cpus().length
      
      const statusText =
        `✨ *Bot Status*\n\n` +
        `⚡ Response: ${responseTime}ms\n` +
        `⏱️ Uptime: ${uptime}\n` +
        `💾 RAM: ${memStats.used} / ${memStats.limit}\n` +
        `📊 Process: ${processMemMB}MB\n` +
        `🖥️ CPU: ${cpuCount} cores\n` +
        `🤖 Version: v2.0\n\n` +
        `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      
      await sock.sendMessage(
        m.chat, 
        { text: statusText },
        { quoted: m }
      )
      
      return { success: true }
      
    } catch (error) {
      console.error("[Status] Error:", error)
      await sock.sendMessage(
        m.chat, 
        { text: "❌ Error getting status.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" },
        { quoted: m }
      )
      return { success: false, error: error.message }
    }
  },
  
  async getContainerMemory() {
    try {
      // Try cgroup v2 first (newer Docker/Pterodactyl)
      if (fs.existsSync('/sys/fs/cgroup/memory.current')) {
        try {
          const used = parseInt(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8'))
          const limit = parseInt(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8'))
          
          return {
            used: (used / 1024 / 1024 / 1024).toFixed(2) + 'GB',
            limit: limit === 9223372036854771712 ? 'unlimited' : (limit / 1024 / 1024 / 1024).toFixed(2) + 'GB'
          }
        } catch (err) {
          console.log('[Status] cgroup v2 read failed, trying v1...')
        }
      }
      
      // Try cgroup v1 (older systems)
      if (fs.existsSync('/sys/fs/cgroup/memory/memory.usage_in_bytes')) {
        try {
          const used = parseInt(fs.readFileSync('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf8'))
          const limit = parseInt(fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8'))
          
          return {
            used: (used / 1024 / 1024 / 1024).toFixed(2) + 'GB',
            limit: limit > 9000000000000000 ? 'unlimited' : (limit / 1024 / 1024 / 1024).toFixed(2) + 'GB'
          }
        } catch (err) {
          console.log('[Status] cgroup v1 read failed, using system memory...')
        }
      }
      
      // Fallback to system memory if not in container or cgroup read failed
      console.log('[Status] Using system memory as fallback')
      const totalMem = os.totalmem() / 1024 / 1024 / 1024
      const freeMem = os.freemem() / 1024 / 1024 / 1024
      const usedMem = totalMem - freeMem
      
      return {
        used: usedMem.toFixed(2) + 'GB',
        limit: totalMem.toFixed(2) + 'GB'
      }
    } catch (error) {
      console.error('[Status] All memory read methods failed:', error)
      // Final fallback - use system memory
      const totalMem = os.totalmem() / 1024 / 1024 / 1024
      const freeMem = os.freemem() / 1024 / 1024 / 1024
      const usedMem = totalMem - freeMem
      
      return {
        used: usedMem.toFixed(2) + 'GB',
        limit: totalMem.toFixed(2) + 'GB'
      }
    }
  },
  
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    if (minutes > 0) return `${minutes}m ${secs}s`
    return `${secs}s`
  },
}