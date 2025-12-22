// plugins/download/pinterest.js

import downloader, { downloadMedia } from '../../lib/downloaders/index.js';
import fs from 'fs';

export default {
  name: "pinterest",
  commands: ["pinterest", "pin", "pindl"],
  description: "Download Pinterest images and videos",
  category: "download",
  usage: "• .pinterest <url> - Download Pinterest content\n• .pin <url> - Short command",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a Pinterest URL!\n\n*Usage:*\n.pinterest <pinterest_url>\n\n*Example:*\n.pin https://pin.it/xxxxx\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading Pinterest content...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.pinterest(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send directly (uiType: 'direct')
      return await sendPinterestDirect(sock, m, result);

    } catch (error) {
      console.error("[Pinterest Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Send Pinterest content directly - UPDATED WITH FILE SYSTEM
 */
async function sendPinterestDirect(sock, m, result) {
  try {
    const { data } = result;
    const download = data.downloads[0];

    // Download to file
    const mediaFile = await downloadMedia(download.url);

    try {
      // Read file
      const fileBuffer = fs.readFileSync(mediaFile.filePath);

      // Build caption
      let caption = `📌 *Pinterest Download*\n\n`;
      if (data.title) {
        caption += `📝 *Title:* ${data.title}\n`;
      }
      caption += `👤 *By:* ${data.author.name}\n`;
      caption += `\n✅ Downloaded successfully!\n`;
      caption += `\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Pinterest Downloader`;

      // Send based on type
      if (download.type === 'video') {
        await sock.sendMessage(m.chat, {
          video: fileBuffer,
          caption: caption,
          mimetype: 'video/mp4'
        }, { quoted: m });
      } else {
        await sock.sendMessage(m.chat, {
          image: fileBuffer,
          caption: caption
        }, { quoted: m });
      }

      console.log("[Pinterest] Content sent successfully!");
      
      // Cleanup temp file
      mediaFile.cleanup();
      
    } catch (sendError) {
      console.error("[Pinterest Direct] Send error:", sendError);
      mediaFile.cleanup(); // Still cleanup on error
      throw sendError;
    }

    return { success: true };

  } catch (error) {
    console.error("[Pinterest Direct] Error:", error);
    throw error;
  }
}