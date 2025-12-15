// plugins/download/instagram.js

import downloader, { downloadMedia } from '../../lib/downloaders/index.js';
import { generateWAMessageFromContent, WAProto as proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

export default {
  name: "instagram",
  commands: ["ig", "igdl", "instagram"],
  description: "Download Instagram posts, reels, and stories",
  category: "download",
  usage: "• .ig <url> - Download Instagram content",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if this is a direct download call (from button)
      const fullText = args.join(' ');
      if (fullText.startsWith('.igdownload_') || (fullText.startsWith('http') && args.length > 1 && args[1] === 'ig_direct')) {
        return await downloadInstagramDirect(sock, m, args);
      }

      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an Instagram URL!\n\n*Usage:*\n.ig <instagram_url>\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading Instagram content...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.instagram(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Handle based on UI type
      if (result.uiType === 'carousel') {
        // Multiple items - send as carousel
        return await sendInstagramCarousel(sock, m, result);
      } else {
        // Single item - send as button message
        return await sendInstagramButtons(sock, m, result);
      }

    } catch (error) {
      console.error("[Instagram Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Direct download from button click - FIXED WITH BUFFER
 */
async function downloadInstagramDirect(sock, m, args) {
  try {
    // Extract URL from args
    let url = args.find(arg => arg.startsWith('http'));
    
    await sock.sendMessage(m.chat, {
      text: `⏳ Downloading...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });

    // Download the media and get buffer
    const mediaData = await downloadMedia(url);

    await sock.sendMessage(m.chat, {
      video: mediaData.buffer,
      caption: `✅ *Instagram Download Complete*\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      mimetype: 'video/mp4'
    }, { quoted: m });

    return { success: true };
  } catch (error) {
    console.error("[Instagram Direct] Error:", error);
    await sock.sendMessage(m.chat, {
      text: `❌ Download failed: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });
  }
}

/**
 * Send Instagram carousel (multiple items)
 */
async function sendInstagramCarousel(sock, m, result) {
  try {
    const { data } = result;
    
    // Build carousel cards
    const cards = await Promise.all(data.items.map(async (item, index) => {
      // Fetch thumbnail image
      let imageBuffer = null;
      try {
        const response = await fetch(item.thumbnail);
        if (response.ok) {
          imageBuffer = Buffer.from(await response.arrayBuffer());
        }
      } catch (err) {
        console.error(`[Instagram] Failed to fetch thumbnail ${index}:`, err.message);
      }

      // Prepare header with image
      let headerConfig = {
        title: item.title,
        hasMediaAttachment: false
      };

      if (imageBuffer) {
        try {
          const mediaMessage = await prepareWAMessageMedia(
            { image: imageBuffer },
            { upload: sock.waUploadToServer }
          );
          
          headerConfig = {
            title: item.title,
            hasMediaAttachment: true,
            imageMessage: mediaMessage.imageMessage
          };
        } catch (imgErr) {
          console.error(`[Instagram] Image prep failed ${index}:`, imgErr.message);
        }
      }

      // Build download buttons for this item
      const buttons = item.downloads.map((download, dIdx) => ({
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: `🔥 ${download.quality}`,
          id: `${m.prefix}igdownload_${index}_${dIdx}_${download.url} ig_direct`
        })
      }));

      return {
        header: proto.Message.InteractiveMessage.Header.create(headerConfig),
        body: proto.Message.InteractiveMessage.Body.create({
          text: `*Item ${index + 1} of ${data.items.length}*\n\n🔥 Select quality to download`
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
          buttons
        })
      };
    }));

    // Create carousel message
    const carouselMessage = generateWAMessageFromContent(m.chat, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2
          },
          interactiveMessage: proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({
              text: `📸 *${data.title}*\n\nSwipe to view all items →`
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Instagram Downloader"
            }),
            carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
              cards
            })
          })
        }
      }
    }, {});

    // Send carousel
    await sock.relayMessage(m.chat, carouselMessage.message, {
      messageId: carouselMessage.key.id
    });

    console.log("[Instagram] Carousel sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[Instagram Carousel] Error:", error);
    throw error;
  }
}

/**
 * Send Instagram single item with buttons
 */
async function sendInstagramButtons(sock, m, result) {
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
        console.error("[Instagram] Thumbnail fetch failed:", err.message);
      }
    }

    // Build caption
    let caption = `📸 *Instagram Post*\n\n`;
    caption += `👤 *Author:* ${data.author.name}\n`;
    caption += `\n🔥 Select quality to download:`;

    // Prepare header with image
    let headerConfig = {
      title: "📸 Instagram Download",
      hasMediaAttachment: false
    };

    if (imageBuffer) {
      try {
        const mediaMessage = await prepareWAMessageMedia(
          { image: imageBuffer },
          { upload: sock.waUploadToServer }
        );
        
        headerConfig = {
          title: "📸 Instagram Download",
          hasMediaAttachment: true,
          imageMessage: mediaMessage.imageMessage
        };
      } catch (imgErr) {
        console.error("[Instagram] Image prep failed:", imgErr.message);
      }
    }

    // Build buttons
    const buttons = data.downloads.map((download, idx) => ({
      name: "quick_reply",
      buttonParamsJson: JSON.stringify({
        display_text: `🔥 ${download.quality}`,
        id: `${m.prefix}igdownload_${idx}_${download.url} ig_direct`
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
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Instagram Downloader"
            }),
            header: proto.Message.InteractiveMessage.Header.create(headerConfig),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
              buttons
            })
          })
        }
      }
    }, {});

    // Send message
    await sock.relayMessage(m.chat, buttonMessage.message, {
      messageId: buttonMessage.key.id
    });

    console.log("[Instagram] Button message sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[Instagram Buttons] Error:", error);
    throw error;
  }
}