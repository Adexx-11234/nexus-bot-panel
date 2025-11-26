// plugins/download/play.js - UPDATED VERSION

import youtubeDownloader from '../../lib/downloaders/index.js';
import fs from 'fs';

export default {
  name: "play",
  commands: ["play"],
  description: "Search and play YouTube videos",
  category: "download",
  usage: "• .play <song name> - Search and download audio",
  
  async execute(sock, sessionId, args, m) {
    let tempFile = null;
    
    try {
      console.log('[Play Plugin] Execute called with args:', args);
      
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a search query!\n\n*Usage:*\n.play <song name>\n\n*Example:*\n.play away by ayra starr\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const query = args.join(' ');
      console.log('[Play Plugin] Searching for:', query);

      await sock.sendMessage(m.chat, {
        text: `🔍 Searching for: *${query}*\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      const result = await youtubeDownloader.youtubePlay(query);
      
      if (!result || !result.success) {
        console.error('[Play Plugin] Search failed:', result?.error);
        return await sock.sendMessage(m.chat, {
          text: `❌ Search Failed!\n\n*Error:* ${result?.error?.message || 'No results found'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      const { data } = result;
      tempFile = { cleanup: data.cleanup };

      const audioBuffer = fs.readFileSync(data.filePath);
      
      let caption = `🎵 *Now Playing*\n\n`;
      caption += `📝 *Title:* ${data.title}\n`;
      caption += `🎧 *Quality:* ${data.quality}\n`;
      caption += `📦 *Size:* ${data.size}\n`;
      caption += `🔗 *URL:* ${data.url}\n\n`;
      caption += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

      // Send as document with thumbnail
      await sock.sendMessage(m.chat, {
        document: audioBuffer,
        mimetype: 'audio/mpeg',
        fileName: data.filename,
        caption: caption,
        jpegThumbnail: data.thumbnailBuffer
      }, { quoted: m });

      // Send as audio PTT (voice note)
      await sock.sendMessage(m.chat, {
        audio: audioBuffer,
        mimetype: 'audio/mp4',
        ptt: true,
        waveform: [0, 20, 40, 60, 80, 100, 80, 60, 40, 20, 0]
      }, { quoted: m });

      console.log('[Play Plugin] Audio sent successfully');

      // Cleanup
      if (data.cleanup) {
        data.cleanup();
      }

      return { success: true };

    } catch (error) {
      console.error("[Play Plugin] Error:", error);
      console.error("[Play Plugin] Error stack:", error.stack);
      
      // Cleanup on error
      if (tempFile && tempFile.cleanup) {
        tempFile.cleanup();
      }
      
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};