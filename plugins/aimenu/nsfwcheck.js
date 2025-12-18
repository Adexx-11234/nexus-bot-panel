// plugins/ai/nsfwcheck.js

import aiService from '../../lib/ai/index.js';

export default {
  name: "nsfwcheck",
  commands: ["nsfwcheck", "nsfw", "safe", "checknsfw"],
  description: "Check if an image contains NSFW content",
  category: "ai",
  usage: "• .nsfwcheck - Reply to an image to check\n• Send image with caption: .nsfwcheck",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Get image URL from quoted message or current message
      let imageUrl = null;

      // Check if replying to an image
      if (m.quoted && m.quoted.imageMessage) {
        if (m.quoted.imageMessage.url) {
          imageUrl = m.quoted.imageMessage.url;
        }
      }

      // Check if current message has image
      if (!imageUrl && m.imageMessage) {
        if (m.imageMessage.url) {
          imageUrl = m.imageMessage.url;
        }
      }

      // Check if URL provided in args
      if (!imageUrl && args[0] && args[0].startsWith('http')) {
        imageUrl = args[0];
      }

      if (!imageUrl) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an image!\n\n*Usage:*\n• Reply to an image with .nsfwcheck\n• Send image with caption .nsfwcheck\n• .nsfwcheck <image_url>\n\n*Example:*\n.nsfwcheck https://example.com/image.jpg\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `🔍 *Checking image for NSFW content...*\n\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call AI service
      const result = await aiService.checkNsfw(imageUrl);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ NSFW Check Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Make sure the image URL is valid and accessible\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Parse result
      const nsfwResult = result.result;
      const isNsfw = nsfwResult.isNsfw || false;
      const confidence = nsfwResult.confidence || 0;

      // Format response with emoji indicators
      let response = `🔍 *NSFW Check Result*\n\n`;
      
      if (isNsfw) {
        response += `⚠️ *Status:* NSFW Content Detected\n`;
        response += `🔴 *Safety:* Not Safe\n`;
      } else {
        response += `✅ *Status:* Safe Content\n`;
        response += `🟢 *Safety:* Safe\n`;
      }
      
      response += `📊 *Confidence:* ${(confidence * 100).toFixed(2)}%\n\n`;

      // Add category breakdown if available
      if (nsfwResult.categories) {
        response += `📋 *Categories:*\n`;
        Object.entries(nsfwResult.categories).forEach(([category, score]) => {
          const percentage = (score * 100).toFixed(2);
          const emoji = score > 0.5 ? '🔴' : score > 0.3 ? '🟡' : '🟢';
          response += `${emoji} ${category}: ${percentage}%\n`;
        });
        response += `\n`;
      }

      response += `🤖 *Model:* ${result.model}\n`;
      response += `⏰ ${result.timestamp}\n\n`;
      response += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

      // Send response
      await sock.sendMessage(m.chat, {
        text: response
      }, { quoted: m });

      return { success: true };

    } catch (error) {
      console.error("[NSFW Check Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};