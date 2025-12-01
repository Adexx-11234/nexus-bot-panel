// plugins/download/play.js - RACE CONDITION FIXED VERSION

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
    let audioBuffer = null;
    
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
      tempFile = { cleanup: data.cleanup, filePath: data.filePath };

      // ============================================
      // FIX: Read file IMMEDIATELY into buffer
      // This prevents race conditions from concurrent requests
      // ============================================
      
      console.log('[Play Plugin] Reading file:', data.filePath);
      
      // Check if file exists before reading
      if (!fs.existsSync(data.filePath)) {
        throw new Error(`File not found: ${data.filePath}`);
      }
      
      // Read file into memory IMMEDIATELY
      audioBuffer = fs.readFileSync(data.filePath);
      console.log('[Play Plugin] File loaded into memory, size:', audioBuffer.length);
      
      // ============================================
      // FIX: Delete file IMMEDIATELY after reading
      // This frees up disk space and prevents conflicts
      // ============================================
      
      if (data.cleanup) {
        data.cleanup();
        console.log('[Play Plugin] Temporary file cleaned up');
      }
      
      // Build caption
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
        ptt: false
      }, { quoted: m });

      console.log('[Play Plugin] Audio sent successfully');
      
      return { success: true };

    } catch (error) {
      console.error("[Play Plugin] Error:", error);
      console.error("[Play Plugin] Error stack:", error.stack);
      
      // Cleanup on error (only if file still exists)
      if (tempFile && tempFile.cleanup) {
        try {
          tempFile.cleanup();
        } catch (cleanupErr) {
          console.error('[Play Plugin] Cleanup error (safe to ignore):', cleanupErr.message);
        }
      }
      
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
      
      return { success: false, error: error.message };
    }
  },
};