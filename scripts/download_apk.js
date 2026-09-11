const https = require('https');
const fs = require('fs');
const path = require('path');

const dest = path.resolve(__dirname, '../apk/app-debug.apk');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function downloadBinary(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBinary(res.headers.location, destPath).then(resolve).catch(reject);
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching temp_url.txt from apk-dist...');
  try {
    const tempUrl = await fetch('https://raw.githubusercontent.com/arshdeepsingh36/horizon-chat/apk-dist/temp_url.txt');
    console.log('tempUrl content:', tempUrl);
    if (tempUrl && tempUrl.startsWith('http')) {
      console.log('Downloading directly from mirror:', tempUrl.trim());
      await downloadBinary(tempUrl.trim(), dest);
      const st = fs.statSync(dest);
      console.log('✅ Downloaded fresh APK:', st.size, 'bytes (', (st.size / 1024 / 1024).toFixed(2), 'MB )');
      return;
    }
  } catch (e) {
    console.log('Mirror download note:', e.message);
  }

  console.log('Falling back to raw base64 decoding...');
  const b64 = await fetch('https://raw.githubusercontent.com/arshdeepsingh36/horizon-chat/apk-dist/app-debug.b64');
  const buf = Buffer.from(b64.trim(), 'base64');
  fs.writeFileSync(dest, buf);
  console.log('✅ Decoded fresh APK:', buf.length, 'bytes');
}

main().catch(console.error);
