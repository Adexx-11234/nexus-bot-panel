// plugins/ai/claude.js

import aiService from '../../lib/ai/index.js';

export default {
  name: "claude",
  commands: ["claude", "anthropic"],
  description: "Chat with Claude AI model",
  category: "ai",
  usage: "• .claude <question> - Ask Claude AI anything\n• .anthropic <question> - Alternative command",
  permissions: {
    // All false = public command, no restrictions
  },
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a question!\n\n*Usage:*\n.claude <your question>\n\n*Example:*\n.claude Write a poem about nature\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const query = args.join(' ');

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `🎭 *Claude AI is thinking...*\n\n_"${query}"_\n\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call AI service
      const result = await aiService.claude(query);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Claude AI Request Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Try .ai or .gpt command instead\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Format response
      let response = `🎭 *Claude AI Response*\n\n`;
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
      console.error("[Claude Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};