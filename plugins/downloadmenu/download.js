// plugins/download/aio.js

import downloader from '../../lib/downloaders/index.js';

export default {
  name: "aio",
  commands: ["dl", "download", "aio"],
  description: "Universal downloader - auto-detects platform",
  category: "download",
  usage: "• .dl <url> - Download from any supported platform\n• .download <url> - Universal download",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Please provide a URL!\n\n*Supported Platforms:*\n• Instagram\n• TikTok\n• YouTube\n• Facebook\n• Twitter/X\n• Spotify\n• SoundCloud\n• Pinterest\n• Capcut\n• Google Drive\n• MediaFire\n\n*Usage:*\n.dl <url>

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      const url = args[0];

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Detecting platform and downloading...\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call universal downloader
      const result = await downloader.download(url);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Download Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Try using platform-specific commands like:\n• .ig for Instagram\n• .tiktok for TikTok\n• .yt for YouTube

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Route to appropriate handler based on platform
      const platformHandlers = {
        instagram: () => import('./igdl.js'),
        tiktok: () => import('./tiktokdl.js'),
        youtube: () => import('./ytdl.js'),
        facebook: () => import('./fbdl.js'),
        twitter: () => import('./twitterdl.js'),
        spotify: () => import('./spotifydl.js'),
        soundcloud: () => import('./soundcloud.js'),
        pinterest: () => import('./pinterestdl.js'),
        capcut: () => import('./capcutdl.js'),
        gdrive: () => import('./gdrive.js'),
        mediafire: () => import('./mediafire.js'),
      };

      // Get platform handler
      const handlerImport = platformHandlers[result.platform];
      
      if (!handlerImport) {
        // Fallback to simple message
        return await sendAIOFallback(sock, m, result);
      }

      // Import and use platform-specific handler
      const handler = await handlerImport();
      
      // Use platform-specific sender based on uiType
      if (result.uiType === 'carousel') {
        const sendFunction = handler[`send${capitalize(result.platform)}Carousel`];
        if (sendFunction) {
          return await sendFunction(sock, m, result);
        }
      } else if (result.uiType === 'buttons') {
        const sendFunction = handler[`send${capitalize(result.platform)}Buttons`];
        if (sendFunction) {
          return await sendFunction(sock, m, result);
        }
      } else if (result.uiType === 'audio') {
        const sendFunction = handler[`send${capitalize(result.platform)}Audio`];
        if (sendFunction) {
          return await sendFunction(sock, m, result);
        }
      } else {
        const sendFunction = handler[`send${capitalize(result.platform)}Direct`];
        if (sendFunction) {
          return await sendFunction(sock, m, result);
        }
      }

      // Final fallback
      return await sendAIOFallback(sock, m, result);

    } catch (error) {
      console.error("[AIO Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n*Tip:* Try using the platform-specific command instead.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};

/**
 * Fallback sender for AIO when platform handlers aren't available
 */
async function sendAIOFallback(sock, m, result) {
  try {
    const { data, platform } = result;

    let message = `✅ *Download Ready*\n\n`;
    message += `🌐 *Platform:* ${capitalize(platform)}\n`;
    
    if (data.title) {
      message += `📝 *Title:* ${data.title}\n`;
    }
    
    if (data.author?.name) {
      message += `👤 *Author:* ${data.author.name}\n`;
    }

    if (data.downloads && data.downloads.length > 0) {
      message += `\n📥 *Available Downloads:*\n`;
      data.downloads.forEach((download, idx) => {
        message += `${idx + 1}. ${download.quality || 'Download'} (${download.format})${download.size ? ` - ${download.size}` : ''}\n`;
      });
      
      message += `\n🔗 Use platform-specific command for direct download:\n`;
      const commands = {
        instagram: '.ig',
        tiktok: '.tiktok',
        youtube: '.yt',
        facebook: '.fb',
        twitter: '.twitter',
        spotify: '.spotify',
        soundcloud: '.sc',
        pinterest: '.pin',
        capcut: '.cc',
        gdrive: '.gd',
        mediafire: '.mf'
      };
      message += `${commands[platform] || '.dl'} <url>`;
    }

    message += `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Universal Downloader`;

    await sock.sendMessage(m.chat, {
      text: message
    }, { quoted: m });

    return { success: true };

  } catch (error) {
    console.error("[AIO Fallback] Error:", error);
    throw error;
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}