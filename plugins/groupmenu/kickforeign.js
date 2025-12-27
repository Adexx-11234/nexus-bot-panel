import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("REMOVE-FOREIGN")

export default {
  name: "Remove Foreign",
  description: "Remove members from specific country codes",
  commands: ["remove", "removeforeign", "kickforeign"],
  category: "groupmenu",
  permissions: {
    adminRequired: true,      // User must be group admin (only applies in groups)
    botAdminRequired: true,   // Bot must be group admin (only applies in groups)
    groupOnly: true,          // Can only be used in groups
  },
  usage:
    "• `.remove <country_code>` - Remove all members with that country code\n" +
    "• `.remove 91` - Remove all Indian numbers (+91)\n" +
    "• `.remove 234` - Remove all Nigerian numbers (+234)\n" +
    "• `.remove 1` - Remove all US/Canada numbers (+1)\n\n" +
    "*Example:* `.remove 91` will kick all members starting with +91",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat

    // Check if country code was provided
    if (!args[0]) {
      return {
        response:
          "❌ *Please provide a country code!*\n\n" +
          "*Usage:* `.remove <country_code>`\n\n" +
          "*Examples:*\n" +
          "• `.remove 91` - Remove Indian numbers\n" +
          "• `.remove 234` - Remove Nigerian numbers\n" +
          "• `.remove 1` - Remove US/Canada numbers\n" +
          "• `.remove 44` - Remove UK numbers"
      }
    }

    const countryCode = args[0].replace(/\+/g, "") // Remove + if provided

    // Validate country code (should be numbers only)
    if (!/^\d+$/.test(countryCode)) {
      return {
        response:
          "❌ *Invalid country code!*\n\n" +
          "Country code should only contain numbers.\n" +
          "*Example:* `.remove 91` (not `.remove +91`)"
      }
    }

    try {
      return await this.processRemoveForeign(sock, m, groupJid, countryCode)
    } catch (error) {
      logger.error("Error in remove foreign command:", error)
      return { response: "❌ Error processing remove foreign command" }
    }
  },

  async processRemoveForeign(sock, m, groupJid, countryCode) {
    try {
      // Get group metadata
      const metadata = await sock.groupMetadata(groupJid)
      
      if (!metadata || !metadata.participants) {
        return { response: "❌ Failed to get group members!" }
      }

      // Get bot's JID
      const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net'

      // Filter members by country code
      const foreignMembers = metadata.participants.filter(participant => {
        const jid = participant.jid || participant.id
        
        // Skip if no JID
        if (!jid) return false
        
        // Extract phone number from JID
        const phoneNumber = jid.split('@')[0].replace(/:/g, '')
        
        // Skip bot itself
        if (jid === botJid) return false
        
        // Skip admins and superadmins (safety measure)
        if (participant.admin === 'admin' || participant.admin === 'superadmin') {
          return false
        }
        
        // Check if phone number starts with country code
        return phoneNumber.startsWith(countryCode)
      })

      // Check if any members found
      if (foreignMembers.length === 0) {
        return {
          response:
            `✅ *No members found with country code +${countryCode}*\n\n` +
            `No action needed.`
        }
      }

      // Extract JIDs for removal
      const jidsToRemove = foreignMembers.map(p => p.id || p.jid)

      logger.info(`[Remove-Foreign] Found ${jidsToRemove.length} members with country code ${countryCode} in ${groupJid}`)

      // Send initial processing message
      await sock.sendMessage(groupJid, {
        text:
          `⏳ *Processing Removal...*\n\n` +
          `Country Code: +${countryCode}\n` +
          `Members Found: ${jidsToRemove.length}\n` +
          `Please wait...\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      // Initialize counters
      let removedCount = 0
      let failedCount = 0
      const removedUsers = []
      const failedUsers = []

      // Process removals in batches of 5 to avoid rate limits
      const batchSize = 2
      for (let i = 0; i < jidsToRemove.length; i += batchSize) {
        const batch = jidsToRemove.slice(i, i + batchSize)
        
        for (const jid of batch) {
          try {
            await sock.groupParticipantsUpdate(groupJid, [jid], "remove")
            removedCount++
            removedUsers.push(jid)
            logger.info(`[Remove-Foreign] Removed: ${jid}`)
          } catch (error) {
            failedCount++
            failedUsers.push(jid)
            logger.error(`[Remove-Foreign] Failed to remove ${jid}:`, error.message)
          }
        }
        
        // Add delay between batches to prevent rate limiting
        if (i + batchSize < jidsToRemove.length) {
          await new Promise(resolve => setTimeout(resolve, 800))
        }
      }

      // Wait for operations to complete
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Prepare result message
      let resultText = `🎯 *Foreign Number Removal Complete!*\n\n`
      resultText += `📊 *Results:*\n`
      resultText += `Country Code: +${countryCode}\n`
      resultText += `✅ Removed: ${removedCount}\n`
      resultText += `❌ Failed: ${failedCount}\n`
      resultText += `📝 Total: ${jidsToRemove.length}\n\n`

      // Add removed users list (limited to prevent long messages)
      if (removedUsers.length > 0) {
        resultText += `✅ *Successfully Removed:*\n`
        const displayLimit = 200 // Show max 20 numbers
        const displayUsers = removedUsers.slice(0, displayLimit)
        
        displayUsers.forEach((jid, index) => {
          const phoneNumber = jid.split('@')[0].replace(/:/g, '')
          resultText += `${index + 1}. +${phoneNumber}\n`
        })
        
        if (removedUsers.length > displayLimit) {
          resultText += `... and ${removedUsers.length - displayLimit} more\n`
        }
        resultText += '\n'
      }

      // Add failed users list (limited)
      if (failedUsers.length > 0) {
        resultText += `❌ *Failed Removals:*\n`
        const displayLimit = 10
        const displayUsers = failedUsers.slice(0, displayLimit)
        
        displayUsers.forEach((jid, index) => {
          const phoneNumber = jid.split('@')[0].replace(/:/g, '')
          resultText += `${index + 1}. +${phoneNumber}\n`
        })
        
        if (failedUsers.length > displayLimit) {
          resultText += `... and ${failedUsers.length - displayLimit} more\n`
        }
        resultText += '\n'
      }

      // Add helpful note if there were failures
      if (failedCount > 0) {
        resultText += `💡 *Note:* Failed removals may be due to:\n`
        resultText += `• User already left the group\n`
        resultText += `• User is a group admin\n`
        resultText += `• Network/API issues\n\n`
      }

      resultText += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      // Send results as a new message
      await sock.sendMessage(groupJid, {
        text: resultText
      }, { quoted: m })

      // Return success response
      return {
        response: null, // We already sent the message above
        success: true,
        removedCount,
        failedCount
      }

    } catch (error) {
      logger.error("[Remove-Foreign] Error processing removals:", error)
      return {
        response:
          `❌ *Error removing foreign numbers*\n\n` +
          `*Error:* ${error.message}\n\n` +
          `*Solution:* Please try again in a few minutes.`
      }
    }
  },

  // Helper method to get country name from code (optional)
  getCountryName(countryCode) {
    const countries = {
      "1": "USA/Canada",
      "44": "United Kingdom",
      "91": "India",
      "92": "Pakistan",
      "234": "Nigeria",
      "254": "Kenya",
      "27": "South Africa",
      "880": "Bangladesh",
      "86": "China",
      "62": "Indonesia",
      "55": "Brazil",
      "52": "Mexico",
      "49": "Germany",
      "33": "France",
      "39": "Italy",
      "34": "Spain",
      "81": "Japan",
      "82": "South Korea",
      "61": "Australia",
      "64": "New Zealand"
    }
    
    return countries[countryCode] || `Country Code +${countryCode}`
  }
}