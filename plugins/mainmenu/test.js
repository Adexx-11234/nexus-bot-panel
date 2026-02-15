export default {
  name: "test",
  commands: ["test"],
  category: "general",
  description: "Test message editing with sendMessage",
  usage: ".test",
  adminOnly: false,
  
  async execute(sock, sessionId, args, m) {
    try {
      // Send initial message using sendMessage
      console.log("=== TEST START (using sendMessage with 3 second delays) ===")
      let statusMsg = await sock.sendMessage(m.chat, { 
        text: `🔄 Test Edit 1/6\n\n> Testing sendMessage editing...\n> Timestamp: ${new Date().toLocaleTimeString()}`
      }, { quoted: m })
      
      console.log("1. Initial message sent at:", new Date().toLocaleTimeString())
      console.log("   Key:", JSON.stringify(statusMsg.key, null, 2))

      // Edit 2 - 3 second delay
      await new Promise(resolve => setTimeout(resolve, 3000))
      console.log("2. Attempting edit 2 at:", new Date().toLocaleTimeString())
      await sock.sendMessage(m.chat, {
        text: `🔄 Test Edit 2/6\n\n> Still testing...\n> Timestamp: ${new Date().toLocaleTimeString()}`,
        edit: statusMsg.key
      })

      // Edit 3 - 3 second delay
      await new Promise(resolve => setTimeout(resolve, 3000))
      console.log("3. Attempting edit 3 at:", new Date().toLocaleTimeString())
      await sock.sendMessage(m.chat, {
        text: `🔄 Test Edit 3/6\n\n> Halfway there...\n> Timestamp: ${new Date().toLocaleTimeString()}`,
        edit: statusMsg.key
      })

      // Edit 4 - 3 second delay
      await new Promise(resolve => setTimeout(resolve, 3000))
      console.log("4. Attempting edit 4 at:", new Date().toLocaleTimeString())
      await sock.sendMessage(m.chat, {
        text: `🔄 Test Edit 4/6\n\n> Getting close...\n> Timestamp: ${new Date().toLocaleTimeString()}`,
        edit: statusMsg.key
      })

      // Edit 5 - 3 second delay
      await new Promise(resolve => setTimeout(resolve, 3000))
      console.log("5. Attempting edit 5 at:", new Date().toLocaleTimeString())
      await sock.sendMessage(m.chat, {
        text: `🔄 Test Edit 5/6\n\n> Almost done...\n> Timestamp: ${new Date().toLocaleTimeString()}`,
        edit: statusMsg.key
      })

      // Edit 6 (Final) - 3 second delay
      await new Promise(resolve => setTimeout(resolve, 3000))
      console.log("6. Attempting edit 6 at:", new Date().toLocaleTimeString())
      await sock.sendMessage(m.chat, {
        text: `✅ Test Edit 6/6\n\n> sendMessage test completed!\n> Timestamp: ${new Date().toLocaleTimeString()}`,
        edit: statusMsg.key
      })
      
      console.log("=== TEST END ===")
      return { success: true }
    } catch (error) {
      console.error("[Test] Error:", error)
      console.error("[Test] Error stack:", error.stack)
      await sock.sendMessage(m.chat, { 
        text: `❌ Test failed: ${error.message}` 
      }, { quoted: m })
      return { success: false }
    }
  }
}