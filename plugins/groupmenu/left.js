export default {
  name: "Left",
  description: "Leave a group immediately",
  commands: ["left", "leave", "bye"],
  category: "group",
  adminOnly: false,
  usage: "• `.left` - Leave the current group immediately",
  
  async execute(sock, sessionId, args, m) {
    try {
      // Check if command is used in a group
      if (!m.isGroup) {
        return await sock.sendMessage(m.chat, {
          text: `❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      const groupJid = m.chat;
      const userJid = m.sender;

      //console.log(`[Left] User ${userJid} is leaving group ${groupJid}`);

      // Leave the group immediately (no message sent)
      await sock.groupLeave(groupJid);

      //console.log(`[Left] Successfully left group ${groupJid}`);

    } catch (error) {
      console.error("[Left] Error leaving group:", error);
      
      // Only send error if still in group
      try {
        await sock.sendMessage(m.chat, {
          text: `❌ Failed to leave group!\n\n*Error:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      } catch (sendError) {
        console.error("[Left] Could not send error message:", sendError);
      }
    }
  },
};
