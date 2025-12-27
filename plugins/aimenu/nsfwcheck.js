// plugins/ai/nsfwcheck.js

import aiService from '../../lib/ai/index.js';
import { uploadDeline } from '../../lib/tools/index.js';

export default {
  name: "nsfwcheck",
  commands: ["nsfwcheck", "nsfw", "safe", "checknsfw"],
  description: "Check if an image contains NSFW content",
  category: "ai",
  usage: "• .nsfwcheck - Reply to an image to check\n• Send image with caption: .nsfwcheck",
  permissions: {
    // All false = public command, no restrictions
  },
  async execute(sock, sessionId, args, m) {
    try {
      let imageUrl = null;

      // Check if current message has image (sent with caption)
      if (m.message?.imageMessage) {
        await sock.sendMessage(m.chat, {
          text: "⏳ Processing image...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
        
        try {
          const buffer = await sock.downloadMedia(m);
          imageUrl = await uploadDeline(buffer, 'image.jpg');
        } catch (downloadError) {
          console.error('[NSFW Check] Download error:', downloadError);
          return await sock.sendMessage(m.chat, {
            text: "❌ Failed to download image!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m });
        }
      }

      // Check if replying to an image
      if (!imageUrl && m.quoted?.message?.imageMessage) {
        await sock.sendMessage(m.chat, {
          text: "⏳ Processing quoted image...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
        
        try {
          const buffer = await sock.downloadMedia(m);
          imageUrl = await uploadDeline(buffer, 'image.jpg');
        } catch (downloadError) {
          console.error('[NSFW Check] Download quoted error:', downloadError);
          return await sock.sendMessage(m.chat, {
            text: "❌ Failed to download quoted image!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m });
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

      // Handle error - FIXED: Only check success, not status
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ NSFW Check Failed!\n\n*Error:* ${result.error?.message || 'Unknown error'}\n\n*Tip:* Make sure the image URL is valid and accessible\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Parse result correctly based on API response
      const nsfwResult = result.result;
      const labelName = nsfwResult.labelName || '';
      const confidence = nsfwResult.confidence || 0;
      
      // Check if label contains "Porn" (case-insensitive)
      const isNsfw = labelName.toLowerCase().includes('porn');

      // Format response with emoji indicators
      let response = `🔍 *NSFW Check Result*\n\n`;
      
      if (isNsfw) {
        response += `⚠️ *Status:* ${labelName}\n`;
        response += `🔴 *Safety:* NSFW Content Detected!\n`;
        response += `⛔ *Warning:* This image contains inappropriate content\n`;
      } else {
        response += `✅ *Status:* ${labelName}\n`;
        response += `🟢 *Safety:* Safe Content\n`;
        response += `✔️ *Result:* This image is safe to view\n`;
      }
      
      response += `\n📊 *Confidence:* ${(confidence * 100).toFixed(2)}%\n`;

      // Add confidence indicator
      const confidenceEmoji = confidence > 0.9 ? '🟢 Very High' : 
                             confidence > 0.7 ? '🟡 High' : 
                             confidence > 0.5 ? '🟠 Medium' : '🔴 Low';
      response += `📈 *Accuracy:* ${confidenceEmoji}\n\n`;

      // Add label details
      response += `🏷️ *Label ID:* \`${nsfwResult.labelId}\`\n`;
      response += `👤 *Creator:* ${result.creator || 'Unknown'}\n`;
      response += `⏰ *Checked:* ${new Date().toLocaleString()}\n\n`;
      
      response += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

      // Send response
      await sock.sendMessage(m.chat, {
        text: response
      }, { quoted: m });

      console.log("[NSFW Check] Image checked successfully!");

      return { success: true };
      
    } catch (error) {
      console.error("[NSFW Check Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};