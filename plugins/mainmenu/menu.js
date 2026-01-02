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
      
      // Build caption text (no duplicate categories here)
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
      captionText += `\nUse the button below to explore all menu categories.`;
      
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
          // Convert to base64 data URL for direct use
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

      // Build menu rows for single_select
      const menuRows = [];

      // Add allmenu first
      menuRows.push({
        header: "📶 All Commands",
        title: "All Menu",
        description: "View all available commands",
        id: `${m.prefix}allmenu`
      });

      // Add each menu category
      for (const folder of sortedFolders) {
        const emoji = menuSystem.getMenuEmoji(folder.name);
        menuRows.push({
          header: emoji,
          title: folder.displayName,
          description: `View ${folder.displayName.toLowerCase()} commands`,
          id: `${m.prefix}${folder.name.toLowerCase()}`
        });
      }

      // Build the interactive message using the new method
      await sock.sendMessage(m.chat, {
        interactiveMessage: {
          title: captionText,
          footer: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Select a category",
          image: { url: imageUrl },
          nativeFlowMessage: {
            messageParamsJson: JSON.stringify({
              bottom_sheet: {
                in_thread_buttons_limit: 3,
                divider_indices: [0],
                list_title: "Menu Categories",
                button_title: "📋 Select Menu"
              }
            }),
            buttons: [
              // Single select menu
              {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                  title: "📋 Select Menu",
                  sections: [
                    {
                      title: "Menu Categories",
                      highlight_label: "Popular",
                      rows: menuRows
                    }
                  ]
                })
              },
              // Quick reply: All Commands
              {
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                  display_text: "📶 All Commands",
                  id: `${m.prefix}allmenu`
                })
              },
              // Quick reply: Bot Info
              {
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                  display_text: "ℹ️ Bot Info",
                  id: `${m.prefix}botinfo`
                })
              },
              // CTA URL: Support Channel
              {
                name: "cta_url",
                buttonParamsJson: JSON.stringify({
                  display_text: "💬 Support Channel",
                  url: "https://whatsapp.com/channel/0029VbBK53XBvvslYeZlBe0V",
                  merchant_url: "https://whatsapp.com/channel/0029VbBK53XBvvslYeZlBe0V"
                })
              }
            ]
          }
        }
      }, { quoted: m });

      console.log("[Menu] Interactive menu sent successfully!");
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
        fallbackText += `📶 *.allmenu* - View all commands\n\n`;
        
        for (const folder of folders) {
          const emoji = menuSystem.getMenuEmoji(folder.name);
          fallbackText += `${emoji} *.${folder.name.toLowerCase()}*\n`;
        }
        
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