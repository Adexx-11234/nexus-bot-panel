// lib/ai/index.js - Complete AI services handler

import { request } from 'undici';
import moment from 'moment-timezone';

// ============================================
// CONSTANTS
// ============================================

const API_PRIMARY = 'https://backend1.tioo.eu.org/api';
const API_SECONDARY = 'https://api.deline.web.id';
const API_OMEGA = 'https://omegatech-api.dixonomega.tech/api';
const MAX_RETRIES = 3;
const MAX_RETRIES_SECONDARY = 5;
const RETRY_INTERVAL = 1500;
const API_REQUEST_TIMEOUT = 60000; // 60 seconds

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatTimestamp() {
  return moment().tz('Africa/Lagos').format('YYYY-MM-DD HH:mm:ss');
}

function formatSources(citations) {
  if (!citations || !Array.isArray(citations)) return '';
  
  let sources = '\n\n📚 *Sources:*\n';
  citations.slice(0, 5).forEach((cite, idx) => {
    sources += `${idx + 1}. ${cite.title}\n   ${cite.url}\n`;
  });
  return sources;
}

// ✅ NEW: Check if error is a header-related failure
function isHeaderFailure(error) {
  const errorMsg = error.message?.toLowerCase() || '';
  return errorMsg.includes('header') || 
         errorMsg.includes('timeout') || 
         errorMsg.includes('parse') ||
         errorMsg.includes('invalid character') ||
         errorMsg.includes('unexpected token');
}

// ✅ NEW: Check if error should trigger API switch
function shouldSwitchAPI(error) {
  const errorMsg = error.message?.toLowerCase() || '';
  return errorMsg.includes('connect') ||
         errorMsg.includes('econnrefused') ||
         errorMsg.includes('etimedout') ||
         errorMsg.includes('socket') ||
         errorMsg.includes('network');
}

// ============================================
// CORE API REQUEST FUNCTIONS
// ============================================

async function makeAPIRequest(endpoint, params = {}, baseUrl = API_PRIMARY, method = 'GET', body = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT);
  
  try {
    const url = method === 'GET' 
      ? `${baseUrl}${endpoint}?${new URLSearchParams(params).toString()}`
      : `${baseUrl}${endpoint}`;
    
    //console.log(`[AI API Request] ${method} ${url}`);
    
    const options = {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: controller.signal,
      bodyTimeout: API_REQUEST_TIMEOUT,
      headersTimeout: 30000
    };

    if (method === 'POST' && body) {
      options.body = JSON.stringify(body);
    }

    const { body: responseBody, statusCode } = await request(url, options);
    clearTimeout(timeoutId);
    
    const chunks = [];
    for await (const chunk of responseBody) {
      chunks.push(chunk);
    }
    
    const data = Buffer.concat(chunks);
    
    // Check if response is JSON
    try {
      return JSON.parse(data.toString());
    } catch {
      // Return buffer for image/video responses
      return data;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function makeAPIRequestWithRetry(endpoint, params = {}, baseUrl = API_PRIMARY, method = 'GET', body = null, maxRetries = MAX_RETRIES) {
  // ✅ Use more retries for secondary API
  const effectiveRetries = baseUrl === API_SECONDARY ? MAX_RETRIES_SECONDARY : maxRetries;
  
  for (let attempt = 1; attempt <= effectiveRetries; attempt++) {
    try {
      const result = await makeAPIRequest(endpoint, params, baseUrl, method, body);
      return result;
    } catch (error) {
      const isLastAttempt = attempt === effectiveRetries;
      const isHeader = isHeaderFailure(error);
      
      // Log appropriately
      if (isHeader) {
        console.warn(`[AI API] Header/Parse error (Attempt ${attempt}/${effectiveRetries}): ${error.message}`);
      } else {
        console.warn(`[AI API] Request failed (Attempt ${attempt}/${effectiveRetries}): ${error.message}`);
      }
      
      // Retry with delay if not last attempt
      if (!isLastAttempt) {
        // ✅ Shorter delay for header failures (they often succeed quickly on retry)
        const delay = isHeader ? 500 : RETRY_INTERVAL;
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

async function makeAPIRequestWithFallback(primaryEndpoint, secondaryEndpoint, params = {}, usePrimary = true) {
  try {
    //console.log(`[AI API] Trying ${usePrimary ? 'PRIMARY' : 'SECONDARY'} API...`);
    const result = await makeAPIRequestWithRetry(
      primaryEndpoint, 
      params, 
      usePrimary ? API_PRIMARY : API_SECONDARY
    );
    //console.log('[AI API] Success');
    return { success: true, data: result, source: usePrimary ? 'primary' : 'secondary' };
  } catch (primaryError) {
    console.warn(`[AI API] ${usePrimary ? 'PRIMARY' : 'SECONDARY'} failed:`, primaryError.message);
    
    if (!secondaryEndpoint) {
      throw primaryError;
    }
    
    try {
      //console.log(`[AI API] Trying ${usePrimary ? 'SECONDARY' : 'PRIMARY'} API...`);
      const result = await makeAPIRequestWithRetry(
        secondaryEndpoint, 
        params, 
        usePrimary ? API_SECONDARY : API_PRIMARY
      );
      //console.log('[AI API] Fallback success');
      return { success: true, data: result, source: usePrimary ? 'secondary' : 'primary' };
    } catch (secondaryError) {
      console.error('[AI API] Fallback failed:', secondaryError.message);
      throw secondaryError;
    }
  }
}

// ============================================
// TEXT AI MODELS - WITH FALLBACK
// ============================================

async function geminiAI(query, retries = MAX_RETRIES) {
  let usePrimary = true;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Gemini AI] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest(
        usePrimary ? '/ai/geminiai' : '/ai/copilot',
        usePrimary ? { q: query } : { text: query },
        usePrimary ? API_PRIMARY : API_SECONDARY
      );

      if (!data || !data.status) {
        throw new Error('Invalid response from Gemini AI');
      }

      return {
        success: true,
        model: 'Gemini AI',
        response: data.data || data.result,
        timestamp: formatTimestamp(),
        source: usePrimary ? 'primary' : 'secondary'
      };
    } catch (error) {
      console.error(`[Gemini AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt < retries) {
        usePrimary = !usePrimary; // Switch API
        //console.log(`[Gemini AI] Switching to ${usePrimary ? 'PRIMARY' : 'SECONDARY'} API...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
      } else {
        return {
          success: false,
          error: { message: error.message, code: 'GEMINI_ERROR' }
        };
      }
    }
  }
}

async function geminiLiteAI(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Gemini Lite] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/geminiai-lite', { q: query }, API_PRIMARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from Gemini Lite');
      }

      const response = data.data?.parts?.[0]?.text || data.data;

      return {
        success: true,
        model: 'Gemini AI Lite',
        response,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Gemini Lite] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'GEMINI_LITE_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function gpt4oAI(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[GPT-4o] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/gpt-4o', { q: query }, API_PRIMARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from GPT-4o');
      }

      return {
        success: true,
        model: 'GPT-4o',
        response: data.data,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[GPT-4o] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'GPT4O_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function gpt4oMiniAI(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[GPT-4o Mini] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/gpt-4o-mini', { q: query }, API_PRIMARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from GPT-4o Mini');
      }

      return {
        success: true,
        model: 'GPT-4o Mini',
        response: data.data,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[GPT-4o Mini] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'GPT4O_MINI_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function claudeAI(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Claude AI] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/claudeai', { q: query }, API_PRIMARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from Claude AI');
      }

      return {
        success: true,
        model: 'Claude AI',
        response: data.data,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Claude AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'CLAUDE_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function llamaAI(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Llama 3.3] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/llama-3.3-70b', { q: query }, API_PRIMARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from Llama AI');
      }

      return {
        success: true,
        model: 'Llama 3.3-70b',
        response: data.data,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Llama AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'LLAMA_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function metaAI(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Meta AI] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/metaai', { q: query }, API_PRIMARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from Meta AI');
      }

      return {
        success: true,
        model: 'Meta AI',
        response: data.data,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Meta AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'META_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function powerbrainAI(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[PowerBrain AI] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/powerbrainai', { q: query }, API_PRIMARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from PowerBrain AI');
      }

      return {
        success: true,
        model: 'PowerBrain AI',
        response: data.data,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[PowerBrain AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'POWERBRAIN_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function copilotAI(query, useThink = false, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Copilot AI] Processing query with ${useThink ? 'THINK' : 'NORMAL'} mode (Attempt ${attempt}/${retries})`);

      const endpoint = useThink ? '/ai/copilot-think' : '/ai/copilot';
       const data = await makeAPIRequestWithRetry(endpoint, { text: query }, API_SECONDARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from Copilot AI');
      }

      // Handle copilot-think response (has citations)
      if (useThink && data.result) {
        return {
          success: true,
          model: 'Copilot AI (Think Mode)',
          response: data.result.text,
          citations: data.result.citations,
          timestamp: formatTimestamp()
        };
      }

      return {
        success: true,
        model: 'Copilot AI',
        response: data.result,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Copilot AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'COPILOT_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function feloAI(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Felo AI] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/feloai', { q: query }, API_PRIMARY);

      if (!data || !data.status || !data.data) {
        throw new Error('Invalid response from Felo AI');
      }

      return {
        success: true,
        model: 'Felo AI',
        response: data.data.answer,
        sources: data.data.source,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Felo AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'FELO_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// SPECIALIZED TEXT AI
// ============================================

async function gitaAI(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Gita AI] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/gitaai', { q: query }, API_PRIMARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from Gita AI');
      }

      return {
        success: true,
        model: 'Gita AI',
        response: data.data,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Gita AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'GITA_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function muslimAI(query, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Muslim AI] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/muslimai', { q: query }, API_PRIMARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from Muslim AI');
      }

      return {
        success: true,
        model: 'Muslim AI',
        response: data.data,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Muslim AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'MUSLIM_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function bibleAI(query, translation = 'NIV', retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Bible AI] Processing query (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/bibleai', { q: query, t: translation }, API_PRIMARY);

      if (!data || !data.status) {
        throw new Error('Invalid response from Bible AI');
      }

      return {
        success: true,
        model: 'Bible AI',
        response: data.data,
        sources: data.sources,
        translation: data.translation,
        metadata: data.metadata,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Bible AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'BIBLE_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// IMAGE GENERATION
// ============================================

async function fluxAI(prompt, options = {}, retries = MAX_RETRIES) {
  const defaultOptions = {
    width: 512,
    height: 512,
    steps: 25,
    seed: null,
    batch_size: 1
  };

  const params = { prompt, ...defaultOptions, ...options };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Flux AI] Generating image (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/flux-ai', {}, API_PRIMARY, 'POST', params);

      if (!data || !data.imageUrl) {
        throw new Error('Invalid response from Flux AI');
      }

      return {
        success: true,
        model: 'Flux AI',
        imageUrl: data.imageUrl,
        prompt,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Flux AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'FLUX_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function magicstudioAI(prompt, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Magic Studio AI] Generating image (Attempt ${attempt}/${retries})`);

      const imageBuffer = await makeAPIRequest('/ai/magicstudioai', { q: prompt }, API_PRIMARY);

      if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
        throw new Error('Invalid response from Magic Studio AI');
      }

      return {
        success: true,
        model: 'Magic Studio AI',
        imageBuffer,
        prompt,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Magic Studio AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'MAGICSTUDIO_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function omegaImageGen(prompt, ratio = '1:1', retries = MAX_RETRIES) {
  let usePrimary = false;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Omega Image Gen] Generating image (Attempt ${attempt}/${retries}) using ${usePrimary ? 'OMEGA' : 'SECONDARY'}`);

      if (usePrimary) {
        // ✅ Use enhanced retry for Omega API
        const data = await makeAPIRequestWithRetry('/ai/Ai-gen-image', { prompt, ratio }, API_OMEGA);

        if (!data || !data.success || !data.imageUrl) {
          throw new Error('Invalid response from Omega Image Gen');
        }

        return {
          success: true,
          model: 'Omega AI Image Generator',
          imageUrl: data.imageUrl,
          prompt: data.prompt,
          ratio: data.ratio,
          timestamp: formatTimestamp()
        };
      } else {
        // ✅ Enhanced retry for secondary (more prone to header failures)
        const imageBuffer = await makeAPIRequestWithRetry('/ai/txt2img', { prompt }, API_SECONDARY, 'GET', null, MAX_RETRIES_SECONDARY);

        if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
          throw new Error('Invalid response from Secondary Image Gen');
        }

        return {
          success: true,
          model: 'AI Image Generator (Secondary)',
          imageBuffer,
          prompt,
          timestamp: formatTimestamp()
        };
      }
    } catch (error) {
      console.error(`[Omega Image Gen] Attempt ${attempt} failed:`, error.message);
      
      if (attempt < retries) {
        // ✅ Switch API on connection errors, retry same API on header failures
        if (shouldSwitchAPI(error)) {
          usePrimary = !usePrimary;
          //console.log(`[Omega Image Gen] Switching to ${usePrimary ? 'OMEGA' : 'SECONDARY'} API...`);
        } else if (isHeaderFailure(error)) {
          //console.log(`[Omega Image Gen] Header failure, retrying same API...`);
        }
        
        const delay = isHeaderFailure(error) ? 500 : RETRY_INTERVAL;
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return {
          success: false,
          error: { message: error.message, code: 'OMEGA_IMAGE_ERROR' }
        };
      }
    }
  }
}

// ============================================
// VIDEO GENERATION
// ============================================

async function soraAI(prompt, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Sora AI] Generating video (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/sora', { prompt }, API_OMEGA);

      if (!data || !data.success || !data.result) {
        throw new Error('Invalid response from Sora AI');
      }

      return {
        success: true,
        model: 'Sora AI',
        videoUrl: data.result,
        prompt: data.prompt,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Sora AI] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'SORA_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// MUSIC GENERATION
// ============================================

async function sonuCreate(description, instrumental = false, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Sonu Create] Creating music task (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/Sonu-create', { 
        description, 
        instrumental: instrumental ? 'true' : 'false' 
      }, API_OMEGA);

      if (!data || !data.success || !data.taskId) {
        throw new Error('Invalid response from Sonu Create');
      }

      return {
        success: true,
        model: 'Sonu AI',
        taskId: data.taskId,
        statusCheckUrl: data.statusCheckUrl,
        message: data.message,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Sonu Create] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'SONU_CREATE_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

async function sonuStatus(taskId, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[Sonu Status] Checking status (Attempt ${attempt}/${retries})`);

      const data = await makeAPIRequest('/ai/sonu-status', { id: taskId }, API_OMEGA);

      if (!data || !data.success) {
        throw new Error('Invalid response from Sonu Status');
      }

      return {
        success: true,
        status: data.status,
        audioUrl: data.audioUrl,
        message: data.message,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[Sonu Status] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'SONU_STATUS_ERROR' }
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

// ============================================
// IMAGE ANALYSIS
// ============================================

async function nsfwCheck(imageUrl, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[NSFW Check] Analyzing image (Attempt ${attempt}/${retries})`);

      // ✅ Enhanced retry for secondary API
      const data = await makeAPIRequestWithRetry('/ai/nsfwcheck', { url: imageUrl }, API_SECONDARY, 'GET', null, MAX_RETRIES_SECONDARY);

      if (!data || !data.status || !data.result) {
        throw new Error('Invalid response from NSFW Check');
      }

      return {
        success: true,
        model: 'NSFW Checker',
        result: data.result,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[NSFW Check] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'NSFW_CHECK_ERROR' }
        };
      }
      
      const delay = isHeaderFailure(error) ? 500 : RETRY_INTERVAL;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function toPrompt(imageUrl, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      //console.log(`[To Prompt] Extracting prompt (Attempt ${attempt}/${retries})`);

      // ✅ Enhanced retry for secondary API
      const data = await makeAPIRequestWithRetry('/ai/toprompt', { url: imageUrl }, API_SECONDARY, 'GET', null, MAX_RETRIES_SECONDARY);

      if (!data || !data.status || !data.result) {
        throw new Error('Invalid response from To Prompt');
      }

      return {
        success: true,
        model: 'To Prompt',
        original: data.result.original,
        translated: data.result.translated,
        timestamp: formatTimestamp()
      };
    } catch (error) {
      console.error(`[To Prompt] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: { message: error.message, code: 'TO_PROMPT_ERROR' }
        };
      }
      
      const delay = isHeaderFailure(error) ? 500 : RETRY_INTERVAL;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// ============================================
// MAIN AI SERVICE
// ============================================

class AIService {
  // Text AI Models
  async gemini(query) { return await geminiAI(query); }
  async geminiLite(query) { return await geminiLiteAI(query); }
  async gpt4o(query) { return await gpt4oAI(query); }
  async gpt4oMini(query) { return await gpt4oMiniAI(query); }
  async claude(query) { return await claudeAI(query); }
  async llama(query) { return await llamaAI(query); }
  async meta(query) { return await metaAI(query); }
  async powerbrain(query) { return await powerbrainAI(query); }
  async copilot(query, useThink = false) { return await copilotAI(query, useThink); }
  async felo(query) { return await feloAI(query); }

  // Specialized Text AI
  async gita(query) { return await gitaAI(query); }
  async muslim(query) { return await muslimAI(query); }
  async bible(query, translation = 'NIV') { return await bibleAI(query, translation); }

  // Image Generation
  async flux(prompt, options = {}) { return await fluxAI(prompt, options); }
  async magicstudio(prompt) { return await magicstudioAI(prompt); }
  async omegaImage(prompt, ratio = '1:1') { return await omegaImageGen(prompt, ratio); }

  // Video Generation
  async sora(prompt) { return await soraAI(prompt); }

  // Music Generation
  async createMusic(description, instrumental = false) { return await sonuCreate(description, instrumental); }
  async checkMusic(taskId) { return await sonuStatus(taskId); }

  // Image Analysis
  async checkNsfw(imageUrl) { return await nsfwCheck(imageUrl); }
  async extractPrompt(imageUrl) { return await toPrompt(imageUrl); }
}

export default new AIService();

export {
  geminiAI,
  geminiLiteAI,
  gpt4oAI,
  gpt4oMiniAI,
  claudeAI,
  llamaAI,
  metaAI,
  powerbrainAI,
  copilotAI,
  feloAI,
  gitaAI,
  muslimAI,
  bibleAI,
  fluxAI,
  magicstudioAI,
  omegaImageGen,
  soraAI,
  sonuCreate,
  sonuStatus,
  nsfwCheck,
  toPrompt,
  formatTimestamp,
  formatSources
};