const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ADB = path.resolve(__dirname, '../platform-tools/adb.exe');
const DEVICE_ID = 'RZCY31F2XPA';
const PKG = 'com.chatapp.horizon';
const ARTIFACTS_DIR = path.resolve(__dirname, '../artifacts');

function adb(cmd) {
  return execSync(`"${ADB}" -s ${DEVICE_ID} ${cmd}`, { encoding: 'utf-8' });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('--- Waking device and starting AuthActivity ---');
  adb('shell input keyevent 224');
  adb('shell wm dismiss-keyguard');
  adb(`shell am force-stop ${PKG}`);
  await sleep(1000);
  adb(`shell am start -n ${PKG}/com.chatapp.horizon.ui.AuthActivity`);
  await sleep(2000);

  console.log('--- Typing credentials ---');
  // Clear app state and launch fresh
  adb('shell pm clear ' + PKG);
  await sleep(1000);
  adb(`shell am start -n ${PKG}/com.chatapp.horizon.ui.AuthActivity`);
  await sleep(2000);

  // Focus Username field
  adb('shell input tap 540 1300');
  await sleep(600);
  adb('shell input text arsh');
  await sleep(600);

  // Send TAB (keycode 61) to switch focus to Password field
  adb('shell input keyevent 61');
  await sleep(600);
  adb('shell input text secret123');
  await sleep(600);

  // Send ENTER (keycode 66) or TAB to move to Sign In and press
  adb('shell input keyevent 61');
  await sleep(400);
  adb('shell input keyevent 66');
  await sleep(3500);

  // Take Chat List Screenshot
  adb('shell screencap -p /sdcard/live_chat_list.png');
  adb(`pull /sdcard/live_chat_list.png "${path.join(ARTIFACTS_DIR, 'live_chat_list.png')}"`);

  // Open First Chat Thread
  console.log('--- Opening conversation thread ---');
  adb('shell input tap 540 613');
  await sleep(2000);

  // Take Chat Screen Screenshot
  adb('shell screencap -p /sdcard/live_chat_screen.png');
  adb(`pull /sdcard/live_chat_screen.png "${path.join(ARTIFACTS_DIR, 'live_chat_screen.png')}"`);

  // Open Attachment Bottom Sheet
  console.log('--- Opening Attachment Picker ---');
  adb('shell input tap 80 2220');
  await sleep(1500);

  adb('shell screencap -p /sdcard/live_attachment_sheet.png');
  adb(`pull /sdcard/live_attachment_sheet.png "${path.join(ARTIFACTS_DIR, 'live_attachment_sheet.png')}"`);

  console.log('✅ Live screenshots captured successfully!');
}

run().catch(e => {
  console.error('Test error:', e.message);
  process.exit(1);
});
