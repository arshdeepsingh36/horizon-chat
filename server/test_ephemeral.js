import { io } from 'socket.io-client';

const API_BASE = 'http://localhost:5000';

async function runTests() {
  console.log('--- Starting Backend Verification ---');

  // 1. Health check
  console.log('1. Testing /health...');
  const healthRes = await fetch(`${API_BASE}/health`);
  const healthData = await healthRes.json();
  if (healthData.status !== 'healthy') {
    throw new Error(`Health check failed: ${JSON.stringify(healthData)}`);
  }
  console.log('✓ Health check OK:', healthData);

  // 2. Register users
  console.log('2. Testing user registration...');
  const timestamp = Date.now();
  const aliceUsername = `alice_${timestamp.toString().slice(-4)}`;
  const bobUsername = `bob_${timestamp.toString().slice(-4)}`;
  const password = 'Password123!';

  const regAlice = await fetch(`${API_BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: aliceUsername, password })
  });
  const regAliceData = await regAlice.json();
  if (!regAlice.ok) throw new Error(`Alice register failed: ${JSON.stringify(regAliceData)}`);
  console.log('✓ Alice registered:', regAliceData.user);

  const regBob = await fetch(`${API_BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: bobUsername, password })
  });
  const regBobData = await regBob.json();
  if (!regBob.ok) throw new Error(`Bob register failed: ${JSON.stringify(regBobData)}`);
  console.log('✓ Bob registered:', regBobData.user);

  // 3. Login
  console.log('3. Testing user login...');
  const loginAlice = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: aliceUsername, password })
  });
  const loginAliceData = await loginAlice.json();
  if (!loginAlice.ok || !loginAliceData.token) throw new Error('Alice login failed');
  const aliceToken = loginAliceData.token;
  console.log('✓ Alice login successful, JWT obtained.');

  const loginBob = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: bobUsername, password })
  });
  const loginBobData = await loginBob.json();
  if (!loginBob.ok || !loginBobData.token) throw new Error('Bob login failed');
  const bobToken = loginBobData.token;
  console.log('✓ Bob login successful, JWT obtained.');

  // 4. Connect WebSockets
  console.log('4. Testing WebSocket JWT Handshakes...');
  const aliceSocket = io(API_BASE, { auth: { token: aliceToken } });
  const bobSocket = io(API_BASE, { auth: { token: bobToken } });

  await new Promise((resolve) => {
    let connected = 0;
    const check = () => {
      connected++;
      if (connected === 2) resolve();
    };
    aliceSocket.on('connect', () => {
      console.log('✓ Alice connected via WebSocket');
      check();
    });
    bobSocket.on('connect', () => {
      console.log('✓ Bob connected via WebSocket');
      check();
    });
  });

  // 5. Check Bob status from Alice
  console.log('5. Querying presence status...');
  const bobStatus = await new Promise((resolve) => {
    aliceSocket.emit('user_status', { targetUsername: bobUsername }, (resp) => {
      resolve(resp);
    });
  });
  console.log('✓ Bob status response:', bobStatus);
  if (!bobStatus.online) throw new Error('Expected Bob to be online');

  // 6. Direct Message Alice -> Bob
  console.log('6. Sending ephemeral message from Alice to Bob...');
  const messageText = 'Hello Bob, this message will only live in RAM!';

  const receivedPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), 5000);
    bobSocket.on('message_received', (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });

  aliceSocket.emit('direct_message', { to: bobUsername, text: messageText });
  const receivedMsg = await receivedPromise;
  console.log('✓ Bob received ephemeral message:', receivedMsg);
  if (receivedMsg.text !== messageText || receivedMsg.from !== aliceUsername) {
    throw new Error('Message content or sender mismatch');
  }

  // 7. Disconnect Bob, send message from Alice, verify drop
  console.log('7. Testing offline message drop (Zero persistence)...');
  bobSocket.disconnect();
  await new Promise(r => setTimeout(r, 500));

  const droppedPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message_dropped')), 5000);
    aliceSocket.on('message_dropped', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  aliceSocket.emit('direct_message', { to: bobUsername, text: 'Are you still there?' });
  const droppedData = await droppedPromise;
  console.log('✓ Offline packet correctly dropped:', droppedData);

  aliceSocket.disconnect();
  console.log('==============================================');
  console.log('ALL BACKEND & SOCKET TESTS PASSED SUCCESSFULLY');
  console.log('==============================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
