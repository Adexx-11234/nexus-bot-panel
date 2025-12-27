// plugins/download/spotify.js

import downloader, { downloadMedia } from '../../lib/downloaders/index.js';
import { prepareWAMessageMedia } from '@whiskeysockets/baileys';
import fs from 'fs';

export default {
  name: "spotify",
  commands: ["spotify", "spot", "spotdl", "spotifydl"],
  description: "Download Spotify tracks",
  category: "download",
  usage: "• .spotify <url> - Download Spotify track\n• .spot <url> - Short command",
  permissions: {
  // All false = public command, no restrictions
},
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if this is a direct download call (from button)
      const fullText = args.join(' ');
      if (fullText.startsWith('http') && (fullText.includes('cdn-spotify') || fullText.includes('zm.io.vn'))) {
        return await downloadSpotifyDirect(sock, m, fullText);
      }

      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a Spotify URL!\n\n*Usage:*\n.spotify <spotify_url>\n\n*Example:*\n.spotify https://open.spotify.com/track/xxxxx\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading Spotify track...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.spotify(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send as audio with thumbnail
      return await sendSpotifyAudio(sock, m, result);

    } catch (error) {
      console.error("[Spotify Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Direct download from button click - UPDATED WITH FILE SYSTEM
 */
async function downloadSpotifyDirect(sock, m, url) {
  try {
    await sock.sendMessage(m.chat, {
      text: `⏳ Downloading audio...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });

    // Download to file
    const mediaFile = await downloadMedia(url);

    try {
      // Read and send
      const fileBuffer = fs.readFileSync(mediaFile.filePath);
      
      await sock.sendMessage(m.chat, {
        audio: fileBuffer,
        mimetype: 'audio/mpeg',
        fileName: `spotify_${Date.now()}.mp3`,
      }, { quoted: m });

      console.log('[Spotify] Audio sent successfully');
      
      // Cleanup temp file
      mediaFile.cleanup();
      
    } catch (sendError) {
      console.error('[Spotify Direct] Send error:', sendError);
      mediaFile.cleanup(); // Still cleanup on error
      throw sendError;
    }

    return { success: true };
  } catch (error) {
    console.error("[Spotify Direct] Error:", error);
    await sock.sendMessage(m.chat, {
      text: `❌ Download failed: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });
  }
}

/**
 * Send Spotify audio with thumbnail - UPDATED WITH FILE SYSTEM
 */
async function sendSpotifyAudio(sock, m, result) {
  try {
    const { data } = result;

    // Fetch thumbnail
    let thumbnailBuffer = null;
    if (data.thumbnail) {
      try {
        const response = await fetch(data.thumbnail);
        if (response.ok) {
          thumbnailBuffer = Buffer.from(await response.arrayBuffer());
        }
      } catch (err) {
        console.error("[Spotify] Thumbnail fetch failed:", err.message);
      }
    }

    // Get audio URL
    const audioUrl = data.downloads[0]?.url;
    if (!audioUrl) {
      throw new Error("No audio download URL found");
    }

    // Download to file
    const mediaFile = await downloadMedia(audioUrl);

    try {
      // Read file
      const fileBuffer = fs.readFileSync(mediaFile.filePath);

      // Build caption
      let caption = `🎵 *Spotify Track*\n\n`;
      caption += `🎵 *Title:* ${data.title}\n`;
      caption += `👤 *Artist:* ${data.author.name}\n`;
      if (data.duration) {
        caption += `⏱️ *Duration:* ${Math.floor(data.duration / 60)}:${(data.duration % 60).toString().padStart(2, '0')}\n`;
      }
      caption += `\n✅ Downloaded successfully!\n`;
      caption += `\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Spotify Downloader`;

      // Prepare context info with thumbnail
      let contextInfo = {};
      if (thumbnailBuffer) {
        contextInfo = {
          externalAdReply: {
            title: data.title,
            body: data.author.name,
            thumbnailUrl: data.thumbnail,
            sourceUrl: audioUrl,
            mediaType: 2,
            mediaUrl: data.thumbnail,
            renderLargerThumbnail: false,
          }
        };
      }

      // Send audio with thumbnail
      await sock.sendMessage(m.chat, {
        audio: fileBuffer,
        mimetype: 'audio/mpeg',
        fileName: `${data.title}.mp3`,
        contextInfo,
        ptt: false,
      }, { quoted: m });

      // Send caption separately with thumbnail image
      if (thumbnailBuffer) {
        await sock.sendMessage(m.chat, {
          image: thumbnailBuffer,
          caption: caption
        }, { quoted: m });
      } else {
        await sock.sendMessage(m.chat, {
          text: caption
        }, { quoted: m });
      }

      console.log("[Spotify] Audio sent successfully!");
      
      // Cleanup temp file
      mediaFile.cleanup();
      
    } catch (sendError) {
      console.error("[Spotify Audio] Send error:", sendError);
      mediaFile.cleanup(); // Still cleanup on error
      throw sendError;
    }

    return { success: true };

  } catch (error) {
    console.error("[Spotify Audio] Error:", error);
    throw error;
  }
}