// plugins/tools/removebg.js

import tools from '../../lib/tools/index.js';
import { downloadMedia } from '../../lib/downloaders/index.js';
import fs from 'fs';

export default {
  name: "removebg",
  commands: ["removebg", "nobg", "rembg", "bgremove"],
  description: "Remove background from images",
  category: "toolmenu",
  usage: "• .removebg <image_url> - Remove background from image\n• .nobg <reply to image> - Remove background from replied image",
  
  async execute(sock, sessionId, args, m) {
    try {
      let imageUrl = null;

      // Check if replying to an image
      if (m.quoted && m.quoted.message) {
        const quotedMsg = m.quoted.message;
        if (quotedMsg.imageMessage) {
          await sock.sendMessage(m.chat, {
            text: "⏳ Processing quoted image...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m });
          
          return await sock.sendMessage(m.chat, {
            text: "❌ Please provide an image URL directly!\n\n*Usage:*\n.removebg <image_url>\n\n*Example:*\n.removebg https://example.com/image.jpg\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m });
        }
      }

      // Check if URL provided in args
      if (args[0]) {
        imageUrl = args[0];
      }

      // Validate input
      if (!imageUrl) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an image URL or reply to an image!\n\n*Usage:*\n.removebg <image_url>\n\n*Example:*\n.removebg https://example.com/image.jpg\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Removing background from image...\nThis may take a moment...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call remove background tool
      const result = await tools.removebg(imageUrl);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Background Removal Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Download the processed image
      const mediaFile = await downloadMedia(result.data.url);

      try {
        // Read file
        const fileBuffer = fs.readFileSync(mediaFile.filePath);

        // Build caption
        let caption = `✅ *Background Removed Successfully!*\n\n`;
        caption += `📐 *Dimensions:* ${result.data.width}x${result.data.height}\n`;
        caption += `🆔 *File ID:* ${result.data.fileId}\n`;
        caption += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Background Remover`;

        // Send the image without background
        await sock.sendMessage(m.chat, {
          image: fileBuffer,
          caption: caption
        }, { quoted: m });

        console.log("[RemoveBG] Background removed and sent successfully!");
        
        // Cleanup temp file
        mediaFile.cleanup();
        
      } catch (sendError) {
        console.error("[RemoveBG] Send error:", sendError);
        mediaFile.cleanup();
        throw sendError;
      }

    } catch (error) {
      console.error("[RemoveBG Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};