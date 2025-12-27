// plugins/tools/spamngl.js

import tools from '../../lib/tools/index.js';

export default {
  name: "spamngl",
  commands: ["spamngl", "nglspam", "nglbomb"],
  description: "Spam NGL links with messages (use responsibly!)",
  category: "toolmenu",
  permissions: {

},
  usage: "• .spamngl <ngl_link> <message> - Spam NGL link",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0] || !args[1]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide NGL link and message!\n\n*Usage:*\n.spamngl <ngl_link> <message>\n\n*Example:*\n.spamngl https://ngl.link/username Hello!\n\n⚠️ *Warning:* Use responsibly!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const nglLink = args[0];
      const message = args.slice(1).join(' ');

      // Validate NGL link
      if (!nglLink.includes('ngl.link')) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Invalid NGL link!\n\nPlease provide a valid NGL link.\n\n*Example:*\nhttps://ngl.link/username\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `⏳ Spamming NGL link...\n📨 Message: "${message}"\n\n⚠️ This may take a moment...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call spam NGL tool
      const result = await tools.spamngl(nglLink, message);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ NGL Spam Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Build response message
      let responseMsg = `✅ *NGL SPAM COMPLETED*\n\n`;
      responseMsg += `👤 *Target:* ${result.data.username}\n`;
      responseMsg += `📨 *Message:* ${result.data.message}\n`;
      responseMsg += `🔄 *Total Attempts:* ${result.data.totalAttempts}\n`;
      responseMsg += `✅ *Successful:* ${result.data.successCount}\n`;
      responseMsg += `❌ *Failed:* ${result.data.failedCount}\n`;
      responseMsg += `\n⚠️ *Use this tool responsibly!*\n`;
      responseMsg += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - NGL Spammer`;

      // Send result
      await sock.sendMessage(m.chat, {
        text: responseMsg
      }, { quoted: m });

      console.log("[SpamNGL] Spam completed successfully!");

    } catch (error) {
      console.error("[SpamNGL Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};