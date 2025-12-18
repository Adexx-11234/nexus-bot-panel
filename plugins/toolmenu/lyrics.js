// plugins/tools/lyrics.js

import tools from '../../lib/tools/index.js';

export default {
  name: "lyrics",
  commands: ["lyrics", "lirik", "lyric"],
  description: "Get song lyrics",
  category: "toolmenu",
  usage: "• .lyrics <song title> - Get song lyrics\n• .lirik <song title> - Get song lyrics",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a song title!\n\n*Usage:*\n.lyrics <song title>\n\n*Example:*\n.lyrics Bohemian Rhapsody\n.lyrics Shape of You Ed Sheeran\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const songTitle = args.join(' ');

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `⏳ Searching for lyrics...\n🎵 "${songTitle}"\n\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call lyrics tool
      const result = await tools.lyrics(songTitle);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Lyrics Search Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Check if results found
      if (!result.data.results || result.data.results.length === 0) {
        return await sock.sendMessage(m.chat, {
          text: `❌ No lyrics found for:\n"${songTitle}"\n\nTry with a different song title or include the artist name.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Get first result
      const lyrics = result.data.results[0];

      // Build response message
      let message = `🎵 *SONG LYRICS*\n\n`;
      message += `📝 *Title:* ${lyrics.title || 'Unknown'}\n`;
      message += `👤 *Artist:* ${lyrics.artist || 'Unknown'}\n`;
      message += `🔗 *Source:* ${lyrics.source || 'Unknown'}\n`;
      message += `\n━━━━━━━━━━━━━━━━━\n\n`;
      message += `${lyrics.lyrics || 'Lyrics not available'}\n`;
      message += `\n━━━━━━━━━━━━━━━━━\n`;
      message += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Lyrics Finder`;

      // Send lyrics
      await sock.sendMessage(m.chat, {
        text: message
      }, { quoted: m });

      console.log("[Lyrics] Lyrics sent successfully!");

    } catch (error) {
      console.error("[Lyrics Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};