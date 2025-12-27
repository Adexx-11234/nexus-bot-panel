export default {
  name: "Unblock",
  description: "Unblock a user from contacting the bot",
  commands: ["unblock", "unblokir", "unblockuser"],
  category: "ownermenu",
    permissions: {
  ownerOnly: true,          // Only bot owner can use (overrides everything)
  privateOnly: true         // Can only be used in private chats
},
  usage: "• `.unblock` - Unblock current chat\n• `.unblock <number>` - Unblock specific number\n• Reply to user and type `.unblock`",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if user is owner
      if (!m.isCreator) {
        return await sock.sendMessage(m.chat, {
          text: `❌ This command is only for bot owners!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      let targetJid;
      let targetNumber;

      // Priority 1: Check if replying to a message
      if (m.quoted && m.quoted.sender) {
        targetJid = m.quoted.sender;
        targetNumber = targetJid.split('@')[0];
      }
      // Priority 2: Check if number provided in args
      else if (args.length > 0) {
        // Join all args and clean the number (remove +, -, (), spaces)
        const cleanNumber = args.join('').replace(/[^\d]/g, '');
        if (cleanNumber.length < 10) {
          return await sock.sendMessage(m.chat, {
            text: `❌ Invalid phone number!\n\n*Usage:*\n.unblock <phone_number>\n\n*Example:*\n.unblock 2348012345678\n.unblock +234 805 893 1419\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m });
        }
        targetJid = cleanNumber + '@s.whatsapp.net';
        targetNumber = cleanNumber;
      }
      // Priority 3: Unblock current chat (only in private chat)
      else if (!m.isGroup) {
        targetJid = m.chat;
        targetNumber = m.chat.split('@')[0];
      }
      // No valid target
      else {
        return await sock.sendMessage(m.chat, {
          text: `❌ Please specify who to unblock!\n\n*Methods:*\n1️⃣ Reply to their message and type .unblock\n2️⃣ Type .unblock <phone_number>\n3️⃣ Use .unblock in private chat with them\n\n*Example:*\n.unblock 2348012345678\n.unblock +234 805 893 1419\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Prevent unblocking yourself
      if (targetJid === m.sender) {
        return await sock.sendMessage(m.chat, {
          text: `❌ You cannot unblock yourself!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Unblock the user
      await sock.updateBlockStatus(targetJid, 'unblock');

      // Send success message to owner
      await sock.sendMessage(m.chat, {
        text: `✅ *User Unblocked Successfully!*\n\n📞 *Number:* @${targetNumber}\n🔓 *Status:* Unblocked\n\nThis user can now contact the bot again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        mentions: [targetJid]
      }, { quoted: m });
      

    } catch (error) {
      console.error("[Unblock] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ Failed to unblock user!\n\n*Error:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};