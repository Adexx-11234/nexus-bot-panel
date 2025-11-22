// plugins/download/play.js

import youtubeDownloader from '../../lib/downloaders/index.js';
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

export default {
  name: "play",
  commands: ["play"],
  description: "Search and play YouTube videos",
  category: "download",
  usage: "• .play <song name> - Search and show download options",
  
  async execute(sock, sessionId, args, m) {
    try {
      console.log('[Play Plugin] Execute called with args:', args);
      
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a search query!\n\n*Usage:*\n.play <song name>\n\n*Example:*\n.play away by ayra starr\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const query = args.join(' ');
      console.log('[Play Plugin] Searching for:', query);

      await sock.sendMessage(m.chat, {
        text: `🔍 Searching for: *${query}*\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      const searchResult = await youtubeDownloader.youtubeSearch(query);
      console.log('[Play Plugin] Search result success:', searchResult?.success);

      if (!searchResult || !searchResult.success) {
        console.error('[Play Plugin] Search failed:', searchResult?.error);
        return await sock.sendMessage(m.chat, {
          text: `❌ Search Failed!\n\n*Error:* ${searchResult?.error?.message || 'Unknown error'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      const firstResult = searchResult.data.items.find(item => item.type === 'video');
      
      if (!firstResult || !firstResult.url) {
        console.log('[Play Plugin] No video results found');
        return await sock.sendMessage(m.chat, {
          text: `❌ No video results found for: *${query}*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      console.log('[Play Plugin] First result:', firstResult.title);

      const downloadResult = await youtubeDownloader.youtube(firstResult.url);
      console.log('[Play Plugin] Download result success:', downloadResult?.success);

      if (!downloadResult || !downloadResult.success) {
        console.error('[Play Plugin] Failed to get metadata:', downloadResult?.error);
        return await sock.sendMessage(m.chat, {
          text: `❌ Failed to get download links!\n\n*Error:* ${downloadResult?.error?.message || 'Unknown error'}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      return await sendPlayButtons(sock, m, downloadResult);

    } catch (error) {
      console.error("[Play Plugin] Error:", error);
      console.error("[Play Plugin] Error stack:", error.stack);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

async function sendPlayButtons(sock, m, result) {
  try {
    console.log('[Play Plugin] sendPlayButtons called');
    
    const { data } = result;

    let imageBuffer = null;
    if (data.thumbnail) {
      try {
        const response = await fetch(data.thumbnail);
        if (response.ok) {
          imageBuffer = Buffer.from(await response.arrayBuffer());
          console.log('[Play Plugin] Thumbnail fetched successfully');
        }
      } catch (err) {
        console.error("[Play Plugin] Thumbnail fetch failed:", err.message);
      }
    }

    let caption = `🎵 *Now Playing*\n\n`;
    caption += `📝 *Title:* ${data.title}\n`;
    caption += `👤 *Channel:* ${data.author.name}\n`;
    caption += `\n🔥 Select format to download:`;

    let headerConfig = {
      title: "🎵 Now Playing",
      hasMediaAttachment: false
    };

    if (imageBuffer) {
      try {
        const mediaMessage = await prepareWAMessageMedia(
          { image: imageBuffer },
          { upload: sock.waUploadToServer }
        );
        
        headerConfig = {
          title: "🎵 Now Playing",
          hasMediaAttachment: true,
          imageMessage: mediaMessage.imageMessage
        };
        console.log('[Play Plugin] Header image prepared');
      } catch (imgErr) {
        console.error("[Play Plugin] Image prep failed:", imgErr.message);
      }
    }

    const buttons = [
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: "🎥 MP4 Video",
          id: `${m.prefix}ytdl ${data.videoId} mp4`
        })
      },
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: "🎵 MP3 Audio",
          id: `${m.prefix}ytdl ${data.videoId} mp3`
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

    console.log('[Play Plugin] Creating button message');

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
              text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - YouTube Player"
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

    console.log('[Play Plugin] Button message sent successfully');
    return { success: true };

  } catch (error) {
    console.error("[Play Buttons] Error:", error);
    console.error("[Play Buttons] Error stack:", error.stack);
    throw error;
  }
}