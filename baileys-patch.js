// baileys-patch.js - Import this FIRST
import axios from 'axios';

const originalFetch = global.fetch;

global.fetch = async function(url, options = {}) {
  // Only patch WhatsApp media uploads
  if (url.includes('whatsapp.net') && options.method === 'POST') {
    console.log('🔧 Using axios for WhatsApp upload instead of fetch...');
    
    let body = options.body;
    
    // Convert stream to buffer if needed
    if (body && typeof body.pipe === 'function') {
      const chunks = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
      console.log(`✅ Buffer ready: ${body.length} bytes`);
    }
    
    try {
      // Use axios instead of fetch (more reliable for large uploads)
      const response = await axios({
        method: 'POST',
        url: url,
        data: body,
        headers: {
          ...options.headers,
          'Content-Type': 'application/octet-stream',
          'Content-Length': body.length
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 120000, // 2 minutes
        validateStatus: () => true // Don't throw on any status
      });
      
      console.log(`✅ Upload successful: ${response.status}`);
      
      // Convert axios response to fetch-like Response
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
        json: async () => response.data,
        text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
      };
      
    } catch (error) {
      console.error(`❌ Axios upload failed: ${error.message}`);
      throw new TypeError(`fetch failed: ${error.message}`);
    }
  }
  
  // For non-WhatsApp requests, use original fetch
  return originalFetch(url, options);
};

console.log('✅ Baileys upload patch with axios loaded');

export default { patched: true };