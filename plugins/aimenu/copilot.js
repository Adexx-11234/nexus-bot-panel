// plugins/ai/copilot.js

import aiService from '../../lib/ai/index.js';

export default {
  name: "copilot",
  commands: ["copilot", "bing", "bingai"],
  description: "Chat with Microsoft Copilot AI (with Think Mode)",
  category: "ai",
  usage: "• .copilot <question> - Ask Copilot AI\n• .copilot think <question> - Use Think Mode with sources",
  permissions: {
    // All false = public command, no restrictions
  },
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a question!\n\n*Usage:*\n.copilot <your question>\n.copilot think <question> - Deep research mode\n\n*Example:*\n.copilot What's the latest in AI?\n.copilot think Explain photosynthesis\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      // Check if Think Mode is requested
      const useThink = args[0].toLowerCase() === 'think';
      const query = useThink ? args.slice(1).join(' ') : args.join(' ');

      if (useThink && !query) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a question after 'think'!\n\n*Usage:*\n.copilot think <your question>\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `💡 *Copilot AI ${useThink ? '(Think Mode)' : ''} is analyzing...*\n\n_"${query}"_\n\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call AI service
      const result = await aiService.copilot(query, useThink);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Copilot AI Request Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Try without 'think' mode or use .ai command\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Format response
      let response = `💡 *${result.model} Response*\n\n`;
      response += `${result.response}\n\n`;

      // Add citations if available (Think Mode)
      if (result.citations && result.citations.length > 0) {
        response += `\n📚 *Sources:*\n`;
        result.citations.slice(0, 5).forEach((cite, idx) => {
          response += `${idx + 1}. ${cite.title}\n   ${cite.url}\n`;
        });
        response += `\n`;
      }

      response += `⏰ ${result.timestamp}\n\n`;
      response += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

      // Send response
      await sock.sendMessage(m.chat, {
        text: response
      }, { quoted: m });

      return { success: true };

    } catch (error) {
      console.error("[Copilot Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};