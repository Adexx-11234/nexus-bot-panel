// plugins/download/ytdl.js - UPDATED TO USE FILE PATHS

import youtubeDownloader from '../../lib/downloaders/index.js';
import { generateWAMessageFromContent, WAProto as proto, prepareWAMessageMedia } from '@nexustechpro/baileys';
import fs from 'fs';

export default {
  name: "youtube",
  commands: ["yt", "ytdl", "youtube"],
  description: "Download YouTube videos and audio",
  category: "download",
  usage: "• .yt <url> - Download YouTube video\n• .ytdl <url> - Direct download",
  
  async execute(sock, sessionId, args, m) {
    try {
      console.log('[YouTube Plugin] Execute called with args:', args);
      const command = m.body.split(' ')[0].slice(m.prefix.length).toLowerCase();
      console.log('[YouTube Plugin] Command:', command);

      // Check if this is a button callback with format selection
      if (args.length === 2 && (args[1].toLowerCase() === 'mp3' || args[1].toLowerCase() === 'mp4')) {
        const videoUrl = args[0];
        const format = args[1].toLowerCase();
        
        console.log(`[YouTube Plugin] Button callback - videoUrl: ${videoUrl}, format: ${format}`);
        
        await sock.sendMessage(m.chat, {
          text: `⏳ Downloading ${format.toUpperCase()}...\nPlease wait, this may take a minute...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });

        console.log('[YouTube Plugin] Calling youtubeDownloader with format');
        const result = await youtubeDownloader.youtube(videoUrl, format);

        console.log('[YouTube Plugin] Downloader result success:', result?.success);

        if (!result || !result.success) {
          console.error('[YouTube Plugin] Download failed:', result?.error);
          return await sock.sendMessage(m.chat, {
            text: `❌ Download Failed!\n\n*Error:* ${result?.error?.message || 'Unknown error'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m });
        }

        // Verify we have the file path
        if (!result.data || !result.data.filePath) {
          console.error('[YouTube Plugin] No file path in result');
          return await sock.sendMessage(m.chat, {
            text: `❌ Download Failed!\n\n*Error:* No file received from downloader\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m });
        }

        // Read file and send
        const { filePath, title, format: fmt, size, cleanup } = result.data;
        const isAudio = fmt === 'mp3';

        console.log(`[YouTube Plugin] Sending ${isAudio ? 'audio' : 'video'} from file, size: ${(size / 1024 / 1024).toFixed(2)} MB`);

        try {
          const fileBuffer = fs.readFileSync(filePath);
          
          if (isAudio) {
            await sock.sendMessage(m.chat, {
              audio: fileBuffer,
              mimetype: 'audio/mpeg',
              fileName: `${title}.mp3`
            }, { quoted: m });
            console.log('[YouTube Plugin] Audio sent successfully');
          } else {
            await sock.sendMessage(m.chat, {
              video: fileBuffer,
              caption: `✅ *Downloaded:* ${title}\n\n*Format:* MP4\n*Size:* ${(size / 1024 / 1024).toFixed(2)} MB\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
              mimetype: 'video/mp4'
            }, { quoted: m });
            console.log('[YouTube Plugin] Video sent successfully');
          }
          
          // Cleanup temp file
          cleanup();
          
        } catch (sendError) {
          console.error('[YouTube Plugin] Send error:', sendError);
          cleanup(); // Still cleanup on error
          throw sendError;
        }

        return { success: true };
      }

      // Validate input
      if (!args[0]) {
        console.log('[YouTube Plugin] No URL provided');
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a YouTube URL!\n\n*Usage:*\n.yt <youtube_url>\n.ytdl <youtube_url>\n\n*Example:*\n.yt https://youtube.com/watch?v=xxxxx\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];
      console.log('[YouTube Plugin] Processing URL:', url);

      await sock.sendMessage(m.chat, {
        text: "⏳ Processing YouTube video...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      console.log('[YouTube Plugin] Calling youtubeDownloader without format');
      const result = await youtubeDownloader.youtube(url);

      console.log('[YouTube Plugin] Downloader result success:', result?.success);

      if (!result || !result.success) {
        console.error('[YouTube Plugin] Failed to get metadata:', result?.error);
        return await sock.sendMessage(m.chat, {
          text: `❌ Failed to get video info!\n\n*Error:* ${result?.error?.message || 'Unknown error'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      console.log('[YouTube Plugin] Sending buttons for video:', result.data.title);
      return await sendYouTubeButtons(sock, m, result);

    } catch (error) {
      console.error("[YouTube Plugin] Error:", error);
      console.error("[YouTube Plugin] Error stack:", error.stack);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

async function sendYouTubeButtons(sock, m, result) {
  try {
    console.log('[YouTube Plugin] sendYouTubeButtons called');
    
    const { data } = result;

    let imageBuffer = null;
    if (data.thumbnail) {
      try {
        const response = await fetch(data.thumbnail);
        if (response.ok) {
          imageBuffer = Buffer.from(await response.arrayBuffer());
          console.log('[YouTube Plugin] Thumbnail fetched successfully');
        }
      } catch (err) {
        console.error("[YouTube Plugin] Thumbnail fetch failed:", err.message);
      }
    }

    let caption = `🎬 *YouTube Download*\n\n`;
    caption += `📝 *Title:* ${data.title}\n`;
    caption += `👤 *Channel:* ${data.author.name}\n`;
    caption += `\n🔥 Select format to download:`;

    let headerConfig = {
      title: "🎬 YouTube Download",
      hasMediaAttachment: false
    };

    if (imageBuffer) {
      try {
        const mediaMessage = await prepareWAMessageMedia(
          { image: imageBuffer },
          { upload: sock.waUploadToServer }
        );
        
        headerConfig = {
          title: "🎬 YouTube Download",
          hasMediaAttachment: true,
          imageMessage: mediaMessage.imageMessage
        };
        console.log('[YouTube Plugin] Header image prepared');
      } catch (imgErr) {
        console.error("[YouTube Plugin] Image prep failed:", imgErr.message);
      }
    }

    const buttons = [
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: "🎥 MP4 Video",
          id: `${m.prefix}ytdl ${data.youtubeUrl} mp4`
        })
      },
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: "🎵 MP3 Audio",
          id: `${m.prefix}ytdl ${data.youtubeUrl} mp3`
        })
      }
    ];

    if (data.youtubeUrl) {
      buttons.push({
        name: "cta_url",
        buttonParamsJson: JSON.stringify({
          display_text: "▶️ Watch on YouTube",
          url: data.youtubeUrl,
          merchant_url: data.youtubeUrl
        })
      });
    }

    console.log('[YouTube Plugin] Creating button message');

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
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - YouTube Downloader"
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

    console.log('[YouTube Plugin] Button message sent successfully');
    return { success: true };

  } catch (error) {
    console.error("[YouTube Buttons] Error:", error);
    console.error("[YouTube Buttons] Error stack:", error.stack);
    throw error;
  }
}