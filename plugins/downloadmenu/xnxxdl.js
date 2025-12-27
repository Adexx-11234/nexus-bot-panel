// plugins/download/xnxx.js

import downloader from '../../lib/downloaders/index.js';
import searchService from '../../lib/search/index.js';
import fs from 'fs';

export default {
  name: "xnxxdl",
  commands: ["xnxxdl", "xnxxdownload"],
  description: "Download XNXX videos (18+)",
  category: "download",
  usage: "• .xnxxdl <url or query> - Download XNXX video",
  permissions: {
  // All false = public command, no restrictions
},
  
  async execute(sock, sessionId, args, m) {
    try {
      if (!args.length) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an XNXX URL or search query!\n\n*Usage:*\n.xnxxdl <xnxx_url>\n.xnxxdl <search_query>\n\n*Examples:*\n.xnxxdl https://www.xnxx.com/video-xxxxx\n.xnxxdl doggy style\n\n⚠️ *18+ Content Only*\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const input = args.join(' ');

      // Check if input is URL or search query
      const isUrl = input.includes('xnxx.com');

      if (!isUrl) {
        // Perform search and pick random result
        await sock.sendMessage(m.chat, {
          text: `🔍 Searching XNXX for: *${input}*\nPicking a random result...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });

        const searchResult = await searchService.xnxx(input);

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

        return await downloadXNXXVideo(sock, m, randomResult.link);
      }

      // Direct URL download
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading XNXX video...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      return await downloadXNXXVideo(sock, m, input);

    } catch (error) {
      console.error("[XNXX Download Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

async function downloadXNXXVideo(sock, m, url) {
  try {
    const result = await downloader.xnxx(url);

    if (!result.success) {
      return await sock.sendMessage(m.chat, {
        text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }

    const { data } = result;
    
    try {
      const fileBuffer = fs.readFileSync(data.filePath);

      let caption = `🔞 *XNXX Video*\n\n`;
      caption += `📝 *Title:* ${data.title}\n`;
      caption += `⏱️ *Duration:* ${Math.floor(data.duration / 60)}:${(data.duration % 60).toString().padStart(2, '0')}\n`;
      caption += `📊 *Info:* ${data.info}\n`;
      caption += `\n✅ Downloaded successfully!\n`;
      caption += `\n⚠️ *18+ Content - Private Use Only*\n`;
      caption += `\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

      await sock.sendMessage(m.chat, {
        video: fileBuffer,
        caption: caption,
        mimetype: 'video/mp4'
      }, { quoted: m });

      console.log("[XNXX Download] Video sent successfully!");
      
      data.cleanup();
      
    } catch (sendError) {
      console.error("[XNXX Download] Send error:", sendError);
      data.cleanup();
      throw sendError;
    }

  } catch (error) {
    console.error("[XNXX Download] Error:", error);
    throw error;
  }
}