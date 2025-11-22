/**
 * Inspect Socket Plugin
 * Display available methods and properties in sock object
 */
export default {
  name: "inspectsock",
  commands: ["inspectsock", "sockinfo", "debugsock"],
  description: "Inspect sock object methods and properties",
  adminOnly: true,
  category: "owner",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Get all properties and methods
      const sockKeys = Object.keys(sock)
      const sockMethods = sockKeys.filter(key => typeof sock[key] === 'function')
      const sockProperties = sockKeys.filter(key => typeof sock[key] !== 'function')
      
      let report = `🔍 *Sock Object Inspection*\n\n`
      
      // List all methods
      report += `📋 *Available Methods (${sockMethods.length}):*\n`
      sockMethods.slice(0, 30).forEach(method => {
        report += `• ${method}\n`
      })
      
      if (sockMethods.length > 30) {
        report += `\n... and ${sockMethods.length - 30} more methods\n`
      }
      
      report += `\n📦 *Properties (${sockProperties.length}):*\n`
      sockProperties.slice(0, 20).forEach(prop => {
        const type = typeof sock[prop]
        report += `• ${prop}: ${type}\n`
      })
      
      if (sockProperties.length > 20) {
        report += `\n... and ${sockProperties.length - 20} more properties\n`
      }
      
      report += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      
      await sock.sendMessage(
        m.chat,
        { text: report },
        { quoted: m }
      )
      
      // Also log to console for full details
      console.log("\n=== FULL SOCK INSPECTION ===")
      console.log("Methods:", sockMethods)
      console.log("\nProperties:", sockProperties)
      console.log("\nSock prototype:", Object.getPrototypeOf(sock))
      
      // Check for specific message-related methods
      const messageRelated = sockKeys.filter(key => 
        key.toLowerCase().includes('message') || 
        key.toLowerCase().includes('chat') ||
        key.toLowerCase().includes('group')
      )
      
      console.log("\nMessage/Chat/Group related methods:", messageRelated)
      
      return { success: true }
      
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