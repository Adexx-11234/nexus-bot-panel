// lib/search/index.js - Adult content search library

import { request } from 'undici';

const API_BASE = 'https://api.deline.web.id';
const MAX_RETRIES = 3;
const RETRY_INTERVAL = 1500;

// ============================================
// UTILITY FUNCTIONS
// ============================================

async function makeAPIRequest(endpoint, params = {}, retries = MAX_RETRIES) {
  const API_REQUEST_TIMEOUT = 60000;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    const queryString = new URLSearchParams(params).toString();
    const url = `${API_BASE}${endpoint}?${queryString}`;
    
    console.log(`[API Request] (Attempt ${attempt}/${retries}):`, url);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT);
    
    try {
      const { body } = await request(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: controller.signal,
        bodyTimeout: API_REQUEST_TIMEOUT,
        headersTimeout: 30000
      });
      
      clearTimeout(timeoutId);
      
      const chunks = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch (error) {
      clearTimeout(timeoutId);
      console.error(`[API Request] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        throw error;
      }
      
      console.log(`[API Request] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// SEARCH FUNCTIONS
// ============================================

async function xnxxSearch(query, page = 1) {
  try {
    console.log(`[XNXX Search] Searching for: "${query}"`);
    
    const data = await makeAPIRequest('/search/xnxx', { q: query, page });
    
    if (!data || !data.status || !data.result) {
      throw new Error('No results found');
    }
    
    console.log(`[XNXX Search] Found ${data.result.length} results`);
    
    return {
      success: true,
      platform: 'xnxx',
      uiType: 'carousel',
      data: {
        query: query,
        count: data.result.length,
        items: data.result.map(item => ({
          title: item.title,
          info: item.info,
          link: item.link
        }))
      }
    };
  } catch (error) {
    console.error('[XNXX Search] Error:', error.message);
    return {
      success: false,
      platform: 'xnxx',
      error: { message: error.message, code: 'XNXX_SEARCH_ERROR' }
    };
  }
}

async function xvideosSearch(query, page = 1) {
  try {
    console.log(`[XVideos Search] Searching for: "${query}"`);
    
    const data = await makeAPIRequest('/search/xvideos', { q: query, page });
    
    if (!data || !data.status || !data.result || !data.result.items) {
      throw new Error('No results found');
    }
    
    console.log(`[XVideos Search] Found ${data.result.count} results`);
    
    return {
      success: true,
      platform: 'xvideos',
      uiType: 'carousel',
      data: {
        query: data.result.query,
        page: data.result.page,
        count: data.result.count,
        items: data.result.items
          .filter(item => {
            // Filter out items with THUMBNUM placeholders in URL
            const hasValidUrl = item.url && !item.url.includes('THUMBNUM');
            const hasValidCover = !item.cover || !item.cover.includes('THUMBNUM');
            return hasValidUrl && hasValidCover;
          })
          .map(item => ({
            title: item.title,
            resolution: item.resolution,
            duration: item.duration,
            artist: item.artist,
            // Clean up cover URL - use first available valid thumbnail
            cover: item.cover && !item.cover.includes('THUMBNUM') 
              ? item.cover.replace(/\.(\d+)\.jpg$/, '.1.jpg') // Use first thumbnail
              : null,
            url: item.url
          }))
      }
    };
  } catch (error) {
    console.error('[XVideos Search] Error:', error.message);
    return {
      success: false,
      platform: 'xvideos',
      error: { message: error.message, code: 'XVIDEOS_SEARCH_ERROR' }
    };
  }
}

// ============================================
// DOWNLOAD FUNCTIONS
// ============================================

async function xnxxDownload(url) {
  try {
    console.log(`[XNXX Download] Downloading:`, url);
    
    const data = await makeAPIRequest('/downloader/xnxx', { url });
    
    if (!data || !data.status || !data.result) {
      throw new Error('Failed to fetch video data');
    }
    
    const result = data.result;
    console.log('[XNXX Download] Video found:', result.title);
    
    return {
      success: true,
      platform: 'xnxx',
      uiType: 'direct',
      data: {
        title: result.title,
        url: result.URL,
        duration: result.duration,
        image: result.image,
        info: result.info,
        downloadUrl: result.files.high, // Use high quality
        format: 'mp4'
      }
    };
  } catch (error) {
    console.error('[XNXX Download] Error:', error.message);
    return {
      success: false,
      platform: 'xnxx',
      error: { message: error.message, code: 'XNXX_DOWNLOAD_ERROR' }
    };
  }
}

async function xvideosDownload(url) {
  try {
    console.log(`[XVideos Download] Downloading:`, url);
    
    const data = await makeAPIRequest('/downloader/xvideos', { url });
    
    if (!data || !data.status || !data.result) {
      throw new Error('Failed to fetch video data');
    }
    
    const result = data.result;
    console.log('[XVideos Download] Video found:', result.title);
    
    return {
      success: true,
      platform: 'xvideos',
      uiType: 'direct',
      data: {
        title: result.title,
        thumb: result.thumb,
        source: result.source,
        downloadUrl: result.videos.videos.high, // Use high quality
        format: 'mp4'
      }
    };
  } catch (error) {
    console.error('[XVideos Download] Error:', error.message);
    return {
      success: false,
      platform: 'xvideos',
      error: { message: error.message, code: 'XVIDEOS_DOWNLOAD_ERROR' }
    };
  }
}

// ============================================
// SEARCH SERVICE CLASS
// ============================================

class SearchService {
  // Search methods
  async xnxx(query, page = 1) {
    return await xnxxSearch(query, page);
  }
  
  async xvideos(query, page = 1) {
    return await xvideosSearch(query, page);
  }
  
  // Download methods
  async xnxxDownload(url) {
    return await xnxxDownload(url);
  }
  
  async xvideosDownload(url) {
    return await xvideosDownload(url);
  }
}

export default new SearchService();

export {
  xnxxSearch,
  xvideosSearch,
  xnxxDownload,
  xvideosDownload
};