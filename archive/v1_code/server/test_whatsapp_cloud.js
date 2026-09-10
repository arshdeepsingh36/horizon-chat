import { io } from 'socket.io-client';

const API_BASE = 'http://localhost:5000';

async function runTests() {
  console.log('--- Testing WhatsApp Cloud Persistence (Telegram-Style) ---');

  // 1. Health check
  const healthRes = await fetch(`${API_BASE}/health`);
  const healthData = await healthRes.json();
  console.log('✓ Health check mode:', healthData.mode);

  const timestamp = Date.now().toString().slice(-4);
  const u1 = `alex_${timestamp}`;
  const u2 = `sam_${timestamp}`;
  const pass = 'Password123!';

  // 2. Register users
  const reg1 = await (await fetch(`${API_BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u1, password: pass })
  })).json();
  const token1 = reg1.token;
  console.log(`✓ User 1 created: @${u1}`);

  const reg2 = await (await fetch(`${API_BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u2, password: pass })
  })).json();
  const token2 = reg2.token;
  console.log(`✓ User 2 created: @${u2}`);

  // 3. Connect User 1 socket (User 2 stays offline initially)
  const sock1 = io(API_BASE, { auth: { token: token1 } });
  await new Promise(r => sock1.on('connect', r));
  console.log(`✓ @${u1} connected via socket.`);

  // 4. Send message while User 2 is offline
  console.log(`Sending message from @${u1} to offline @${u2}...`);
  const sendRes = await new Promise(resolve => {
    sock1.emit('send_message', {
      to: u2,
      text: 'Hello Sam! Even though you are offline, Telegram-style cloud storage will keep this safe.'
    }, resolve);
  });
  console.log('✓ Message persisted to DB while recipient offline:', sendRes.message.status);

  // 5. User 2 connects later and queries cloud history
  const sock2 = io(API_BASE, { auth: { token: token2 } });
  await new Promise(r => sock2.on('connect', r));
  console.log(`✓ @${u2} logged in and connected later.`);

  const historyRes = await fetch(`${API_BASE}/api/messages/${u1}`, {
    headers: { 'Authorization': `Bearer ${token2}` }
  });
  const historyData = await historyRes.json();
  console.log(`✓ @${u2} retrieved cloud message history. Count: ${historyData.messages.length}`);
  if (historyData.messages.length !== 1) {
    throw new Error('Cloud history count mismatch');
  }

  // 6. Test message reaction
  const msgId = historyData.messages[0].id;
  await new Promise(resolve => {
    sock2.emit('add_reaction', { messageId: msgId, emoji: '❤️', partnerUsername: u1 });
    setTimeout(resolve, 500);
  });

  // 7. Verify reaction persisted in cloud DB
  const historyAfterReaction = await (await fetch(`${API_BASE}/api/messages/${u2}`, {
    headers: { 'Authorization': `Bearer ${token1}` }
  })).json();
  console.log('✓ Cloud reaction confirmed:', historyAfterReaction.messages[0].reactions);
  if (!historyAfterReaction.messages[0].reactions['❤️']) {
    throw new Error('Emoji reaction was not persisted in database');
  }

  // 8. Test Chats List
  const chatsRes = await (await fetch(`${API_BASE}/api/chats`, {
    headers: { 'Authorization': `Bearer ${token1}` }
  })).json();
  console.log('✓ User 1 WhatsApp chats list loaded:', chatsRes.map(c => ({ partner: c.partnerUsername, last: c.lastMessage.text })));

  sock1.disconnect();
  sock2.disconnect();

  console.log('====================================================');
  console.log('ALL WHATSAPP CLOUD PERSISTENCE TESTS PASSED (100%)');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
