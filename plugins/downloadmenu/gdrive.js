// plugins/download/gdrive.js

import downloader from '../../lib/downloaders/index.js';

export default {
  name: "gdrive",
  commands: ["gdrive", "gd", "googledrive"],
  description: "Download files from Google Drive",
  category: "download",
  usage: "• .gdrive <url> - Download Google Drive file\n• .gd <url> - Short command",
  permissions: {
  // All false = public command, no restrictions
},
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a Google Drive URL!\n\n*Usage:*\n.gdrive <drive_url>\n\n*Example:*\n.gd https://drive.google.com/file/d/xxxxx/view\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Processing Google Drive file...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.gdrive(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send directly (uiType: 'direct')
      return await sendGDriveDirect(sock, m, result);

    } catch (error) {
      console.error("[Google Drive Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Send Google Drive file info and download link (uiType: 'direct')
 * Note: Google Drive files often require authentication, so we provide the link
 */
async function sendGDriveDirect(sock, m, result) {
  try {
    const { data } = result;
    const download = data.downloads[0];

    // Build message
    let message = `💾 *Google Drive Download*\n\n`;
    message += `📄 *Filename:* ${data.title}\n`;
    message += `📦 *Size:* ${download.size}\n`;
    message += `📁 *Format:* ${download.format.toUpperCase()}\n`;
    message += `\n🔗 *Download Link:*\n${download.url}\n`;
    message += `\n✅ Click the link above to download\n`;
    message += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Google Drive Downloader`;

    await sock.sendMessage(m.chat, {
      text: message
    }, { quoted: m });

    console.log("[Google Drive] Info sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[Google Drive Direct] Error:", error);
    throw error;
  }
}