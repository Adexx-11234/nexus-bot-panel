// plugins/tools/removebg.js

import tools from '../../lib/tools/index.js';
import { uploadDeline } from '../../lib/tools/index.js';

export default {
  name: "removebg",
  commands: ["removebg", "nobg", "rembg", "bgremove"],
  description: "Remove background from images",
  category: "toolmenu",
  usage: "• .removebg <image_url> - Remove background from image\n• .removebg - Reply to an image to remove background",
  
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
          console.error('[RemoveBG] Download error:', downloadError);
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
          // ✅ Use sock.downloadMedia which handles quoted messages
          const buffer = await sock.downloadMedia(m);
          imageUrl = await uploadDeline(buffer, 'image.jpg');
        } catch (downloadError) {
          console.error('[RemoveBG] Download quoted error:', downloadError);
          return await sock.sendMessage(m.chat, {
            text: "❌ Failed to download quoted image!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m });
        }
      }

      // Check if URL provided in args
      if (!imageUrl && args[0]) {
        imageUrl = args[0];
      }

      // Validate input
      if (!imageUrl) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an image URL or reply to an image!\n\n*Usage:*\n• Reply to an image with .removebg\n• Send image with caption .removebg\n• .removebg <image_url>\n\n*Example:*\n.removebg https://example.com/image.jpg\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
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
          text: `❌ Background Removal Failed!\n\n*Error:* ${result.error?.message || 'Unknown error'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // ✅ result.data.url returns a buffer, not a URL that needs downloading
      const imageBuffer = result.data.buffer || result.data;

      // Build caption
      let caption = `✅ *Background Removed Successfully!*\n\n`;
      
      if (result.data.width && result.data.height) {
        caption += `📐 *Dimensions:* ${result.data.width}x${result.data.height}\n`;
      }
      
      if (result.data.fileId) {
        caption += `🆔 *File ID:* ${result.data.fileId}\n`;
      }
      
      caption += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Background Remover`;

      // Send the image without background
      await sock.sendMessage(m.chat, {
        image: imageBuffer,
        caption: caption
      }, { quoted: m });

      console.log("[RemoveBG] Background removed and sent successfully!");

    } catch (error) {
      console.error("[RemoveBG Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};