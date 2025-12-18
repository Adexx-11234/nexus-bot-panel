// lib/tools/index.js - Tools service for various utilities

import { request } from 'undici';
import axios from 'axios';
import FormData from 'form-data';

const API_BASE = 'https://api.deline.web.id';
const REQUEST_TIMEOUT = 60000;

// ============================================
// UTILITY FUNCTIONS
// ============================================

async function makeToolRequest(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `${API_BASE}${endpoint}?${queryString}`;
  
  console.log(`[Tools API] Request:`, url);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  
  try {
    const { body, statusCode, headers } = await request(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: controller.signal,
      bodyTimeout: REQUEST_TIMEOUT,
      headersTimeout: 30000
    });
    
    clearTimeout(timeoutId);
    
    // Check if response is an image (buffer)
    const contentType = headers['content-type'];
    if (contentType && contentType.startsWith('image/')) {
      const chunks = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      return {
        success: true,
        isBuffer: true,
        buffer: Buffer.concat(chunks),
        contentType: contentType
      };
    }
    
    // Otherwise parse as JSON
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    
    const responseText = Buffer.concat(chunks).toString();
    const data = JSON.parse(responseText);
    
    return {
      success: true,
      isBuffer: false,
      data: data
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

const uploadDeline = async (buffer, ext = "bin", mime = "application/octet-stream") => {
  const fd = new FormData();
  fd.append("file", new Blob([buffer], { type: mime }), `file.${ext}`);
  const res = await axios.post("https://api.deline.web.id/uploader", fd, {
    maxBodyLength: 50 * 1024 * 1024,
    maxContentLength: 50 * 1024 * 1024,
  });
  const data = res.data || {};
  if (data.status === false) {
    throw new Error(data.message || data.error || "Upload failed");
  }
  const link = data?.result?.link || data?.url || data?.path;
  if (!link) throw new Error("Invalid response (no link found)");
  return link;
};

// ============================================
// TOOL FUNCTIONS
// ============================================

/**
 * Enhance image quality to HD
 */
async function imageToHD(imageUrl) {
  try {
    console.log('[Tools] Converting image to HD...');
    
    const result = await makeToolRequest('/tools/hd', { url: imageUrl });
    
    if (result.isBuffer) {
      return {
        success: true,
        tool: 'hd',
        data: {
          buffer: result.buffer,
          contentType: result.contentType
        }
      };
    }
    
    throw new Error('Expected image buffer response');
  } catch (error) {
    console.error('[Tools HD] Error:', error.message);
    return {
      success: false,
      tool: 'hd',
      error: { message: error.message, code: 'HD_ERROR' }
    };
  }
}

/**
 * Get song lyrics
 */
async function getLyrics(songTitle) {
  try {
    console.log('[Tools] Fetching lyrics for:', songTitle);
    
    const result = await makeToolRequest('/tools/lyrics', { title: songTitle });
    
    if (!result.data || !result.data.status) {
      throw new Error('Failed to fetch lyrics');
    }
    
    return {
      success: true,
      tool: 'lyrics',
      data: {
        results: result.data.result || [],
        query: songTitle
      }
    };
  } catch (error) {
    console.error('[Tools Lyrics] Error:', error.message);
    return {
      success: false,
      tool: 'lyrics',
      error: { message: error.message, code: 'LYRICS_ERROR' }
    };
  }
}

/**
 * OCR - Extract text from image
 */
async function extractText(imageUrl) {
  try {
    console.log('[Tools] Extracting text from image...');
    
    const result = await makeToolRequest('/tools/ocr', { url: imageUrl });
    
    if (!result.data || !result.data.status) {
      throw new Error('Failed to extract text');
    }
    
    return {
      success: true,
      tool: 'ocr',
      data: {
        text: result.data.Text || '',
        creator: result.data.creator
      }
    };
  } catch (error) {
    console.error('[Tools OCR] Error:', error.message);
    return {
      success: false,
      tool: 'ocr',
      error: { message: error.message, code: 'OCR_ERROR' }
    };
  }
}

/**
 * Generate welcome canvas image
 */
async function generateWelcomeCanvas(username, guildName, memberCount, avatar, background) {
  try {
    console.log('[Tools] Generating welcome canvas...');
    
    const params = {
      username: username,
      guildName: guildName,
      memberCount: memberCount.toString(),
      avatar: avatar,
      background: background,
      quality: '99'
    };
    
    const result = await makeToolRequest('/canvas/welcome', params);
    
    if (result.isBuffer) {
      return {
        success: true,
        tool: 'canvas-welcome',
        data: {
          buffer: result.buffer,
          contentType: result.contentType
        }
      };
    }
    
    throw new Error('Expected image buffer response');
  } catch (error) {
    console.error('[Tools Canvas Welcome] Error:', error.message);
    return {
      success: false,
      tool: 'canvas-welcome',
      error: { message: error.message, code: 'CANVAS_WELCOME_ERROR' }
    };
  }
}

/**
 * Generate goodbye canvas image
 */
async function generateGoodbyeCanvas(username, guildName, memberCount, avatar, background) {
  try {
    console.log('[Tools] Generating goodbye canvas...');
    
    const params = {
      username: username,
      guildName: guildName,
      memberCount: memberCount.toString(),
      avatar: avatar,
      background: background,
      quality: '99'
    };
    
    const result = await makeToolRequest('/canvas/goodbye', params);
    
    if (result.isBuffer) {
      return {
        success: true,
        tool: 'canvas-goodbye',
        data: {
          buffer: result.buffer,
          contentType: result.contentType
        }
      };
    }
    
    throw new Error('Expected image buffer response');
  } catch (error) {
    console.error('[Tools Canvas Goodbye] Error:', error.message);
    return {
      success: false,
      tool: 'canvas-goodbye',
      error: { message: error.message, code: 'CANVAS_GOODBYE_ERROR' }
    };
  }
}

/**
 * Remove background from image
 */
async function removeBackground(imageUrl) {
  try {
    console.log('[Tools] Removing background from image...');
    
    const result = await makeToolRequest('/tools/removebg', { url: imageUrl });
    
    if (!result.data || !result.data.status || !result.data.result) {
      throw new Error('Failed to remove background');
    }
    
    return {
      success: true,
      tool: 'removebg',
      data: {
        url: result.data.result.url,
        cutoutUrl: result.data.result.cutoutUrl,
        maskUrl: result.data.result.maskUrl,
        width: result.data.result.width,
        height: result.data.result.height,
        fileId: result.data.result.fileId
      }
    };
  } catch (error) {
    console.error('[Tools RemoveBG] Error:', error.message);
    return {
      success: false,
      tool: 'removebg',
      error: { message: error.message, code: 'REMOVEBG_ERROR' }
    };
  }
}

/**
 * Spam NGL link with messages
 */
async function spamNGL(nglLink, message, count = 25) {
  try {
    console.log('[Tools] Spamming NGL link...');
    
    const result = await makeToolRequest('/tools/spamngl', { 
      url: nglLink, 
      message: message 
    });
    
    if (!result.data || !result.data.status) {
      throw new Error('Failed to spam NGL');
    }
    
    return {
      success: true,
      tool: 'spamngl',
      data: {
        username: result.data.result.username_target,
        message: result.data.result.pesan_terkirim,
        totalAttempts: result.data.result.total_percobaan,
        successCount: result.data.result.berhasil_dikirim,
        failedCount: result.data.result.gagal_dikirim
      }
    };
  } catch (error) {
    console.error('[Tools SpamNGL] Error:', error.message);
    return {
      success: false,
      tool: 'spamngl',
      error: { message: error.message, code: 'SPAMNGL_ERROR' }
    };
  }
}

/**
 * Take screenshot of website
 */
async function takeScreenshot(websiteUrl) {
  try {
    console.log('[Tools] Taking screenshot of:', websiteUrl);
    
    const result = await makeToolRequest('/tools/screenshot', { url: websiteUrl });
    
    if (result.isBuffer) {
      return {
        success: true,
        tool: 'screenshot',
        data: {
          buffer: result.buffer,
          contentType: result.contentType,
          url: websiteUrl
        }
      };
    }
    
    throw new Error('Expected image buffer response');
  } catch (error) {
    console.error('[Tools Screenshot] Error:', error.message);
    return {
      success: false,
      tool: 'screenshot',
      error: { message: error.message, code: 'SCREENSHOT_ERROR' }
    };
  }
}

// ============================================
// MAIN TOOLS SERVICE
// ============================================

class ToolsService {
  async hd(imageUrl) { return await imageToHD(imageUrl); }
  async lyrics(songTitle) { return await getLyrics(songTitle); }
  async ocr(imageUrl) { return await extractText(imageUrl); }
  async removebg(imageUrl) { return await removeBackground(imageUrl); }
  async spamngl(nglLink, message) { return await spamNGL(nglLink, message); }
  async screenshot(websiteUrl) { return await takeScreenshot(websiteUrl); }
    async welcomeCanvas(username, guildName, memberCount, avatar, background) { 
    return await generateWelcomeCanvas(username, guildName, memberCount, avatar, background); 
  }
  async goodbyeCanvas(username, guildName, memberCount, avatar, background) { 
    return await generateGoodbyeCanvas(username, guildName, memberCount, avatar, background); 
  }
}

export default new ToolsService();
export const tools = new ToolsService();
export {
  imageToHD,
  getLyrics,
  extractText,
  removeBackground,
  spamNGL,
  takeScreenshot,
  uploadDeline,
    generateWelcomeCanvas,
  generateGoodbyeCanvas
};