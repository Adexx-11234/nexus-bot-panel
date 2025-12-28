import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("PIN")

export default {
  name: "Pin",
  description: "Pin a message in the chat",
  commands: ["pin"],
  category: "mainmenu",
  usage:
    "• `.pin` (reply to message) - Pin the replied message\n" +
    "• Works in both groups and private chats\n" +
    "• In groups, only admins can use this command",
  
  async execute(sock, sessionId, args, m) {
    const chatJid = m.chat
    
    // Normalize JIDs for comparison
    const normalizeJid = (jid) => {
      if (!jid) return ''
      return jid.split('@')[0].split(':')[0] + '@s.whatsapp.net'
    }
    
    try {
      // Check if in a group
      if (m.isGroup) {
        // Check if user is admin or bot owner
        const adminChecker = new AdminChecker()
        const isAdmin = await adminChecker.isGroupAdmin(sock, chatJid, m.sender)
        
        const botJid = normalizeJid(sock.user.id)
        const senderJid = normalizeJid(m.sender)
        const isBotOwner = botJid === senderJid
        
        if (!isAdmin && !isBotOwner) {
          return { 
            response: "❌ Only group admins or bot owner can pin messages!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
          }
        }
        
        // Check if bot is admin (required to pin messages in groups)
        const isBotAdmin = await adminChecker.isGroupAdmin(sock, chatJid, sock.user.id)
        if (!isBotAdmin) {
          return { 
            response: "❌ I need to be a group admin to pin messages!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
          }
        }
      }
      
      // Check if replying to a message
      if (!m.quoted) {
        return { 
          response: "❌ Please reply to a message you want to pin!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }
      }
      
      // Get the message key from quoted message
      // Try different ways to get the key
      let messageKey = m.quoted.key || m.quoted.stanzaId
      
      // If still no key, try to construct it
      if (!messageKey && m.quoted.id) {
        messageKey = {
          remoteJid: chatJid,
          fromMe: m.quoted.fromMe || false,
          id: m.quoted.id,
          participant: m.quoted.participant || m.quoted.sender
        }
      }
      
      if (!messageKey) {
        return { 
          response: "❌ Unable to get message information. Please try again!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }
      }
      
      // Log the key for debugging
      logger.info(`[Pin] Attempting to pin message with key:`, JSON.stringify(messageKey))
      
      // Pin the message - simpler format without time parameter
      await sock.sendMessage(chatJid, {
        pin: messageKey
      })
      
      logger.info(`[Pin] Message pinned in ${chatJid} by ${m.sender}`)
      
      return { 
        response: "✅ Message pinned successfully!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        success: true 
      }
      
    } catch (error) {
      logger.error("[Pin] Error pinning message:", error)
      
      // Handle specific errors
      if (error.message?.includes("not-authorized")) {
        return { 
          response: "❌ I don't have permission to pin messages. Make sure I'm an admin!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }
      }
      
      return { 
        response: `❌ Failed to pin message! Error: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
      }
    }
  }
}