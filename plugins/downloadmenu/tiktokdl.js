// plugins/download/tiktok.js

import downloader, { downloadMedia } from '../../lib/downloaders/index.js';
import { generateWAMessageFromContent, WAProto as proto, prepareWAMessageMedia } from '@nexustechpro/baileys';
import fs from 'fs'
export default {
  name: "tiktok",
  commands: ["tiktok", "tt", "ttdl", "tiktokdl"],
  description: "Download TikTok videos without watermark",
  category: "download",
  usage: "• .tiktok <url> - Download TikTok video\n• .tt <url> - Short command",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if this is a direct download call (from button)
      const fullText = args.join(' ');
      if (fullText.startsWith('http') && fullText.includes('tiktokcdn.com')) {
        return await downloadTikTokDirect(sock, m, fullText, args[1] || 'Video');
      }

      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a TikTok URL!\n\n*Usage:*\n.tiktok <tiktok_url>\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading TikTok video...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.tiktok(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send as button message
      return await sendTikTokButtons(sock, m, result);

    } catch (error) {
      console.error("[TikTok Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Direct download from button click - FIXED WITH ERROR HANDLING
 */
async function downloadTikTokDirect(sock, m, url, quality) {
  try {
    await sock.sendMessage(m.chat, {
      text: `⏳ Downloading ${quality}...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });

    // Download to file
    const mediaFile = await downloadMedia(url);

    try {
      // Read file
      const fileBuffer = fs.readFileSync(mediaFile.filePath);

      // Determine if it's audio or video
      if (quality.toLowerCase().includes('audio') || quality.toLowerCase().includes('mp3')) {
        await sock.sendMessage(m.chat, {
          audio: fileBuffer,
          mimetype: 'audio/mpeg',
          fileName: `tiktok_audio_${Date.now()}.mp3`,
        }, { quoted: m });
      } else {
        await sock.sendMessage(m.chat, {
          video: fileBuffer,
          caption: `✅ *TikTok Download Complete*\n\n*Quality:* ${quality}\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          mimetype: 'video/mp4'
        }, { quoted: m });
      }

      console.log('[TikTok] Media sent successfully');
      
      // Cleanup temp file
      mediaFile.cleanup();
      
    } catch (sendError) {
      console.error('[TikTok Direct] Send error:', sendError);
      mediaFile.cleanup(); // Still cleanup on error
      throw sendError;
    }

    return { success: true };
  } catch (error) {
    console.error("[TikTok Direct] Error:", error);
    await sock.sendMessage(m.chat, {
      text: `❌ Download failed: ${error.message}\n\n*Tip:* The video link might have expired. Try downloading again from the original TikTok URL.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });
  }
}

/**
 * Send TikTok with quality buttons
 */
async function sendTikTokButtons(sock, m, result) {
  try {
    const { data } = result;

    // Fetch thumbnail
    let imageBuffer = null;
    if (data.thumbnail) {
      try {
        const response = await fetch(data.thumbnail);
        if (response.ok) {
          imageBuffer = Buffer.from(await response.arrayBuffer());
        }
      } catch (err) {
        console.error("[TikTok] Thumbnail fetch failed:", err.message);
      }
    }

    // Build caption
    let caption = `🎵 *TikTok Download*\n\n`;
    caption += `📝 *Title:* ${data.title.substring(0, 100)}${data.title.length > 100 ? '...' : ''}\n`;
    caption += `👤 *Author:* ${data.author.name}\n`;
    if (data.duration) caption += `⏱️ *Duration:* ${formatDuration(data.duration)}s\n`;
    if (data.metadata) {
      caption += `\n📊 *Stats:*\n`;
      caption += `👁️ Views: ${formatNumber(data.metadata.views)}\n`;
      caption += `❤️ Likes: ${formatNumber(data.metadata.likes)}\n`;
      caption += `💬 Comments: ${formatNumber(data.metadata.comments)}\n`;
    }
    caption += `\n🔥 Select quality to download:`;

    // Prepare header with image
    let headerConfig = {
      title: "🎵 TikTok Download",
      hasMediaAttachment: false
    };

    if (imageBuffer) {
      try {
        const mediaMessage = await prepareWAMessageMedia(
          { image: imageBuffer },
          { upload: sock.waUploadToServer }
        );
        
        headerConfig = {
          title: "🎵 TikTok Download",
          hasMediaAttachment: true,
          imageMessage: mediaMessage.imageMessage
        };
      } catch (imgErr) {
        console.error("[TikTok] Image prep failed:", imgErr.message);
      }
    }

    // Build buttons
    const buttons = data.downloads.map((download) => ({
      name: "quick_reply",
      buttonParamsJson: JSON.stringify({
        display_text: `${download.type === 'audio' ? '🎵' : '🔥'} ${download.quality}${download.size ? ` (${download.size})` : ''}`,
        id: `${m.prefix}ttdl ${download.url} ${download.quality}`
      })
    }));

    // Create button message
    const buttonMessage = generateWAMessageFromContent(m.chat, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2
          },
          interactiveMessage: proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({
              text: caption
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - TikTok Downloader"
            }),
            header: proto.Message.InteractiveMessage.Header.create(headerConfig),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
              buttons
            })
          })
        }
      }
    }, {});

    await sock.relayMessage(m.chat, buttonMessage.message, {
      messageId: buttonMessage.key.id
    });

    console.log("[TikTok] Button message sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[TikTok Buttons] Error:", error);
    throw error;
  }
}

function formatDuration(seconds) {
  return seconds || 'N/A';
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}