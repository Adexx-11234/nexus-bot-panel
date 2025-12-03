/**
 * Simple Status Plugin
 * Display basic bot information
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
      const responseTime = Date.now() - startTime
      const uptime = this.formatUptime(process.uptime())
      const memUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
      
      const statusText =
        `✨ *Bot Status*\n\n` +
        `⚡ Speed: ${responseTime}ms\n` +
        `⏱️ Uptime: ${uptime}\n` +
        `💾 Memory: ${memUsed}MB\n` +
        `🤖 Version: v2.0\n\n` +
        `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      
      // Send directly without "calculating" message
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
  
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  },
}