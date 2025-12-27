// plugins/ai/llama.js

import aiService from '../../lib/ai/index.js';

export default {
  name: "llama",
  commands: ["llama", "llama3", "meta"],
  description: "Chat with Llama 3.3-70b AI model",
  category: "ai",
  usage: "• .llama <question> - Ask Llama AI anything\n• .llama3 <question> - Alternative command",
  permissions: {
    // All false = public command, no restrictions
  },
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a question!\n\n*Usage:*\n.llama <your question>\n\n*Example:*\n.llama What is machine learning?\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const query = args.join(' ');

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `🦙 *Llama 3.3-70b is processing...*\n\n_"${query}"_\n\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call AI service
      const result = await aiService.llama(query);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Llama AI Request Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Try .ai or .gpt command instead\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Format response
      let response = `🦙 *Llama 3.3-70b Response*\n\n`;
      response += `${result.response}\n\n`;
      response += `⏰ ${result.timestamp}\n`;
      response += `🤖 Model: ${result.model}\n\n`;
      response += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

      // Send response
      await sock.sendMessage(m.chat, {
        text: response
      }, { quoted: m });

      return { success: true };

    } catch (error) {
      console.error("[Llama Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};