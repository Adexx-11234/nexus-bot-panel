// lib/downloaders/index.js - Complete rewrite with undici for all platforms

import { request } from 'undici';

// ============================================
// CONSTANTS
// ============================================

const API_BASE = 'https://backend1.tioo.eu.org/api';

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
    threads: /threads\.net/i,
    rednote: /(?:xiaohongshu\.com|xhslink\.com)/i,
    douyin: /douyin\.com/i,
    cocofun: /icocofun\.com/i,
    snackvideo: /snackvideo\.com/i,
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

// ============================================
// CORE DOWNLOAD FUNCTIONS
// ============================================

/**
 * Make API request using undici
 */
async function makeAPIRequest(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `${API_BASE}${endpoint}?${queryString}`;
  
  console.log('[API Request]', url);
  
  const { body } = await request(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  
  return JSON.parse(Buffer.concat(chunks).toString());
}

/**
 * Follow redirects and download media to buffer (for all platforms)
 */
async function downloadWithRedirects(url, maxRedirects = 5) {
  try {
    console.log('[Download] Starting download:', url);
    
    // First request - may get 302 redirect
    let response = await request(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // Follow redirects if needed
    let redirectCount = 0;
    while (response.statusCode === 302 && redirectCount < maxRedirects) {
      const location = response.headers.location;
      console.log(`[Download] Following redirect ${redirectCount + 1}...`);
      
      // Consume the body before making new request
      for await (const chunk of response.body) {}
      
      response = await request(location, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      redirectCount++;
    }

    console.log('[Download] Final Status:', response.statusCode);
    console.log('[Download] Content-Type:', response.headers['content-type']);
    console.log('[Download] Content-Length:', response.headers['content-length']);

    if (response.statusCode !== 200) {
      throw new Error(`Download failed with status: ${response.statusCode}`);
    }

    // Read response body into buffer
    const chunks = [];
    for await (const chunk of response.body) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    console.log(`[Download] Complete: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    return buffer;
    
  } catch (error) {
    console.error('[Download] Error:', error.message);
    throw error;
  }
}

// ============================================
// YOUTUBE DOWNLOADERS
// ============================================

/**
 * YouTube MP3 Downloader
 */
async function youtubeMP3Downloader(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[YouTube MP3] Downloading MP3 (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/downloader/youtube', { url });

      if (!data || !data.status || !data.mp3) {
        throw new Error('Failed to fetch MP3 data');
      }

      console.log('[YouTube MP3] Data fetched:', data.title);
      console.log('[YouTube MP3] Downloading audio...');

      const buffer = await downloadWithRedirects(data.mp3);

      return {
        success: true,
        platform: 'youtube',
        uiType: 'direct',
        data: {
          title: data.title || 'YouTube Audio',
          thumbnail: data.thumbnail,
          author: { name: data.author || 'YouTube' },
          youtubeUrl: url,
          videoId: url,
          format: 'mp3',
          buffer: buffer,
          filename: `${data.title}.mp3`,
          size: buffer.length
        }
      };
    } catch (error) {
      console.error(`[YouTube MP3] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        console.error('[YouTube MP3] All retries exhausted');
        return {
          success: false,
          platform: 'youtube',
          error: { message: error.message, code: 'YT_MP3_ERROR' }
        };
      }
      
      const waitTime = 2000 * attempt;
      console.log(`[YouTube MP3] Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * YouTube MP4 Downloader
 */
async function youtubeMP4Downloader(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[YouTube MP4] Downloading MP4 (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/downloader/youtube', { url });

      if (!data || !data.status || !data.mp4) {
        throw new Error('Failed to fetch MP4 data');
      }

      console.log('[YouTube MP4] Data fetched:', data.title);
      console.log('[YouTube MP4] Downloading video...');

      const buffer = await downloadWithRedirects(data.mp4);

      return {
        success: true,
        platform: 'youtube',
        uiType: 'direct',
        data: {
          title: data.title || 'YouTube Video',
          thumbnail: data.thumbnail,
          author: { name: data.author || 'YouTube' },
          youtubeUrl: url,
          videoId: url,
          format: 'mp4',
          buffer: buffer,
          filename: `${data.title}.mp4`,
          size: buffer.length
        }
      };
    } catch (error) {
      console.error(`[YouTube MP4] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        console.error('[YouTube MP4] All retries exhausted');
        return {
          success: false,
          platform: 'youtube',
          error: { message: error.message, code: 'YT_MP4_ERROR' }
        };
      }
      
      const waitTime = 2000 * attempt;
      console.log(`[YouTube MP4] Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * YouTube Metadata Downloader (for buttons)
 */
async function youtubeMetadataDownloader(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[YouTube Metadata] Fetching metadata (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/downloader/youtube', { url });

      if (!data || !data.status) {
        throw new Error('Failed to fetch metadata');
      }

      console.log('[YouTube Metadata] Metadata fetched:', data.title);

      return {
        success: true,
        platform: 'youtube',
        uiType: 'buttons',
        data: {
          title: data.title || 'YouTube Video',
          thumbnail: data.thumbnail,
          author: { name: data.author || 'YouTube' },
          youtubeUrl: url,
          videoId: url // Pass the full URL so it can be downloaded fresh
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
      
      const waitTime = 2000 * attempt;
      console.log(`[YouTube Metadata] Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * YouTube Search
 */
async function youtubeSearch(query, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[YouTube Search] Searching (Attempt ${attempt}/${retries}):`, query);

      const data = await makeAPIRequest('/search/yts', { q: query });

      if (!data || !data.status || !data.all || data.all.length === 0) {
        throw new Error('No YouTube results found');
      }

      const items = data.all.slice(0, 10).map(v => {
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
      console.error(`[YouTube Search] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        console.error('[YouTube Search] All retries exhausted');
        return {
          success: false,
          platform: 'youtube',
          error: { message: error.message, code: 'YT_SEARCH_ERROR' }
        };
      }
      
      const waitTime = 2000 * attempt;
      console.log(`[YouTube Search] Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * Main YouTube Downloader (handles format selection)
 */
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

async function instagramDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/igdl', { url });

    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('No data returned from Instagram');
    }

    const items = data.filter(item => item.status);

    if (items.length === 0) {
      throw new Error('No valid Instagram content found');
    }

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
  } catch (error) {
    return {
      success: false,
      platform: 'instagram',
      error: { message: error.message, code: 'IG_ERROR' }
    };
  }
}

// ============================================
// TIKTOK DOWNLOADERS
// ============================================

async function tiktokDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/tiktok', { url });

    if (!data || data.code !== 0 || !data.data) {
      throw new Error('Failed to fetch TikTok video');
    }

    const { data: video } = data;

    return {
      success: true,
      platform: 'tiktok',
      uiType: 'buttons',
      data: {
        title: video.title,
        thumbnail: video.cover,
        author: {
          name: video.author?.nickname || 'TikTok User',
          avatar: video.author?.avatar
        },
        duration: video.duration,
        downloads: [
          {
            type: 'video',
            quality: 'HD (No Watermark)',
            url: video.hdplay,
            size: formatSize(video.hd_size),
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
        ],
        metadata: {
          views: video.play_count,
          likes: video.digg_count,
          comments: video.comment_count
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'tiktok',
      error: { message: error.message, code: 'TT_ERROR' }
    };
  }
}

async function tiktokSimpleDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/ttdl', { url });

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
// TWITTER DOWNLOADER
// ============================================

async function twitterDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/twitter', { url });

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
// FACEBOOK DOWNLOADER
// ============================================

async function facebookDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/fbdown', { url });

    if (!data || !data.status) {
      throw new Error('Failed to fetch Facebook video');
    }

    return {
      success: true,
      platform: 'facebook',
      uiType: 'buttons',
      data: {
        title: 'Facebook Video',
        thumbnail: null,
        author: { name: 'Facebook User' },
        downloads: [
          {
            type: 'video',
            quality: 'HD',
            url: data.HD,
            format: 'mp4'
          },
          {
            type: 'video',
            quality: 'SD',
            url: data.Normal_video,
            format: 'mp4'
          }
        ]
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'facebook',
      error: { message: error.message, code: 'FB_ERROR' }
    };
  }
}

// ============================================
// SPOTIFY DOWNLOADER
// ============================================

async function spotifyDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/spotify', { url });

    if (!data || !data.status || !data.res_data) {
      throw new Error('Failed to fetch Spotify track');
    }

    const { res_data } = data;

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
  } catch (error) {
    return {
      success: false,
      platform: 'spotify',
      error: { message: error.message, code: 'SPOT_ERROR' }
    };
  }
}

// ============================================
// SOUNDCLOUD DOWNLOADER
// ============================================

async function soundcloudDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/soundcloud', { url });

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
// PINTEREST DOWNLOADER
// ============================================

async function pinterestDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/pinterest', { url });

    if (!data || !data.success || !data.result) {
      throw new Error('Failed to fetch Pinterest content');
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
  } catch (error) {
    return {
      success: false,
      platform: 'pinterest',
      error: { message: error.message, code: 'PIN_ERROR' }
    };
  }
}

// ============================================
// CAPCUT DOWNLOADER
// ============================================

async function capcutDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/capcut', { url });

    if (!data || !data.status || data.code !== 200) {
      throw new Error('Failed to fetch Capcut template');
    }

    return {
      success: true,
      platform: 'capcut',
      uiType: 'buttons',
      data: {
        title: data.title,
        thumbnail: data.coverUrl,
        author: { name: data.authorName || 'Capcut Creator' },
        downloads: [{
          type: 'video',
          quality: 'Template Video',
          url: data.originalVideoUrl,
          format: 'mp4'
        }]
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'capcut',
      error: { message: error.message, code: 'CC_ERROR' }
    };
  }
}

// ============================================
// GOOGLE DRIVE DOWNLOADER
// ============================================

async function gdriveDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/gdrive', { url });

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
// MEDIAFIRE DOWNLOADER
// ============================================

async function mediafireDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/mediafire', { url });

    if (!data || !data.status) {
      throw new Error('Failed to fetch MediaFire file');
    }

    return {
      success: true,
      platform: 'mediafire',
      uiType: 'buttons',
      data: {
        title: data.filename,
        thumbnail: null,
        author: { name: data.owner || 'MediaFire User' },
        downloads: [{
          type: 'file',
          quality: 'Original File',
          url: data.url,
          size: data.filesizeH,
          format: data.ext
        }],
        metadata: {
          uploadDate: data.upload_date,
          mimetype: data.mimetype
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'mediafire',
      error: { message: error.message, code: 'MF_ERROR' }
    };
  }
}

// ============================================
// THREADS DOWNLOADER
// ============================================

async function threadsDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/threads', { url });

    if (!data || !data.status) {
      throw new Error('Failed to fetch Threads media');
    }

    const downloads = [];
    
    if (data.type === 'video' && data.video) {
      downloads.push({
        type: 'video',
        quality: 'Original Video',
        url: data.download || data.video,
        format: 'mp4'
      });
    } else if (data.type === 'image' && data.image) {
      downloads.push({
        type: 'image',
        quality: 'Original Image',
        url: data.image,
        format: 'jpg'
      });
    }

    return {
      success: true,
      platform: 'threads',
      uiType: 'buttons',
      data: {
        title: 'Threads Post',
        thumbnail: data.type === 'image' ? data.image : null,
        author: { name: 'Threads User' },
        downloads
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'threads',
      error: { message: error.message, code: 'THREADS_ERROR' }
    };
  }
}

// ============================================
// REDNOTE DOWNLOADER
// ============================================

async function rednoteDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/rednote', { url });

    if (!data || !data.status) {
      throw new Error('Failed to fetch Rednote media');
    }

    const downloads = [];

    if (data.downloads && data.downloads.length > 0) {
      data.downloads.forEach(item => {
        downloads.push({
          type: 'video',
          quality: item.quality || 'Original',
          url: item.url,
          format: 'mp4'
        });
      });
    }

    if (data.images && data.images.length > 0) {
      data.images.forEach((img, index) => {
        downloads.push({
          type: 'image',
          quality: `Image ${index + 1}`,
          url: img,
          format: 'jpg'
        });
      });
    }

    return {
      success: true,
      platform: 'rednote',
      uiType: 'buttons',
      data: {
        title: data.title || 'Rednote Post',
        thumbnail: data.images?.[0] || null,
        author: { name: data.nickname || 'Rednote User' },
        downloads,
        metadata: {
          likes: data.engagement?.likes,
          comments: data.engagement?.comments,
          collects: data.engagement?.collects
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'rednote',
      error: { message: error.message, code: 'REDNOTE_ERROR' }
    };
  }
}

// ============================================
// DOUYIN DOWNLOADER
// ============================================

async function douyinDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/douyin', { url });

    if (!data || !data.status || !data.data) {
      throw new Error('Failed to fetch Douyin video');
    }

    const downloads = data.data.links.map(link => ({
      type: 'video',
      quality: link.quality || 'Original',
      url: link.url,
      format: 'mp4'
    }));

    return {
      success: true,
      platform: 'douyin',
      uiType: 'buttons',
      data: {
        title: data.data.title || 'Douyin Video',
        thumbnail: data.data.thumbnail,
        author: { name: 'Douyin User' },
        downloads
      }
    };
      } catch (error) {
    return {
      success: false,
      platform: 'douyin',
      error: { message: error.message, code: 'DOUYIN_ERROR' }
    };
  }
}

// ============================================
// COCOFUN DOWNLOADER
// ============================================

async function cocofunDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/cocofun', { url });

    if (!data || !data.status) {
      throw new Error('Failed to fetch Cocofun video');
    }

    return {
      success: true,
      platform: 'cocofun',
      uiType: 'buttons',
      data: {
        title: data.topic || data.caption || 'Cocofun Video',
        thumbnail: data.thumbnail,
        author: { name: 'Cocofun User' },
        duration: data.duration,
        downloads: [
          {
            type: 'video',
            quality: 'No Watermark',
            url: data.no_watermark,
            format: 'mp4'
          },
          {
            type: 'video',
            quality: 'With Watermark',
            url: data.watermark,
            format: 'mp4'
          }
        ],
        metadata: {
          plays: data.play,
          likes: data.like,
          shares: data.share
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'cocofun',
      error: { message: error.message, code: 'COCOFUN_ERROR' }
    };
  }
}

// ============================================
// SNACKVIDEO DOWNLOADER
// ============================================

async function snackvideoDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/snackvideo', { url });

    if (!data || !data.status) {
      throw new Error('Failed to fetch SnackVideo');
    }

    return {
      success: true,
      platform: 'snackvideo',
      uiType: 'buttons',
      data: {
        title: data.title || 'SnackVideo',
        thumbnail: data.thumbnail,
        author: { 
          name: data.creator?.name || 'SnackVideo User',
          avatar: data.creator?.profileUrl
        },
        duration: data.duration,
        downloads: [{
          type: 'video',
          quality: 'Original Video',
          url: data.videoUrl,
          format: 'mp4'
        }],
        metadata: {
          views: data.interaction?.views,
          likes: data.interaction?.likes,
          shares: data.interaction?.shares,
          uploadDate: data.uploadDate
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      platform: 'snackvideo',
      error: { message: error.message, code: 'SNACKVIDEO_ERROR' }
    };
  }
}

// ============================================
// ALL-IN-ONE DOWNLOADER
// ============================================

async function aioDownloader(url) {
  try {
    const data = await makeAPIRequest('/downloader/aio', { url });

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
        case 'threads': return await threadsDownloader(input);
        case 'rednote': return await rednoteDownloader(input);
        case 'douyin': return await douyinDownloader(input);
        case 'cocofun': return await cocofunDownloader(input);
        case 'snackvideo': return await snackvideoDownloader(input);
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
  async tiktok(url) { return await tiktokDownloader(url); }
  async tiktokSimple(url) { return await tiktokSimpleDownloader(url); }
  async youtube(url, format = null) { 
    console.log('[DownloaderService] youtube() called with url:', url, 'format:', format);
    return await youtubeDownloader(url, format); 
  }
  async youtubeSearch(query) { return await youtubeSearch(query); }
  async twitter(url) { return await twitterDownloader(url); }
  async facebook(url) { return await facebookDownloader(url); }
  async spotify(url) { return await spotifyDownloader(url); }
  async soundcloud(url) { return await soundcloudDownloader(url); }
  async pinterest(url) { return await pinterestDownloader(url); }
  async capcut(url) { return await capcutDownloader(url); }
  async gdrive(url) { return await gdriveDownloader(url); }
  async mediafire(url) { return await mediafireDownloader(url); }
  async threads(url) { return await threadsDownloader(url); }
  async rednote(url) { return await rednoteDownloader(url); }
  async douyin(url) { return await douyinDownloader(url); }
  async cocofun(url) { return await cocofunDownloader(url); }
  async snackvideo(url) { return await snackvideoDownloader(url); }
  async aio(url) { return await aioDownloader(url); }
}

/**
 * Download media and return buffer (legacy support for other plugins)
 */
async function downloadMedia(url, maxRetries = 3) {
  return await downloadWithRedirects(url, maxRetries);
}

export default new DownloaderService();

export {
  detectPlatform,
  formatSize,
  formatDuration,
  downloadWithRedirects,
  makeAPIRequest,
  downloadMedia, // Add this line
  youtubeDownloader,
  youtubeSearch,
  youtubeMP3Downloader,
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
  threadsDownloader,
  rednoteDownloader,
  douyinDownloader,
  cocofunDownloader,
  snackvideoDownloader,
  aioDownloader
};