// baileys-patch.js - Import this FIRST in your main file
import { readFile } from 'fs/promises';

// Patch global fetch to convert streams to buffers for WhatsApp uploads
const originalFetch = global.fetch;

global.fetch = async function(url, options = {}) {
  // Only patch WhatsApp media uploads
  if (url.includes('whatsapp.net') && options.method === 'POST') {
    // If body is a ReadStream, convert to Buffer
    if (options.body && typeof options.body.pipe === 'function') {
      console.log('🔧 Converting stream to buffer for WhatsApp upload...');
      
      const chunks = [];
      for await (const chunk of options.body) {
        chunks.push(chunk);
      }
      
      options.body = Buffer.concat(chunks);
      
      // Ensure Content-Length header is set
      if (!options.headers) {
        options.headers = {};
      }
      
      options.headers['Content-Length'] = options.body.length.toString();
      
      console.log(`✅ Buffer ready: ${options.body.length} bytes`);
    }
  }
  
  return originalFetch(url, options);
};

console.log('✅ Baileys upload patch loaded');

export default {
  patched: true
};