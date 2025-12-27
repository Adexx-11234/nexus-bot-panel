// plugins/ai/ai.js

import aiService from '../../lib/ai/index.js';

export default {
  name: "ai",
  commands: ["ai", "gemini", "ask"],
  description: "Chat with Gemini AI (main AI assistant)",
  category: "aimenu", // Changed from "ai" to match menu system
  usage: "• .ai <question> - Ask Gemini AI anything\n• .ask <question> - Alternative command",
  
  // ✅ FIXED: Universal access - anyone can use
  permissions: {
    // All false = public command, no restrictions
  },
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a question!\n\n*Usage:*\n.ai <your question>\n\n*Example:*\n.ai What is quantum computing?\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const query = args.join(' ');

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `🤖 *Gemini AI is thinking...*\n\n_"${query}"_\n\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call AI service
      const result = await aiService.gemini(query);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ AI Request Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Try again or use .gpt command\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Format response
      let response = `🤖 *Gemini AI Response*\n\n`;
      response += `${result.response}\n\n`;
      response += `⏰ ${result.timestamp}\n`;
      response += `📡 Source: ${result.source}\n\n`;
      response += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

      // Send response
      await sock.sendMessage(m.chat, {
        text: response
      }, { quoted: m });

      return { success: true };

    } catch (error) {
      console.error("[AI Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};