import { supabase } from "@/integrations/supabase/client";

/**
 * Staff web push for the OmniFlow app.
 *
 * The in-app notifiers (ChatNotifier, LeadNotifier, OrderNotifier) only fire
 * while a tab is open and subscribed to realtime. Registering the device with
 * OneSignal lets the send-staff-push edge function reach it when the app is
 * closed, which is what the database triggers on notifications/chat_messages
 * depend on.
 *
 * OneSignal app for the OmniFlow staff app. Separate from the Insider app
 * because OneSignal binds one site origin per web-push app, and Insider's is
 * https://homedecorinsider.lovable.app — staff push cannot be delivered from
 * OmniFlow's domain on that app ID. VITE_ONESIGNAL_STAFF_APP_ID overrides it
 * for a different deployment; the app ID is public and ships in the bundle,
 * so hardcoding the default is safe (the REST API key is not, and lives only
 * in the ONESIGNAL_STAFF_API_KEY edge-function secret).
 */
export const ONESIGNAL_APP_ID =
  import.meta.env.VITE_ONESIGNAL_STAFF_APP_ID ??
  "4e6e57c1-7555-4f05-81e2-efdb9d6e19d4";

let initPromise: Promise<unknown> | null = null;
// Set once OneSignal reports an active subscription for this device.
let subscribed = false;

async function getOneSignal() {
  if (typeof window === "undefined") return null;
  const { default: OneSignal } = await import("react-onesignal");
  if (!initPromise) {
    initPromise = OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      allowLocalhostAsSecureOrigin: true,
      // Reuse the app's own root worker — see public/sw.js. Registering a
      // second worker at '/' would evict the local-notification handler.
      serviceWorkerPath: "sw.js",
    }).catch(() => {
      initPromise = null;
    });
  }
  await initPromise;
  return OneSignal;
}

/** Load the SDK early so the browser doesn't swallow the subscription state. */
export async function initPush(): Promise<void> {
  try {
    await getOneSignal();
  } catch {
    // non-critical
  }
}

/** What the browser currently allows, without prompting. */
export function permissionState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * True when this device already receives OmniFlow pushes through OneSignal.
 *
 * The in-app notifiers use it to skip their own showNotification() call — the
 * server-side push covers the notification shade, and firing both would put
 * the same alert on screen twice.
 */
export function pushDeliversSystemNotifications(): boolean {
  if (permissionState() !== "granted") return false;
  return subscribed;
}

/**
 * Ask for notification permission, opt the device in, and store the OneSignal
 * subscription against the signed-in staff user.
 *
 * Safe to call on every app open: OneSignal no-ops when the device is already
 * subscribed, and the registration RPC just refreshes last_seen_at.
 *
 * Returns true when a subscription ID was stored.
 */
export async function registerStaffPush(
  userId: string,
  role?: string | null,
): Promise<boolean> {
  if (typeof window === "undefined" || !userId) return false;
  try {
    const OneSignal = await getOneSignal();
    if (!OneSignal) return false;

    await OneSignal.Notifications.requestPermission();
    if (!OneSignal.Notifications.permission) return false;

    await OneSignal.User.PushSubscription.optIn();

    // The subscription ID can arrive a moment after opt-in.
    let subscriptionId = OneSignal.User.PushSubscription.id;
    for (let i = 0; i < 10 && !subscriptionId; i++) {
      await new Promise((r) => setTimeout(r, 500));
      subscriptionId = OneSignal.User.PushSubscription.id;
    }
    if (!subscriptionId) return false;

    // Goes through the RPC rather than a direct upsert: on a shared browser
    // the subscription ID outlives the sign-in, and only a SECURITY DEFINER
    // can hand the existing row to whoever is signed in now. Without that,
    // the second person's alerts would keep going to the first.
    const { error } = await supabase.rpc("register_staff_push_device" as never, {
      _player_id: subscriptionId,
      _role: role ?? null,
      _user_agent: navigator.userAgent.slice(0, 300),
    } as never);
    if (error) return false;

    subscribed = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn staff push on or off for this device.
 *
 * Disabling only flips push_enabled on the device row — the OneSignal
 * subscription is left intact so re-enabling doesn't need a fresh browser
 * permission prompt (which the browser will not show twice).
 */
export async function setStaffPushEnabled(
  userId: string,
  enabled: boolean,
  role?: string | null,
): Promise<boolean> {
  if (enabled) {
    const ok = await registerStaffPush(userId, role);
    if (ok) return true;
  }

  try {
    const OneSignal = await getOneSignal();
    const subscriptionId = OneSignal?.User.PushSubscription.id;
    if (!subscriptionId) return false;

    const { error } = await supabase
      .from("staff_push_devices" as never)
      .update({ push_enabled: enabled } as never)
      .eq("onesignal_player_id", subscriptionId);
    if (!error) subscribed = enabled;
    return !error;
  } catch {
    return false;
  }
}
