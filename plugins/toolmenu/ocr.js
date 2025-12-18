// plugins/tools/ocr.js

import tools from '../../lib/tools/index.js';
import { uploadDeline } from '../../lib/tools/index.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

export default {
  name: "ocr",
  commands: ["ocr", "readtext", "extracttext", "imgtotxt", "imagetotext"],
  description: "Extract text from images using OCR",
  category: "toolmenu",
  usage: "• .ocr <image_url> - Extract text from image\n• .ocr <reply to image> - Extract text from replied image\n• Send image with caption: .ocr",
  
  async execute(sock, sessionId, args, m) {
    try {
      let imageUrl = null;

      // Check if current message has image (sent with caption)
      if (m.message && (m.message.imageMessage || m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage)) {
        const imageMsg = m.message.imageMessage;
        if (imageMsg) {
          await sock.sendMessage(m.chat, {
            text: "⏳ Processing image...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m });
          
          try {
            const buffer = await downloadMediaMessage(
              m,
              'buffer',
              {},
              { 
                logger: console,
                reuploadRequest: sock.updateMediaMessage
              }
            );
            
            imageUrl = await uploadDeline(buffer, 'jpg', 'image/jpeg');
          } catch (downloadError) {
            console.error('[OCR] Download error:', downloadError);
            return await sock.sendMessage(m.chat, {
              text: "❌ Failed to download image!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
            }, { quoted: m });
          }
        }
      }

      // Check if replying to an image
      if (!imageUrl && m.quoted && m.quoted.message) {
        const quotedMsg = m.quoted.message;
        if (quotedMsg.imageMessage) {
          await sock.sendMessage(m.chat, {
            text: "⏳ Processing quoted image...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m });
          
          try {
            const buffer = await downloadMediaMessage(
              m.quoted,
              'buffer',
              {},
              { 
                logger: console,
                reuploadRequest: sock.updateMediaMessage
              }
            );
            
            imageUrl = await uploadDeline(buffer, 'jpg', 'image/jpeg');
          } catch (downloadError) {
            console.error('[OCR] Download error:', downloadError);
            return await sock.sendMessage(m.chat, {
              text: "❌ Failed to download image!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
            }, { quoted: m });
          }
        }
      }

      // Check if URL provided in args
      if (!imageUrl && args[0] && args[0].startsWith('http')) {
        imageUrl = args[0];
      }

      // Validate input
      if (!imageUrl) {
        return await sock.sendMessage(m.chat, {
          text: "❌ Please provide an image URL or reply to an image!\n\n*Usage:*\n• .ocr <image_url>\n• .ocr <reply to image>\n• Send image with caption: .ocr\n\n*Example:*\n.ocr https://example.com/image.jpg\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m });
      }

      // Send processing message
      await sock.sendMessage(m.chat, {
        text: "⏳ Extracting text from image...\nThis may take a moment...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m });

      // Call OCR tool
      const result = await tools.ocr(imageUrl);

      // Handle error
      if (!result.success) {
        return await sock.sendMessage(m.chat, {
          text: `❌ Text Extraction Failed!\n\n*Error:* ${result.error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Check if text was found
      if (!result.data.text || result.data.text.trim() === '') {
        return await sock.sendMessage(m.chat, {
          text: `❌ No text found in the image!\n\nMake sure the image contains readable text.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m });
      }

      // Build response message
      let message = `📝 *TEXT EXTRACTED*\n\n`;
      message += `━━━━━━━━━━━━━━━━━\n\n`;
      message += `${result.data.text}\n`;
      message += `\n━━━━━━━━━━━━━━━━━\n`;
      message += `\n✅ Text extracted successfully!\n`;
      message += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - OCR Tool`;

      // Send extracted text
      await sock.sendMessage(m.chat, {
        text: message
      }, { quoted: m });

      console.log("[OCR] Text extracted and sent successfully!");

    } catch (error) {
      console.error("[OCR Plugin] Error:", error);
      await sock.sendMessage(m.chat, {
        text: `❌ An error occurred!\n\n*Details:* ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m });
    }
  },
};