export default {
  name: "Galaxy Form",
  description: "Send a galaxy_message native flow form",
  commands: ["galaxy", "galaxyform"],
  permissions: {},
  category: "mainmenu",
  usage: "• .galaxy - Send galaxy form",

  async execute(sock, sessionId, args, m) {
    try {
      console.log("[Galaxy] Sending galaxy_message form...");

      const buttons = [
        {
          name: "galaxy_message",
          buttonParamsJson: JSON.stringify({
            mode: "published",
            flow_message_version: "3",
            flow_token: "1:1307913409923914:293680f87029f5a13d1ec5e35e718af3",
            flow_id: "1307913409923914",
            flow_cta: "Here is button form",
            flow_action: "navigate",
            flow_action_payload: {
              screen: "QUESTION_ONE",
              params: {
                user_id: "123456789",
                referral: "campaign_xyz"
              }
            },
            flow_metadata: {
              flow_json_version: "201",
              data_api_protocol: "v2",
              flow_name: "Lead Qualification [en]",
              data_api_version: "v2",
              categories: ["Lead Generation", "Sales"]
            }
          })
        }
      ];

      await sock.relayMessage(
        m.chat,
        {
          interactiveMessage: {
            title: "🛰️ Galaxy Form",
            footer: "© Nexus Bot - Galaxy",
            nativeFlowMessage: { buttons }
          }
        },
        { quoted: m }
      );

      console.log("[Galaxy] Form sent successfully!");
      return { success: true };
    } catch (error) {
      console.error("[Galaxy] Error:", error);
      await sock.sendMessage(
        m.chat,
        { text: `❌ Galaxy Form Failed: ${error.message}` },
        { quoted: m }
      );
      return { success: false, error: error.message };
    }
  }
};