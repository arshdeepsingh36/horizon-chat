const { io } = require('f:/vibe code/chat/server/node_modules/socket.io-client');
const http = require('https');
const { execSync } = require('child_process');

const BASE_URL = 'https://horizon-chat-1.onrender.com';
const ADB = 'C:\\Users\\Admin\\Desktop\\techhy\\platform-tools\\adb.exe';
const ARTIFACTS = 'C:\\Users\\Admin\\.gemini\\antigravity-ide\\brain\\500cb899-23f9-4bc5-b9cd-4c3085172cc6';

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const loginRes = await postJson(`${BASE_URL}/api/auth/login`, { username: 'sarah', password: 'secret123' });
  const token = loginRes.token;

  const socket = io(BASE_URL, {
    auth: { token },
    transports: ['websocket']
  });

  socket.on('connect', () => {
    console.log('Sarah socket connected! Emitting typing_start for Arsh (recipientId: 5)...');
    socket.emit('typing_start', { recipientId: 5 });

    setTimeout(() => {
      console.log('Capturing typing indicator...');
      try {
        execSync(`& '${ADB}' shell screencap -p /sdcard/s_typing_active.png`, { shell: 'powershell.exe' });
        execSync(`& '${ADB}' pull /sdcard/s_typing_active.png '${ARTIFACTS}\\s_typing_active.png'`, { shell: 'powershell.exe' });
        console.log('Pulled s_typing_active.png!');
      } catch (e) {
        console.error('Screencap error:', e.message);
      }

      setTimeout(() => {
        socket.emit('typing_stop', { recipientId: 5 });
        setTimeout(() => {
          socket.disconnect();
          process.exit(0);
        }, 500);
      }, 1500);

    }, 1500);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
