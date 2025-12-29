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
      captionText += `🎯 Select a menu category from the list below.\n`;
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

      // Build rows for classic WhatsApp listMessage
      const rows = [];

      // All commands first
      rows.push({
        title: "📶 All Commands",
        rowId: `${m.prefix}allmenu`,
        description: "View all available commands in one list",
      });

      // One row per category
      for (const folder of sortedFolders) {
        const emoji = menuSystem.getMenuEmoji(folder.name);
        rows.push({
          title: `${emoji} ${folder.displayName}`,
          rowId: `${m.prefix}${folder.name.toLowerCase()}`,
          description: `View ${folder.displayName.toLowerCase()} commands`,
        });
      }

      const sections = [
        {
          title: "Menu Categories",
          rows,
        },
      ];

      // Send Baileys listMessage
      await sock.sendMessage(
        m.chat,
        {
          text: captionText,
          footer: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Select a category",
          title: "🤖 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 MENU",
          buttonText: "📋 Open Menu",
          sections,
        },
        { quoted: m },
      );

      console.log("[Menu] List menu sent successfully!");
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