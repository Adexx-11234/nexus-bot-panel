import axios from "axios"
import FormData from "form-data"
import { fileTypeFromBuffer } from "file-type"
import fetch from "node-fetch"
import { JSDOM } from "jsdom"
import sharp from "sharp"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const tempDir = path.join(__dirname, "../temp")

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true })
}

console.log(`Using ezgif.com for all media conversions - NO FFmpeg required!`)

/**
 * Generate unique temp file path
 */
function getTempFilePath(prefix, ext) {
  return path.join(tempDir, `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`)
}

/**
 * Clean up temp file safely
 */
function cleanupTempFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log(`✓ Cleaned up temp file: ${path.basename(filePath)}`)
    }
  } catch (err) {
    console.warn(`Failed to cleanup ${filePath}:`, err.message)
  }
}

/**
 * Upload to Telegraph (accepts buffer)
 */
export function TelegraPh(buffer) {
  return new Promise(async (resolve, reject) => {
    try {
      const form = new FormData()
      form.append("file", buffer, "image.jpg")
      const { data } = await axios({
        url: "https://telegra.ph/upload",
        method: "POST",
        headers: { ...form.getHeaders() },
        data: form,
      })
      resolve("https://telegra.ph" + data[0].src)
    } catch (err) {
      reject(new Error(String(err)))
    }
  })
}

/**
 * Upload to Uguu (accepts buffer)
 */
export async function UploadFileUgu(buffer) {
  return new Promise(async (resolve, reject) => {
    try {
      const form = new FormData()
      form.append("files[]", buffer, "file.bin")
      const { data } = await axios({
        url: "https://uguu.se/upload.php",
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...form.getHeaders(),
        },
        data: form,
      })
      resolve(data.files[0])
    } catch (err) {
      reject(err)
    }
  })
}


/**
 * Get Telegram Sticker Pack and convert to WhatsApp format
 * @param {String} url Telegram sticker pack URL
 * @returns {Promise<Array>} Array of sticker objects with URLs and type info
 */
export async function Telesticker(url) {
  return new Promise(async (resolve, reject) => {
    if (!url.match(/(https:\/\/t\.me\/addstickers\/)/gi)) {
      throw new Error("Enter your telegram sticker URL")
    }

    try {
      const packName = url.replace("https://t.me/addstickers/", "")
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

      if (!BOT_TOKEN) {
        return reject(new Error("TELEGRAM_BOT_TOKEN environment variable is not set. Please add your Telegram bot token to .env file."))
      }

      console.log(`Fetching Telegram sticker pack: ${packName}`)

      const { data } = await axios({
        url: `https://api.telegram.org/bot${BOT_TOKEN}/getStickerSet`,
        method: "GET",
        params: {
          name: packName,
        },
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 30000,
      })

      if (!data.ok) {
        return reject(new Error(`Failed to fetch sticker pack from Telegram: ${data.description || "Unknown error"}`))
      }

      const hasil = []
      for (let i = 0; i < data.result.stickers.length; i++) {
        const sticker = data.result.stickers[i]

        const isVideo = sticker.is_video === true
        const isAnimated = sticker.is_animated === true

        const fileId = sticker.file_id

        const fileResponse = await axios({
          url: `https://api.telegram.org/bot${BOT_TOKEN}/getFile`,
          method: "GET",
          params: {
            file_id: fileId,
          },
          timeout: 30000,
        })

        if (!fileResponse.data.ok) {
          console.warn(`Failed to get file info for sticker ${i + 1}`)
          continue
        }

        const result = {
          status: 200,
          author: "TelegramImport",
          url: `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileResponse.data.result.file_path}`,
          isVideo: isVideo,
          isAnimated: isAnimated,
          fileType: isVideo ? "webm" : isAnimated ? "tgs" : "webp",
        }
        hasil.push(result)
      }

      resolve(hasil)
    } catch (err) {
      reject(new Error(`Failed to fetch Telegram stickers: ${err.message}`))
    }
  })
}

/**
 * Convert WebP/Sticker to MP4 using ezgif.com (animated stickers)
 * @param {Buffer|string} source WebP/Sticker buffer or URL
 * @returns {Promise<Buffer>} MP4 buffer
 */
export async function webp2mp4File(source) {
  try {
    console.log("Starting webp2mp4 conversion...")
    
    const form = new FormData()
    const isUrl = typeof source === "string" && /https?:\/\//.test(source)
    
    if (isUrl) {
      form.append("new-image-url", source)
      form.append("new-image", "")
    } else {
      form.append("new-image-url", "")
      form.append("new-image", source, "sticker.webp")
    }

    console.log("Uploading to ezgif...")
    
    // Step 1: Upload the webp file
    const res = await fetch("https://ezgif.com/webp-to-mp4", {
      method: "POST",
      body: form,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })
    
    if (!res.ok) {
      throw new Error(`Upload failed with status ${res.status}`)
    }
    
    const html = await res.text()
    const { document } = new JSDOM(html).window

    console.log("Extracting form data...")
    
    // Step 2: Extract form data for conversion
    const form2 = new FormData()
    const obj = {}
    for (const input of document.querySelectorAll("form input[name]")) {
      obj[input.name] = input.value
      form2.append(input.name, input.value)
    }

    if (!obj.file) {
      console.error("HTML response:", html.substring(0, 500))
      throw new Error("Failed to upload file to ezgif - file parameter not found")
    }

    console.log("Converting with file ID:", obj.file)

    // Step 3: Perform the conversion
    const res2 = await fetch("https://ezgif.com/webp-to-mp4/" + obj.file, {
      method: "POST",
      body: form2,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })
    
    if (!res2.ok) {
      throw new Error(`Conversion failed with status ${res2.status}`)
    }
    
    const html2 = await res2.text()
    const { document: document2 } = new JSDOM(html2).window

    console.log("Finding video element...")

    // Step 4: Get the converted video URL
    let videoSource = document2.querySelector("div#output > p.outfile > video > source")
    
    if (!videoSource) {
      videoSource = document2.querySelector("div#output video source")
    }
    
    if (!videoSource) {
      videoSource = document2.querySelector("video source")
    }
    
    if (!videoSource) {
      const videoElement = document2.querySelector("div#output video")
      if (videoElement && videoElement.src) {
        videoSource = { src: videoElement.src }
      }
    }
    
    if (!videoSource || !videoSource.src) {
      console.error("HTML response:", html2.substring(0, 1000))
      throw new Error("Failed to get converted video from ezgif - video source not found")
    }

    const videoUrl = new URL(videoSource.src, res2.url).toString()
    console.log("Downloading video from:", videoUrl)

    // Step 5: Download the MP4 buffer with enhanced retry logic
    let videoBuffer
    let retries = 5
    
    while (retries > 0) {
      try {
        console.log(`Download attempt ${6 - retries}/5...`)
        
        const videoResponse = await fetch(videoUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://ezgif.com/'
          }
        })
        
        if (!videoResponse.ok) {
          throw new Error(`Video download failed with status ${videoResponse.status}`)
        }
        
        videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
        
        if (videoBuffer.length === 0) {
          throw new Error("Downloaded video buffer is empty")
        }
        
        console.log(`✓ Download successful (${videoBuffer.length} bytes)`)
        break
        
      } catch (downloadError) {
        retries--
        console.error(`Download attempt failed: ${downloadError.message}`)
        
        if (retries === 0) {
          throw downloadError
        }
        
        // Exponential backoff: 2s, 4s, 8s, 16s, 32s
        const waitTime = Math.pow(2, 5 - retries) * 1000
        console.log(`Waiting ${waitTime}ms before retry... (${retries} attempts left)`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }

    console.log("✓ Conversion successful, buffer size:", videoBuffer.length)
    return videoBuffer
    
  } catch (ezgifError) {
    console.error("ezgif webp to mp4 conversion failed:", ezgifError.message)
    throw new Error(`Conversion failed: ${ezgifError.message}`)
  }
}

/**
 * Convert WebP/Sticker to PNG using Sharp (static stickers)
 * @param {Buffer|string} source WebP buffer or URL
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function webp2png(source) {
  try {
    const pngBuffer = await sharp(source).png().toBuffer()
    return pngBuffer
  } catch (error) {
    console.error("Sharp webp to png conversion failed:", error.message)
    throw error
  }
}

/**
 * Convert Image to WebP Sticker for WhatsApp using Sharp
 * @param {Buffer} buffer Image buffer (PNG, JPG, etc)
 * @returns {Promise<Buffer>} WebP sticker buffer
 */
export async function image2webp(buffer) {
  try {
    const webpBuffer = await sharp(buffer)
      .resize(512, 512, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({
        quality: 90,
        lossless: false,
      })
      .toBuffer()

    return webpBuffer
  } catch (error) {
    console.error("Sharp image to webp conversion failed:", error.message)
    throw error
  }
}

/**
 * Convert Video to WebP Animated Sticker for WhatsApp using ezgif.com
 * @param {Buffer} buffer Video buffer (MP4, WebM, etc.)
 * @returns {Promise<Buffer>} Animated WebP sticker buffer
 */
export async function video2webp(buffer) {
  try {
    const form = new FormData()
    form.append("new-image-url", "")
    form.append("new-image", buffer, "video.mp4")

    const res = await fetch("https://ezgif.com/video-to-webp", {
      method: "POST",
      body: form,
    })
    const html = await res.text()
    const { document } = new JSDOM(html).window

    const form2 = new FormData()
    const obj = {}
    for (const input of document.querySelectorAll("form input[name]")) {
      obj[input.name] = input.value
      form2.append(input.name, input.value)
    }

    if (!obj.file) {
      throw new Error("Failed to upload file to ezgif")
    }

    // Create a fresh FormData instead of trying to delete from existing one
    const form3 = new FormData()
    for (const [key, value] of Object.entries(obj)) {
      if (key !== "start" && key !== "end") {
        form3.append(key, value)
      }
    }
    form3.append("start", "0")
    form3.append("end", "10")

    const res2 = await fetch("https://ezgif.com/video-to-webp/" + obj.file, {
      method: "POST",
      body: form3,
    })
    const html2 = await res2.text()
    const { document: document2 } = new JSDOM(html2).window

    let imgElement = document2.querySelector("div#output img.output")
    if (!imgElement) {
      imgElement = document2.querySelector('img[src*="/ezgif-"]')
    }
    if (!imgElement) {
      imgElement = document2.querySelector("div#output img")
    }

    if (!imgElement) {
      throw new Error("Failed to get converted webp from ezgif")
    }

    const imgUrl = new URL(imgElement.src, res2.url).toString()

    const imgResponse = await fetch(imgUrl)
    let imgBuffer = Buffer.from(await imgResponse.arrayBuffer())

    try {
      imgBuffer = await sharp(imgBuffer)
        .resize(512, 512, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp()
        .toBuffer()
    } catch (resizeErr) {
      console.warn("Could not resize webp, using original:", resizeErr.message)
    }

    return imgBuffer
  } catch (ezgifError) {
    console.error("ezgif video to webp conversion failed:", ezgifError.message)
    throw ezgifError
  }
}

/**
 * Convert Audio to WhatsApp PTT (Voice Note)
 */
export async function toPTT(buffer) {
  console.warn("toPTT: Audio conversion not fully implemented without FFmpeg. Returning original buffer.")
  return buffer
}

/**
 * Convert to Audio (MP3)
 */
export async function toAudio(buffer) {
  console.warn("toAudio: Audio conversion not fully implemented without FFmpeg. Returning original buffer.")
  return buffer
}

/**
 * Extract Audio from Video
 */
export async function video2audio(buffer) {
  return toAudio(buffer)
}

/**
 * Get random filename with extension
 */
export function getRandom(ext) {
  return `${crypto.randomBytes(8).toString("hex")}${ext}`
}

/**
 * Sleep/delay function
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get media info
 */
export async function getMediaInfo(buffer) {
  try {
    const fileType = await fileTypeFromBuffer(buffer)
    return {
      format: fileType?.ext || "unknown",
      mime: fileType?.mime || "unknown",
      size: buffer.length,
    }
  } catch (err) {
    throw new Error(`Failed to get media info: ${err.message}`)
  }
}

// Export temp utilities
export { getTempFilePath, cleanupTempFile, tempDir }