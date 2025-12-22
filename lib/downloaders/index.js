// lib/downloaders/index.js - Complete downloader with all methods

import { request } from 'undici';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import searchService from '../search/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create tmp directory in project root
const TMP_DIR = path.join(__dirname, '../../tmp');
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// ============================================
// CONSTANTS
// ============================================

const API_PRIMARY = 'https://backend1.tioo.eu.org/api';
const API_SECONDARY = 'https://api.deline.web.id';
const MAX_RETRIES = 4;
const RETRY_INTERVAL = 1500; // 1.5 seconds

// ============================================
// UTILITY FUNCTIONS
// ============================================

function detectPlatform(url) {
  const patterns = {
    instagram: /(?:instagram\.com|instagr\.am)/i,
    tiktok: /(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/i,
    youtube: /(?:youtube\.com|youtu\.be)/i,
    facebook: /(?:facebook\.com|fb\.watch|fb\.com)/i,
    twitter: /(?:twitter\.com|x\.com|t\.co)/i,
    spotify: /(?:spotify\.com|spotify\.link)/i,
    soundcloud: /soundcloud\.com/i,
    pinterest: /(?:pinterest\.com|pin\.it)/i,
    capcut: /capcut\.com/i,
    gdrive: /(?:drive\.google\.com|docs\.google\.com)/i,
    mediafire: /mediafire\.com/i,
    applemusic: /(?:music\.apple\.com)/i,
  };

  for (const [platform, pattern] of Object.entries(patterns)) {
    if (pattern.test(url)) return platform;
  }
  return null;
}

function formatSize(bytes) {
  if (!bytes || bytes === 'NA') return 'Unknown';
  if (typeof bytes === 'string') return bytes;
  
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  return match ? match[1] : null;
}

// ============================================
// UTILITY: Generate browser-like headers
// ============================================

function generateBrowserHeaders() {
  // Realistic Chrome user agents - rotated for variety
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];

  // Order matters! Browsers send headers in specific order
  return {
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'Pragma': 'no-cache'
  };
}

// ============================================
// CORE API REQUEST FUNCTIONS - FIXED
// ============================================

async function makeAPIRequest(endpoint, params = {}, usePrimary = true) {
  const API_REQUEST_TIMEOUT = 60000; // 60 seconds
  
  const baseUrl = usePrimary ? API_PRIMARY : API_SECONDARY;
  const queryString = new URLSearchParams(params).toString();
  const url = `${baseUrl}${endpoint}?${queryString}`;
  
  console.log(`[API Request] ${usePrimary ? 'PRIMARY' : 'SECONDARY'}:`, url);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT);
  
  try {
    // ✅ FIX: Use generated browser-like headers
    const headers = generateBrowserHeaders();
    
    const { statusCode, headers: responseHeaders, body } = await request(url, {
      headers,
      signal: controller.signal,
      bodyTimeout: API_REQUEST_TIMEOUT,
      headersTimeout: 30000
    });
    
    clearTimeout(timeoutId);
    
    // ✅ FIX: Check status code first
    if (statusCode !== 200) {
      throw new Error(`HTTP ${statusCode}: Request failed`);
    }
    
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    
    const responseText = Buffer.concat(chunks).toString();
    
    // ✅ FIX: Check if response is empty
    if (!responseText || responseText.trim() === '') {
      throw new Error('Empty response from API');
    }
    
    // ✅ FIX: Parse and validate JSON
    let jsonData;
    try {
      jsonData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[API] Failed to parse JSON:', responseText.substring(0, 200));
      throw new Error('Invalid JSON response from API');
    }
    
    // ✅ FIX: Log response for debugging
    console.log(`[API Response] Status: ${jsonData.status}, Keys:`, Object.keys(jsonData));
    
    return jsonData;
  } catch (error) {
    clearTimeout(timeoutId);
    
    // ✅ Better error messages
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    
    console.error(`[API Error] ${error.message}`);
    throw error;
  }
}

async function makeAPIRequestWithFallback(primaryEndpoint, secondaryEndpoint, params = {}) {
  try {
    console.log('[API] Trying primary API...');
    const result = await makeAPIRequest(primaryEndpoint, params, true);
    console.log('[API] Primary API success');
    return { success: true, data: result, source: 'primary' };
  } catch (primaryError) {
    console.warn('[API] Primary API failed:', primaryError.message);
    
    if (!secondaryEndpoint) {
      throw primaryError;
    }
    
    try {
      console.log('[API] Trying secondary API...');
      const result = await makeAPIRequest(secondaryEndpoint, params, false);
      console.log('[API] Secondary API success');
      return { success: true, data: result, source: 'secondary' };
    } catch (secondaryError) {
      console.error('[API] Secondary API failed:', secondaryError.message);
      throw secondaryError;
    }
  }
}

// ============================================
// DOWNLOAD FUNCTIONS - FIXED WITH HEADERS
// ============================================

async function downloadWithRedirects(url, filename = null, maxRedirects = 5, retries = 3) {
  const DOWNLOAD_TIMEOUT = 120000; // 120 seconds
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    let tempFilePath = null;
    let writeStream = null;
    
    try {
      console.log(`[Download] Starting download (Attempt ${attempt}/${retries}):`, url);
      
      // Generate filename from URL or use provided filename
      let finalFilename = filename;
      if (!finalFilename) {
        const urlPath = new URL(url).pathname;
        const urlFilename = path.basename(urlPath);
        finalFilename = urlFilename || `download_${Date.now()}`;
      }
      
      // Sanitize filename
      finalFilename = finalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
      
      tempFilePath = path.join(TMP_DIR, finalFilename);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
      
      // ✅ FIX: Use browser-like headers for download too
      const headers = generateBrowserHeaders();
      
      const response = await request(url, {
        headers,
        maxRedirections: maxRedirects,
        signal: controller.signal,
        bodyTimeout: DOWNLOAD_TIMEOUT,
        headersTimeout: 30000
      });

      clearTimeout(timeoutId);

      console.log('[Download] Final Status:', response.statusCode);
      console.log('[Download] Content-Type:', response.headers['content-type']);

      if (response.statusCode !== 200) {
        throw new Error(`Download failed with status: ${response.statusCode}`);
      }

      // Write to file
      writeStream = fs.createWriteStream(tempFilePath);
      let downloadedSize = 0;
      
      for await (const chunk of response.body) {
        writeStream.write(chunk);
        downloadedSize += chunk.length;
        
        // Log progress for large files (every 5MB)
        if (downloadedSize % (5 * 1024 * 1024) < chunk.length) {
          console.log(`[Download] Progress: ${(downloadedSize / 1024 / 1024).toFixed(2)} MB`);
        }
      }
      
      writeStream.end();
      
      // Wait for write to complete
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
      
      console.log(`[Download] Complete: ${(downloadedSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`[Download] Saved to: ${tempFilePath}`);
      
      return {
        filePath: tempFilePath,
        size: downloadedSize,
        cleanup: () => {
          try {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
              console.log(`[Cleanup] Deleted: ${tempFilePath}`);
            }
          } catch (err) {
            console.error(`[Cleanup] Error:`, err.message);
          }
        }
      };
      
    } catch (error) {
      console.error(`[Download] Attempt ${attempt} failed:`, error.message);
      
      // Cleanup on error
      if (writeStream) {
        writeStream.destroy();
      }
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupErr) {
          console.error('[Download] Cleanup error:', cleanupErr.message);
        }
      }
      
      if (attempt === retries) {
        console.error('[Download] All download retries exhausted');
        throw error;
      }
      
      // Wait before retrying (exponential backoff)
      const waitTime = RETRY_INTERVAL * attempt;
      console.log(`[Download] Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

// Legacy support - downloadMedia function
async function downloadMedia(url, filename = null, maxRetries = 3) {
  return await downloadWithRedirects(url, filename, 5, maxRetries);
}

// ============================================
// YOUTUBE DOWNLOADERS
// ============================================

async function youtubeMP3Downloader(url, retries = MAX_RETRIES) {
  let usePrimary = false;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[YouTube MP3] Downloading MP3 (Attempt ${attempt}/${retries})`);

      const apiResult = usePrimary 
        ? await makeAPIRequestWithFallback('/downloader/youtube', null, { url })
        : await makeAPIRequest('/downloader/ytmp3', { url }, false);

      const { data, source } = apiResult.success ? apiResult : { data: apiResult, source: usePrimary ? 'primary' : 'secondary' };
      
      let downloadUrl, title, thumbnail, author;

      if ((source === 'primary' && usePrimary) || (!apiResult.success && usePrimary)) {
        if (!data || !data.status || !data.mp3) {
          throw new Error('Invalid response from primary API');
        }
        downloadUrl = data.mp3;
        title = data.title;
        thumbnail = data.thumbnail;
        author = data.author;
      } else {
        if (!data || !data.status || !data.result?.dlink) {
          throw new Error('Invalid response from secondary API');
        }
        downloadUrl = data.result.dlink;
        title = data.result.youtube?.title;
        thumbnail = data.result.youtube?.thumbnail;
        author = 'YouTube';
      }

      console.log('[YouTube MP3] Data fetched:', title);
      console.log('[YouTube MP3] Downloading audio from:', usePrimary ? 'PRIMARY' : 'SECONDARY');

      const filename = `${(title || 'audio').replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;
      const mediaFile = await downloadWithRedirects(downloadUrl, filename);

      return {
        success: true,
        platform: 'youtube',
        uiType: 'direct',
        data: {
          title: title || 'YouTube Audio',
          thumbnail: thumbnail || `https://img.youtube.com/vi/${extractVideoId(url)}/maxresdefault.jpg`,
          author: { name: author || 'YouTube' },
          youtubeUrl: url,
          videoId: url,
          format: 'mp3',
          filePath: mediaFile.filePath,
          filename: filename,
          size: mediaFile.size,
          cleanup: mediaFile.cleanup
        }
      };
    } catch (error) {
      console.error(`[YouTube MP3] Attempt ${attempt} failed (${usePrimary ? 'PRIMARY' : 'SECONDARY'} API):`, error.message);
      
      if (usePrimary && attempt < retries) {
        console.log('[YouTube MP3] Switching to SECONDARY API for next attempt...');
        usePrimary = false;
      } else if (!usePrimary && attempt < retries) {
        console.log('[YouTube MP3] Switching back to PRIMARY API for next attempt...');
        usePrimary = true;
      }
      
      if (attempt === retries) {
        console.error('[YouTube MP3] All retries exhausted');
        return {
          success: false,
          platform: 'youtube',
          error: { message: error.message, code: 'YT_MP3_ERROR' }
        };
      }
      
      console.log(`[YouTube MP3] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// YOUTUBE PLAY DOWNLOADER - NEW
// ============================================

async function youtubePlayDownloader(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[YouTube Play] Searching and downloading (Attempt ${attempt}/${retries}):`, query);

      const data = await makeAPIRequest('/downloader/ytplay', { q: query }, false);

      // ✅ FIX: Proper validation - status should be true
      if (!data) {
        throw new Error('No response from API');
      }
      
      if (data.status !== true) {  // ✅ Changed from !data.status
        throw new Error(`API returned status: ${data.status}`);
      }
      
      if (!data.result) {
        throw new Error('No result in API response');
      }
      
      if (!data.result.dlink) {
        throw new Error('No download link in result');
      }

      const result = data.result;
      console.log('[YouTube Play] Found:', result.title);
      console.log('[YouTube Play] Downloading audio from:', result.dlink);

      const sanitizedTitle = (result.title || 'audio').replace(/[^a-zA-Z0-9]/g, '_');
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const filename = `${sanitizedTitle}_${timestamp}_${randomSuffix}.mp3`;
      
      console.log('[YouTube Play] Using unique filename:', filename);
      const mediaFile = await downloadWithRedirects(result.dlink, filename);

      // Download thumbnail
      let thumbnailBuffer = null;
      if (result.thumbnail) {
        try {
          const response = await fetch(result.thumbnail);
          if (response.ok) {
            thumbnailBuffer = Buffer.from(await response.arrayBuffer());
            console.log('[YouTube Play] Thumbnail downloaded');
          }
        } catch (err) {
          console.error('[YouTube Play] Thumbnail download failed:', err.message);
        }
      }

      return {
        success: true,
        platform: 'youtube',
        uiType: 'play',
        data: {
          title: result.title,
          url: result.url,
          thumbnail: result.thumbnail,
          thumbnailBuffer: thumbnailBuffer,
          quality: result.pick?.quality || 'unknown',
          size: result.pick?.size || 'unknown',
          ext: result.pick?.ext || 'mp3',
          format: 'mp3',
          filePath: mediaFile.filePath,
          filename: filename,
          fileSize: mediaFile.size,
          cleanup: mediaFile.cleanup
        }
      };
    } catch (error) {
      console.error(`[YouTube Play] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        console.error('[YouTube Play] All retries exhausted');
        return {
          success: false,
          platform: 'youtube',
          error: { message: error.message, code: 'YT_PLAY_ERROR' }
        };
      }
      
      console.log(`[YouTube Play] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}


async function youtubeMP4Downloader(url, retries = MAX_RETRIES) {
  let usePrimary = false;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[YouTube MP4] Downloading MP4 (Attempt ${attempt}/${retries})`);

      const apiResult = usePrimary 
        ? await makeAPIRequestWithFallback('/downloader/youtube', null, { url })
        : await makeAPIRequest('/downloader/ytmp4', { url }, false);

      const { data, source } = apiResult.success ? apiResult : { data: apiResult, source: usePrimary ? 'primary' : 'secondary' };
      
      let downloadUrl, title, thumbnail, author;

      if ((source === 'primary' && usePrimary) || (!apiResult.success && usePrimary)) {
        if (!data || !data.status || !data.mp4) {
          throw new Error('Invalid response from primary API');
        }
        downloadUrl = data.mp4;
        title = data.title;
        thumbnail = data.thumbnail;
        author = data.author;
      } else {
        if (!data || !data.status || !data.result?.dl) {
          throw new Error('Invalid response from secondary API');
        }
        downloadUrl = data.result.dl;
        title = 'YouTube Video';
        thumbnail = `https://img.youtube.com/vi/${extractVideoId(url)}/maxresdefault.jpg`;
        author = 'YouTube';
      }

      console.log('[YouTube MP4] Data fetched:', title);
      console.log('[YouTube MP4] Downloading video from:', usePrimary ? 'PRIMARY' : 'SECONDARY');

      const filename = `${(title || 'video').replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
      const mediaFile = await downloadWithRedirects(downloadUrl, filename);

      return {
        success: true,
        platform: 'youtube',
        uiType: 'direct',
        data: {
          title: title || 'YouTube Video',
          thumbnail: thumbnail,
          author: { name: author || 'YouTube' },
          youtubeUrl: url,
          videoId: url,
          format: 'mp4',
          filePath: mediaFile.filePath,
          filename: filename,
          size: mediaFile.size,
          cleanup: mediaFile.cleanup
        }
      };
    } catch (error) {
      console.error(`[YouTube MP4] Attempt ${attempt} failed (${usePrimary ? 'PRIMARY' : 'SECONDARY'} API):`, error.message);
      
      if (usePrimary && attempt < retries) {
        console.log('[YouTube MP4] Switching to SECONDARY API for next attempt...');
        usePrimary = false;
      } else if (!usePrimary && attempt < retries) {
        console.log('[YouTube MP4] Switching back to PRIMARY API for next attempt...');
        usePrimary = true;
      }
      
      if (attempt === retries) {
        console.error('[YouTube MP4] All retries exhausted');
        return {
          success: false,
          platform: 'youtube',
          error: { message: error.message, code: 'YT_MP4_ERROR' }
        };
      }
      
      console.log(`[YouTube MP4] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function youtubeMetadataDownloader(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[YouTube Metadata] Fetching metadata (Attempt ${attempt}/${retries})`);

      const apiResult = await makeAPIRequestWithFallback(
        '/downloader/youtube',
        null,
        { url }
      );

      const { data } = apiResult;

      if (!data || !data.status) {
        throw new Error('Invalid response');
      }

      console.log('[YouTube Metadata] Metadata fetched:', data.title);

      return {
        success: true,
        platform: 'youtube',
        uiType: 'buttons',
        data: {
          title: data.title || 'YouTube Video',
          thumbnail: data.thumbnail || `https://img.youtube.com/vi/${extractVideoId(url)}/maxresdefault.jpg`,
          author: { name: data.author || 'YouTube' },
          youtubeUrl: url,
          videoId: url
        }
      };
    } catch (error) {
      console.error(`[YouTube Metadata] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        console.error('[YouTube Metadata] All retries exhausted');
        return {
          success: false,
          platform: 'youtube',
          error: { message: error.message, code: 'YT_METADATA_ERROR' }
        };
      }
      
      console.log(`[YouTube Metadata] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function youtubeSearch(query, retries = MAX_RETRIES) {
  let usePrimary = false;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[YouTube Search] Searching (Attempt ${attempt}/${retries}):`, query);

      const data = usePrimary
        ? await makeAPIRequest('/search/yts', { q: query }, true)
        : await makeAPIRequest('/search/youtube', { q: query }, false);

      const source = usePrimary ? 'primary' : 'secondary';
      
      let items = [];

      console.log(`[YouTube Search] Using ${source.toUpperCase()} API`);

      if (source === 'primary') {
        if (!data || !data.status || !data.all || data.all.length === 0) {
          throw new Error('No YouTube results found');
        }

        items = data.all.slice(0, 10).map(v => {
          let videoUrl = v.url;
          if (!videoUrl && v.videoId) {
            videoUrl = `https://youtube.com/watch?v=${v.videoId}`;
          }

          return {
            type: v.type || 'video',
            title: v.title,
            url: videoUrl,
            videoId: v.videoId,
            thumbnail: v.thumbnail,
            duration: v.seconds ? formatDuration(v.seconds) : null,
            author: { 
              name: v.author?.name || 'YouTube' 
            }
          };
        });
      } else {
        if (!data || !data.status || !data.result || data.result.length === 0) {
          throw new Error('No YouTube results found');
        }

        items = data.result.slice(0, 10).map(v => ({
          type: 'video',
          title: v.title,
          url: v.link,
          videoId: extractVideoId(v.link),
          thumbnail: v.imageUrl,
          duration: v.duration,
          author: { 
            name: v.channel || 'YouTube' 
          }
        }));
      }

      console.log('[YouTube Search] Found', items.length, 'results');

      return {
        success: true,
        platform: 'youtube',
        uiType: 'carousel',
        data: {
          title: `YouTube Search: ${query}`,
          items: items
        }
      };
    } catch (error) {
      console.error(`[YouTube Search] Attempt ${attempt} failed (${usePrimary ? 'PRIMARY' : 'SECONDARY'} API):`, error.message);
      
      if (usePrimary && attempt < retries) {
        console.log('[YouTube Search] Switching to SECONDARY API for next attempt...');
        usePrimary = false;
      } else if (!usePrimary && attempt < retries) {
        console.log('[YouTube Search] Switching back to PRIMARY API for next attempt...');
        usePrimary = true;
      }
      
      if (attempt === retries) {
        console.error('[YouTube Search] All retries exhausted');
        return {
          success: false,
          platform: 'youtube',
          error: { message: error.message, code: 'YT_SEARCH_ERROR' }
        };
      }
      
      console.log(`[YouTube Search] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function youtubeDownloader(url, format = null) {
  try {
    if (!url) {
      throw new Error('URL is required');
    }

    console.log('[YouTube] Downloader called:', url, 'Format:', format);

    if (format === 'mp3') {
      return await youtubeMP3Downloader(url);
    } else if (format === 'mp4') {
      return await youtubeMP4Downloader(url);
    }

    return await youtubeMetadataDownloader(url);
  } catch (error) {
    console.error('[YouTube] Error:', error.message);
    return {
      success: false,
      platform: 'youtube',
      error: { message: error.message, code: 'YT_ERROR' }
    };
  }
}

// ============================================
// INSTAGRAM DOWNLOADER
// ============================================

async function instagramDownloader(url, retries = MAX_RETRIES) {
  let usePrimary = true;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Instagram] Downloading (Attempt ${attempt}/${retries})`);

      const data = usePrimary
        ? await makeAPIRequest('/downloader/igdl', { url }, true)
        : await makeAPIRequest('/downloader/ig', { url }, false);

      const source = usePrimary ? 'primary' : 'secondary';
      
      let items = [];

      if (source === 'primary') {
        if (!data || !Array.isArray(data) || data.length === 0) {
          throw new Error('No data returned from Instagram');
        }

        items = data.filter(item => item.status);

        if (items.length === 0) {
          throw new Error('No valid Instagram content found');
        }

        console.log(`[Instagram] Found ${items.length} items from ${source.toUpperCase()} API`);

        if (items.length === 1) {
          return {
            success: true,
            platform: 'instagram',
            uiType: 'buttons',
            data: {
              title: 'Instagram Post',
              thumbnail: items[0].thumbnail,
              author: { name: items[0].creator || 'Instagram User' },
              downloads: [{
                type: 'video',
                quality: 'Original',
                url: items[0].url,
                format: 'mp4'
              }]
            }
          };
        }

        return {
          success: true,
          platform: 'instagram',
          uiType: 'carousel',
          data: {
            title: `Instagram Album (${items.length} items)`,
            items: items.map((item, index) => ({
              thumbnail: item.thumbnail,
              title: `Photo/Video ${index + 1}/${items.length}`,
              downloads: [{
                type: 'video',
                quality: 'Download',
                url: item.url,
                format: 'mp4'
              }]
            }))
          }
        };
      } else {
        if (!data || !data.status || !data.result?.media) {
          throw new Error('Invalid response from secondary API');
        }

        const media = data.result.media;
        const allMedia = [...(media.images || []), ...(media.videos || [])];

        if (allMedia.length === 0) {
          throw new Error('No media found');
        }

        console.log(`[Instagram] Found ${allMedia.length} items from ${source.toUpperCase()} API`);

        if (allMedia.length === 1) {
          return {
            success: true,
            platform: 'instagram',
            uiType: 'buttons',
            data: {
              title: 'Instagram Post',
              thumbnail: allMedia[0],
              author: { name: 'Instagram User' },
              downloads: [{
                type: media.videos?.length > 0 ? 'video' : 'image',
                quality: 'Original',
                url: allMedia[0],
                format: media.videos?.length > 0 ? 'mp4' : 'jpg'
              }]
            }
          };
        }

        return {
          success: true,
          platform: 'instagram',
          uiType: 'carousel',
          data: {
            title: `Instagram Album (${allMedia.length} items)`,
            items: allMedia.map((mediaUrl, index) => ({
              thumbnail: mediaUrl,
              title: `Media ${index + 1}/${allMedia.length}`,
              downloads: [{
                type: 'media',
                quality: 'Download',
                url: mediaUrl,
                format: 'mp4'
              }]
            }))
          }
        };
      }
    } catch (error) {
      console.error(`[Instagram] Attempt ${attempt} failed (${usePrimary ? 'PRIMARY' : 'SECONDARY'} API):`, error.message);
      
      if (usePrimary && attempt < retries) {
        console.log('[Instagram] Switching to SECONDARY API for next attempt...');
        usePrimary = false;
      } else if (!usePrimary && attempt < retries) {
        console.log('[Instagram] Switching back to PRIMARY API for next attempt...');
        usePrimary = true;
      }
      
      if (attempt === retries) {
        return {
          success: false,
          platform: 'instagram',
          error: { message: error.message, code: 'IG_ERROR' }
        };
      }
      
      console.log(`[Instagram] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// TIKTOK DOWNLOADER - FIXED toString ERROR
// ============================================

async function tiktokDownloader(url, retries = MAX_RETRIES) {
  let usePrimary = true;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[TikTok] Downloading (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/downloader/tiktok', { url }, usePrimary);
      const source = usePrimary ? 'primary' : 'secondary';

      console.log(`[TikTok] Using ${source.toUpperCase()} API`);

      if (source === 'primary') {
        if (!data || data.code !== 0 || !data.data) {
          throw new Error('Failed to fetch TikTok video');
        }

        const video = data.data;

        return {
          success: true,
          platform: 'tiktok',
          uiType: 'buttons',
          data: {
            title: video.title || 'TikTok Video',
            thumbnail: video.cover || null,
            author: {
              name: video.author?.nickname || 'TikTok User',
              avatar: video.author?.avatar || null
            },
            duration: video.duration || null,
            downloads: [
              {
                type: 'video',
                quality: 'HD (No Watermark)',
                url: video.hdplay || video.play,
                size: formatSize(video.hd_size || video.size),
                format: 'mp4'
              },
              {
                type: 'video',
                quality: 'SD (No Watermark)',
                url: video.play,
                size: formatSize(video.size),
                format: 'mp4'
              },
              {
                type: 'audio',
                quality: 'Audio Only',
                url: video.music,
                format: 'mp3'
              }
            ].filter(d => d.url), // Remove items without URLs
            metadata: {
              views: video.play_count || 0,
              likes: video.digg_count || 0,
              comments: video.comment_count || 0
            }
          }
        };
      } else {
        if (!data || !data.status || !data.result) {
          throw new Error('Invalid response from secondary API');
        }

        const result = data.result;

        return {
          success: true,
          platform: 'tiktok',
          uiType: 'buttons',
          data: {
            title: result.title || 'TikTok Video',
            thumbnail: result.author?.avatar || null,
            author: {
              name: result.author?.nickname || 'TikTok User',
              avatar: result.author?.avatar || null
            },
            downloads: [
              {
                type: 'video',
                quality: 'Video (No Watermark)',
                url: result.download,
                format: 'mp4'
              },
              {
                type: 'audio',
                quality: 'Audio Only',
                url: result.music,
                format: 'mp3'
              }
            ].filter(d => d.url)
          }
        };
      }
    } catch (error) {
      console.error(`[TikTok] Attempt ${attempt} failed (${usePrimary ? 'PRIMARY' : 'SECONDARY'}):`, error.message);
      
      if (usePrimary && attempt < retries) {
        console.log('[TikTok] Switching to SECONDARY API...');
        usePrimary = false;
      } else if (!usePrimary && attempt < retries) {
        console.log('[TikTok] Switching back to PRIMARY API...');
        usePrimary = true;
      }
      
      if (attempt === retries) {
        return {
          success: false,
          platform: 'tiktok',
          error: { message: error.message, code: 'TT_ERROR' }
        };
      }
      
      console.log(`[TikTok] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function tiktokSimpleDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/ttdl', { url }, true);

    if (!data || !data.status) {
      throw new Error('Failed to fetch TikTok video');
    }

    return {
      success: true,
      platform: 'tiktok',
      uiType: 'buttons',
      data: {
        title: data.title,
        thumbnail: null,
        author: { name: data.creator || 'TikTok User' },
        downloads: [
          {
            type: 'video',
            quality: 'Video',
            url: data.video[0],
            format: 'mp4'
          },
          {
            type: 'audio',
            quality: 'Audio',
            url: data.audio[0],
            format: 'mp3'
          }
        ]
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'tiktok',
      error: { message: error.message, code: 'TTDL_ERROR' }
    };
  }
}

// ============================================
// SPOTIFY DOWNLOADER
// ============================================

async function spotifyDownloader(url, retries = MAX_RETRIES) {
  let usePrimary = true;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Spotify] Downloading (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/downloader/spotify', { url }, usePrimary);
      const source = usePrimary ? 'primary' : 'secondary';

      console.log(`[Spotify] Using ${source.toUpperCase()} API`);

      if (source === 'primary') {
        if (!data || !data.status || !data.res_data) {
          throw new Error('Failed to fetch Spotify track');
        }

        const res_data = data.res_data;

        return {
          success: true,
          platform: 'spotify',
          uiType: 'buttons',
          data: {
            title: res_data.title,
            thumbnail: res_data.thumbnail,
            author: { name: 'Spotify Artist' },
            duration: res_data.duration,
            downloads: res_data.formats.map(format => ({
              type: 'audio',
              quality: format.quality || 'Audio',
              url: format.url,
              size: format.filesize,
              format: format.ext || 'mp3'
            }))
          }
        };
      } else {
        if (!data || !data.status || !data.result) {
          throw new Error('Invalid response from secondary API');
        }

        const result = data.result;

        return {
          success: true,
          platform: 'spotify',
          uiType: 'buttons',
          data: {
            title: result.title,
            thumbnail: result.thumbnail,
            author: { name: result.author || 'Spotify Artist' },
            duration: result.duration,
            downloads: result.medias?.map(media => ({
              type: 'audio',
              quality: media.quality || 'Audio',
              url: media.url,
              format: media.extension || 'mp3'
            })) || []
          }
        };
      }
    } catch (error) {
      console.error(`[Spotify] Attempt ${attempt} failed (${usePrimary ? 'PRIMARY' : 'SECONDARY'} API):`, error.message);
      
      if (usePrimary && attempt < retries) {
        console.log('[Spotify] Switching to SECONDARY API for next attempt...');
        usePrimary = false;
      } else if (!usePrimary && attempt < retries) {
        console.log('[Spotify] Switching back to PRIMARY API for next attempt...');
        usePrimary = true;
      }
      
      if (attempt === retries) {
        return {
          success: false,
          platform: 'spotify',
          error: { message: error.message, code: 'SPOT_ERROR' }
        };
      }
      
      console.log(`[Spotify] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// TWITTER DOWNLOADER
// ============================================

async function twitterDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/twitter', { url }, true);

    if (!data || !data.status || !data.url) {
      throw new Error('Failed to fetch Twitter video');
    }

    const downloads = data.url
      .filter(item => item.hd || item.sd)
      .map(item => ({
        type: 'video',
        quality: item.hd ? 'HD' : 'SD',
        url: item.hd || item.sd,
        format: 'mp4'
      }));

    return {
      success: true,
      platform: 'twitter',
      uiType: 'buttons',
      data: {
        title: data.title?.substring(0, 100) || 'Twitter Video',
        thumbnail: null,
        author: { name: data.creator || 'Twitter User' },
        downloads
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'twitter',
      error: { message: error.message, code: 'TW_ERROR' }
    };
  }
}

// ============================================
// FACEBOOK DOWNLOADER - UPDATED WITH FALLBACK
// ============================================

async function facebookDownloader(url, retries = MAX_RETRIES) {
  let usePrimary = true;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Facebook] Downloading (Attempt ${attempt}/${retries})`);

      const data = usePrimary
        ? await makeAPIRequest('/downloader/fbdown', { url }, true)
        : await makeAPIRequest('/downloader/facebook', { url }, false);

      const source = usePrimary ? 'primary' : 'secondary';
      console.log(`[Facebook] Using ${source.toUpperCase()} API`);

      if (!data || !data.status) {
        throw new Error('Invalid Facebook response');
      }

      const downloads = [];

      if (source === 'primary') {
        if (data.HD) {
          downloads.push({
            type: 'video',
            quality: 'HD',
            url: data.HD,
            format: 'mp4'
          });
        }
        if (data.Normal_video) {
          downloads.push({
            type: 'video',
            quality: 'SD',
            url: data.Normal_video,
            format: 'mp4'
          });
        }
      } else {
        if (data.result?.list && Array.isArray(data.result.list)) {
          data.result.list.forEach(item => {
            downloads.push({
              type: 'video',
              quality: item.quality || 'Video',
              url: item.url,
              format: 'mp4'
            });
          });
        }
      }

      if (downloads.length === 0) {
        throw new Error('No download links found');
      }

      return {
        success: true,
        platform: 'facebook',
        uiType: 'buttons',
        data: {
          title: 'Facebook Video',
          thumbnail: null,
          author: { name: 'Facebook User' },
          downloads
        }
      };
    } catch (error) {
      console.error(`[Facebook] Attempt ${attempt} failed (${usePrimary ? 'PRIMARY' : 'SECONDARY'}):`, error.message);
      
      if (usePrimary && attempt < retries) {
        console.log('[Facebook] Switching to SECONDARY API...');
        usePrimary = false;
      } else if (!usePrimary && attempt < retries) {
        console.log('[Facebook] Switching back to PRIMARY API...');
        usePrimary = true;
      }
      
      if (attempt === retries) {
        return {
          success: false,
          platform: 'facebook',
          error: { message: error.message, code: 'FB_ERROR' }
        };
      }
      
      console.log(`[Facebook] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// SOUNDCLOUD DOWNLOADER
// ============================================

async function soundcloudDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/soundcloud', { url }, true);

    if (!data || !data.status) {
      throw new Error('Failed to fetch SoundCloud track');
    }

    return {
      success: true,
      platform: 'soundcloud',
      uiType: 'buttons',
      data: {
        title: data.title,
        thumbnail: data.thumbnail,
        author: { name: 'SoundCloud Artist' },
        downloads: [{
          type: 'audio',
          quality: 'MP3 Audio',
          url: data.downloadMp3,
          format: 'mp3'
        }]
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'soundcloud',
      error: { message: error.message, code: 'SC_ERROR' }
    };
  }
}

// ============================================
// PINTEREST DOWNLOADER - UPDATED WITH FALLBACK
// ============================================

async function pinterestDownloader(url, retries = MAX_RETRIES) {
  let usePrimary = true;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Pinterest] Downloading (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/downloader/pinterest', { url }, usePrimary);
      const source = usePrimary ? 'primary' : 'secondary';

      console.log(`[Pinterest] Using ${source.toUpperCase()} API`);

      if (!data || !data.status) {
        throw new Error('Failed to fetch Pinterest content');
      }

      if (source === 'primary') {
        if (!data.success || !data.result) {
          throw new Error('Invalid response from primary API');
        }

        const { result } = data;

        if (result.is_video && result.video_url) {
          return {
            success: true,
            platform: 'pinterest',
            uiType: 'buttons',
            data: {
              title: result.title || 'Pinterest Video',
              thumbnail: result.image,
              author: {
                name: result.user?.full_name || 'Pinterest User',
                avatar: result.user?.avatar_url
              },
              downloads: [{
                type: 'video',
                quality: 'Original Video',
                url: result.video_url,
                format: 'mp4'
              }]
            }
          };
        }

        return {
          success: true,
          platform: 'pinterest',
          uiType: 'buttons',
          data: {
            title: result.title || 'Pinterest Image',
            thumbnail: result.image,
            author: {
              name: result.user?.full_name || 'Pinterest User',
              avatar: result.user?.avatar_url
            },
            downloads: [{
              type: 'image',
              quality: 'Original Image',
              url: result.images?.orig?.url || result.image,
              format: 'jpg'
            }]
          }
        };
      } else {
        // Secondary API
        if (!data.result) {
          throw new Error('Invalid response from secondary API');
        }

        const result = data.result;
        const isVideo = result.video && result.video !== 'Tidak ada';

        if (isVideo) {
          return {
            success: true,
            platform: 'pinterest',
            uiType: 'buttons',
            data: {
              title: 'Pinterest Video',
              thumbnail: result.thumbnail,
              author: { name: 'Pinterest User' },
              downloads: [{
                type: 'video',
                quality: 'Original Video',
                url: result.video,
                format: 'mp4'
              }]
            }
          };
        }

        return {
          success: true,
          platform: 'pinterest',
          uiType: 'buttons',
          data: {
            title: 'Pinterest Image',
            thumbnail: result.thumbnail,
            author: { name: 'Pinterest User' },
            downloads: [{
              type: 'image',
              quality: 'Original Image',
              url: result.image,
              format: 'jpg'
            }]
          }
        };
      }
    } catch (error) {
      console.error(`[Pinterest] Attempt ${attempt} failed (${usePrimary ? 'PRIMARY' : 'SECONDARY'}):`, error.message);
      
      if (usePrimary && attempt < retries) {
        console.log('[Pinterest] Switching to SECONDARY API...');
        usePrimary = false;
      } else if (!usePrimary && attempt < retries) {
        console.log('[Pinterest] Switching back to PRIMARY API...');
        usePrimary = true;
      }
      
      if (attempt === retries) {
        return {
          success: false,
          platform: 'pinterest',
          error: { message: error.message, code: 'PIN_ERROR' }
        };
      }
      
      console.log(`[Pinterest] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// CAPCUT DOWNLOADER - UPDATED WITH NEW API
// ============================================

async function capcutDownloader(url, retries = MAX_RETRIES) {
  let usePrimary = true;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Capcut] Downloading (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/downloader/capcut', { url }, usePrimary);
      const source = usePrimary ? 'primary' : 'secondary';

      console.log(`[Capcut] Using ${source.toUpperCase()} API`);

      if (!data || !data.status) {
        throw new Error('Invalid Capcut response');
      }

      let downloads = [];
      let title, thumbnail, author, duration;

      if (source === 'primary' && data.code === 200) {
        // Primary format
        title = data.title;
        thumbnail = data.coverUrl;
        author = data.authorName || 'Capcut Creator';
        downloads.push({
          type: 'video',
          quality: 'Template Video',
          url: data.originalVideoUrl,
          format: 'mp4'
        });
      } else if (data.result?.medias) {
        // Secondary format - NEW API STRUCTURE
        title = data.result.title;
        thumbnail = data.result.thumbnail;
        author = data.result.author || 'Capcut Creator';
        duration = data.result.duration;
        
        data.result.medias.forEach((media, idx) => {
          downloads.push({
            type: 'video',
            quality: media.quality || `Video ${idx + 1}`,
            url: media.url,
            format: 'mp4'
          });
        });
      }

      if (downloads.length === 0) {
        throw new Error('No download links found');
      }

      return {
        success: true,
        platform: 'capcut',
        uiType: 'buttons',
        data: {
          title: title || 'Capcut Template',
          thumbnail: thumbnail,
          author: { name: author },
          duration: duration,
          downloads
        }
      };
    } catch (error) {
      console.error(`[Capcut] Attempt ${attempt} failed (${usePrimary ? 'PRIMARY' : 'SECONDARY'}):`, error.message);
      
      if (usePrimary && attempt < retries) {
        console.log('[Capcut] Switching to SECONDARY API...');
        usePrimary = false;
      } else if (!usePrimary && attempt < retries) {
        console.log('[Capcut] Switching back to PRIMARY API...');
        usePrimary = true;
      }
      
      if (attempt === retries) {
        return {
          success: false,
          platform: 'capcut',
          error: { message: error.message, code: 'CC_ERROR' }
        };
      }
      
      console.log(`[Capcut] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// GOOGLE DRIVE DOWNLOADER
// ============================================

async function gdriveDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/gdrive', { url }, true);

    if (!data || !data.success || !data.data) {
      throw new Error('Failed to fetch Google Drive file');
    }

    const { data: file } = data;

    return {
      success: true,
      platform: 'gdrive',
      uiType: 'buttons',
      data: {
        title: file.filename,
        thumbnail: null,
        author: { name: 'Google Drive' },
        downloads: [{
          type: 'file',
          quality: 'Original File',
          url: file.downloadUrl,
          size: file.filesize,
          format: file.filename.split('.').pop()
        }]
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'gdrive',
      error: { message: error.message, code: 'GD_ERROR' }
    };
  }
}

// ============================================
// MEDIAFIRE DOWNLOADER - UPDATED WITH FALLBACK
// ============================================

async function mediafireDownloader(url, retries = MAX_RETRIES) {
  let usePrimary = true;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[MediaFire] Downloading (Attempt ${attempt}/${retries})`);

      const data = usePrimary
        ? await makeAPIRequest('/downloader/mediafire', { url }, true)
        : await makeAPIRequest('/downloader/mediafire', { url }, false);

      const source = usePrimary ? 'primary' : 'secondary';
      console.log(`[MediaFire] Using ${source.toUpperCase()} API`);

      if (!data || !data.status) {
        throw new Error('Invalid MediaFire response');
      }

      let downloadUrl, filename, filesize, ext, owner, uploadDate, mimetype;

      if (source === 'primary') {
        // Primary API response format
        if (!data.url) throw new Error('No download URL from primary API');
        downloadUrl = data.url;
        filename = data.filename;
        filesize = data.filesizeH;
        ext = data.ext;
        owner = data.owner;
        uploadDate = data.upload_date;
        mimetype = data.mimetype;
      } else {
        // Secondary API response format
        if (!data.result?.downloadUrl) throw new Error('No download URL from secondary API');
        downloadUrl = data.result.downloadUrl;
        filename = data.result.fileName;
        filesize = 'Unknown';
        ext = filename.split('.').pop();
        owner = 'MediaFire User';
      }

      return {
        success: true,
        platform: 'mediafire',
        uiType: 'buttons',
        data: {
          title: filename,
          thumbnail: null,
          author: { name: owner || 'MediaFire User' },
          downloads: [{
            type: 'file',
            quality: 'Download File',
            url: downloadUrl,
            size: filesize,
            format: ext
          }],
          metadata: {
            uploadDate: uploadDate,
            mimetype: mimetype
          }
        }
      };
    } catch (error) {
      console.error(`[MediaFire] Attempt ${attempt} failed (${usePrimary ? 'PRIMARY' : 'SECONDARY'}):`, error.message);
      
      if (usePrimary && attempt < retries) {
        console.log('[MediaFire] Switching to SECONDARY API...');
        usePrimary = false;
      } else if (!usePrimary && attempt < retries) {
        console.log('[MediaFire] Switching back to PRIMARY API...');
        usePrimary = true;
      }
      
      if (attempt === retries) {
        return {
          success: false,
          platform: 'mediafire',
          error: { message: error.message, code: 'MF_ERROR' }
        };
      }
      
      console.log(`[MediaFire] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// APPLE MUSIC DOWNLOADER - NEW
// ============================================

async function applemusicDownloader(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Apple Music] Downloading (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/downloader/applemusic', { url }, false);

      if (!data || !data.status || !data.result) {
        throw new Error('Invalid Apple Music response');
      }

      const result = data.result;

      return {
        success: true,
        platform: 'applemusic',
        uiType: 'buttons',
        data: {
          title: result.name,
          thumbnail: result.thumbnail,
          author: { name: result.artist },
          album: result.album_name,
          downloads: [{
            type: 'audio',
            quality: 'M4A Audio',
            url: result.url,
            format: 'm4a'
          }],
          metadata: {
            albumName: result.album_name,
            trackType: result.type
          }
        }
      };
    } catch (error) {
      console.error(`[Apple Music] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          platform: 'applemusic',
          error: { message: error.message, code: 'AM_ERROR' }
        };
      }
      
      console.log(`[Apple Music] Retrying in ${RETRY_INTERVAL}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// ALL-IN-ONE DOWNLOADER
// ============================================

async function aioDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/aio', { url }, true);

    if (!data || data.status !== 'success' || !data.data) {
      throw new Error('Failed to fetch media');
    }

    const { data: result } = data;
    const downloads = [];

    // Add video links
    if (result.links?.video && Array.isArray(result.links.video)) {
      result.links.video.forEach(video => {
        downloads.push({
          type: 'video',
          quality: video.q_text || 'Video',
          url: video.url,
          size: video.size,
          format: 'mp4'
        });
      });
    }

    // Add audio links
    if (result.links?.audio && Array.isArray(result.links.audio)) {
      result.links.audio.forEach(audio => {
        downloads.push({
          type: 'audio',
          quality: audio.q_text || 'Audio',
          url: audio.url,
          size: audio.size,
          format: 'mp3'
        });
      });
    }

    return {
      success: true,
      platform: result.extractor || 'unknown',
      uiType: 'buttons',
      data: {
        title: result.title || 'Media',
        thumbnail: result.thumbnail,
        author: {
          name: result.author?.full_name || result.author?.username || 'User',
          avatar: result.author?.avatar
        },
        downloads
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'aio',
      error: { message: error.message, code: 'AIO_ERROR' }
    };
  }
}

// ============================================
// MAIN DOWNLOADER SERVICE
// ============================================

class DownloaderService {
  async download(input, isSearch = false) {
    try {
      if (isSearch) {
        return await youtubeSearch(input);
      }

      const platform = detectPlatform(input);

      if (!platform) {
        return {
          success: false,
          error: {
            message: 'Unsupported URL or platform not detected',
            code: 'UNKNOWN_PLATFORM'
          }
        };
      }

      switch (platform) {
        case 'instagram': return await instagramDownloader(input);
        case 'tiktok': return await tiktokDownloader(input);
        case 'youtube': return await youtubeDownloader(input);
        case 'facebook': return await facebookDownloader(input);
        case 'twitter': return await twitterDownloader(input);
        case 'spotify': return await spotifyDownloader(input);
        case 'soundcloud': return await soundcloudDownloader(input);
        case 'pinterest': return await pinterestDownloader(input);
        case 'capcut': return await capcutDownloader(input);
        case 'gdrive': return await gdriveDownloader(input);
        case 'mediafire': return await mediafireDownloader(input);
        case 'applemusic': return await applemusicDownloader(input);
        default:
          return {
            success: false,
            error: {
              message: `Platform '${platform}' not implemented yet`,
              code: 'NOT_IMPLEMENTED'
            }
          };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          message: error.message,
          code: 'DOWNLOAD_ERROR'
        }
      };
    }
  }

  // Platform-specific methods
  async instagram(url) { return await instagramDownloader(url); }
  async youtubePlay(query) { return await youtubePlayDownloader(query); }
  async tiktok(url) { return await tiktokDownloader(url); }
  async tiktokSimple(url) { return await tiktokSimpleDownloader(url); }
  async youtube(url, format = null) { return await youtubeDownloader(url, format); }
  async youtubeSearch(query) { return await youtubeSearch(query); }
  async twitter(url) { return await twitterDownloader(url); }
  async facebook(url) { return await facebookDownloader(url); }
  async spotify(url) { return await spotifyDownloader(url); }
  async soundcloud(url) { return await soundcloudDownloader(url); }
  async pinterest(url) { return await pinterestDownloader(url); }
  async capcut(url) { return await capcutDownloader(url); }
  async gdrive(url) { return await gdriveDownloader(url); }
  async mediafire(url) { return await mediafireDownloader(url); }
  async applemusic(url) { return await applemusicDownloader(url); }
  async aio(url) { return await aioDownloader(url); }
  // Adult content downloaders
  async xnxx(url) { 
    const result = await searchService.xnxxDownload(url);
    if (!result.success) return result;
    
    // Download the video file
    const filename = `${result.data.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
    const mediaFile = await downloadWithRedirects(result.data.downloadUrl, filename);
    
    return {
      ...result,
      data: {
        ...result.data,
        filePath: mediaFile.filePath,
        filename: filename,
        fileSize: mediaFile.size,
        cleanup: mediaFile.cleanup
      }
    };
  }
  
  async xvideos(url) { 
    const result = await searchService.xvideosDownload(url);
    if (!result.success) return result;
    
    // Download the video file
    const filename = `${result.data.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
    const mediaFile = await downloadWithRedirects(result.data.downloadUrl, filename);
    
    return {
      ...result,
      data: {
        ...result.data,
        filePath: mediaFile.filePath,
        filename: filename,
        fileSize: mediaFile.size,
        cleanup: mediaFile.cleanup
      }
    };
  }
}

export default new DownloaderService();

export {
  detectPlatform,
  formatSize,
  formatDuration,
  downloadWithRedirects,
  makeAPIRequest,
  downloadMedia,
  youtubeDownloader,
  youtubeSearch,
  youtubePlayDownloader,
  youtubeMP3Downloader,
  searchService,
  youtubeMP4Downloader,
  youtubeMetadataDownloader,
  instagramDownloader,
  tiktokDownloader,
  tiktokSimpleDownloader,
  twitterDownloader,
  facebookDownloader,
  spotifyDownloader,
  soundcloudDownloader,
  pinterestDownloader,
  capcutDownloader,
  gdriveDownloader,
  mediafireDownloader,
  applemusicDownloader,
  aioDownloader
};