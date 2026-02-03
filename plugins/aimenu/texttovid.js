// plugins/ai/vgen.js

import aiService from '../../lib/ai/index.js';
import { downloadMedia } from '../../lib/downloaders/index.js';

export default {
  name: "vgen",
  commands: ["vgen", "video", "sora", "genvideo"],
  description: "Generate videos from text descriptions using Sora AI",
  category: "ai",
  usage: "• .vgen <description> - Generate video from text\n• .sora <description> - Alternative command",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a video description!\n\n*Usage:*\n.vgen <description>\n\n*Example:*\n.vgen A drone flying over a beautiful beach at sunrise\n.vgen A cat playing with a ball of yarn\n\n*Note:* Video generation takes 2-3 minutes\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      const prompt = args.join(' ');

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `🎬 *Generating video with Sora AI...*\n\n_"${prompt}"_\n\nThis will take 2-3 minutes. Please be patient...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call AI service
      const result = await aiService.sora(prompt);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Video Generation Failed!\n\n*Error:* ${result.error.message}\n\n*Tip:* Try with a simpler description or try again later\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send download progress message
      await sock.sendMessage(m.chat, {
        text: `⏳ Video generated! Downloading...\n\nPlease wait...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Download the generated video
      let videoFile;
      try {
        videoFile = await downloadMedia(result.videoUrl, `sora_${Date.now()}.mp4`);
      } catch (downloadError) {
        console.error('[VGen] Video download failed:', downloadError.message);
        return await sock.sendMessage(m.chat, {
          text: `❌ Failed to download generated video!\n\n*Video URL:* ${result.videoUrl}\n\n*Error:* ${downloadError.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      try {
        // Read video file
        const fs = await import('fs');
        const videoBuffer = fs.readFileSync(videoFile.filePath);

        // Format caption
        let caption = `🎬 *Video Generated Successfully*\n\n`;
        caption += `📝 *Prompt:* ${prompt}\n`;
        caption += `🤖 *Model:* ${result.model}\n`;
        caption += `⏰ ${result.timestamp}\n\n`;
        caption += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;

        // Send video
        await sock.sendMessage(m.chat, {
          video: videoBuffer,
          caption: caption,
          mimetype: 'video/mp4'
        }, { quoted: m });

        //console.log('[VGen] Video sent successfully');
        
        // Cleanup temp file
        videoFile.cleanup();

      } catch (sendError) {
        console.error('[VGen] Send error:', sendError);
        videoFile.cleanup();
        throw sendError;
      }

      return { success: true };

    } catch (error) {
      console.error("[VGen Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};