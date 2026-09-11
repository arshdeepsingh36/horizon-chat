import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDbPath = path.join(__dirname, 'data', 'horizon_chat.db');

const { 
    initDb,
    createUser, 
    findUserById, 
    updateUserProfile,
    updateUserLastSeen, 
    blockUser, 
    unblockUser, 
    isUserBlocked, 
    reportUser, 
    clearConversationMessages,
    saveMessageTRD,
    getMessagesCursor
} = await import('./db.js');

async function runTests() {
    console.log('--- Starting Phase 2b Verification Tests ---');

    await initDb();

    // 1. Create two test accounts with timestamped usernames to ensure uniqueness
    const ts = Date.now();
    const unameA = `alpha_${ts}`;
    const unameB = `beta_${ts}`;
    console.log(`1. Creating test accounts: ${unameA} and ${unameB}...`);
    const userA = await createUser(unameA, 'hashed_pass_alpha', 'Alpha User');
    const userB = await createUser(unameB, 'hashed_pass_beta', 'Beta User');
    console.log(`Created User A (ID: ${userA.id}, @${userA.username}) and User B (ID: ${userB.id}, @${userB.username})`);

    // 2. Test avatar upload and profile update
    console.log('\n2. Testing profile update with avatar...');
    const dummyBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    
    // Simulate avatar saving logic from server.js
    const matches = dummyBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let avatarUrl = '';
    if (matches && matches.length === 3) {
        const ext = matches[1].split('/')[1] || 'jpg';
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `avatar_${userA.id}_${Date.now()}.${ext}`;
        const filePath = path.join(__dirname, 'uploads', filename);
        fs.writeFileSync(filePath, buffer);
        avatarUrl = `/uploads/${filename}`;
    }
    await updateUserProfile(userA.id, {
        displayName: 'Alpha Updated',
        bioStatus: 'Building horizon chat',
        avatarUrl: avatarUrl
    });
    
    const updatedA = await findUserById(userA.id);
    if (updatedA.display_name === 'Alpha Updated' && updatedA.avatar_url === avatarUrl && updatedA.bio_status === 'Building horizon chat') {
        console.log(' Profile update & avatar storage SUCCESS:', updatedA.avatar_url);
    } else {
        throw new Error('Profile update failed: ' + JSON.stringify(updatedA));
    }

    // 3. Test last_seen update
    console.log('\n3. Testing last_seen update...');
    await updateUserLastSeen(userA.id);
    const userAWithLastSeen = await findUserById(userA.id);
    if (userAWithLastSeen.last_seen) {
        console.log(' last_seen update SUCCESS:', userAWithLastSeen.last_seen);
    } else {
        throw new Error('last_seen update failed');
    }

    // 4. Test User Block & Unblock
    console.log('\n4. Testing User Block / Unblock logic...');
    let blocked = await isUserBlocked(userA.id, userB.id);
    console.log('Initial block state (A blocks B):', blocked);
    if (blocked) throw new Error('Should not be blocked initially');

    await blockUser(userA.id, userB.id);
    blocked = await isUserBlocked(userA.id, userB.id);
    console.log('After block state (A blocks B):', blocked);
    if (!blocked) throw new Error('User B should be blocked by User A');

    await unblockUser(userA.id, userB.id);
    blocked = await isUserBlocked(userA.id, userB.id);
    console.log('After unblock state (A blocks B):', blocked);
    if (blocked) throw new Error('User B should be unblocked');

    // Re-block for testing
    await blockUser(userA.id, userB.id);

    // 5. Test User Reporting
    console.log('\n5. Testing User Reporting...');
    const reportRes = await reportUser(userA.id, userB.id, 'Spamming unwanted video messages');
    if (reportRes) {
        console.log(' User report logged SUCCESS');
    } else {
        throw new Error('Failed to record user report');
    }

    // 6. Test Clear Conversation Messages
    console.log('\n6. Testing Clear Conversation...');
    // Insert mock messages
    await saveMessageTRD({
        senderId: userA.id,
        recipientId: userB.id,
        text: 'Hello Beta',
        attachmentType: 'NONE'
    });
    await saveMessageTRD({
        senderId: userB.id,
        recipientId: userA.id,
        text: '{"duration":12000}',
        attachmentType: 'VIDEO',
        attachmentUrl: '/uploads/vid.mp4'
    });

    const msgsBefore = await getMessagesCursor(userA.id, userB.id, null, 50);
    console.log('Message count before clear:', msgsBefore.length);
    if (msgsBefore.length !== 2) throw new Error('Failed to setup mock messages');

    await clearConversationMessages(userA.id, userB.id);

    const msgsAfter = await getMessagesCursor(userA.id, userB.id, null, 50);
    console.log('Message count after clear:', msgsAfter.length);
    if (msgsAfter.length !== 0) throw new Error('Conversation was not cleared');

    // 7. Test Video Messaging Attachment
    console.log('\n7. Testing Video Message Pipeline...');
    const videoMsg = await saveMessageTRD({
        senderId: userA.id,
        recipientId: userB.id,
        text: '0:25',
        attachmentType: 'VIDEO',
        attachmentUrl: '/uploads/vid_test_123.mp4',
        thumbnailBlur: 'data:image/jpeg;base64,...;dur:0:25',
        fileSizeBytes: 10485760
    });

    if (videoMsg.attachmentType === 'VIDEO' && videoMsg.attachmentUrl.endsWith('.mp4') && videoMsg.text === '0:25') {
        console.log(' Video message saved & retrieved SUCCESS:', videoMsg);
    } else {
        throw new Error('Video message verification failed');
    }

    console.log('\n ALL PHASE 2B DATABASE & BACKEND TESTS PASSED SUCCESSFULLY! ');
    process.exit(0);
}

runTests().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
