/**
 * The one root-scope service worker (public/sw.js) is shared by the local
 * showNotification() calls and OneSignal web push.
 *
 * OneSignal registers it as /sw.js?appId=…&sdkVersion=… and, on every init,
 * reinstalls it when those query params differ from what is active.
 * Re-registering the bare "/sw.js" on each app open therefore swapped the
 * worker out from under OneSignal every time; init then waited on a worker
 * that kept being replaced and never resolved ("Notification service startup
 * timed out"). So register only when nothing controls "/" yet, and otherwise
 * leave whatever is installed — OneSignal's copy included — alone.
 */
export async function ensureAppWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}
