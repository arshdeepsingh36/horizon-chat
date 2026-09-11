const { execSync } = require('child_process');
const path = require('path');

const ADB = path.resolve(__dirname, '../platform-tools/adb.exe');
const DEV = 'RZCY31F2XPA';

function run(cmd) {
  return execSync(`"${ADB}" -s ${DEV} ${cmd}`, { encoding: 'utf-8' });
}

console.log('1. Launching UserProfileActivity directly...');
run('shell am start -n com.chatapp.horizon/.ui.UserProfileActivity --es recipient_id user123 --es username "Sarah Jenkins" --es recipient_name "Sarah Jenkins" --es recipient_status "Hey there! Using Horizon." --ez is_online true');
run('shell sleep 2');
run('shell screencap -p /sdcard/verified_user_profile.png');
run('pull /sdcard/verified_user_profile.png artifacts/phase2b_verification/verified_user_profile.png');

console.log('2. Launching ChatActivity directly...');
run('shell am start -n com.chatapp.horizon/.ui.ChatActivity --es recipient_id user123 --es username "Sarah Jenkins" --es recipient_name "Sarah Jenkins"');
run('shell sleep 2');
run('shell screencap -p /sdcard/verified_chat.png');
run('pull /sdcard/verified_chat.png artifacts/phase2b_verification/verified_chat.png');

console.log('Done!');
