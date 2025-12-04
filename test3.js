import fs from 'fs/promises';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

// Convert WebP to MP4 using ezgif.com
async function webpToMp4(buffer, filename = 'sticker.webp') {
  try {
    console.log('Uploading WebP to ezgif.com...');
    
    const form = new FormData();
    form.append('new-image-url', '');
    form.append('new-image', buffer, filename);

    // Step 1: Upload the webp file
    const uploadRes = await fetch('https://ezgif.com/webp-to-mp4', {
      method: 'POST',
      body: form,
    });
    
    const uploadHtml = await uploadRes.text();
    const { document: uploadDoc } = new JSDOM(uploadHtml).window;

    // Step 2: Extract form data for conversion
    const form2 = new FormData();
    const formInputs = uploadDoc.querySelectorAll('form input[name]');
    
    if (formInputs.length === 0) {
      await fs.writeFile('./debug-upload.html', uploadHtml);
      throw new Error('Failed to upload file to ezgif - no form found');
    }

    let fileParam = null;
    for (const input of formInputs) {
      form2.append(input.name, input.value);
      if (input.name === 'file') {
        fileParam = input.value;
      }
    }

    if (!fileParam) {
      throw new Error('Failed to get file parameter from ezgif');
    }

    console.log(`File uploaded: ${fileParam}`);
    console.log('Converting to MP4 on ezgif.com...');

    // Step 3: Perform the conversion
    const convertRes = await fetch(`https://ezgif.com/webp-to-mp4/${fileParam}`, {
      method: 'POST',
      body: form2,
    });
    
    const convertHtml = await convertRes.text();
    const { document: convertDoc } = new JSDOM(convertHtml).window;

    // Step 4: Get the converted video URL
    let videoElement = convertDoc.querySelector('div#output > p.outfile > video > source');
    
    if (!videoElement) {
      // Try alternative selector
      videoElement = convertDoc.querySelector('video source[src*="/ezgif-"]');
    }
    
    if (!videoElement) {
      await fs.writeFile('./debug-convert.html', convertHtml);
      throw new Error('Failed to get converted video from ezgif. Check debug-convert.html');
    }

    const videoUrl = new URL(videoElement.src, convertRes.url).toString();
    console.log(`Download URL: ${videoUrl}`);
    console.log('Downloading converted video...');

    // Step 5: Download the MP4 file
    const videoResponse = await fetch(videoUrl);
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

    return videoBuffer;
  } catch (error) {
    console.error('ezgif conversion error:', error.message);
    throw error;
  }
}

// Main function
async function main() {
  try {
    console.log('Reading sticker.webp...');
    const webpBuffer = await fs.readFile('./sticker.webp');
    console.log(`Loaded: ${(webpBuffer.length / 1024).toFixed(2)} KB\n`);
    
    console.log('Converting WebP to MP4 using ezgif.com...');
    const mp4Buffer = await webpToMp4(webpBuffer, 'sticker.webp');
    
    await fs.writeFile('./sticker-output.mp4', mp4Buffer);
    console.log(`\n✅ Conversion complete!`);
    console.log(`Output: sticker-output.mp4 (${(mp4Buffer.length / 1024).toFixed(2)} KB)`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

main();