// Horizon Chat Service Worker - Web Push Notifications & Background Sync
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    payload = {
      title: 'Horizon Chat',
      body: event.data.text()
    };
  }

  const title = payload.title || 'Horizon Chat';
  const options = {
    body: payload.body || 'You received a new message',
    icon: '/horizon icon.ico',
    badge: '/horizon icon.ico',
    tag: 'horizon-chat-notification',
    renotify: true,
    data: payload.data || {}
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If client tab is already open, focus it
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
