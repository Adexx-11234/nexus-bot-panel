import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  name: "Menu",
  description: "Show main bot menu with all available categories",
  commands: ["menu", "start", "bot", "help"],
  permissions: {},
  category: "mainmenu",
  usage: "• .menu - Show complete menu with all categories",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check connection state first
      if (!sock || !sock.user) {
        console.log("[Menu] Socket not ready, retrying...");
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!sock || !sock.user) {
          throw new Error("Bot connection not ready");
        }
      }

      // Import menu system
      let menuSystem;
      try {
        const menuModule = await import("../../utils/menu-system.js");
        menuSystem = menuModule.default;
      } catch (err) {
        console.error("[Menu] Failed to import menu system:", err);
        throw new Error("Menu system not available");
      }
      
      // Get user info
      const userInfo = {
        name: m.pushName || m.sender?.split('@')[0] || "User",
        id: m.sender,
      };
      
      // Get menu folders
      const folders = await Promise.race([
        menuSystem.scanMenuFolders(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
      ]);
      
      const currentTime = new Date();
      const timeGreeting = menuSystem.getTimeGreeting();
      
      // Build caption text
      let captionText = `┌─❖\n`;
      captionText += `│ 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙\n`;
      captionText += `└┬❖\n`;
      captionText += `┌┤ ${timeGreeting}\n`;
      captionText += `│└────────┈⳹\n`;
      captionText += `│👤 ᴜsᴇʀ: ${userInfo.name}\n`;
      captionText += `│📅 ᴅᴀᴛᴇ: ${currentTime.toLocaleDateString()}\n`;
      captionText += `│⏰ ᴛɪᴍᴇ: ${currentTime.toLocaleTimeString()}\n`;
      captionText += `│🛠 ᴠᴇʀsɪᴏɴ: 1.0.0\n`;
      captionText += `└─────────────┈⳹\n\n`;
      captionText += `🎯 Welcome to Nexus Bot!\n`;
      captionText += `📊 Total Categories: ${folders.length + 1}\n`;
      captionText += `\nUse the buttons below to explore all menu categories.`;
      
      // Priority order for menus
      const priorityMenus = [
        'mainmenu', 'groupmenu', 'downloadmenu', 'gamemenu', 
        'aimenu', 'ownermenu', 'convertmenu', 'bugmenu'
      ];
      
      // Sort folders by priority
      const sortedFolders = folders.sort((a, b) => {
        const aIndex = priorityMenus.indexOf(a.name.toLowerCase());
        const bIndex = priorityMenus.indexOf(b.name.toLowerCase());
        if (aIndex === -1 && bIndex === -1) return a.name.localeCompare(b.name);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });

      // Get local image
      let imageUrl = null;
      console.log("[Menu] Loading local menu image");
      
      const possiblePaths = [
        path.resolve(process.cwd(), "Defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "defaults", "images", "menu.png"), 
        path.resolve(process.cwd(), "assets", "images", "menu.png")
      ];
      
      for (const imagePath of possiblePaths) {
        if (fs.existsSync(imagePath)) {
          const imageBuffer = fs.readFileSync(imagePath);
          const base64Image = imageBuffer.toString('base64');
          imageUrl = `data:image/png;base64,${base64Image}`;
          console.log(`[Menu] Using local image: ${imagePath}`);
          break;
        }
      }
      
      if (!imageUrl) {
        console.log("[Menu] No local image found, using placeholder");
        imageUrl = "https://via.placeholder.com/800x400/1a1a1a/00ff00?text=Nexus+Bot";
      }

      // Build menu sections with rows
      const menuSections = [];
      
      // Section 1: Main Commands
      const mainRows = [
        {
          title: "📶 All Menu",
          description: "View all available commands",
          id: `${m.prefix}allmenu`
        },
        {
          title: "ℹ️ Bot Info",
          description: "Get bot information and stats",
          id: `${m.prefix}botinfo`
        }
      ];
      
      menuSections.push({
        title: "Main Commands",
        highlight_label: "Popular",
        rows: mainRows
      });

      // Section 2: Category Menus
      const categoryRows = [];
      for (const folder of sortedFolders) {
        const emoji = menuSystem.getMenuEmoji(folder.name);
        categoryRows.push({
          title: `${emoji} ${folder.displayName}`,
          description: `View ${folder.displayName.toLowerCase()} commands`,
          id: `${m.prefix}${folder.name.toLowerCase()}`
        });
      }
      
      menuSections.push({
        title: "Menu Categories",
        highlight_label: "Explore",
        rows: categoryRows
      });

      // Build the enhanced interactive message with native flow
      await sock.sendMessage(m.chat, {
        interactiveMessage: {
          title: captionText,
          footer: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Powered by Nexus Technology",
          image: { url: imageUrl },
          nativeFlowMessage: {
            messageParamsJson: JSON.stringify({
              limited_time_offer: {
                text: "🎁 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 Menu Command",
                url: "https://whatsapp.com/channel/0029VbBK53XBvvslYeZlBe0V",
                copy_code: `NEXUS${Date.now().toString().slice(-6)}`,
                expiration_time: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
              },
              bottom_sheet: {
                in_thread_buttons_limit: 2,
                divider_indices: [0, 1, 2],
                list_title: "📋 Nexus Bot Menu",
                button_title: "Select Category"
              },
              tap_target_configuration: {
                title: "🌐 Nexus Bot",
                description: "Advanced WhatsApp Bot with AI Integration",
                canonical_url: "https://whatsapp.com/channel/0029VbBK53XBvvslYeZlBe0V",
                domain: "nexusbot.example.com",
                button_index: 0
              }
            }),
            buttons: [
              // Button 1: Initial single_select placeholder
              {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                  has_multiple_buttons: true
                })
              },
              // Button 2: Call permission request
              {
                name: "call_permission_request",
                buttonParamsJson: JSON.stringify({
                  has_multiple_buttons: true
                })
              },
              // Button 3: Main menu single_select with sections
              {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                  title: "📋 Select Menu Category",
                  sections: menuSections,
                  has_multiple_buttons: true
                })
              },
              // Button 4: Copy bot prefix code
              {
                name: "cta_copy",
                buttonParamsJson: JSON.stringify({
                  display_text: "📋 Copy Bot Prefix",
                  id: "bot_prefix_copy",
                  copy_code: m.prefix || "."
                })
              },
              // Button 5: Quick access to all commands
              {
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                  display_text: "📶 All Commands",
                  id: `${m.prefix}allmenu`
                })
              },
              // Button 6: Support channel URL
              {
                name: "cta_url",
                buttonParamsJson: JSON.stringify({
                  display_text: "💬 Join Support Channel",
                  url: "https://whatsapp.com/channel/0029VbBK53XBvvslYeZlBe0V",
                  merchant_url: "https://whatsapp.com/channel/0029VbBK53XBvvslYeZlBe0V"
                })
              }
            ]
          }
        }
      }, { quoted: m });

      console.log("[Menu] Enhanced interactive menu with native flow sent successfully!");
      return { success: true };
      
    } catch (error) {
      console.error("[Menu] Critical Error:", error);
      
      // Fallback to text-only menu
      try {
        let fallbackText = `❌ Interactive menu failed, here's text version:\n\n`;
        
        const menuModule = await import("../../utils/menu-system.js");
        const menuSystem = menuModule.default;
        const folders = await menuSystem.scanMenuFolders();
        
        fallbackText += `🎯 *𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 MENU*\n\n`;
        fallbackText += `📶 *.allmenu* - View all commands\n`;
        fallbackText += `ℹ️ *.botinfo* - Bot information\n\n`;
        
        fallbackText += `*Menu Categories:*\n`;
        for (const folder of folders) {
          const emoji = menuSystem.getMenuEmoji(folder.name);
          fallbackText += `${emoji} *.${folder.name.toLowerCase()}*\n`;
        }
        
        fallbackText += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`;
        
        await sock.sendMessage(m.chat, { 
          text: fallbackText
        }, { quoted: m });
      } catch (finalError) {
        console.error("[Menu] Even fallback failed:", finalError);
        await sock.sendMessage(m.chat, { 
          text: `❌ Menu Error: ${error.message}\n\nType *.allmenu* for text-only menu.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m });
      }
      
      return { success: false, error: error.message };
    }
  },
};