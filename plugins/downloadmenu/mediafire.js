// plugins/download/mediafire.js

import downloader from '../../lib/downloaders/index.js';

export default {
  name: "mediafire",
  commands: ["mediafire", "mf", "mfdl"],
  description: "Download files from MediaFire",
  category: "download",
  usage: "• .mediafire <url> - Download MediaFire file\n• .mf <url> - Short command",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a MediaFire URL!\n\n*Usage:*\n.mediafire <mediafire_url>\n\n*Example:*\n.mf https://mediafire.com/file/xxxxx\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Processing MediaFire file...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.mediafire(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send directly (uiType: 'direct')
      return await sendMediaFireDirect(sock, m, result);

    } catch (error) {
      console.error("[MediaFire Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Send MediaFire file info and download link (uiType: 'direct')
 */
async function sendMediaFireDirect(sock, m, result) {
  try {
    const { data } = result;
    const download = data.downloads[0];

    // Build message
    let message = `📁 *MediaFire Download*\n\n`;
    message += `📄 *Filename:* ${data.title}\n`;
    message += `📦 *Size:* ${download.size}\n`;
    message += `📁 *Format:* ${download.format.toUpperCase()}\n`;
    message += `👤 *Uploader:* ${data.author.name}\n`;
    if (data.metadata?.uploadDate) {
      message += `📅 *Uploaded:* ${data.metadata.uploadDate}\n`;
    }
    message += `\n🔗 *Download Link:*\n${download.url}\n`;
    message += `\n✅ Click the link above to download\n`;
    message += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - MediaFire Downloader`;

    await sock.sendMessage(m.chat, {
      text: message
    }, { quoted: m });

    //console.log("[MediaFire] Info sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[MediaFire Direct] Error:", error);
    throw error;
  }
}