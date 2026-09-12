const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APK_URL = 'https://github.com/arshdeepsingh36/horizon-chat/releases/download/v2.0-latest/app-debug.apk';
const ADB_PATH = path.resolve(__dirname, '../platform-tools/adb.exe');
const DEVICE_ID = 'RZCY31F2XPA';
const LOCAL_DIR = path.resolve(__dirname, '../apk');
const LOCAL_APK = path.resolve(LOCAL_DIR, 'app-debug.apk');

if (!fs.existsSync(LOCAL_DIR)) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

function downloadBinary(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`Redirecting (${res.statusCode}) -> ${res.headers.location.substring(0, 60)}...`);
        return downloadBinary(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('Download failed with status: ' + res.statusCode));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

async function main() {
  console.log('--- Downloading Latest Release APK ---');
  console.log('URL:', APK_URL);
  await downloadBinary(APK_URL, LOCAL_APK);

  const stats = fs.statSync(LOCAL_APK);
  console.log(`✅ Downloaded ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB) to ${LOCAL_APK}`);

  console.log(`--- Installing on Android Device (${DEVICE_ID}) ---`);
  try {
    console.log('Uninstalling previous build to guarantee clean state...');
    execSync(`"${ADB_PATH}" -s ${DEVICE_ID} uninstall com.chatapp.horizon`, { encoding: 'utf-8' });
  } catch (e) {
    console.log('Note: App not previously installed or uninstalled.');
  }

  console.log('Streaming fresh install to device...');
  const installResult = execSync(`"${ADB_PATH}" -s ${DEVICE_ID} install -r -g "${LOCAL_APK}"`, { encoding: 'utf-8' });
  console.log('Install Result:', installResult.trim());

  console.log('🚀 Successfully installed latest build on device!');
}

main().catch(err => {
  console.error('Deployment error:', err.message);
  process.exit(1);
});
