// Horizon Chat Service Worker
// Push notifications disabled and cleaned up per specification
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister().catch(() => {})
  );
});
