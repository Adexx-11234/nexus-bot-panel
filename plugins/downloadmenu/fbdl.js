// plugins/download/facebook.js

import downloader, { downloadMedia } from '../../lib/downloaders/index.js';
import { generateWAMessageFromContent, WAProto as proto } from '@whiskeysockets/baileys';

export default {
  name: "facebook",
  commands: ["fb", "fbdl", "facebook"],
  description: "Download Facebook videos",
  category: "download",
  usage: "• .fb <url> - Download Facebook video\n• .fbdl <url> - Download video",
  permissions: {
  // All false = public command, no restrictions
},
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if this is a direct download call (from button)
      const fullText = args.join(' ');
      if (fullText.startsWith('http') && fullText.includes('snapcdn.app')) {
        const quality = args[1] || 'Video';
        return await downloadFacebookDirect(sock, m, fullText, quality);
      }

      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a Facebook URL!\n\n*Usage:*\n.fb <facebook_url>\n\n*Example:*\n.fb https://facebook.com/watch/?v=xxxxx\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading Facebook video...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.facebook(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send as button message
      return await sendFacebookButtons(sock, m, result);

    } catch (error) {
      console.error("[Facebook Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Direct download from button click - FIXED WITH BUFFER
 */
// UPDATED: Works with file system
async function downloadFacebookDirect(sock, m, url, quality) {
  try {
    await sock.sendMessage(m.chat, {
      text: `⏳ Downloading ${quality}...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });

    // Download to file
    const mediaFile = await downloadMedia(url);

    try {
      // Read file and send
      const fileBuffer = fs.readFileSync(mediaFile.filePath);
      
      await sock.sendMessage(m.chat, {
        video: fileBuffer,
        caption: `✅ *Facebook Download Complete*\n\n*Quality:* ${quality}\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        mimetype: 'video/mp4'
      }, { quoted: m });

      // Cleanup temp file
      mediaFile.cleanup();
      
    } catch (sendError) {
      console.error("[Facebook Direct] Send error:", sendError);
      mediaFile.cleanup(); // Still cleanup on error
      throw sendError;
    }

    return { success: true };
  } catch (error) {
    console.error("[Facebook Direct] Error:", error);
    await sock.sendMessage(m.chat, {
      text: `❌ Download failed: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });
  }
}
/**
 * Send Facebook with quality buttons
 */
async function sendFacebookButtons(sock, m, result) {
  try {
    const { data } = result;

    // Build caption
    let caption = `📘 *Facebook Video Download*\n\n`;
    caption += `👤 *From:* ${data.author.name}\n`;
    caption += `\n🔥 Select quality to download:`;

    // Build buttons
    const buttons = data.downloads.map((download) => ({
      name: "quick_reply",
      buttonParamsJson: JSON.stringify({
        display_text: `🔥 ${download.quality}`,
        id: `${m.prefix}fbdl ${download.url} ${download.quality}`
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
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Facebook Downloader"
            }),
            header: proto.Message.InteractiveMessage.Header.create({
              title: "📘 Facebook Video",
              hasMediaAttachment: false
            }),
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

    console.log("[Facebook] Button message sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[Facebook Buttons] Error:", error);
    throw error;
  }
}