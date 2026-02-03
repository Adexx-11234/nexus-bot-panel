// plugins/tools/screenshot.js

import tools from '../../lib/tools/index.js';

export default {
  name: "screenshot",
  commands: ["screenshot", "ss", "webss", "sitess"],
  description: "Take screenshot of any website",
  category: "toolmenu",
  usage: "• .screenshot <url> - Take website screenshot\n• .ss <url> - Short command",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Validate input
      if (!args[0]) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide a website URL!\n\n*Usage:*\n.screenshot <website_url>\n\n*Example:*\n.ss https://google.com\n.screenshot https://github.com\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      let websiteUrl = args[0];

      // Add https:// if not present
      if (!websiteUrl.startsWith('http://') && !websiteUrl.startsWith('https://')) {
        websiteUrl = 'https://' + websiteUrl;
      }

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: `⏳ Taking screenshot of:\n${websiteUrl}\n\nThis may take a moment...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });

      // Call screenshot tool
      const result = await tools.screenshot(websiteUrl);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Screenshot Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Send the screenshot
      await sock.sendMessage(m.chat, {
        image: result.data.buffer,
        caption: `✅ *Website Screenshot*\n\n🔗 *URL:* ${result.data.url}\n\n📸 Screenshot captured successfully!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Screenshot Tool`
      }, { quoted: m });

      //console.log("[Screenshot] Screenshot sent successfully!");

    } catch (error) {
      console.error("[Screenshot Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};