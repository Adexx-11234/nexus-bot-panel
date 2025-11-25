export default {
  name: "Block",
  description: "Block a user from contacting the bot",
  commands: ["block", "blokir", "blockuser"],
  category: "ownermenu",
  ownerOnly: true,
  usage: "• `.block` - Block current chat\n• `.block <number>` - Block specific number\n• Reply to user and type `.block`",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if user is owner - FIX: use m.isCreator instead of m.isOwner
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
        // Clean the number (remove +, -, (), spaces)
        const cleanNumber = args.join('').replace(/[^\d]/g, '');
        if (cleanNumber.length < 10) {
          return await sock.sendMessage(m.chat, {
            text: `❌ Invalid phone number!\n\n*Usage:*\n.block <phone_number>\n\n*Example:*\n.block 2348012345678\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m });
        }
        targetJid = cleanNumber + '@s.whatsapp.net';
        targetNumber = cleanNumber;
      }
      // Priority 3: Block current chat (only in private chat)
      else if (!m.isGroup) {
        targetJid = m.chat;
        targetNumber = m.chat.split('@')[0];
      }
      // No valid target
      else {
        return await sock.sendMessage(m.chat, {
          text: `❌ Please specify who to block!\n\n*Methods:*\n1️⃣ Reply to their message and type .block\n2️⃣ Type .block <phone_number>\n3️⃣ Use .block in private chat with them\n\n*Example:*\n.block 2348012345678\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Prevent blocking yourself
      if (targetJid === m.sender) {
        return await sock.sendMessage(m.chat, {
          text: `❌ You cannot block yourself!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Block the user
      await sock.updateBlockStatus(targetJid, 'block');

      // Send success message
      await sock.sendMessage(m.chat, {
        text: `✅ *User Blocked Successfully!*\n\n📞 *Number:* @${targetNumber}\n🚫 *Status:* Blocked\n\nThis user can no longer contact the bot.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        mentions: [targetJid]
      }, { quoted: m });

      console.log(`[Block] Owner ${m.sender} blocked ${targetJid}`);

    } catch (error) {
      console.error("[Block] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ Failed to block user!\n\n*Error:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};