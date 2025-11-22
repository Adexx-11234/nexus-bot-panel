import axios from 'axios'
import FormData from 'form-data'
import { fileTypeFromBuffer } from 'file-type'
import fetch from 'node-fetch'
import * as cheerio from 'cheerio'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobePath from 'ffprobe-static'
import sharp from 'sharp'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs/promises'
import { createWriteStream, createReadStream } from 'fs'
import { Readable } from 'stream'

// Set FFmpeg paths (full build with all codecs)
ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath.path)
console.log(`FFmpeg path set to: ${ffmpegPath}`)
console.log(`FFprobe path set to: ${ffprobePath.path}`)

/**
 * Upload to Telegraph (accepts buffer)
 */
export function TelegraPh(buffer) {
  return new Promise(async (resolve, reject) => {
    try {
      const form = new FormData()
      form.append("file", buffer, 'image.jpg')
      const { data } = await axios({
        url: "https://telegra.ph/upload",
        method: "POST",
        headers: { ...form.getHeaders() },
        data: form
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
      form.append("files[]", buffer, 'file.bin')
      const { data } = await axios({
        url: "https://uguu.se/upload.php",
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...form.getHeaders()
        },
        data: form
      })
      resolve(data.files[0])
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Convert WebP/Sticker to MP4 (animated stickers)
 * @param {Buffer} buffer WebP/Sticker buffer
 * @returns {Promise<Buffer>} MP4 buffer
 */
export function webp2mp4File(buffer) {
  return new Promise(async (resolve, reject) => {
    const tmpDir = os.tmpdir()
    const inputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.webp`)
    const outputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.mp4`)

    try {
      await fs.writeFile(inputFile, buffer)

      ffmpeg(inputFile)
        .outputOptions([
          '-pix_fmt yuv420p',
          '-c:v libx264',
          '-movflags +faststart',
          '-filter:v crop=\'floor(in_w/2)*2:floor(in_h/2)*2\'',
          '-preset fast',
          '-crf 28'
        ])
        .toFormat('mp4')
        .on('end', async () => {
          try {
            const result = await fs.readFile(outputFile)
            await cleanup(inputFile, outputFile)
            resolve(result)
          } catch (err) {
            reject(err)
          }
        })
        .on('error', async (err) => {
          await cleanup(inputFile, outputFile)
          reject(err)
        })
        .save(outputFile)
    } catch (err) {
      await cleanup(inputFile, outputFile)
      reject(err)
    }
  })
}

/**
 * Convert WebP/Sticker to PNG (static stickers)
 * Uses Sharp library for better compatibility
 * @param {Buffer} buffer WebP buffer
 * @returns {Promise<Buffer>} PNG buffer
 */
export function webp2png(buffer) {
  return new Promise(async (resolve, reject) => {
    try {
      // Try using Sharp first (more reliable for WebP to PNG)
      const pngBuffer = await sharp(buffer)
        .png()
        .toBuffer()
      resolve(pngBuffer)
    } catch (sharpErr) {
      // Fallback to FFmpeg if Sharp fails
      const tmpDir = os.tmpdir()
      const inputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.webp`)
      const outputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.png`)

      try {
        await fs.writeFile(inputFile, buffer)

        ffmpeg(inputFile)
          .outputOptions([
            '-vcodec png',
            '-f image2'
          ])
          .output(outputFile)
          .on('end', async () => {
            try {
              const result = await fs.readFile(outputFile)
              await cleanup(inputFile, outputFile)
              resolve(result)
            } catch (err) {
              reject(err)
            }
          })
          .on('error', async (err) => {
            await cleanup(inputFile, outputFile)
            reject(err)
          })
          .run()
      } catch (err) {
        await cleanup(inputFile, outputFile)
        reject(err)
      }
    }
  })
}

/**
 * Convert Image to WebP Sticker for WhatsApp
 * @param {Buffer} buffer Image buffer (PNG, JPG, etc)
 * @returns {Promise<Buffer>} WebP sticker buffer
 */
export function image2webp(buffer) {
  return new Promise(async (resolve, reject) => {
    const tmpDir = os.tmpdir()
    const inputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.png`)
    const outputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.webp`)

    try {
      await fs.writeFile(inputFile, buffer)

      ffmpeg(inputFile)
        .outputOptions([
          '-vcodec libwebp',
          '-vf scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
          '-loop 0',
          '-preset default',
          '-an',
          '-vsync 0'
        ])
        .toFormat('webp')
        .on('end', async () => {
          try {
            const result = await fs.readFile(outputFile)
            await cleanup(inputFile, outputFile)
            resolve(result)
          } catch (err) {
            reject(err)
          }
        })
        .on('error', async (err) => {
          await cleanup(inputFile, outputFile)
          reject(err)
        })
        .save(outputFile)
    } catch (err) {
      await cleanup(inputFile, outputFile)
      reject(err)
    }
  })
}

/**
 * Convert Video to WebP Animated Sticker for WhatsApp
 * @param {Buffer} buffer Video buffer
 * @returns {Promise<Buffer>} Animated WebP sticker buffer
 */
export function video2webp(buffer) {
  return new Promise(async (resolve, reject) => {
    const tmpDir = os.tmpdir()
    const inputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.mp4`)
    const outputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.webp`)

    try {
      await fs.writeFile(inputFile, buffer)

      ffmpeg(inputFile)
        .outputOptions([
          '-vcodec libwebp',
          '-vf scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1,fps=15',
          '-loop 0',
          '-ss 00:00:00',
          '-t 00:00:10',
          '-preset default',
          '-an',
          '-vsync 0'
        ])
        .toFormat('webp')
        .on('end', async () => {
          try {
            const result = await fs.readFile(outputFile)
            await cleanup(inputFile, outputFile)
            resolve(result)
          } catch (err) {
            reject(err)
          }
        })
        .on('error', async (err) => {
          await cleanup(inputFile, outputFile)
          reject(err)
        })
        .save(outputFile)
    } catch (err) {
      await cleanup(inputFile, outputFile)
      reject(err)
    }
  })
}

/**
 * Convert Audio to WhatsApp PTT (Voice Note)
 * @param {Buffer} buffer Audio buffer
 * @returns {Promise<Buffer>} Opus audio buffer for WhatsApp PTT
 */
export function toPTT(buffer) {
  return new Promise(async (resolve, reject) => {
    const tmpDir = os.tmpdir()
    const inputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.audio`)
    const outputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.opus`)

    try {
      await fs.writeFile(inputFile, buffer)

      ffmpeg(inputFile)
        .audioCodec('libopus')
        .audioBitrate('128k')
        .audioChannels(1)
        .audioFrequency(48000)
        .outputOptions([
          '-vbr on',
          '-compression_level 10'
        ])
        .toFormat('opus')
        .on('end', async () => {
          try {
            const result = await fs.readFile(outputFile)
            await cleanup(inputFile, outputFile)
            resolve(result)
          } catch (err) {
            reject(err)
          }
        })
        .on('error', async (err) => {
          await cleanup(inputFile, outputFile)
          reject(err)
        })
        .save(outputFile)
    } catch (err) {
      await cleanup(inputFile, outputFile)
      reject(err)
    }
  })
}

/**
 * Convert to Audio (MP3)
 * @param {Buffer} buffer Audio/Video buffer
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
export function toAudio(buffer) {
  return new Promise(async (resolve, reject) => {
    const tmpDir = os.tmpdir()
    const inputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.input`)
    const outputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.mp3`)

    try {
      await fs.writeFile(inputFile, buffer)

      ffmpeg(inputFile)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .audioChannels(2)
        .audioFrequency(44100)
        .toFormat('mp3')
        .on('end', async () => {
          try {
            const result = await fs.readFile(outputFile)
            await cleanup(inputFile, outputFile)
            resolve(result)
          } catch (err) {
            reject(err)
          }
        })
        .on('error', async (err) => {
          await cleanup(inputFile, outputFile)
          reject(err)
        })
        .save(outputFile)
    } catch (err) {
      await cleanup(inputFile, outputFile)
      reject(err)
    }
  })
}

/**
 * Extract Audio from Video
 * @param {Buffer} buffer Video buffer
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
export function video2audio(buffer) {
  return toAudio(buffer)
}

/**
 * Convert to Video (MP4)
 * @param {Buffer} buffer Video buffer
 * @returns {Promise<Buffer>} MP4 video buffer
 */
export function toVideo(buffer) {
  return new Promise(async (resolve, reject) => {
    const tmpDir = os.tmpdir()
    const inputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.input`)
    const outputFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.mp4`)

    try {
      await fs.writeFile(inputFile, buffer)

      ffmpeg(inputFile)
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioBitrate('128k')
        .audioFrequency(44100)
        .outputOptions([
          '-crf 28',
          '-preset fast',
          '-movflags +faststart'
        ])
        .toFormat('mp4')
        .on('end', async () => {
          try {
            const result = await fs.readFile(outputFile)
            await cleanup(inputFile, outputFile)
            resolve(result)
          } catch (err) {
            reject(err)
          }
        })
        .on('error', async (err) => {
          await cleanup(inputFile, outputFile)
          reject(err)
        })
        .save(outputFile)
    } catch (err) {
      await cleanup(inputFile, outputFile)
      reject(err)
    }
  })
}

/**
 * Get Telegram Sticker Pack and convert to WhatsApp format
 * @param {String} url Telegram sticker pack URL
 * @returns {Promise<Array>} Array of sticker objects with URLs and buffers
 */
export async function Telesticker(url) {
  return new Promise(async (resolve, reject) => {
    if (!url.match(/(https:\/\/t\.me\/addstickers\/)/gi)) {
      return reject(new Error('Invalid Telegram sticker URL. Format: https://t.me/addstickers/packname'))
    }

    try {
      const packName = url.replace("https://t.me/addstickers/", "")
      const { data } = await axios({
        url: `https://api.telegram.org/bot891038791:AAHWB1dQd-vi0IbH2NjKYUk-hqQ8rQuzPD4/getStickerSet?name=${encodeURIComponent(packName)}`,
        method: "GET",
        headers: { "User-Agent": "GoogleBot" }
      })

      if (!data.ok) {
        return reject(new Error('Failed to fetch sticker pack from Telegram'))
      }

      const results = []
      for (let i = 0; i < data.result.stickers.length; i++) {
        try {
          const sticker = data.result.stickers[i]
          // Use thumb for preview, or file_id for full sticker
          const fileId = sticker.thumb?.file_id || sticker.file_id
          
          const fileData = await axios({
            url: `https://api.telegram.org/bot891038791:AAHWB1dQd-vi0IbH2NjKYUk-hqQ8rQuzPD4/getFile?file_id=${fileId}`,
            method: "GET"
          })

          const fileUrl = `https://api.telegram.org/file/bot891038791:AAHWB1dQd-vi0IbH2NjKYUk-hqQ8rQuzPD4/${fileData.data.result.file_path}`
          
          // Download the sticker buffer
          const response = await axios.get(fileUrl, { responseType: 'arraybuffer' })
          const buffer = Buffer.from(response.data)

          results.push({
            status: 200,
            url: fileUrl,
            buffer: buffer,
            isAnimated: sticker.is_animated || false,
            isVideo: sticker.is_video || false,
            emoji: sticker.emoji || '😀'
          })
        } catch (err) {
          console.error(`Failed to fetch sticker ${i}:`, err.message)
          continue
        }
      }

      if (results.length === 0) {
        return reject(new Error('No stickers could be downloaded from the pack'))
      }

      resolve(results)
    } catch (err) {
      reject(new Error(`Failed to fetch Telegram stickers: ${err.message}`))
    }
  })
}

/**
 * Upload to Flonime
 */
export async function floNime(medianya, options = {}) {
  try {
    const fileTypeResult = await fileTypeFromBuffer(medianya)
    const ext = fileTypeResult?.ext || options.ext || 'bin'
    const form = new FormData()
    form.append('file', medianya, `tmp.${ext}`)
    const response = await fetch('https://flonime.my.id/upload', {
      method: 'POST',
      body: form
    })
    return await response.json()
  } catch (err) {
    throw new Error(`Upload failed: ${err.message}`)
  }
}

/**
 * Cleanup temporary files
 */
async function cleanup(...files) {
  for (const file of files) {
    try {
      await fs.unlink(file)
    } catch {}
  }
}

/**
 * Get random filename with extension
 */
export function getRandom(ext) {
  return `${crypto.randomBytes(8).toString('hex')}${ext}`
}

/**
 * Sleep/delay function
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Get media info
 * @param {Buffer} buffer Media buffer
 * @returns {Promise<Object>} Media metadata
 */
export function getMediaInfo(buffer) {
  return new Promise(async (resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), getRandom('.media'))
    
    try {
      await fs.writeFile(tmpFile, buffer)
      
      ffmpeg.ffprobe(tmpFile, async (err, metadata) => {
        await cleanup(tmpFile)
        
        if (err) return reject(err)
        resolve(metadata)
      })
    } catch (err) {
      await cleanup(tmpFile)
      reject(err)
    }
  })
}