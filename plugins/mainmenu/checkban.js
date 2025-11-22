import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger('CHECK_BAN')

export default {
  name: "Check Ban Status",
  description: "Check if a WhatsApp account is banned",
  commands: ["checkban", "isbanned"],
  category: "mainmenu",
  usage: "• `.checkban <phone>` - Check if account is banned",

  async execute(sock, sessionId, args, m) {
    try {
      // Check if phone number provided
      if (args.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Please provide a phone number.\n\n" +
                "*Usage:* `.checkban <phone>`\n\n" +
                "*Examples:*\n" +
                "• `.checkban 2347067023422`\n" +
                "• `.checkban 234 70 670 3422`\n" +
                "• `.checkban +2347067023422`" + `

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return
      }

      // Extract and clean phone number
      const phoneInput = args.join('').trim()
      const cleanPhone = this.cleanPhoneNumber(phoneInput)

      // Validate phone number
      if (!cleanPhone || !/^\d{10,15}$/.test(cleanPhone)) {
        await sock.sendMessage(m.chat, { 
          text: `❌ Invalid phone number format.\n\n` +
                `Provided: ${phoneInput}\n` +
                `Cleaned: ${cleanPhone || 'invalid'}\n\n` +
                `Please provide a valid phone number with 10-15 digits.

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return
      }

      // Send checking message
      await sock.sendMessage(m.chat, { 
        text: `🔍 Checking ban status for: +${cleanPhone}\n\nPlease wait...

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      // Send checking message
      await sock.sendMessage(m.chat, { 
        text: `🔍 Checking ban status for: +${cleanPhone}\n\nPlease wait...

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      // Check account status - use checkStatusWA (capital WA)
      let status
      try {
        status = await sock.checkStatusWA(cleanPhone)
        
        logger.debug("[CheckBan] Status response:", status)
        
      } catch (error) {
        logger.error("[CheckBan] Error checking status:", error)
        await sock.sendMessage(m.chat, { 
          text: `⚠️ *Error Checking Status*\n\n` +
                `*Error:* ${error.message}\n\n` +
                `Unable to verify account status. The number may be invalid or the service is temporarily unavailable.

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return
      }

      // Build response message based on API response
      let response = `📊 *Account Status Report*\n\n`
      response += `📱 Phone: +${cleanPhone}\n\n`
      
      // Check the ban status from response
      if (status.ban === true || status.ban === "true") {
        response += `🚫 *Status: BANNED*\n\n`
        response += `❌ This WhatsApp account has been banned.\n`
        response += `The account cannot send or receive messages.`
      } else if (status.ban === false || status.ban === "false") {
        response += `✅ *Status: ACTIVE*\n\n`
        response += `✓ This WhatsApp account is active and not banned.\n`
        response += `✓ The account can send and receive messages.`
        
        // Add additional info if available
        if (status.status || status.bio) {
          response += `\n\n📝 *About:* ${status.status || status.bio}`
        }
        
        if (status.setAt) {
          const date = new Date(status.setAt * 1000)
          response += `\n🕐 *Updated:* ${date.toLocaleString()}`
        }
      } else if (!status.exists || status.exists === false) {
        response += `⚠️ *Status: NOT FOUND*\n\n`
        response += `This number is not registered on WhatsApp or doesn't exist.`
      } else {
        response += `⚠️ *Status: UNKNOWN*\n\n`
        response += `Could not determine ban status.\n`
        response += `Response: ${JSON.stringify(status, null, 2)}`
      }

      await sock.sendMessage(m.chat, { text: response }, { quoted: m })

    } catch (error) {
      logger.error("[CheckBan] Unexpected error:", error)
      
      await sock.sendMessage(m.chat, { 
        text: `❌ *Unexpected Error*\n\n` +
              `Error: ${error.message || 'Unknown error'}\n\n` +
              `Please try again later.

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })
    }
  },

  /**
   * Clean phone number - remove all non-digit characters
   */
  cleanPhoneNumber(phone) {
    if (!phone) return null
    
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '')
    
    // If it's empty after cleaning, return null
    if (!cleaned) return null
    
    return cleaned
  }
}