// plugins/download/xvideos.js

import downloader from '../../lib/downloaders/index.js';
import searchService from '../../lib/search/index.js';
import fs from 'fs';

export default {
  name: "xvdl",
  commands: ["xvdl", "xvideosdownload"],
  description: "Download XVideos (18+)",
  category: "download",
  usage: "• .xvdl <url or query> - Download XVideos video",
  
  async execute(sock, sessionId, args, m) {
    try {
      if (!args.length) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an XVideos URL or search query!\n\n*Usage:*\n.xvdl <xvideos_url>\n.xvdl <search_query>\n\n*Examples:*\n.xvdl https://www.xvideos.com/video.xxxxx\n.xvdl doggy style\n\n⚠️ *18+ Content Only*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const input = args.join(' ');

      // Check if input is URL or search query
      const isUrl = input.includes('xvideos.com');

      if (!isUrl) {
        // Perform search and pick random result
        await sock.sendMessage(m.chat, {
          text: `🔍 Searching XVideos for: *${input}*\nPicking a random result...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });

        const searchResult = await searchService.xvideos(input);

        if (!searchResult.success || !searchResult.data.items.length) {
          return await sock.sendMessage(m.chat, {
            text: `❌ No results found for: *${input}*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m });
        }

        // Pick random result
        const randomIndex = Math.floor(Math.random() * Math.min(5, searchResult.data.items.length));
        const randomResult = searchResult.data.items[randomIndex];
        
        await sock.sendMessage(m.chat, {
          text: `🎲 Selected: *${randomResult.title}*\n\n⏳ Downloading...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });

        return await downloadXVideosVideo(sock, m, randomResult.url);
      }

      // Direct URL download
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading XVideos...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      return await downloadXVideosVideo(sock, m, input);

    } catch (error) {
      console.error("[XVideos Download Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

async function downloadXVideosVideo(sock, m, url) {
  try {
    const result = await downloader.xvideos(url);

    if (!result.success) {
      return await sock.sendMessage(m.chat, {
        text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }

    const { data } = result;
    
    try {
      const fileBuffer = fs.readFileSync(data.filePath);

      let caption = `🔞 *XVideos*\n\n`;
      caption += `📝 *Title:* ${data.title}\n`;
      caption += `\n✅ Downloaded successfully!\n`;
      caption += `\n⚠️ *18+ Content - Private Use Only*\n`;
      caption += `\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

      await sock.sendMessage(m.chat, {
        video: fileBuffer,
        caption: caption,
        mimetype: 'video/mp4'
      }, { quoted: m });

      console.log("[XVideos Download] Video sent successfully!");
      
      data.cleanup();
      
    } catch (sendError) {
      console.error("[XVideos Download] Send error:", sendError);
      data.cleanup();
      throw sendError;
    }

  } catch (error) {
    console.error("[XVideos Download] Error:", error);
    throw error;
  }
}