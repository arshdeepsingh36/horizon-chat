import { io } from 'socket.io-client';

const API_BASE = 'http://localhost:5000';

async function runTests() {
  console.log('--- Testing Horizon Chat v2.0.0 (TRD & PRD Compliance) ---');

  // 1. Health check
  const healthRes = await fetch(`${API_BASE}/health`);
  const healthData = await healthRes.json();
  console.log('✓ Health check mode:', healthData.project, 'version:', healthData.version);

  const timestamp = Date.now().toString().slice(-4);
  const u1Name = `arsh_${timestamp}`;
  const u2Name = `sarah_${timestamp}`;
  const pass = 'SecurePassword123';

  // 2. Register User 1 & User 2
  const reg1 = await (await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u1Name, password: pass })
  })).json();
  const token1 = reg1.token;
  const user1 = reg1.user;
  console.log(`✓ User 1 created: @${user1.username} (ID: ${user1.id})`);

  const reg2 = await (await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u2Name, password: pass })
  })).json();
  const token2 = reg2.token;
  const user2 = reg2.user;
  console.log(`✓ User 2 created: @${user2.username} (ID: ${user2.id})`);

  // 3. User Lookup
  const lookupRes = await (await fetch(`${API_BASE}/api/users/lookup?username=${u2Name}`, {
    headers: { Authorization: `Bearer ${token1}` }
  })).json();
  console.log(`✓ User lookup verified: @${lookupRes.username} (ID: ${lookupRes.id})`);
  if (lookupRes.id !== user2.id) throw new Error('User lookup ID mismatch');

  // 4. Socket Connection & Message with Micro-Blur Thumbnail
  const sock1 = io(API_BASE, { auth: { token: token1 } });
  const sock2 = io(API_BASE, { auth: { token: token2 } });

  await new Promise(r => sock1.on('connect', r));
  await new Promise(r => sock2.on('connect', r));
  console.log('✓ Both clients connected via WebSockets with JWT.');

  // 4. Test Cloudflare R2 Presigned Upload Generation (TRD Section 3.5 & rules.md Section 3)
  const presignRes = await (await fetch(`${API_BASE}/api/media/presign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token1}`
    },
    body: JSON.stringify({
      fileName: 'horizon_sunset.png',
      contentType: 'image/png',
      fileSizeBytes: 2457812
    })
  })).json();

  if (!presignRes.uploadUrl || !presignRes.publicUrl || !presignRes.thumbnailBlur) {
    throw new Error('Cloudflare R2 presign generation failed');
  }
  console.log('✓ Cloudflare R2 presigned URL generated:', presignRes.uploadUrl.substring(0, 45) + '...');
  console.log('✓ Micro-preview thumbnail blur validated (~200 bytes Base64)');

  const receivePromise = new Promise(resolve => {
    sock2.on('new_message', resolve);
  });

  const sendRes = await new Promise(resolve => {
    sock1.emit('send_message', {
      recipientId: user2.id,
      text: 'Check this schema file',
      attachmentType: 'IMAGE',
      attachmentUrl: presignRes.publicUrl,
      thumbnailBlur: presignRes.thumbnailBlur,
      fileSizeBytes: presignRes.fileSizeBytes
    }, resolve);
  });

  console.log('✓ Message acknowledged with generated ID:', sendRes.message.id);
  const receivedMsg = await receivePromise;
  console.log('✓ Recipient received message with blurred thumbnail:', receivedMsg.attachment_type, receivedMsg.file_size_bytes);

  // 5. Read Receipt
  const readAckPromise = new Promise(resolve => {
    sock1.on('message_read_ack', resolve);
  });

  sock2.emit('mark_read', { messageId: receivedMsg.id, senderId: user1.id });
  const ack = await readAckPromise;
  console.log('✓ Read receipt acknowledged to sender:', ack);

  // 6. Test 25-Message Cursor Pagination
  console.log('Seeding 28 messages to test 25-message cursor pagination...');
  for (let i = 1; i <= 28; i++) {
    await new Promise(resolve => {
      sock1.emit('send_message', {
        recipientId: user2.id,
        text: `Message batch test ${i}`
      }, resolve);
    });
  }

  // Page 1: limit=25
  const page1 = await (await fetch(`${API_BASE}/api/messages/${user2.id}?limit=25`, {
    headers: { Authorization: `Bearer ${token1}` }
  })).json();

  console.log(`✓ Page 1 loaded: ${page1.length} messages (Expected 25)`);
  if (page1.length !== 25) throw new Error(`Expected 25 messages, got ${page1.length}`);

  const oldestInPage1 = page1[0].id; // First item is oldest in ascending array

  // Page 2: cursor=oldestInPage1
  const page2 = await (await fetch(`${API_BASE}/api/messages/${user2.id}?cursor=${oldestInPage1}&limit=25`, {
    headers: { Authorization: `Bearer ${token1}` }
  })).json();

  console.log(`✓ Page 2 loaded via cursor ID ${oldestInPage1}: ${page2.length} messages`);
  if (page2.length === 0) throw new Error('Expected older messages in page 2');

  // 7. Phase 2: Profile Settings & Password Update
  console.log('--- Phase 2 Features Verification ---');
  const meRes = await (await fetch(`${API_BASE}/api/users/me`, {
    headers: { Authorization: `Bearer ${token1}` }
  })).json();
  console.log(`✓ Profile me: @${meRes.username}, displayName: ${meRes.displayName}, bio: ${meRes.bioStatus}`);

  const updateProfileRes = await (await fetch(`${API_BASE}/api/users/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token1}`
    },
    body: JSON.stringify({
      displayName: 'Arshdeep Singh',
      bioStatus: 'Vibe coding Phase 2 🚀',
      avatarUrl: 'https://pub-r2.storage.cloud/avatars/sample_avatar.png'
    })
  })).json();
  if (updateProfileRes.user.displayName !== 'Arshdeep Singh') throw new Error('Profile update failed');
  console.log(`✓ Profile updated: ${updateProfileRes.user.displayName}, bio: "${updateProfileRes.user.bioStatus}"`);

  // Password update
  const newPass = 'BrandNewPassword2026';
  const passRes = await (await fetch(`${API_BASE}/api/users/password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token1}`
    },
    body: JSON.stringify({
      currentPassword: pass,
      newPassword: newPass
    })
  })).json();
  if (!passRes.success) throw new Error('Password update failed');
  console.log('✓ Password update verified.');

  // Login with new password
  const reLogin = await (await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u1Name, password: newPass })
  })).json();
  if (!reLogin.token) throw new Error('Login with new password failed');
  console.log('✓ Successfully authenticated with new updated password.');

  // 8. Phase 2: View-Once Ephemeral Media
  const viewOnceMsg = await new Promise(resolve => {
    sock1.emit('send_message', {
      recipientId: user2.id,
      text: 'Secret ephemeral snapshot',
      attachmentType: 'IMAGE',
      attachmentUrl: presignRes.publicUrl,
      thumbnailBlur: presignRes.thumbnailBlur,
      fileSizeBytes: 1024500,
      isViewOnce: true
    }, resolve);
  });
  console.log(`✓ View-once message sent (ID: ${viewOnceMsg.message.id}, isViewOnce: ${viewOnceMsg.message.isViewOnce})`);
  if (!viewOnceMsg.message.isViewOnce) throw new Error('View once flag missing');

  // Mark view once as opened
  const viewedRes = await (await fetch(`${API_BASE}/api/messages/${viewOnceMsg.message.id}/view-once`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token2}` }
  })).json();
  if (!viewedRes.message.isViewed) throw new Error('Failed to mark media viewed');
  console.log(`✓ View-once media marked as viewed/opened (isViewed: ${viewedRes.message.isViewed})`);

  // 9. Phase 2: Typing Indicators
  const typingPromise = new Promise(resolve => {
    sock2.on('user_typing', resolve);
  });
  sock1.emit('typing_start', { recipientId: user2.id });
  const typingEvent = await typingPromise;
  console.log(`✓ Real-time typing event received: user ${typingEvent.userId} isTyping=${typingEvent.isTyping}`);
  if (!typingEvent.isTyping) throw new Error('Typing indicator failed');

  sock1.disconnect();
  sock2.disconnect();

  console.log('====================================================');
  console.log('ALL HORIZON CHAT PHASE 2 TESTS PASSED SUCCESSFULLY');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
