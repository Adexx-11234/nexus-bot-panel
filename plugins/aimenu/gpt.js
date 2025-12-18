// plugins/ai/gpt.js

import aiService from '../../lib/ai/index.js';

export default {
  name: "gpt",
  commands: ["gpt", "gpt4", "gpt4o", "openai"],
  description: "Chat with GPT-4o AI model",
  category: "ai",
  usage: "• .gpt <question> - Ask GPT-4o anything\n• .gpt4o <question> - Alternative command",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a question!\n\n*Usage:*\n.gpt <your question>\n\n*Example:*\n.gpt Explain blockchain technology\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const query = args.join(' ');

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `🧠 *GPT-4o is processing...*\n\n_"${query}"_\n\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call AI service
      const result = await aiService.gpt4o(query);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ GPT-4o Request Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Try .ai or .claude command instead\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Format response
      let response = `🧠 *GPT-4o Response*\n\n`;
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
      console.error("[GPT Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};