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
      if (args.length === 0) {
        await sock.sendMessage(m.chat, { text: "❌ Please provide a phone number.\n\n*Usage:* `.checkban <phone>`\n\n*Examples:*\n• `.checkban 2347067023422`\n• `.checkban 234 70 670 3422`\n• `.checkban +2347067023422`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      const phoneInput = args.join('').trim()
      const cleanPhone = this.cleanPhoneNumber(phoneInput)

      if (!cleanPhone || !/^\d{10,15}$/.test(cleanPhone)) {
        await sock.sendMessage(m.chat, { text: `❌ Invalid phone number format.\n\nProvided: ${phoneInput}\nCleaned: ${cleanPhone || 'invalid'}\n\nPlease provide a valid phone number with 10-15 digits.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }, { quoted: m })
        return
      }

      await sock.sendMessage(m.chat, { text: `🔍 Checking ban status for: +${cleanPhone}\n\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }, { quoted: m })

      let status
      try {
        const results = await sock.onWhatsApp(cleanPhone)
        logger.debug("[CheckBan] onWhatsApp response:", results)
        
        if (!results || results.length === 0) {
          await sock.sendMessage(m.chat, { text: `⚠️ *Account Not Found*\n\n📱 Phone: +${cleanPhone}\n\nThis number is not registered on WhatsApp.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }, { quoted: m })
          return
        }

        status = results[0]
      } catch (error) {
        logger.error("[CheckBan] Error checking status:", error)
        await sock.sendMessage(m.chat, { text: `⚠️ *Error Checking Status*\n\n*Error:* ${error.message}\n\nUnable to verify account status. The number may be invalid or the service is temporarily unavailable.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }, { quoted: m })
        return
      }

      let response = `📊 *Account Status Report*\n\n📱 Phone: +${cleanPhone}\n\n`
      
      if (status.exists === true) {
        response += `✅ *Status: ACTIVE*\n\n✓ This WhatsApp account is registered and active.\n✓ The account can send and receive messages.`
      } else if (status.exists === false) {
        response += `⚠️ *Status: NOT REGISTERED*\n\nThis number is not registered on WhatsApp.`
      } else {
        response += `⚠️ *Status: UNKNOWN*\n\nCould not determine account status.\nResponse: ${JSON.stringify(status, null, 2)}`
      }

      response += '\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙'
      await sock.sendMessage(m.chat, { text: response }, { quoted: m })

    } catch (error) {
      logger.error("[CheckBan] Unexpected error:", error)
      await sock.sendMessage(m.chat, { text: `❌ *Unexpected Error*\n\nError: ${error.message || 'Unknown error'}\n\nPlease try again later.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }, { quoted: m })
    }
  },

  cleanPhoneNumber(phone) {
    if (!phone) return null
    const cleaned = phone.replace(/\D/g, '')
    return cleaned || null
  }
}