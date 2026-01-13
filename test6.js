import dotenv from "dotenv"
import axios from "axios"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { Telesticker } from "./lib/converters/media-converter.js"
import { video2webp, image2webp } from "./lib/converters/media-converter.js"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Create test directories
const testDir = path.join(__dirname, "test_stickers")
const downloadDir = path.join(testDir, "downloads")
const convertedDir = path.join(testDir, "converted")
const linksFile = path.join(testDir, "links.txt")

// Ensure directories exist
if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true })
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })
if (!fs.existsSync(convertedDir)) fs.mkdirSync(convertedDir, { recursive: true })

async function testStickerConversion() {
  try {
    console.log("📥 Fetching Telegram sticker pack...")
    const packUrl = "https://t.me/addstickers/acouplepak"
    
    // Step 1: Get stickers from Telegram
    const stickers = await Telesticker(packUrl)
    console.log(`✓ Got ${stickers.length} stickers from Telegram\n`)

    // Step 2: Download stickers and save links
    console.log("📥 Downloading stickers...")
    const linksData = []
    const stickerFiles = []

    for (let i = 0; i < Math.min(stickers.length, 5); i++) {
      const sticker = stickers[i]
      console.log(`[${i + 1}/5] Downloading ${sticker.fileType} sticker...`)

      try {
        const response = await axios.get(sticker.url, {
          responseType: "arraybuffer",
          timeout: 30000,
        })
        const buffer = Buffer.from(response.data)

        // Save to file
        const fileName = `sticker_${i + 1}_${sticker.fileType}_${sticker.isAnimated ? "animated" : "static"}.${sticker.fileType === "webm" ? "webm" : sticker.fileType === "tgs" ? "tgs" : "webp"}`
        const filePath = path.join(downloadDir, fileName)
        fs.writeFileSync(filePath, buffer)
        
        console.log(`   ✓ Saved: ${fileName} (${buffer.length} bytes)`)

        // Store link info
        linksData.push({
          index: i + 1,
          type: sticker.fileType,
          isAnimated: sticker.isAnimated,
          isVideo: sticker.isVideo,
          url: sticker.url,
          fileName: fileName,
          size: buffer.length,
        })

        stickerFiles.push({
          index: i + 1,
          fileName: fileName,
          filePath: filePath,
          buffer: buffer,
          isVideo: sticker.isVideo,
          isAnimated: sticker.isAnimated,
          fileType: sticker.fileType,
        })
      } catch (err) {
        console.error(`   ❌ Failed to download sticker ${i + 1}:`, err.message)
      }
    }

    // Step 3: Save links to txt file
    console.log(`\n💾 Saving ${linksData.length} links to links.txt...`)
    const linksContent = linksData
      .map(
        (l) =>
          `[${l.index}] ${l.type.toUpperCase()} (${l.isVideo ? "Video" : l.isAnimated ? "Animated" : "Static"}) - ${l.size} bytes\n${l.url}`
      )
      .join("\n\n")
    fs.writeFileSync(linksFile, linksContent)
    console.log(`✓ Links saved to: ${linksFile}\n`)

    // Step 4: Try converting each sticker
    console.log("🔄 Converting stickers...\n")
    for (const sticker of stickerFiles) {
      console.log(`[${sticker.index}/${stickerFiles.length}] Converting ${sticker.fileType}...`)
      
      try {
        if (sticker.isVideo || sticker.fileType === "webm") {
          console.log(`   Type: Video/Animated - Using video2webp conversion...`)
          const startTime = Date.now()
          
          try {
            const webpBuffer = await video2webp(sticker.buffer)
            const duration = Math.floor((Date.now() - startTime) / 1000)
            
            const convertedFileName = `sticker_${sticker.index}_converted.webp`
            const convertedPath = path.join(convertedDir, convertedFileName)
            fs.writeFileSync(convertedPath, webpBuffer)
            
            console.log(`   ✓ Converted in ${duration}s → ${convertedFileName} (${webpBuffer.length} bytes)\n`)
          } catch (convErr) {
            console.error(`   ❌ Conversion failed: ${convErr.message}\n`)
          }
        } else {
          console.log(`   Type: Static - Using image2webp conversion...`)
          const startTime = Date.now()
          
          try {
            const webpBuffer = await image2webp(sticker.buffer)
            const duration = Math.floor((Date.now() - startTime) / 1000)
            
            const convertedFileName = `sticker_${sticker.index}_converted.webp`
            const convertedPath = path.join(convertedDir, convertedFileName)
            fs.writeFileSync(convertedPath, webpBuffer)
            
            console.log(`   ✓ Converted in ${duration}s → ${convertedFileName} (${webpBuffer.length} bytes)\n`)
          } catch (convErr) {
            console.error(`   ❌ Conversion failed: ${convErr.message}\n`)
          }
        }
      } catch (err) {
        console.error(`   ❌ Error: ${err.message}\n`)
      }
    }

    console.log(`\n✅ Test completed!`)
    console.log(`📁 Downloads: ${downloadDir}`)
    console.log(`📁 Converted: ${convertedDir}`)
    console.log(`📄 Links file: ${linksFile}`)
    console.log(`\nFiles saved:`)
    console.log(`  - ${stickerFiles.length} original sticker files`)
    console.log(`  - links.txt with all URLs`)
    console.log(`  - Converted WebP files (if successful)`)

  } catch (error) {
    console.error("❌ Error:", error.message)
    process.exit(1)
  }
}

testStickerConversion()
