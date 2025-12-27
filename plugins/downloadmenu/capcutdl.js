// plugins/download/capcut.js

import downloader, { downloadMedia } from '../../lib/downloaders/index.js';
import { generateWAMessageFromContent, WAProto as proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

export default {
  name: "capcut",
  commands: ["capcut", "cc", "ccdl", "capcutdl"],
  description: "Download Capcut templates",
  category: "download",
  usage: "• .capcut <url> - Download Capcut template\n• .cc <url> - Short command",
  permissions: {
  // All false = public command, no restrictions
},
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if this is a direct download call (from button)
      const fullText = args.join(' ');
      if (fullText.startsWith('http') && fullText.includes('3bic.com')) {
        return await downloadCapcutDirect(sock, m, fullText);
      }

      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a Capcut URL!\n\n*Usage:*\n.capcut <capcut_url>\n\n*Example:*\n.cc https://www.capcut.com/template-detail/xxxxx\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading Capcut template...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.capcut(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send as button message (uiType: 'buttons')
      return await sendCapcutButtons(sock, m, result);

    } catch (error) {
      console.error("[Capcut Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Direct download from button click - FIXED WITH BUFFER
 */
async function downloadCapcutDirect(sock, m, url) {
  try {
    await sock.sendMessage(m.chat, {
      text: `⏳ Downloading template...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });

    // Download the media and get buffer
    const mediaData = await downloadMedia(url);

    // Send the video directly
    await sock.sendMessage(m.chat, {
      video: mediaData.buffer,
      caption: `✅ *Capcut Template Downloaded*\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      mimetype: 'video/mp4'
    }, { quoted: m });

    return { success: true };
  } catch (error) {
    console.error("[Capcut Direct] Error:", error);
    await sock.sendMessage(m.chat, {
      text: `❌ Download failed: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });
  }
}

/**
 * Send Capcut with button (uiType: 'buttons')
 */
async function sendCapcutButtons(sock, m, result) {
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
        console.error("[Capcut] Thumbnail fetch failed:", err.message);
      }
    }

    // Build caption
    let caption = `🎨 *Capcut Template*\n\n`;
    caption += `📝 *Title:* ${data.title}\n`;
    caption += `👤 *Creator:* ${data.author.name}\n`;
    caption += `\n🔥 Click to download template:`;

    // Prepare header with image
    let headerConfig = {
      title: "🎨 Capcut Template",
      hasMediaAttachment: false
    };

    if (imageBuffer) {
      try {
        const mediaMessage = await prepareWAMessageMedia(
          { image: imageBuffer },
          { upload: sock.waUploadToServer }
        );
        
        headerConfig = {
          title: "🎨 Capcut Template",
          hasMediaAttachment: true,
          imageMessage: mediaMessage.imageMessage
        };
      } catch (imgErr) {
        console.error("[Capcut] Image prep failed:", imgErr.message);
      }
    }

    // Build button
    const buttons = [{
      name: "quick_reply",
      buttonParamsJson: JSON.stringify({
        display_text: "🔥 Download Template",
        id: `${m.prefix}ccdl ${data.downloads[0].url}`
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
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Capcut Downloader"
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

    console.log("[Capcut] Button message sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[Capcut Buttons] Error:", error);
    throw error;
  }
}