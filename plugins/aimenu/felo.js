// plugins/ai/felo.js

import aiService from '../../lib/ai/index.js';

export default {
  name: "felo",
  commands: ["felo", "research", "search"],
  description: "Research-focused AI with cited sources",
  category: "ai",
  usage: "• .felo <question> - Get researched answers with sources\n• .research <question> - Alternative command",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a research question!\n\n*Usage:*\n.felo <your question>\n\n*Example:*\n.felo What are the latest discoveries about black holes?\n.felo How does climate change affect oceans?\n\n*Note:* Felo AI provides answers with cited sources\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const query = args.join(' ');

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `🔬 *Felo AI is researching...*\n\n_"${query}"_\n\nSearching multiple sources...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call AI service
      const result = await aiService.felo(query);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Felo AI Request Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Try .ai or .copilot command instead\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Format response
      let response = `🔬 *Felo AI Research Result*\n\n`;
      response += `${result.response}\n\n`;

      // Add sources if available
      if (result.sources && result.sources.length > 0) {
        response += `📚 *Sources:*\n`;
        result.sources.slice(0, 5).forEach((source, idx) => {
          if (typeof source === 'string') {
            response += `${idx + 1}. ${source}\n`;
          } else if (source.title && source.url) {
            response += `${idx + 1}. ${source.title}\n   ${source.url}\n`;
          } else if (source.url) {
            response += `${idx + 1}. ${source.url}\n`;
          }
        });
        response += `\n`;
      }

      response += `⏰ ${result.timestamp}\n`;
      response += `🤖 Model: ${result.model}\n\n`;
      response += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

      // Send response
      await sock.sendMessage(m.chat, {
        text: response
      }, { quoted: m });

      return { success: true };

    } catch (error) {
      console.error("[Felo Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};