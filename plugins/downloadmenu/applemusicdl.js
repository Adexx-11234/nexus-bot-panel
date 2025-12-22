// plugins/download/applemusicdl.js

import downloader, { downloadMedia } from '../../lib/downloaders/index.js';
import { generateWAMessageFromContent, WAProto as proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';
import fs from 'fs';

export default {
  name: "applemusic",
  commands: ["applemusic", "am", "amdl", "applemusicdl"],
  description: "Download Apple Music tracks",
  category: "download",
  usage: "• .applemusic <url> - Download Apple Music track\n• .am <url> - Short command",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if this is a direct download call (from button)
      const fullText = args.join(' ');
      if (fullText.startsWith('http') && fullText.includes('mymp3.xyz')) {
        return await downloadAppleMusicDirect(sock, m, fullText);
      }

      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an Apple Music URL!\n\n*Usage:*\n.applemusic <apple_music_url>\n\n*Example:*\n.am https://music.apple.com/id/song/xxxxx\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading Apple Music track...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.applemusic(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send as button message
      return await sendAppleMusicButtons(sock, m, result);

    } catch (error) {
      console.error("[Apple Music Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Direct download from button click
 */
async function downloadAppleMusicDirect(sock, m, url) {
  try {
    await sock.sendMessage(m.chat, {
      text: `⏳ Downloading audio...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });

    // Download the media to file
    const mediaFile = await downloadMedia(url, 'applemusic_audio.m4a');

    try {
      // Read and send the audio
      const fileBuffer = fs.readFileSync(mediaFile.filePath);
      
      await sock.sendMessage(m.chat, {
        audio: fileBuffer,
        mimetype: 'audio/mp4',
        fileName: `applemusic_${Date.now()}.m4a`,
      }, { quoted: m });

      console.log('[Apple Music] Audio sent successfully');
      
      // Cleanup
      mediaFile.cleanup();
      
    } catch (sendError) {
      console.error('[Apple Music Direct] Send error:', sendError);
      mediaFile.cleanup();
      throw sendError;
    }

    return { success: true };
  } catch (error) {
    console.error("[Apple Music Direct] Error:", error);
    await sock.sendMessage(m.chat, {
      text: `❌ Download failed: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });
  }
}

/**
 * Send Apple Music with button
 */
async function sendAppleMusicButtons(sock, m, result) {
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
        console.error("[Apple Music] Thumbnail fetch failed:", err.message);
      }
    }

    // Build caption
    let caption = `🍎 *Apple Music Track*\n\n`;
    caption += `🎵 *Title:* ${data.title}\n`;
    caption += `👤 *Artist:* ${data.author.name}\n`;
    if (data.album) {
      caption += `💿 *Album:* ${data.album}\n`;
    }
    caption += `\n🔥 Click to download:`;

    // Prepare header with image
    let headerConfig = {
      title: "🍎 Apple Music",
      hasMediaAttachment: false
    };

    if (imageBuffer) {
      try {
        const mediaMessage = await prepareWAMessageMedia(
          { image: imageBuffer },
          { upload: sock.waUploadToServer }
        );
        
        headerConfig = {
          title: "🍎 Apple Music",
          hasMediaAttachment: true,
          imageMessage: mediaMessage.imageMessage
        };
      } catch (imgErr) {
        console.error("[Apple Music] Image prep failed:", imgErr.message);
      }
    }

    // Build button
    const buttons = [{
      name: "quick_reply",
      buttonParamsJson: JSON.stringify({
        display_text: "🎵 Download Audio",
        id: `${m.prefix}amdl ${data.downloads[0].url}`
      })
    }];

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
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Apple Music Downloader"
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

    console.log("[Apple Music] Button message sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[Apple Music Buttons] Error:", error);
    throw error;
  }
}