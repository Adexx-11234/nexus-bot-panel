export default {
  name: "demoteall",
  commands: ["demoteall"],
  description: "Demote all group admins to regular members (Owner only)",
  adminOnly: true,

  async execute(sock, sessionId, args, m) {
    try {
      // Check if it's a group
      if (!m.isGroup) {
        return await sock.sendMessage(m.chat, {
          text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        })
      }
  const adminChecker = new AdminChecker()
  const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
  if (!isAdmin) {
    return { response: "❌ Only group admins can use this command!" }
  }
  
      // Get group metadata
      const groupMetadata = await sock.groupMetadata(m.chat)
      const participants = groupMetadata.participants
      const botNumber = sock.user.id.split(":")[0] + "@s.whatsapp.net"

      // Check if bot is admin
      const botParticipant = participants.find((p) => p.id === botNumber)
      if (!botParticipant || !botParticipant.admin) {
        return await sock.sendMessage(m.chat, {
          text: "❌ I need to be an admin to demote members!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        })
      }

      // Get admin members (excluding bot and command sender)
      const admins = participants.filter((p) => p.admin && p.id !== botNumber && p.id !== m.sender)

      if (admins.length === 0) {
        return await sock.sendMessage(m.chat, {
          text: "ℹ️ No other admins to demote!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        })
      }

      // Demote all admin members
      const adminIds = admins.map((p) => p.id)

      await sock.groupParticipantsUpdate(m.chat, adminIds, "demote")

      await sock.sendMessage(m.chat, {
        text: `✅ *DEMOTE ALL COMPLETED*\n\n` +
          `👤 Demoted: ${adminIds.length} admins\n` +
          `👑 Remaining admins: You and Bot\n\n` +
          `All other admins have been demoted to regular members!

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      })

      return { success: true, demoted: adminIds.length }
    } catch (error) {
      console.error("[DemoteAll] Error:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Error demoting all admins!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
      })
      return { success: false, error: error.message }
    }
  },
}
