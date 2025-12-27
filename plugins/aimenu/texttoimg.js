// plugins/ai/imagine.js

import aiService from '../../lib/ai/index.js';

export default {
  name: "imagine",
  commands: ["imagine", "img", "generate", "draw"],
  description: "Generate images from text descriptions",
  category: "ai",
  usage: "• .imagine <description> - Generate image from text\n• .img <description> - Alternative command",
  permissions: {
    // All false = public command, no restrictions
  },
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an image description!\n\n*Usage:*\n.imagine <description>\n\n*Example:*\n.imagine A futuristic city at sunset with flying cars\n.imagine A cute cat wearing sunglasses\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const prompt = args.join(' ');

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `🎨 *Generating image...*\n\n_"${prompt}"_\n\nThis may take 30-60 seconds...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call AI service (using omegaImage as primary)
      const result = await aiService.omegaImage(prompt, '1:1');

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Image Generation Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Try with a simpler description\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Handle both imageUrl (primary) and imageBuffer (secondary) responses
      let imageBuffer;
      if (result.imageBuffer) {
        // Secondary API returns buffer directly
        imageBuffer = result.imageBuffer;
      } else if (result.imageUrl) {
        // Primary API returns URL - need to download
        try {
          const response = await fetch(result.imageUrl);
          if (response.ok) {
            imageBuffer = Buffer.from(await response.arrayBuffer());
          } else {
            throw new Error('Failed to download generated image');
          }
        } catch (fetchError) {
          console.error('[Imagine] Image download failed:', fetchError.message);
          return await sock.sendMessage(m.chat, {
            text: `❌ Failed to download generated image!\n\n*Error:* ${fetchError.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m });
        }
      } else {
        throw new Error('No image data received');
      }
      // Format caption
      let caption = `🎨 *Image Generated Successfully*\n\n`;
      caption += `📝 *Prompt:* ${prompt}\n`;
      caption += `🤖 *Model:* ${result.model}\n`;
      caption += `⏰ ${result.timestamp}\n\n`;
      caption += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

      // Send image
      await sock.sendMessage(m.chat, {
        image: imageBuffer,
        caption: caption
      }, { quoted: m });

      console.log('[Imagine] Image sent successfully');
      return { success: true };

    } catch (error) {
      console.error("[Imagine Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};