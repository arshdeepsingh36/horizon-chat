const { execSync } = require('child_process');
const path = require('path');
const ADB = 'F:\\vibe code\\chat\\platform-tools\\adb.exe';
const DEV = 'RZCY31F2XPA';

function adb(cmd) {
  return execSync(`"${ADB}" -s ${DEV} ${cmd}`, { encoding: 'utf8' });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function test() {
  console.log('1. Tapping bob (x=500, y=380)...');
  adb('shell input tap 500 380');
  await sleep(2000);
  
  adb('shell screencap -p /sdcard/p2b_step1_chat.png');
  adb('pull /sdcard/p2b_step1_chat.png "F:\\vibe code\\chat\\artifacts\\phase2b_verification\\01_chat_view.png"');
  console.log('Saved 01_chat_view.png');

  console.log('2. Tapping header (x=400, y=130) to open UserProfileActivity...');
  adb('shell input tap 400 130');
  await sleep(2000);
  
  adb('shell screencap -p /sdcard/p2b_step2_profile.png');
  adb('pull /sdcard/p2b_step2_profile.png "F:\\vibe code\\chat\\artifacts\\phase2b_verification\\02_user_profile.png"');
  console.log('Saved 02_user_profile.png');

  console.log('3. Tapping Docs tab in profile (x=540, y=1050)...');
  adb('shell input tap 540 1050');
  await sleep(1000);
  adb('shell screencap -p /sdcard/p2b_step3_docs.png');
  adb('pull /sdcard/p2b_step3_docs.png "F:\\vibe code\\chat\\artifacts\\phase2b_verification\\03_profile_docs.png"');
  console.log('Saved 03_profile_docs.png');

  console.log('4. Going back to chat (x=80, y=130)...');
  adb('shell input tap 80 130');
  await sleep(1000);

  console.log('5. Tapping Attachment icon in chat (x=70, y=2280)...');
  adb('shell input tap 70 2280');
  await sleep(1500);
  adb('shell screencap -p /sdcard/p2b_step4_attachment.png');
  adb('pull /sdcard/p2b_step4_attachment.png "F:\\vibe code\\chat\\artifacts\\phase2b_verification\\04_attachment_sheet.png"');
  console.log('Saved 04_attachment_sheet.png');

  console.log('6. Dismissing sheet...');
  adb('shell input tap 540 500');
  await sleep(800);

  console.log('7. Tapping Camera icon (x=160, y=2280)...');
  adb('shell input tap 160 2280');
  await sleep(1500);
  adb('shell screencap -p /sdcard/p2b_step5_camera.png');
  adb('pull /sdcard/p2b_step5_camera.png "F:\\vibe code\\chat\\artifacts\\phase2b_verification\\05_camera_picker.png"');
  console.log('Saved 05_camera_picker.png');

  console.log('✅ All test captures completed!');
}

test().catch(console.error);
