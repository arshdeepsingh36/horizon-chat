const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB_PATH = 'F:\\vibe code\\chat\\platform-tools\\adb.exe';
const DEVICE_ID = 'RZCY31F2XPA';
const B64_FILE = 'F:\\vibe code\\chat\\dist_apk\\app-debug.b64';
const APK_FILE = 'F:\\vibe code\\chat\\apk\\app-debug.apk';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('--- Polling Git for compiled APK from GitHub Actions ---');
  let initialMtime = fs.existsSync(B64_FILE) ? fs.statSync(B64_FILE).mtimeMs : 0;

  for (let i = 1; i <= 25; i++) {
    console.log(`[${new Date().toLocaleTimeString()}] Poll attempt ${i}: pulling latest git changes...`);
    try {
      execSync('git pull --rebase origin main', { cwd: 'F:\\vibe code\\chat', stdio: 'pipe' });
    } catch (e) {
      // ignore transient git lock
    }

    if (fs.existsSync(B64_FILE)) {
      const currentMtime = fs.statSync(B64_FILE).mtimeMs;
      const b64Data = fs.readFileSync(B64_FILE, 'utf8').trim();
      if (b64Data.length > 100000 && currentMtime !== initialMtime) {
        console.log(`✅ Found new compiled base64 APK (${b64Data.length} chars) in git!`);
        const buf = Buffer.from(b64Data, 'base64');
        fs.writeFileSync(APK_FILE, buf);
        console.log(`Saved decoded APK to ${APK_FILE} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);

        console.log('--- Installing on device via ADB ---');
        try {
          execSync(`"${ADB_PATH}" -s ${DEVICE_ID} uninstall com.chatapp.horizon`, { stdio: 'pipe' });
        } catch (e) {}

        const installRes = execSync(`"${ADB_PATH}" -s ${DEVICE_ID} install -r -g "${APK_FILE}"`, { encoding: 'utf8' });
        console.log('Install Result:', installRes.trim());
        console.log('🚀 Successfully deployed updated APK with horizon icon.ico to device!');
        return;
      }
    }
    await sleep(8000);
  }
  console.log('Timed out waiting for git artifact.');
}

main().catch(console.error);
