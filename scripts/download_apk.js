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
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const releaseUrl = 'https://github.com/arshdeepsingh36/horizon-chat/releases/download/v2.0-latest/app-debug.apk';
  console.log('Fetching latest APK from GitHub Releases:', releaseUrl);
  try {
    await downloadBinary(releaseUrl, dest);
    const st = fs.statSync(dest);
    console.log('✅ Downloaded latest APK successfully:', st.size, 'bytes (', (st.size / 1024 / 1024).toFixed(2), 'MB )');
  } catch (e) {
    console.error('Download failed:', e.message);
  }
}

main().catch(console.error);
