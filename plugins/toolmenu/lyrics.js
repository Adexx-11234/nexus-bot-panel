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
        text: "❌ Please provide a song title!\n\n*Usage:*\n.lyrics <song title>\n\n*Example:*\n.lyrics Bohemian Rhapsody\n.lyrics Shape of You Ed Sheeran\n\n> © Nexus Bot"
      }, { quoted: m });
    }

    const songTitle = args.join(' ');

    // Send processing message
    await sock.sendMessage(m.chat, {
      text: `⏳ Searching for lyrics...\n🎵 "${songTitle}"\n\nPlease wait...\n\n> © Nexus Bot`
    }, { quoted: m });

    // Call lyrics tool
    const result = await tools.lyrics(songTitle);

    // Handle error
    if (!result.success) {
      return await sock.sendMessage(m.chat, {
        text: `❌ Lyrics Search Failed!\n\n*Error:* ${result.error.message}\n\n> © Nexus Bot`
      }, { quoted: m });
    }

    // ✅ Check if result exists (single result, not array)
    if (!result.data.result) {
      return await sock.sendMessage(m.chat, {
        text: `❌ No lyrics found for:\n"${songTitle}"\n\nTry with a different song title or include the artist name.\n\n> © Nexus Bot`
      }, { quoted: m });
    }

    // ✅ Get the result (already the first result from tool)
    const lyrics = result.data.result;

    // ✅ Build response message with correct field names
    let message = `🎵 *SONG LYRICS*\n\n`;
    message += `📝 *Title:* ${lyrics.trackName || lyrics.name || 'Unknown'}\n`;
    message += `👤 *Artist:* ${lyrics.artistName || 'Unknown'}\n`;
    message += `💿 *Album:* ${lyrics.albumName || 'Unknown'}\n`;
    message += `⏱️ *Duration:* ${lyrics.duration ? Math.floor(lyrics.duration / 60) + ':' + (lyrics.duration % 60).toString().padStart(2, '0') : 'Unknown'}\n`;
    message += `\n━━━━━━━━━━━━━━━━━\n\n`;
    
    // ✅ Use plainLyrics instead of lyrics
    const lyricsText = lyrics.plainLyrics || 'Lyrics not available';
    
    // ✅ Truncate if too long (WhatsApp limit ~65000 chars)
    const maxLength = 4000;
    if (lyricsText.length > maxLength) {
      message += lyricsText.substring(0, maxLength);
      message += `\n\n... (Lyrics truncated due to length)\n`;
    } else {
      message += lyricsText;
    }
    
    message += `\n\n━━━━━━━━━━━━━━━━━\n`;
    message += `\n> © Nexus Bot - Lyrics Finder`;

    // Send lyrics
    await sock.sendMessage(m.chat, {
      text: message
    }, { quoted: m });

    //console.log("[Lyrics] Lyrics sent successfully!");
  } catch (error) {
    console.error("[Lyrics Plugin] Error:", error);
    await sock.sendMessage(m.chat, {
      text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © Nexus Bot`
    }, { quoted: m });
  }
},
};