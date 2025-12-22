import tools from '../../lib/tools/index.js';
import { uploadDeline } from '../../lib/tools/index.js';

export default {
  name: "imagetohd",
  commands: ["hd", "imagehd", "tohd", "enhancehd"],
  description: "Enhance image quality to HD",
  category: "toolmenu",
  usage: "• .hd <image_url> - Enhance image to HD\n• .hd <reply to image> - Enhance replied image\n• Send image with caption: .hd",
  
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
          console.error('[ImageToHD] Download error:', downloadError);
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
          console.error('[ImageToHD] Download quoted error:', downloadError);
          return await sock.sendMessage(m.chat, {
            text: "❌ Failed to download quoted image!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m });
        }
      }

      // Check if URL provided in args
      if (!imageUrl && args[0] && args[0].startsWith('http')) {
        imageUrl = args[0];
      }

      // Validate input
      if (!imageUrl) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an image URL or reply to an image!\n\n*Usage:*\n• .hd <image_url>\n• .hd <reply to image>\n• Send image with caption: .hd\n\n*Example:*\n.hd https://example.com/image.jpg\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Enhancing image to HD...\nThis may take a moment...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call HD enhancement tool
      const result = await tools.hd(imageUrl);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Enhancement Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send the HD image directly using the buffer
      await sock.sendMessage(m.chat, {
        image: result.data.buffer,
        caption: `✅ *Image Enhanced to HD*\n\n📸 Your image has been enhanced successfully!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - HD Enhancement`
      }, { quoted: m });

      console.log("[ImageToHD] Image enhanced and sent successfully!");

    } catch (error) {
      console.error("[ImageToHD Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};