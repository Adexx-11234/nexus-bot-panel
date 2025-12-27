/**
 * Channel JID Plugin - FIXED VERSION
 * Get WhatsApp Channel JID from invite links
 * 
 * Commands:
 * - listchannels: Show all channels you're following with their JIDs
 * - channelfromlink <link>: Extract channel JID from invite link
 * - joinchannel <jid_or_link>: Join a channel using JID or invite link
 */

export default {
  name: "channeljid",
  commands: ["listchannels", "channelfromlink", "joinchannel"],
  description: "Get WhatsApp channel JID for your channels",
 permissions: {
},
  category: "mainmenu",

  async execute(sock, sessionId, args, m) {
    try {
      const fullText = m.body || m.text || ""
      const commandMatch = fullText.match(/^[.!#/](\w+)/)
      const command = commandMatch ? commandMatch[1].toLowerCase() : ""

      switch (command) {
        case "listchannels":
          return await this.listChannels(sock, m)
        
        case "channelfromlink":
          return await this.channelFromLink(sock, m, args)
        
        case "joinchannel":
          return await this.joinChannel(sock, m, args)
        
        default:
          return { success: false, error: "Unknown command" }
      }

    } catch (error) {
      console.error("[ChannelJID] Error:", error)
      await sock.sendMessage(m.chat, {
        text: `❌ Error: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  },

  /**
   * Extract channel JID from invite link
   */
  async channelFromLink(sock, m, args) {
    try {
      if (!args || args.length === 0) {
        await sock.sendMessage(m.chat, {
          text: "❌ *Missing Channel Link*\n\n" +
                "*Usage:* .channelfromlink <link>\n\n" +
                "*Example:*\n" +
                ".channelfromlink https://whatsapp.com/channel/0029VaeW5Tw4yltQOYWS5O2s\n\n" +
                "*How to get channel link:*\n" +
                "1. Open channel on WhatsApp\n" +
                "2. Tap channel name → Share\n" +
                "3. Copy link and paste here\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return { success: false, error: "Missing link" }
      }

      const link = args.join(' ').trim()

      // Extract invite code from link
      // Format: https://whatsapp.com/channel/0029VaeW5Tw4yltQOYWS5O2s
      const inviteCodeMatch = link.match(/whatsapp\.com\/channel\/([A-Za-z0-9]+)/)
      
      if (!inviteCodeMatch) {
        await sock.sendMessage(m.chat, {
          text: "❌ *Invalid Channel Link*\n\n" +
                "Please provide a valid WhatsApp channel link.\n\n" +
                "*Format:*\n" +
                "`https://whatsapp.com/channel/XXXXX`\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return { success: false, error: "Invalid link format" }
      }

      const inviteCode = inviteCodeMatch[1]

      // Send loading message
      const loadingMsg = await sock.sendMessage(
        m.chat,
        { text: "⏳ Fetching channel info...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" },
        { quoted: m }
      )

      // Get channel metadata using invite code
      const metadata = await sock.newsletterMetadata("invite", inviteCode)

      if (!metadata) {
        await sock.sendMessage(m.chat, {
          text: "❌ *Channel Not Found*\n\n" +
                "Could not fetch channel information.\n" +
                "Make sure the link is valid and public.\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          edit: loadingMsg.key
        }, { quoted: m })
        return { success: false, error: "Channel not found" }
      }

      // Build success message
      let message = 
        `┌─❖\n` +
        `│ ✅ Channel Found!\n` +
        `└┬❖「 ${metadata.name || 'Unknown'} 」\n` +
        `┌┤\n` +
        `│└────────┈⳹\n`

      message += `│📋 *JID:* \`${metadata.id}\`\n`
      message += `│🔗 *Invite:* ${inviteCode}\n`
      
      if (metadata.description) {
        message += `│📝 *Description:*\n`
        message += `│${metadata.description.substring(0, 100)}${metadata.description.length > 100 ? '...' : ''}\n`
      }
      
      if (metadata.subscribers) {
        message += `│👥 *Subscribers:* ${this.formatNumber(metadata.subscribers)}\n`
      }
      
      if (metadata.verified) {
        message += `│✓ Verified\n`
      }
      
      message += `│└────────┈⳹\n\n`
      message += `💡 *How to use this JID:*\n`
      message += `Copy the JID above and use it in your code:\n`
      message += `\`\`\`javascript\n`
      message += `const CHANNEL_JID = '${metadata.id}'\n`
      message += `await sock.newsletterFollow(CHANNEL_JID)\n`
      message += `\`\`\`\n\n`
      message += `*Quick join:*\n`
      message += `.joinchannel ${metadata.id}\n\n`
      message += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      await sock.sendMessage(m.chat, {
        text: message,
        edit: loadingMsg.key
      }, { quoted: m })

      return { success: true, channelJID: metadata.id }

    } catch (error) {
      console.error("[ChannelFromLink] Error:", error)
      throw error
    }
  },

  /**
   * List all channels the user is following
   */
  async listChannels(sock, m) {
    try {
      const loadingMsg = await sock.sendMessage(
        m.chat,
        { text: "⏳ Fetching your channels...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" },
        { quoted: m }
      )

      // Use newsletterMetadata with "jid" to get subscribed channels
      // This requires getting the JIDs first, which is the issue
      // Better approach: use the store or query
      
      let channels = []
      
      // Try to get from store if available
      if (sock.store && sock.store.newsletters) {
        channels = Object.values(sock.store.newsletters)
      }

      if (channels.length === 0) {
        await sock.sendMessage(m.chat, {
          text: "📢 *No Channels Found*\n\n" +
                "You are not following any WhatsApp channels yet.\n\n" +
                "*How to get channel JID:*\n" +
                "1. Get the channel invite link\n" +
                "2. Use: `.channelfromlink <link>`\n" +
                "3. Copy the JID from the result\n\n" +
                "*Example:*\n" +
                "`.channelfromlink https://whatsapp.com/channel/0029VaeW5Tw4yltQOYWS5O2s`\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
          edit: loadingMsg.key
        }, { quoted: m })
        return { success: true }
      }

      let message = 
        `┌─❖\n` +
        `│ 📢 Your WhatsApp Channels\n` +
        `└┬❖「 ${channels.length} Total 」\n`

      channels.forEach((channel, index) => {
        const name = channel.name || channel.subject || 'Unknown'
        const jid = channel.id || channel.jid || 'Unknown'
        
        message += `┌┤ ${index + 1}. ${name}\n`
        message += `│└────────┈⳹\n`
        message += `│📋 JID: \`${jid}\`\n`
        
        if (channel.description) {
          message += `│📝 ${channel.description.substring(0, 50)}${channel.description.length > 50 ? '...' : ''}\n`
        }
        
        message += `│└────────┈⳹\n\n`
      })

      message += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      await sock.sendMessage(m.chat, {
        text: message,
        edit: loadingMsg.key
      }, { quoted: m })

      return { success: true, channels: channels.length }

    } catch (error) {
      console.error("[ListChannels] Error:", error)
      throw error
    }
  },

  /**
   * Join channel using JID or invite link
   */
  async joinChannel(sock, m, args) {
    try {
      if (!args || args.length === 0) {
        await sock.sendMessage(m.chat, {
          text: "❌ *Missing Channel Info*\n\n" +
                "*Usage:* .joinchannel <jid_or_link>\n\n" +
                "*Examples:*\n" +
                "`.joinchannel 120363190224821113@newsletter`\n" +
                "`.joinchannel https://whatsapp.com/channel/0029VaeW5Tw4yltQOYWS5O2s`\n\n" +
                "💡 Use `.channelfromlink <link>` to get JID first\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return { success: false, error: "Missing info" }
      }

      const input = args.join(' ').trim()
      let channelJID = input

      // Check if it's a link
      if (input.includes('whatsapp.com/channel/')) {
        const inviteCodeMatch = input.match(/whatsapp\.com\/channel\/([A-Za-z0-9]+)/)
        
        if (!inviteCodeMatch) {
          await sock.sendMessage(m.chat, {
            text: "❌ Invalid link format\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m })
          return { success: false, error: "Invalid link" }
        }

        const inviteCode = inviteCodeMatch[1]
        
        // Get metadata to extract JID
        const metadata = await sock.newsletterMetadata("invite", inviteCode)
        if (!metadata || !metadata.id) {
          await sock.sendMessage(m.chat, {
            text: "❌ Could not get channel JID from link\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m })
          return { success: false, error: "Invalid channel" }
        }
        
        channelJID = metadata.id
      }

      // Validate JID format
      if (!channelJID.includes('@newsletter')) {
        await sock.sendMessage(m.chat, {
          text: "❌ *Invalid JID Format*\n\n" +
                "JID must end with @newsletter\n\n" +
                "*Example:* `120363190224821113@newsletter`\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return { success: false, error: "Invalid JID" }
      }

      const loadingMsg = await sock.sendMessage(
        m.chat,
        { text: "⏳ Joining channel...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" },
        { quoted: m }
      )

      // Follow the channel
      await sock.newsletterFollow(channelJID)

      // Get channel name
      let channelName = "Unknown"
      try {
        const metadata = await sock.newsletterMetadata("jid", channelJID.split('@')[0])
        if (metadata && metadata.name) {
          channelName = metadata.name
        }
      } catch (e) {
        // Ignore
      }

      await sock.sendMessage(m.chat, {
        text: "✅ *Successfully Joined Channel!*\n\n" +
              `📢 Channel: ${channelName}\n` +
              `📋 JID: \`${channelJID}\`\n\n` +
              "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        edit: loadingMsg.key
      }, { quoted: m })

      return { success: true, channelJID }

    } catch (error) {
      console.error("[JoinChannel] Error:", error)
      
      if (error.message?.includes('already')) {
        await sock.sendMessage(m.chat, {
          text: "ℹ️ *Already Following*\n\n" +
                "You are already following this channel.\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return { success: false, error: "Already following" }
      }
      
      throw error
    }
  },

  /**
   * Format large numbers
   */
  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M'
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K'
    }
    return num.toString()
  }
}