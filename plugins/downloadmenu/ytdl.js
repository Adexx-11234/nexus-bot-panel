// plugins/download/youtube.js

import youtubeDownloader from '../../lib/downloaders/index.js';
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

        try {
          const scriptPath = path.join(__dirname, '../../lib/downloaders/downloadhep.js');
          const scriptDir = path.dirname(scriptPath);
          
          console.log('[YouTube Plugin] Script path:', scriptPath);
          console.log('[YouTube Plugin] Working directory:', scriptDir);
          
          // Execute from the script's directory
          const { stdout, stderr } = await execAsync(
            `cd "${scriptDir}" && node downloadhep.js "${videoUrl}" "${format}"`
          );
          
          console.log('[YouTube Plugin] Script output:', stdout);
          if (stderr) console.log('[YouTube Plugin] Script stderr:', stderr);
          
          // Parse output
          const outputMatch = stdout.match(/OUTPUT_FILE:(.+)/);
          const titleMatch = stdout.match(/TITLE:(.+)/);
          const sizeMatch = stdout.match(/SIZE:(\d+)/);
          
          if (!outputMatch) {
            throw new Error('Download failed - no output file');
          }
          
          const filename = outputMatch[1].trim();
          const filePath = path.join(scriptDir, filename);
          const title = titleMatch ? titleMatch[1].trim() : 'YouTube Media';
          const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
          
          console.log('[YouTube Plugin] Reading file:', filePath);
          
          const buffer = fs.readFileSync(filePath);
          console.log(`[YouTube Plugin] File size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
          
          // Delete the file
          fs.unlinkSync(filePath);
          console.log('[YouTube Plugin] File deleted');
          
          // Send to WhatsApp
          if (format === 'mp3') {
            await sock.sendMessage(m.chat, {
              audio: buffer,
              mimetype: 'audio/mpeg',
              fileName: `${title}.mp3`
            }, { quoted: m });
            console.log('[YouTube Plugin] Audio sent');
          } else {
            await sock.sendMessage(m.chat, {
              video: buffer,
              caption: `✅ *Downloaded:* ${title}\n\n*Format:* MP4\n*Size:* ${(size / 1024 / 1024).toFixed(2)} MB\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
              mimetype: 'video/mp4'
            }, { quoted: m });
            console.log('[YouTube Plugin] Video sent');
          }
          
          return { success: true };
          
        } catch (error) {
          console.error('[YouTube Plugin] Error:', error);
          return await sock.sendMessage(m.chat, {
            text: `❌ Download Failed!\n\n*Error:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m });
        }
      }

      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a YouTube URL!\n\n*Usage:*\n.yt <youtube_url>\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];
      
      await sock.sendMessage(m.chat, {
        text: "⏳ Processing YouTube video...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      const result = await youtubeDownloader.youtube(url);

      if (!result || !result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Failed to get video info!\n\n*Error:* ${result?.error?.message || 'Unknown error'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      return await sendYouTubeButtons(sock, m, result);

    } catch (error) {
      console.error("[YouTube Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

async function sendYouTubeButtons(sock, m, result) {
  try {
    const { data } = result;

    let imageBuffer = null;
    if (data.thumbnail) {
      try {
        const response = await fetch(data.thumbnail);
        if (response.ok) {
          imageBuffer = Buffer.from(await response.arrayBuffer());
        }
      } catch (err) {
        console.error("[YouTube Plugin] Thumbnail error:", err.message);
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
      } catch (imgErr) {
        console.error("[YouTube Plugin] Image prep error:", imgErr.message);
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

    const buttonMessage = generateWAMessageFromContent(m.chat, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2
          },
          interactiveMessage: proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({ text: caption }),
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

    return { success: true };

  } catch (error) {
    console.error("[YouTube Buttons] Error:", error);
    throw error;
  }
}