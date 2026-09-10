import { execSync } from 'child_process';
import fs from 'fs';

const adb = 'C:\\Users\\Admin\\Desktop\\techhy\\platform-tools\\adb.exe';
const buf = execSync(`"${adb}" exec-out run-as com.chatapp.horizon cat cache/voice_cache/voice_52.m4a`, {
  maxBuffer: 10 * 1024 * 1024
});

fs.writeFileSync('voice_52_dump.m4a', buf);
console.log('Saved size:', buf.length);
console.log('First 20 bytes (hex):', buf.subarray(0, 20).toString('hex'));
console.log('First 20 bytes (ascii):', buf.subarray(0, 20).toString('ascii'));
