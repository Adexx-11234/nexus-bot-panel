import dotenv from "dotenv"
import axios from "axios"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import FormData from "form-data"
import { JSDOM } from "jsdom"
import fetch from "node-fetch"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const testDir = path.join(__dirname, "test_stickers")
const downloadDir = path.join(testDir, "downloads")

async function debugEzgif() {
  try {
    // Read the first downloaded sticker
    const files = fs.readdirSync(downloadDir)
    const testFile = files[0]
    const testPath = path.join(downloadDir, testFile)
    
    console.log(`\n🧪 DEBUG: Testing ezgif.com conversion`)
    console.log(`📄 File: ${testFile}`)
    
    const buffer = fs.readFileSync(testPath)
    console.log(`📊 Size: ${buffer.length} bytes\n`)

    // STEP 1: Upload file
    console.log(`[STEP 1] Upload video to ezgif.com...`)
    const form = new FormData()
    form.append("new-image-url", "")
    form.append("new-image", buffer, "video.webm")

    const res = await fetch("https://ezgif.com/video-to-webp", {
      method: "POST",
      body: form,
    })
    
    console.log(`   Status: ${res.status} ${res.statusText}`)
    
    const html = await res.text()
    console.log(`   Response length: ${html.length} bytes`)
    
    // Save HTML for inspection
    fs.writeFileSync(path.join(testDir, "step1_upload.html"), html)
    console.log(`   ✓ Saved: step1_upload.html\n`)

    // Parse HTML
    console.log(`[STEP 2] Parse form from response...`)
    const { document } = new JSDOM(html).window
    const form2 = new FormData()
    const obj = {}
    
    for (const input of document.querySelectorAll("form input[name]")) {
      console.log(`   Found input: ${input.name} = ${input.value}`)
      obj[input.name] = input.value
      form2.append(input.name, input.value)
    }

    if (!obj.file) {
      console.log(`   ❌ ERROR: No file parameter found!`)
      console.log(`   Available parameters: ${Object.keys(obj).join(", ")}`)
      return
    }
    console.log(`   ✓ Got file ID: ${obj.file}\n`)

    // STEP 3: Convert video
    console.log(`[STEP 3] Convert video (start=0, end=10)...`)
    const form3 = new FormData()
    for (const [key, value] of Object.entries(obj)) {
      if (key !== "start" && key !== "end") {
        form3.append(key, value)
      }
    }
    form3.append("start", "0")
    form3.append("end", "10")

    const conversionUrl = `https://ezgif.com/video-to-webp/${obj.file}`
    console.log(`   URL: ${conversionUrl}`)
    
    const res2 = await fetch(conversionUrl, {
      method: "POST",
      body: form3,
    })

    console.log(`   Status: ${res2.status} ${res2.statusText}`)
    
    const html2 = await res2.text()
    console.log(`   Response length: ${html2.length} bytes`)
    
    // Save HTML for inspection
    fs.writeFileSync(path.join(testDir, "step2_convert.html"), html2)
    console.log(`   ✓ Saved: step2_convert.html\n`)

    // STEP 4: Find WebP output
    console.log(`[STEP 4] Find WebP output in HTML...`)
    const { document: document2 } = new JSDOM(html2).window

    // Try different selectors
    let webpLink = null
    
    // Look for download links
    const links = document2.querySelectorAll("a")
    console.log(`   Found ${links.length} total links`)
    console.log(`   Looking for .webp links (not .webp.html)...`)
    
    for (const link of links) {
      const href = link.getAttribute("href")
      if (href && href.includes(".webp") && !href.endsWith(".html")) {
        console.log(`   ✓ Found direct WebP link: ${href}`)
        webpLink = href
        break
      }
    }

    // Look for image sources
    if (!webpLink) {
      console.log(`   No direct link found, checking image src...`)
      const images = document2.querySelectorAll("img")
      console.log(`   Found ${images.length} total images`)
      
      for (const img of images) {
        const src = img.getAttribute("src")
        if (src && src.includes(".webp")) {
          console.log(`   ✓ Found WebP image: ${src}`)
          webpLink = src
          break
        }
      }
    }

    // Alternative: look for webp in div#output
    if (!webpLink) {
      console.log(`   Searching div#output for WebP...`)
      const output = document2.querySelector("div#output")
      if (output) {
        const outputHtml = output.innerHTML
        const match = outputHtml.match(/href=['"]([^'"]*\.webp[^'"]*)['"]/)
        if (match) {
          console.log(`   ✓ Found in output HTML: ${match[1]}`)
          webpLink = match[1]
        }
      }
    }

    if (!webpLink) {
      console.log(`   ❌ No WebP found!`)
      console.log(`   Searching for any .webp reference...`)
      const fullText = html2
      const webpMatches = fullText.match(/[^"']*\.webp[^"']*/g) || []
      webpMatches.slice(0, 5).forEach(match => console.log(`   - ${match}`))
      
      console.log(`\n   Try accessing the download directly:`)
      // Try the pattern: if html link is /webp-to-gif/FILE.webp.html, 
      // the direct file might be /media/FILE.webp or similar
      const pageMatch = html2.match(/ezgif-[a-f0-9]+\.webp/)
      if (pageMatch) {
        console.log(`   Found filename: ${pageMatch[0]}`)
        webpLink = `/media/${pageMatch[0]}`
      }
      return
    }

    // STEP 5: Download WebP
    console.log(`\n[STEP 5] Download WebP file...`)
    const webpUrl = new URL(webpLink, res2.url).toString()
    console.log(`   Full URL: ${webpUrl}`)
    
    const webpRes = await fetch(webpUrl)
    console.log(`   Status: ${webpRes.status}`)
    
    const webpBuffer = Buffer.from(await webpRes.arrayBuffer())
    console.log(`   Downloaded: ${webpBuffer.length} bytes`)
    
    // Check if it's actually WebP or HTML
    const isHTML = webpBuffer.toString("utf8", 0, 50).includes("<html") || webpBuffer.toString("utf8", 0, 50).includes("<!DOCTYPE")
    const isWebP = webpBuffer[0] === 82 && webpBuffer[1] === 73 && webpBuffer[2] === 70 && webpBuffer[3] === 70 // RIFF header
    
    console.log(`   File type: ${isHTML ? "HTML (ERROR!)" : isWebP ? "WebP ✓" : "Unknown"}`)
    
    if (isWebP) {
      // Save WebP
      const webpPath = path.join(testDir, "test_output.webp")
      fs.writeFileSync(webpPath, webpBuffer)
      console.log(`   ✓ Saved: test_output.webp`)
      console.log(`\n✅ SUCCESS! WebP conversion works!`)
    } else if (isHTML) {
      console.log(`   ❌ Downloaded HTML instead of WebP!`)
      // Save the HTML to inspect
      fs.writeFileSync(path.join(testDir, "webp_page.html"), webpBuffer)
      console.log(`   Saved HTML to webp_page.html for inspection`)
    } else {
      console.log(`   ❌ Unknown file type`)
    }

  } catch (error) {
    console.error("\n❌ Error:", error.message)
    console.error(error.stack)
  }
}

debugEzgif()
