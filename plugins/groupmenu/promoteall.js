export default {
  name: "promoteall",
  commands: ["promoteall"],
  description: "Promote all group members to admin (Owner only)",
        permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},

  async execute(sock, sessionId, args, m) {
    try {


      // Get group metadata
      const groupMetadata = await sock.groupMetadata(m.chat)
      const participants = groupMetadata.participants
      const botNumber = sock.user.id.split(":")[0] + "@s.whatsapp.net"

      // Check if bot is admin
      const botParticipant = participants.find((p) => p.jid === botNumber)
      if (!botParticipant || !botParticipant.admin) {
        return await sock.sendMessage(m.chat, {
          text: "❌ I need to be an admin to promote members!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        })
      }

      // Get non-admin members
      const nonAdmins = participants.filter((p) => !p.admin && p.jid !== botNumber)

      if (nonAdmins.length === 0) {
        return await sock.sendMessage(m.chat, {
          text: "ℹ️ All members are already admins!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        })
      }

      // Promote all non-admin members
      const memberIds = nonAdmins.map((p) => p.jid)

      await sock.groupParticipantsUpdate(m.chat, memberIds, "promote")

      await sock.sendMessage(m.chat, {
        text: `✅ *PROMOTE ALL COMPLETED*\n\n` +
          `👑 Promoted: ${memberIds.length} members\n` +
          `📊 Total admins now: ${participants.length}\n\n` +
          `All group members are now administrators!

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      })

      return { success: true, promoted: memberIds.length }
    } catch (error) {
      console.error("[PromoteAll] Error:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Error promoting all members!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
      })
      return { success: false, error: error.message }
    }
  },
}
