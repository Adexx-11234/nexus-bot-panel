// plugins/search/xnxx.js

import searchService from '../../lib/search/index.js';
import { generateWAMessageFromContent, WAProto as proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

export default {
  name: "xnxx",
  commands: ["xnxx", "xnxxsearch"],
  description: "Search XNXX videos (18+)",
  category: "searchmenu",
  usage: "• .xnxx <query> - Search XNXX videos",
  
  async execute(sock, sessionId, args, m) {
    try {
      if (!args.length) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a search query!\n\n*Usage:*\n.xnxx <search_query>\n\n*Example:*\n.xnxx doggy style\n\n⚠️ *18+ Content Only*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const query = args.join(' ');

      await sock.sendMessage(m.chat, {
        text: `🔍 Searching XNXX for: *${query}*\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      const result = await searchService.xnxx(query);

      if (!result.success || !result.data || !result.data.items) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Search Failed!\n\n*Error:* ${result?.error?.message || 'No results found'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      return await sendXNXXCarousel(sock, m, result, query);

    } catch (error) {
      console.error("[XNXX Search Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

async function sendXNXXCarousel(sock, m, result, query) {
  try {
    const { data } = result;

    if (data.items.length === 0) {
      return await sock.sendMessage(m.chat, {
        text: `❌ No results found for: *${query}*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }

    const cards = await Promise.all(data.items.slice(0, 10).map(async (item, index) => {
      console.log(`[XNXX] Building card ${index}:`, item.title);

      const headerConfig = {
        title: item.title.substring(0, 60),
        subtitle: "XNXX",
        hasMediaAttachment: false
      };

      let bodyText = `📊 ${item.info}\n`;
      bodyText += `\n🔞 18+ Content\n`;

      const buttons = [
        {
          name: "quick_reply",
          buttonParamsJson: JSON.stringify({
            display_text: "📥 Download",
            id: `${m.prefix}xnxxdl ${item.link}`
          })
        },
        {
          name: "cta_url",
          buttonParamsJson: JSON.stringify({
            display_text: "🌐 View on XNXX",
            url: item.link,
            merchant_url: item.link
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
              text: `🔞 *XNXX Search Results*\n\n*Query:* ${query}\n*Results:* ${data.items.length} videos found\n\nSwipe to browse →\n\n⚠️ *18+ Content Only*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - XNXX Search"
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

    console.log("[XNXX] Carousel sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[XNXX Carousel] Error:", error);
    throw error;
  }
}