// plugins/search/xvideos.js

import searchService from '../../lib/search/index.js';
import { generateWAMessageFromContent, WAProto as proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

export default {
  name: "xvideos",
  commands: ["xvideos", "xvsearch"],
  description: "Search XVideos (18+)",
  category: "searchmenu",
  usage: "• .xvideos <query> - Search XVideos",
  
  async execute(sock, sessionId, args, m) {
    try {
      if (!args.length) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a search query!\n\n*Usage:*\n.xvideos <search_query>\n\n*Example:*\n.xvideos doggy style\n\n⚠️ *18+ Content Only*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const query = args.join(' ');

      await sock.sendMessage(m.chat, {
        text: `🔍 Searching XVideos for: *${query}*\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      const result = await searchService.xvideos(query);

      if (!result.success || !result.data || !result.data.items) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Search Failed!\n\n*Error:* ${result?.error?.message || 'No results found'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      return await sendXVideosCarousel(sock, m, result, query);

    } catch (error) {
      console.error("[XVideos Search Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

async function sendXVideosCarousel(sock, m, result, query) {
  try {
    const { data } = result;

    if (data.items.length === 0) {
      return await sock.sendMessage(m.chat, {
        text: `❌ No results found for: *${query}*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }

    const cards = await Promise.all(data.items.slice(0, 10).map(async (item, index) => {
      console.log(`[XVideos] Building card ${index}:`, item.title);

      let imageBuffer = null;
      try {
        if (item.cover) {
          const response = await fetch(item.cover);
          if (response.ok) {
            imageBuffer = Buffer.from(await response.arrayBuffer());
          }
        }
      } catch (err) {
        console.error(`[XVideos] Failed to fetch cover ${index}:`, err.message);
      }

      let headerConfig = {
        title: item.title.substring(0, 60),
        subtitle: item.artist || "XVideos",
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
            subtitle: item.artist || "XVideos",
            hasMediaAttachment: true,
            imageMessage: mediaMessage.imageMessage
          };
        } catch (imgErr) {
          console.error(`[XVideos] Image prep failed ${index}:`, imgErr.message);
        }
      }

      let bodyText = `👤 *${item.artist}*\n`;
      bodyText += `🎬 ${item.resolution} | ⏱️ ${item.duration}\n`;
      bodyText += `\n🔞 18+ Content\n`;

      const buttons = [
        {
          name: "quick_reply",
          buttonParamsJson: JSON.stringify({
            display_text: "📥 Download",
            id: `${m.prefix}xvdl ${item.url}`
          })
        },
        {
          name: "cta_url",
          buttonParamsJson: JSON.stringify({
            display_text: "🌐 View on XVideos",
            url: item.url,
            merchant_url: item.url
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

    const carouselMessage = generateWAMessageFromContent(m.chat, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2
          },
          interactiveMessage: proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({
              text: `🔞 *XVideos Search Results*\n\n*Query:* ${query}\n*Results:* ${data.items.length} videos found\n\nSwipe to browse →\n\n⚠️ *18+ Content Only*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - XVideos Search"
            }),
            carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
              cards
            })
          })
        }
      }
    }, {});

    await sock.relayMessage(m.chat, carouselMessage.message, {
      messageId: carouselMessage.key.id
    });

    console.log("[XVideos] Carousel sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[XVideos Carousel] Error:", error);
    throw error;
  }
}