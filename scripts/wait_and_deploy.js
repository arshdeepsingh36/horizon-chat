const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = 'arshdeepsingh36/horizon-chat';
const ADB_PATH = path.resolve(__dirname, '../platform-tools/adb.exe');
const DEVICE_ID = 'RZCY31F2XPA';
const LOCAL_DIR = path.resolve(__dirname, '../apk');
const LOCAL_APK = path.resolve(LOCAL_DIR, 'app-debug.apk');

if (!fs.existsSync(LOCAL_DIR)) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

function fetchString(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node-deploy-script' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchString(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('Fetch failed with status: ' + res.statusCode));
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function downloadBinary(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node-deploy-script' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForAndDownloadApk() {
  const releaseUrl = `https://github.com/${REPO}/releases/download/v2.0-latest/app-debug.apk`;
  console.log(`--- Waiting for fresh APK build on GitHub Releases ---`);

  let attempts = 0;
  while (attempts < 120) {
    attempts++;
    console.log(`[${new Date().toLocaleTimeString()}] Attempt ${attempts}: Checking for updated APK...`);

    try {
      const tempApk = path.resolve(LOCAL_DIR, 'temp.apk');
      await downloadBinary(releaseUrl, tempApk);
      const stats = fs.statSync(tempApk);
      if (stats.size > 5 * 1024 * 1024) {
        fs.copyFileSync(tempApk, LOCAL_APK);
        fs.unlinkSync(tempApk);
        console.log(`✅ Downloaded release APK: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        return true;
      }
    } catch (e) {
      // In-flight
    }

    // 3. Try release asset
    try {
      const tempApk = path.resolve(LOCAL_DIR, 'temp.apk');
      await downloadBinary(releaseUrl, tempApk);
      const stats = fs.statSync(tempApk);
      if (stats.size > 5 * 1024 * 1024) {
        fs.copyFileSync(tempApk, LOCAL_APK);
        fs.unlinkSync(tempApk);
        console.log(`✅ Downloaded release APK: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        return true;
      }
    } catch (e) {
      // In-flight
    }

    await sleep(8000);
  }
  throw new Error('Timed out waiting for APK');
}

async function installOnDevice() {
  console.log(`--- Installing on Android Device (${DEVICE_ID}) ---`);
  try {
    console.log('Uninstalling previous app version for a clean install...');
    execSync(`"${ADB_PATH}" -s ${DEVICE_ID} uninstall com.chatapp.horizon`, { stdio: 'inherit' });
  } catch (e) {
    console.log('Uninstall note (app not previously installed):', e.message);
  }

  console.log('Installing new APK...');
  const res = execSync(`"${ADB_PATH}" -s ${DEVICE_ID} install -r -g "${LOCAL_APK}"`, { encoding: 'utf-8' });
  console.log('ADB Install Result:\n', res);

  console.log('🚀 Horizon Chat APK with horizon icon.ico Installed Fresh on Device!');
}

async function run() {
  await waitForAndDownloadApk();
  await installOnDevice();
}

run().catch(err => {
  console.error('Execution error:', err.message);
  process.exit(1);
});
