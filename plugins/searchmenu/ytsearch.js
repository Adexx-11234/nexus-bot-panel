// plugins/download/ytsearch.js

import youtubeDownloader from '../../lib/downloaders/index.js';
import { generateWAMessageFromContent, WAProto as proto, prepareWAMessageMedia } from '@nexustechpro/baileys';

export default {
  name: "ytsearch",
  commands: ["yts", "ytsearch", "youtubesearch"],
  description: "Search YouTube videos",
  category: "searchmenu",
  usage: "• .yts <query> - Search YouTube\n• .ytsearch <query> - Search videos",
  
  async execute(sock, sessionId, args, m) {
    try {
      console.log('[YTSearch Plugin] Execute called with args:', args);
      
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a search query!\n\n*Usage:*\n.yts <search query>\n\n*Example:*\n.yts Keane Somewhere Only We Know\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const query = args.join(' ');

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `🔍 Searching YouTube for: *${query}*\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call youtube search
      console.log('[YTSearch Plugin] Calling youtubeDownloader.youtubeSearch');
      const result = await youtubeDownloader.youtubeSearch(query);

      console.log("[YTSearch Plugin] Search result success:", result?.success);
      
      // Handle error
      if (!result.success || !result.data || !result.data.items) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Search Failed!\n\n*Error:* ${result?.error?.message || 'No results found'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send as carousel
      return await sendYouTubeSearchCarousel(sock, m, result, query);

    } catch (error) {
      console.error("[YTSearch Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Send YouTube search results as carousel
 */
async function sendYouTubeSearchCarousel(sock, m, result, query) {
  try {
    const { data } = result;

    // Filter only video results
    const videoItems = data.items.filter(item => item.type === 'video');

    if (videoItems.length === 0) {
      return await sock.sendMessage(m.chat, {
        text: `❌ No video results found for: *${query}*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }

    // Build carousel cards
    const cards = await Promise.all(videoItems.slice(0, 10).map(async (item, index) => {
      
      console.log(`[YTSearch] Building card ${index}:`, item.title);
      
      // Fetch thumbnail image
      let imageBuffer = null;
      try {
        if (item.thumbnail) {
          const response = await fetch(item.thumbnail);
          if (response.ok) {
            imageBuffer = Buffer.from(await response.arrayBuffer());
          }
        }
      } catch (err) {
        console.error(`[YTSearch] Failed to fetch thumbnail ${index}:`, err.message);
      }

      // Prepare header with image
      let headerConfig = {
        title: item.title.substring(0, 60),
        subtitle: item.author?.name || 'YouTube',
        hasMediaAttachment: false
      };

      if (imageBuffer) {
        try {
          const mediaMessage = await prepareWAMessageMedia(
            { image: imageBuffer },
            { upload: sock.waUploadToServer }
          );
          
          headerConfig = {
            title: item.title.substring(0, 60),
            subtitle: item.author?.name || 'YouTube',
            hasMediaAttachment: true,
            imageMessage: mediaMessage.imageMessage
          };
        } catch (imgErr) {
          console.error(`[YTSearch] Image prep failed ${index}:`, imgErr.message);
        }
      }

      // Build body text
      let bodyText = `👤 *${item.author?.name || 'YouTube'}*\n`;
      
      if (item.duration) {
        bodyText += `⏱️ Duration: ${item.duration}\n`;
      }

      // Build proper YouTube watch URL
      let youtubeUrl = item.url;
      if (item.videoId && !youtubeUrl) {
        youtubeUrl = `https://youtube.com/watch?v=${item.videoId}`;
      }

      console.log(`[YTSearch] Final URL for item ${index}:`, youtubeUrl);

      // Build buttons
      const buttons = [
        {
          name: "quick_reply",
          buttonParamsJson: JSON.stringify({
            display_text: "📥 Download",
            id: `${m.prefix}yt ${youtubeUrl}`
          })
        },
        {
          name: "cta_url",
          buttonParamsJson: JSON.stringify({
            display_text: "▶️ Watch on YouTube",
            url: youtubeUrl,
            merchant_url: youtubeUrl
          })
        }
      ];

      return {
        header: proto.Message.InteractiveMessage.Header.create(headerConfig),
        body: proto.Message.InteractiveMessage.Body.create({
          text: bodyText
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
              text: `🔍 *YouTube Search Results*\n\n*Query:* ${query}\n*Results:* ${videoItems.length} videos found\n\nSwipe to browse →\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - YouTube Search"
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

    console.log("[YTSearch] Carousel sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[YTSearch Carousel] Error:", error);
    throw error;
  }
}