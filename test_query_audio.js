import { initDb, getMessagesCursor, findUserByUsername } from './server/db.js';

async function main() {
  await initDb();
  const alice = await findUserByUsername('alice');
  const bob = await findUserByUsername('bob');
  console.log('Alice:', alice ? { id: alice.id, username: alice.username } : null);
  console.log('Bob:', bob ? { id: bob.id, username: bob.username } : null);

  if (alice && bob) {
    const msgs = await getMessagesCursor(alice.id, bob.id, 20);
    console.log('Total messages:', msgs.length);
    for (const m of msgs) {
      if (m.attachment_type === 'AUDIO') {
        console.log(`Audio Msg ID=${m.id}, sender=${m.sender_id}, text=${m.message_text}, url=${m.attachment_url?.slice(0, 100)}`);
      }
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
