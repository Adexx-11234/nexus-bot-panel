import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { generateWAMessageFromContent, WAProto as proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  name: "Menu",
  description: "Show main bot menu with all available categories",
  commands: ["menu", "start", "bot", "help"],
  adminOnly: false,
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
      captionText += `🎯 Select a menu category below:\n`;
      captionText += `📊 Total Categories: ${folders.length + 1}\n`;
      
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

      // Get local image only (no profile picture)
      let imageBuffer = null;
      console.log("[Menu] Loading local menu image");
      
      const possiblePaths = [
        path.resolve(process.cwd(), "Defaults", "images", "menu.png"),
        path.resolve(process.cwd(), "defaults", "images", "menu.png"), 
        path.resolve(process.cwd(), "assets", "images", "menu.png")
      ];
      
      for (const imagePath of possiblePaths) {
        if (fs.existsSync(imagePath)) {
          imageBuffer = fs.readFileSync(imagePath);
          console.log(`[Menu] Using local image: ${imagePath}`);
          break;
        }
      }
      
      if (!imageBuffer) {
        console.log("[Menu] No local image found, continuing without image");
      }

      // Build menu rows for single_select - FIXED FORMAT
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

      // Prepare header with image if available
      let headerConfig = {
        title: "🤖 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 MENU",
        subtitle: timeGreeting,
        hasMediaAttachment: false
      };

      if (imageBuffer) {
        try {
          const mediaMessage = await prepareWAMessageMedia(
            { image: imageBuffer },
            { upload: sock.waUploadToServer }
          );
          
          headerConfig = {
            title: "🤖 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 MENU",
            subtitle: timeGreeting,
            hasMediaAttachment: true,
            imageMessage: mediaMessage.imageMessage
          };
          console.log("[Menu] Image header prepared successfully");
        } catch (imgErr) {
          console.error("[Menu] Failed to prepare image header:", imgErr.message);
        }
      }

      // Create interactive message with PROPER STRING FORMAT
      const msg = generateWAMessageFromContent(m.chat, {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2
            },
            interactiveMessage: proto.Message.InteractiveMessage.create({
              body: proto.Message.InteractiveMessage.Body.create({
                text: captionText
              }),
              footer: proto.Message.InteractiveMessage.Footer.create({
                text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Select a category"
              }),
              header: proto.Message.InteractiveMessage.Header.create(headerConfig),
              nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                buttons: [
                  {
                    name: "single_select",
                    buttonParamsJson: JSON.stringify({
                      title: "📋 Select Menu",
                      sections: [{
                        title: "Menu Categories",
                        highlight_label: "Popular",
                        rows: menuRows
                      }]
                    })
                  },
                  {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                      display_text: "📶 All Commands",
                      id: `${m.prefix}allmenu`
                    })
                  },
                  {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                      display_text: "ℹ️ Bot Info",
                      id: `${m.prefix}botinfo`
                    })
                  },
                  {
                    name: "cta_url",
                    buttonParamsJson: JSON.stringify({
                      display_text: "💬 Support Channel",
                      url: "https://whatsapp.com/channel/0029VbBK53XBvvslYeZlBe0V",
                      merchant_url: "https://whatsapp.com/channel/0029VbBK53XBvvslYeZlBe0V"
                    })
                  }
                ]
              })
            })
          }
        }
      }, {});

      // Send the message
      await sock.relayMessage(msg.key.remoteJid, msg.message, {
        messageId: msg.key.id
      });

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