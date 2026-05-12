// Minimal service worker for FurnCRM chat notifications.
// Required on Android Chrome: new Notification() from a page context is
// silently ignored when the app is backgrounded. Notifications must go
// through ServiceWorkerRegistration.showNotification() instead.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Open / focus the app when the user taps a notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/chat';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        // If the app is already open in a tab, focus it and navigate
        for (const client of list) {
          if ('focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
