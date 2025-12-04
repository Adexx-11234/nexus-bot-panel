# 📥 Download Menu Plugin Documentation

Supports downloading media from 15+ platforms with automatic format handling.

---

## 📺 Supported Platforms

| Platform | Command | Format | Quality |
|----------|---------|--------|---------|
| YouTube | `ytdl` | MP4, MP3 | 720p, 1080p |
| Instagram | `igdl` | MP4, JPG | HD, SD |
| TikTok | `tiktokdl` | MP4 | HD, SD |
| Facebook | `fbdl` | MP4 | 720p, 480p |
| Twitter | `twitterdl` | MP4, GIF | HD, SD |
| Spotify | `spotifydl` | MP3 | 192kbps, 320kbps |
| SoundCloud | `soundcloud` | MP3 | 128kbps, 256kbps |
| Pinterest | `pinterest` | JPG, PNG | High, Medium |
| Google Drive | `gdrive` | Any | Original |
| MediaFire | `mediafire` | Any | Original |
| Apple Music | `applemusicdl` | M4A | 256kbps |
| CapCut | `capcutdl` | MP4 | HD, SD |
| YouTube Search | `ytsearch` | MP4 | Multiple results |
| Music Play | `play` | MP3 | Stream/Download |
| Generic Download | `download` | Any | Auto-detect |

---

## 🔧 How Downloads Work

### **Processing Pipeline**

\`\`\`
User sends URL
    ↓
Validate URL format
    ↓
Identify platform
    ↓
Extract metadata (title, duration, quality)
    ↓
Get available formats
    ↓
Select best format (user preference or auto)
    ↓
Download stream
    ↓
Convert if needed (e.g., MP4 → MP3)
    ↓
Compress if too large
    ↓
Send to user with metadata
\`\`\`

### **Quality Selection**

\`\`\`javascript
// YouTube: 720p / 360p / 240p fallback
// Video: Highest available ≤ 720p
// Audio: 320kbps preferred

// Selection logic
const preferredQuality = userSettings.quality || "best"
const maxSize = 100 * 1024 * 1024  // 100MB limit

// If file too large, downgrade quality
if (fileSize > maxSize) {
  quality = nextLowerQuality(quality)
}
\`\`\`

---

## 💬 Command Usage

### **YouTube**
\`\`\`
.ytdl https://youtube.com/watch?v=xxx
.ytdl https://youtu.be/xxx quality:720p
.ytsearch taylor swift all too well
\`\`\`

**Response:**
\`\`\`
✅ Downloaded: "All Too Well (10 Min Version)"
Duration: 10:13 | Size: 45MB | Quality: 720p
📤 Sending video...
\`\`\`

### **Instagram**
\`\`\`
.igdl https://instagram.com/p/xxx
.igdl https://instagram.com/reel/xxx
\`\`\`

**Response:**
\`\`\`
✅ Instagram Media Downloaded
Type: Reel | Duration: 15s | Size: 8MB
📤 Sending...
\`\`\`

### **TikTok**
\`\`\`
.tiktokdl https://tiktok.com/@user/video/xxx
.tiktok https://vt.tiktok.com/xxx
\`\`\`

### **Spotify Music**
\`\`\`
.spotifydl https://spotify.com/track/xxx
.spotifydl https://open.spotify.com/track/xxx
\`\`\`

**Response:**
\`\`\`
✅ Track: "Blinding Lights" - The Weeknd
Duration: 3:20 | Bitrate: 320kbps | Size: 8MB
📤 Sending audio...
\`\`\`

### **SoundCloud**
\`\`\`
.soundcloud https://soundcloud.com/user/track
.play artist - song name
\`\`\`

### **Multi-Download**
\`\`\`
.download https://example.com/video.mp4
.mediafire https://mediafire.com/file/xxx
.gdrive https://drive.google.com/file/d/xxx
\`\`\`

---

## ⚙️ Configuration

**Download Settings:**
\`\`\`javascript
{
  maxFileSize: 100 * 1024 * 1024,    // 100MB
  supportedFormats: ['mp4', 'mp3', 'jpg', 'png', 'webm'],
  qualityPreference: 'high',
  enableConversion: true,
  enableCompression: true,
  retryAttempts: 3,
  timeout: 120000,                   // 2 minutes
  cacheDownloads: true,
  cacheDuration: 3600000            // 1 hour
}
\`\`\`

---

## 🔄 Error Handling

| Error | Solution |
|-------|----------|
| **URL Invalid** | Verify correct platform link |
| **Video Expired** | Creator removed or private |
| **Too Large** | Video exceeds 100MB limit |
| **Download Failed** | Retry or use alternative |
| **Format Unavailable** | Request different quality |
| **Timeout** | Server too slow, retry |

---

## 📊 Download Metadata

**Collected Information:**
\`\`\`javascript
{
  platform: "youtube",
  url: "https://youtube.com/watch?v=xxx",
  title: "Video Title",
  duration: 600,              // seconds
  uploader: "Channel Name",
  uploadDate: "2024-01-15",
  thumbnail: "image_url",
  fileSize: 45000000,         // bytes
  format: "mp4",
  quality: "720p",
  fps: 30,
  codec: "h264",
  bitrate: 2500,              // kbps
  extractedAt: 1701624000000
}
\`\`\`

---

## 🚀 Performance

- **Parallel Downloads** - Process multiple requests simultaneously
- **Streaming** - Don't wait for full file before sending
- **Caching** - Save downloaded files for 1 hour
- **Compression** - Reduce file size when necessary
- **Queue Management** - Process large downloads in background

---
