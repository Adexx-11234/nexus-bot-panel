// plugins/ai/describe.js

import aiService from '../../lib/ai/index.js';
import { uploadDeline } from '../../lib/tools/index.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

export default {
  name: "describe",
  commands: ["describe", "whatisthis", "analyze", "vision"],
  description: "Analyze and describe images using AI vision",
  category: "ai",
  usage: "• .describe - Reply to an image to get description\n• Send image with caption: .describe\n• .describe <image_url>",
  
  async execute(sock, sessionId, args, m) {
    try {
      let imageUrl = null;

      // Check if current message has image (sent with caption)
      if (m.message && (m.message.imageMessage || m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage)) {
        const imageMsg = m.message.imageMessage;
        if (imageMsg) {
          await sock.sendMessage(m.chat, {
            text: "⏳ Processing image...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m });
          
          try {
            const buffer = await downloadMediaMessage(
              m,
              'buffer',
              {},
              { 
                logger: console,
                reuploadRequest: sock.updateMediaMessage
              }
            );
            
            imageUrl = await uploadDeline(buffer, 'jpg', 'image/jpeg');
          } catch (downloadError) {
            console.error('[Describe] Download error:', downloadError);
            return await sock.sendMessage(m.chat, {
              text: "❌ Failed to download image!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
            }, { quoted: m });
          }
        }
      }

      // Check if replying to an image
      if (!imageUrl && m.quoted && m.quoted.message) {
        const quotedMsg = m.quoted.message;
        if (quotedMsg.imageMessage) {
          await sock.sendMessage(m.chat, {
            text: "⏳ Processing quoted image...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m });
          
          try {
            const buffer = await downloadMediaMessage(
              m.quoted,
              'buffer',
              {},
              { 
                logger: console,
                reuploadRequest: sock.updateMediaMessage
              }
            );
            
            imageUrl = await uploadDeline(buffer, 'jpg', 'image/jpeg');
          } catch (downloadError) {
            console.error('[Describe] Download error:', downloadError);
            return await sock.sendMessage(m.chat, {
              text: "❌ Failed to download image!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
            }, { quoted: m });
          }
        }
      }

      // Check if URL provided in args
      if (!imageUrl && args[0] && args[0].startsWith('http')) {
        imageUrl = args[0];
      }

      if (!imageUrl) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an image!\n\n*Usage:*\n• Reply to an image with .describe\n• Send image with caption .describe\n• .describe <image_url>\n\n*Example:*\n.describe https://example.com/image.jpg\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `👁️ *Analyzing image...*\n\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Extract prompt/description from image
      const result = await aiService.extractPrompt(imageUrl);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Image Analysis Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Make sure the image URL is valid and accessible\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Format response
      let response = `👁️ *Image Analysis Result*\n\n`;
      response += `📝 *Original Description:*\n${result.original}\n\n`;
      
      if (result.translated) {
        response += `🌐 *Translated:*\n${result.translated}\n\n`;
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
      console.error("[Describe Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};