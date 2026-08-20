// Service worker for OmniFlow notifications.
//
// Two jobs share this one root-scope worker:
//
//  1. OneSignal web push — imported below so pushes sent from the OmniFlow
//     dashboard (chat, lead assignments, order updates) are delivered even
//     when the app is closed. OneSignal must own the 'push' event, so its
//     SDK worker is imported first and left to handle those.
//
//  2. Local showNotification() calls from the in-app notifiers, which cover
//     the case where the app IS open and we want an instant shade entry
//     without a server round-trip. Required on Android Chrome: new
//     Notification() from a page context is silently ignored when the app is
//     backgrounded.
//
// Registering a second worker at '/' would evict this one, so OneSignal is
// pointed at this file via serviceWorkerPath in src/lib/push.ts.
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Open / focus the app when the user taps one of OUR local notifications.
// OneSignal ships its own notificationclick handler for pushes it delivered;
// the __omniflow marker keeps the two from both acting on the same tap.
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  if (!data.__omniflow) return;

  event.notification.close();
  const targetUrl = data.url || '/chat';

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
