// plugins/download/soundcloud.js

import downloader, { downloadMedia } from '../../lib/downloaders/index.js';

export default {
  name: "soundcloud",
  commands: ["soundcloud", "sc", "scdl"],
  description: "Download SoundCloud tracks",
  category: "download",
  usage: "• .soundcloud <url> - Download SoundCloud track\n• .sc <url> - Short command",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if this is a direct download call (from button)
      const fullText = args.join(' ');
      if (fullText.startsWith('http') && fullText.includes('sndcdn.com')) {
        return await downloadSoundCloudDirect(sock, m, fullText);
      }

      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a SoundCloud URL!\n\n*Usage:*\n.soundcloud <soundcloud_url>\n\n*Example:*\n.sc https://soundcloud.com/artist/track\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Downloading SoundCloud track...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call downloader
      const result = await downloader.soundcloud(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send as audio with thumbnail (uiType: 'audio')
      return await sendSoundCloudAudio(sock, m, result);

    } catch (error) {
      console.error("[SoundCloud Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Direct download from button click - FIXED WITH BUFFER
 */
async function downloadSoundCloudDirect(sock, m, url) {
  try {
    await sock.sendMessage(m.chat, {
      text: `⏳ Downloading audio...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });

    // Download the media and get buffer
    const mediaData = await downloadMedia(url);

    // Send the audio directly
    await sock.sendMessage(m.chat, {
      audio: mediaData.buffer,
      mimetype: 'audio/mpeg',
      fileName: `soundcloud_${Date.now()}.mp3`,
    }, { quoted: m });

    return { success: true };
  } catch (error) {
    console.error("[SoundCloud Direct] Error:", error);
    await sock.sendMessage(m.chat, {
      text: `❌ Download failed: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }, { quoted: m });
  }
}

/**
 * Send SoundCloud audio with thumbnail (uiType: 'audio')
 */
async function sendSoundCloudAudio(sock, m, result) {
  try {
    const { data } = result;

    // Fetch thumbnail
    let thumbnailBuffer = null;
    if (data.thumbnail) {
      try {
        const response = await fetch(data.thumbnail);
        if (response.ok) {
          thumbnailBuffer = Buffer.from(await response.arrayBuffer());
        }
      } catch (err) {
        console.error("[SoundCloud] Thumbnail fetch failed:", err.message);
      }
    }

    // Get audio URL
    const audioUrl = data.downloads[0]?.url;
    if (!audioUrl) {
      throw new Error("No audio download URL found");
    }

    // Download audio to buffer
    const mediaData = await downloadMedia(audioUrl);

    // Build caption
    let caption = `🔊 *SoundCloud Track*\n\n`;
    caption += `📝 *Title:* ${data.title}\n`;
    caption += `👤 *Artist:* ${data.author.name}\n`;
    caption += `\n✅ Downloaded successfully!\n`;
    caption += `\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - SoundCloud Downloader`;

    // Prepare context info with thumbnail
    let contextInfo = {};
    if (thumbnailBuffer) {
      contextInfo = {
        externalAdReply: {
          title: data.title,
          body: data.author.name,
          thumbnailUrl: data.thumbnail,
          sourceUrl: audioUrl,
          mediaType: 2,
          mediaUrl: data.thumbnail,
          renderLargerThumbnail: true,
        }
      };
    }

    // Send audio with thumbnail
    await sock.sendMessage(m.chat, {
      audio: mediaData.buffer,
      mimetype: 'audio/mpeg',
      fileName: `${data.title}.mp3`,
      contextInfo,
      ptt: false,
    }, { quoted: m });

    // Send caption separately with thumbnail image
    if (thumbnailBuffer) {
      await sock.sendMessage(m.chat, {
        image: thumbnailBuffer,
        caption: caption
      }, { quoted: m });
    } else {
      await sock.sendMessage(m.chat, {
        text: caption
      }, { quoted: m });
    }

    console.log("[SoundCloud] Audio sent successfully!");
    return { success: true };

  } catch (error) {
    console.error("[SoundCloud Audio] Error:", error);
    throw error;
  }
}