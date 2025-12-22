# 🎨 Convert Menu Plugin Documentation

Media format conversion with quality preservation and optimization.

---

## 📋 Conversion Types

| Conversion | Command | Input | Output | Use Case |
|-----------|---------|-------|--------|----------|
| Image → Sticker | `sticker` | JPG, PNG, WEBP | WEBP | Create stickers |
| Image → Image | `toimage` | Any | PNG/JPG | Format change |
| Video → Audio | `toaudio` | MP4, MKV | MP3 | Extract audio |
| Video → MP3 | `tomp3` | Any video | MP3 | Music from video |
| Audio → Voice | `tovn` | MP3, OGG | OGG | WhatsApp voice note |
| Video → GIF | `togif` | MP4, WebM | GIF | Animated sticker |
| Video → Video | `tovideo` | Any | MP4 | Standardize format |
| Image → URL | `tourl` | Any | URL | Share online |
| Image → Meme | `smeme` | Image | Image | Add text to image |
| Sticker → Animated | `take` | Static WEBP | Animated WEBP | Animate sticker |
| Audio → MP3 | `toaudio` | OGG, WAV | MP3 | Convert audio |

---

## 🎯 How Conversion Works

### **Processing Steps**

\`\`\`
User sends media/URL
    ↓
Receive & validate input
    ↓
Check file size & format
    ↓
Load conversion settings
    ↓
Process conversion (FFmpeg/Sharp/Jimp)
    ↓
Apply optimizations
    ↓
Validate output
    ↓
Send to user
    ↓
Clean up temp files
\`\`\`

---

## 💬 Command Usage

### **Sticker Conversion**
\`\`\`
.sticker (reply to image)          # Convert to sticker
.sticker (reply to video)          # Extract first frame as sticker
.take (reply to sticker)           # Add border/effects
\`\`\`

**Response:**
\`\`\`
✅ Sticker created
Size: 512x512px | Type: Static
📤 Sending sticker...
\`\`\`

### **Image Conversion**
\`\`\`
.toimage (reply to sticker)        # Sticker → Image
.toimage (reply to webp)           # WebP → PNG
\`\`\`

### **Audio Conversion**
\`\`\`
.tomp3 (reply to video)            # Extract audio as MP3
.toaudio (reply to mp3)            # Convert audio format
.tovn (reply to mp3)               # Create voice note
\`\`\`

### **Video Conversion**
\`\`\`
.togif (reply to video)            # Create animated GIF
.tovideo (reply to audio)          # Not practical
\`\`\`

### **Image Effects**
\`\`\`
.smeme (reply to image) Text       # Add meme text
.tourl (reply to image)            # Upload and get URL
\`\`\`

---

## ⚙️ Quality Settings

**Sticker Conversion:**
\`\`\`javascript
{
  width: 512,
  height: 512,
  format: "webp",
  quality: 95,
  animated: false
}
\`\`\`

**Image Compression:**
\`\`\`javascript
{
  quality: 80,          // 1-100
  format: "png",
  maxWidth: 2048,
  maxHeight: 2048
}
\`\`\`

**Audio Conversion:**
\`\`\`javascript
{
  bitrate: "320k",      // 128k, 192k, 256k, 320k
  sampleRate: 44100,    // Hz
  channels: 2,          // Stereo
  format: "mp3"
}
\`\`\`

**Video Conversion:**
\`\`\`javascript
{
  fps: 30,              // Frames per second
  quality: "high",      // low, medium, high
  maxResolution: "720p",
  bitrate: "2500k",
  format: "mp4"
}
\`\`\`

---

## 📊 File Size Limits

| Format | Max Size | Typical |
|--------|----------|---------|
| Image | 10MB | 2-5MB |
| Sticker | 500KB | 100-300KB |
| Audio | 20MB | 5-15MB |
| Video | 100MB | 30-50MB |
| GIF | 5MB | 1-3MB |

---

## 🔄 Conversion Pipeline

\`\`\`
Input Media
    ↓
FFmpeg Analysis
    ↓
Format Detection
    ↓
Quality Assessment
    ↓
Apply Filters (if needed)
    ↓
Start Conversion
    ↓
Monitor Progress
    ↓
Validate Output
    ↓
Size Optimization
    ↓
Send Response
\`\`\`

---

## 💾 Temporary Files

\`\`\`
/lib/temp/
├── telesticker_[timestamp]_[id].webp
├── converted_[timestamp]_[id].mp3
├── meme_[timestamp]_[id].jpg
└── [Auto-cleanup after 1 hour]
\`\`\`

**Auto-Cleanup:**
- Run every 60 minutes
- Delete files older than 1 hour
- Log cleanup results

---

## ⚠️ Limitations

- Sticker: 512x512px only
- Audio: Max 20MB
- Video: Max 100MB
- GIF: Max 15 seconds
- Simultaneous: 5 conversions max
- Timeout: 60 seconds per conversion

---
