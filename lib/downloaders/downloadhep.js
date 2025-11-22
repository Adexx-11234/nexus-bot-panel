import { request } from 'undici';
import fs from 'fs';
import { pipeline } from 'stream/promises';

const [,, youtubeUrl, format] = process.argv;

async function downloadYouTube() {
  try {
    console.log('Getting download links...');
    
    const apiUrl = `https://backend1.tioo.eu.org/api/downloader/youtube?url=${encodeURIComponent(youtubeUrl)}`;
    
    const { body: apiBody } = await request(apiUrl);
    const chunks = [];
    for await (const chunk of apiBody) {
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    
    console.log('Title:', data.title);
    console.log('Author:', data.author);
    
    const downloadUrl = format === 'mp3' ? data.mp3 : data.mp4;
    const outputFile = format === 'mp3' ? 'song.mp3' : 'video.mp4';
    
    console.log(`\nDownloading ${format.toUpperCase()}...`);
    
    // First request - will get 302 redirect
    let response = await request(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // If it's a redirect, follow it
    let redirectCount = 0;
    while (response.statusCode === 302 && redirectCount < 5) {
      const location = response.headers.location;
      console.log(`Following redirect ${redirectCount + 1}...`);
      
      // Consume the body before making new request
      for await (const chunk of response.body) {}
      
      response = await request(location, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      redirectCount++;
    }

    console.log('Final Status:', response.statusCode);
    console.log('Content-Type:', response.headers['content-type']);
    console.log('Content-Length:', response.headers['content-length']);

    if (response.statusCode === 200) {
      await pipeline(response.body, fs.createWriteStream(outputFile));
      const stats = fs.statSync(outputFile);
      console.log(`✓ Download complete: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      
      // Output for parent process
      console.log('OUTPUT_FILE:' + outputFile);
      console.log('TITLE:' + data.title);
      console.log('SIZE:' + stats.size);
    } else {
      console.error('Download failed with status:', response.statusCode);
      process.exit(1);
    }
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

downloadYouTube();