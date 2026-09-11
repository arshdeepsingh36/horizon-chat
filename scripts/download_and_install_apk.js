const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APK_URL = 'https://github.com/arshdeepsingh36/horizon-chat/releases/download/v2.0-latest/app-debug.apk';
const LOCAL_DIR = path.resolve(__dirname, '../apk');
const LOCAL_PATH = path.resolve(LOCAL_DIR, 'app-debug.apk');
const ADB_PATH = path.resolve(__dirname, '../platform-tools/adb.exe');
const DEVICE_ID = 'RZCY31F2XPA';

if (!fs.existsSync(LOCAL_DIR)) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download: Status Code ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  console.log('Fetching latest release asset information...');
  try {
    console.log(`Downloading latest APK from ${APK_URL}...`);
    await downloadFile(APK_URL, LOCAL_PATH);
    const stats = fs.statSync(LOCAL_PATH);
    console.log(`Downloaded ${stats.size} bytes successfully to ${LOCAL_PATH}`);
    
    console.log(`Installing APK to device ${DEVICE_ID}...`);
    const installOutput = execSync(`"${ADB_PATH}" -s ${DEVICE_ID} install -r -d "${LOCAL_PATH}"`, { encoding: 'utf-8' });
    console.log('Install Output:', installOutput.trim());
    console.log('✅ Updated APK installed successfully!');
  } catch (err) {
    console.error('Error during download/install:', err.message);
    process.exit(1);
  }
}

main();
