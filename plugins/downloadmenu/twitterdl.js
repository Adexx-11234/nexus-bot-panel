// plugins/download/twitter.js

import downloader, { downloadMedia } from '../../lib/downloaders/index.js';
import { generateWAMessageFromContent, WAProto as proto } from '@whiskeysockets/baileys';

export default {
  name: "twitter",
  commands: ["twitter", "tw", "twdl", "x", "twitterdl"],
  description: "Download Twitter/X videos",
  category: "download",
  usage: "• .twitter <url> - Download Twitter video\n• .x <url> - Download from X",
  permissions: {
  // All false = public command, no restrictions
},
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if this is a direct download call (from button)
      const fullText = args.join(' ');
      if (fullText.startsWith('http') && fullText.includes('twimg.com')) {
        const quality = args[1] || 'Video';
        return await downloadTwitterDirect(sock, m, fullText, quality);
      }

      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a Twitter/X URL!\n\n*Usage:*\n.twitter <twitter_url>\n\n*Example:*\n.twitter https://twitter.com/user/status/xxxxx\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading Twitter video...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.twitter(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send as button message
      return await sendTwitterButtons(sock, m, result);

    } catch (error) {
      console.error("[Twitter Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Direct download from button click - FIXED WITH BUFFER
 */
async function downloadTwitterDirect(sock, m, url, quality) {
  try {
    await sock.sendMessage(m.chat, {
      text: `⏳ Downloading ${quality}...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });

    // Download the media and get buffer
    const mediaData = await downloadMedia(url);

    // Send the video directly
    await sock.sendMessage(m.chat, {
      video: mediaData.buffer,
      caption: `✅ *Twitter Download Complete*\n\n*Quality:* ${quality}\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      mimetype: 'video/mp4'
    }, { quoted: m });

    return { success: true };
  } catch (error) {
    console.error("[Twitter Direct] Error:", error);
    await sock.sendMessage(m.chat, {
      text: `❌ Download failed: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });
  }
}

/**
 * Send Twitter with quality buttons
 */
async function sendTwitterButtons(sock, m, result) {
  try {
    const { data } = result;

    // Build caption
    let caption = `🦅 *Twitter/X Video Download*\n\n`;
    if (data.title) {
      caption += `📝 *Tweet:* ${data.title.substring(0, 150)}${data.title.length > 150 ? '...' : ''}\n`;
    }
    caption += `👤 *From:* ${data.author.name}\n`;
    caption += `\n🔥 Select quality to download:`;

    // Build buttons
    const buttons = data.downloads.map((download) => ({
      name: "quick_reply",
      buttonParamsJson: JSON.stringify({
        display_text: `🔥 ${download.quality}`,
        id: `${m.prefix}twdl ${download.url} ${download.quality}`
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
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Twitter Downloader"
            }),
            header: proto.Message.InteractiveMessage.Header.create({
              title: "🦅 Twitter/X Video",
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

    console.log("[Twitter] Button message sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[Twitter Buttons] Error:", error);
    throw error;
  }
}