import { supabase } from "@/integrations/supabase/client";
import { ensureAppWorker } from "@/lib/appWorker";
import { deleteOneSignalDatabase, ensureOneSignalStorage } from "@/lib/oneSignalStorage";

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

type PushWindow = Window & {
  __omniflowOneSignalInit?: Promise<void>;
  /** Set by the OneSignal CDN bundle once it has actually executed. */
  OneSignal?: unknown;
};

type OneSignalClient = Awaited<ReturnType<typeof getOneSignal>>;

const STEP_TIMEOUT_MS = 12_000;
// init() downloads the CDN bundle, fetches the app config and completes the
// service-worker handshake. On a sales phone on mobile data that regularly
// runs past 12s, so it gets its own, longer budget.
const INIT_TIMEOUT_MS = 30_000;
const SUBSCRIPTION_TIMEOUT_MS = 20_000;
const SUBSCRIPTION_POLL_MS = 400;
// Backstop only — every step above has its own, more specific timeout.
const REGISTRATION_TIMEOUT_MS = 90_000;

// Set once OneSignal reports an active subscription for this device.
let subscribed = false;
let lastRegistrationError: string | null = null;
let registrationPromise: Promise<boolean> | null = null;

/** Opt in from the browser console on a real phone: localStorage.omniflow_push_debug = "1" */
function debugEnabled(): boolean {
  try {
    return localStorage.getItem("omniflow_push_debug") === "1";
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: PromiseLike<T>, label: string, timeoutMs = STEP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** react-onesignal rejects with bare strings as well as Errors. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return error ? String(error) : "unknown error";
}

// A TypeError on a minified property ("Cannot read properties of undefined
// (reading 'Qe')") is thrown inside OneSignal's own CDN bundle, never by this
// file or by react-onesignal — the wrapper reads everything through optional
// chaining. It means SDK internals were dereferenced before init finished
// building them, so say something the person holding the phone can act on.
const SDK_INTERNAL_CRASH = /cannot read propert(?:y|ies) of (?:undefined|null)/i;

// --- Diagnostics -----------------------------------------------------------
// The SDK's minified crash says nothing about its cause, and staff phones have
// no dev tools. Record which setup step was running and what OneSignal itself
// logged (it always prints its errors, even with logging off), so the message
// on screen carries the real reason.
let currentStep = "starting";
const sdkLog: string[] = [];
const SDK_LOG_LIMIT = 4;
let capturingSdkLog = false;

function stringifyLogArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

if (typeof window !== "undefined" && typeof console !== "undefined") {
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (capturingSdkLog) {
        const line = args.map(stringifyLogArg).join(" ").replace(/\s+/g, " ").slice(0, 200);
        if (line && !line.startsWith("Staff push registration failed")) {
          sdkLog.push(line);
          if (sdkLog.length > SDK_LOG_LIMIT) sdkLog.shift();
        }
      }
      original(...args);
    };
  }
}

function beginDiagnostics() {
  currentStep = "starting";
  sdkLog.length = 0;
  capturingSdkLog = true;
}

function endDiagnostics() {
  capturingSdkLog = false;
}

/** Where the minified crash came from — the file name carries the SDK build. */
function crashLocation(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;
  const frame = error.stack.split("\n").find((line) => /https?:\/\//.test(line));
  const match = frame?.match(/https?:\/\/[^\s)]+/);
  return match ? match[0].replace(/^https?:\/\//, "").slice(0, 120) : null;
}

function describeSdkState(): string {
  const sdk = (window as PushWindow).OneSignal as
    | { config?: { appId?: string } | null; User?: { PushSubscription?: { id?: string | null } } }
    | undefined;
  if (!sdk) return "SDK not loaded";
  const configured = sdk.config?.appId ? "config loaded" : "config missing";
  const subscriptionId = sdk.User?.PushSubscription?.id ? "has subscription" : "no subscription";
  return `${configured}, ${subscriptionId}`;
}

function diagnostics(error: unknown): string {
  const parts = [`step: ${currentStep}`, describeSdkState()];
  const where = crashLocation(error);
  if (where) parts.push(`at ${where}`);
  const logged = sdkLog.length ? ` | OneSignal said: ${sdkLog.join(" / ")}` : "";
  return ` [Details — ${parts.join("; ")}${logged}]`;
}

function explainError(detail: string): string {
  if (!SDK_INTERNAL_CRASH.test(detail)) return detail;
  return (
    `${detail} — the notification service did not finish loading. ` +
    "Close OmniFlow completely, reopen it and tap again. If it keeps happening, check that " +
    `the Site URL of OneSignal app ${ONESIGNAL_APP_ID} is exactly ${window.location.origin}, ` +
    "and that no content blocker, VPN or Wi-Fi filter is blocking cdn.onesignal.com."
  );
}

// Once per tab session: after the SDK has crashed on its own internals, wipe
// its database and reload so the next init starts from a clean slate. init()
// cannot be re-run on the same page, so a reload is the only way to retry.
const SDK_REPAIR_FLAG = "omniflow_onesignal_repaired";

function repairAfterSdkCrash(error: unknown): boolean {
  if (!SDK_INTERNAL_CRASH.test(describeError(error))) return false;
  try {
    if (sessionStorage.getItem(SDK_REPAIR_FLAG)) return false;
    sessionStorage.setItem(SDK_REPAIR_FLAG, "1");
  } catch {
    return false;
  }
  console.warn("OneSignal crashed during setup; resetting its storage and reloading.");
  void deleteOneSignalDatabase().finally(() => window.location.reload());
  return true;
}

function registrationFailed(context: string, error?: unknown): false {
  const detail = describeError(error);
  const message =
    `${context}: ${explainError(detail)}` +
    (SDK_INTERNAL_CRASH.test(detail) || /timed out/i.test(detail) ? diagnostics(error) : "");
  // Keep the FIRST failure of an attempt. The outer wrappers only know that
  // they were interrupted; the innermost one knows why, and overwriting it
  // was what reduced every failure to a generic "did not complete".
  if (lastRegistrationError === null) lastRegistrationError = message;
  console.error("Staff push registration failed:", message, error);
  return false;
}

// OneSignal keeps a single global instance per page. The mount-time restore
// and the "Connect this phone" tap used to reach login()/optIn() concurrently,
// so every SDK-touching operation is queued through here instead.
let sdkQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = sdkQueue.then(task, task);
  sdkQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// OneSignal binds each web-push app to ONE site URL. When the page runs on any
// other origin, the v16 SDK logs "can only be used on …", lets init() resolve
// anyway, and the next API call (login) dereferences internals it never built
// — the opaque "Cannot read properties of undefined (reading 'Qe')". Reading
// the same public app config the SDK reads lets us say which URL is wrong.
const APP_CONFIG_URL = `https://api.onesignal.com/sync/${ONESIGNAL_APP_ID}/web`;
const APP_CONFIG_TIMEOUT_MS = 6_000;

type OneSignalAppConfig = {
  success?: boolean;
  features?: { restrict_origin?: { enable?: boolean } };
  config?: { origin?: string; siteInfo?: { origin?: string } };
};

function siteKey(origin: string): string | null {
  try {
    return new URL(origin).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

let siteCheck: Promise<string | null> | null = null;

/** Resolves to a problem description, or null when the config looks right or can't be read. */
function checkOneSignalSite(): Promise<string | null> {
  siteCheck ??= (async () => {
    try {
      const response = await withTimeout(
        fetch(APP_CONFIG_URL, { cache: "no-store" }),
        "OneSignal app config",
        APP_CONFIG_TIMEOUT_MS,
      );
      if (!response.ok) return null;
      const appConfig = (await response.json()) as OneSignalAppConfig;
      if (appConfig.success === false || !appConfig.config) {
        return (
          `OneSignal app ${ONESIGNAL_APP_ID} has no Web push platform set up. ` +
          "In OneSignal open that app → Settings → Push & In-App → Web, choose Typical Site and enter this site's URL: " +
          window.location.origin
        );
      }
      if (appConfig.features?.restrict_origin?.enable === false) return null;
      const configured = appConfig.config.origin ?? appConfig.config.siteInfo?.origin;
      if (!configured) return null;
      if (siteKey(configured) === siteKey(window.location.origin)) return null;
      return (
        `OneSignal app ${ONESIGNAL_APP_ID} is set up for ${configured}, but OmniFlow is running on ` +
        `${window.location.origin}. In OneSignal open that app → Settings → Push & In-App → Web and change ` +
        `the Site URL to ${window.location.origin}, save, then reopen OmniFlow.`
      );
    } catch {
      // Unreachable or not CORS-readable: let the SDK try and report its own error.
      return null;
    }
  })();
  return siteCheck;
}

async function getOneSignal() {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;
  if (!("PushManager" in window)) return null;

  currentStep = "service worker";
  await withTimeout(ensureAppWorker(), "Notification worker startup");
  currentStep = "site URL check";
  const siteProblem = await checkOneSignalSite();
  if (siteProblem) throw new Error(siteProblem);

  const { default: OneSignal } = await import("react-onesignal");
  const pushWindow = window as PushWindow;

  let init = pushWindow.__omniflowOneSignalInit;
  if (!init) {
    currentStep = "storage check";
    const storageProblem = await ensureOneSignalStorage();
    if (storageProblem) throw new Error(storageProblem);
    if (debugEnabled()) OneSignal.Debug.setLogLevel("trace");
    init = OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      allowLocalhostAsSecureOrigin: true,
      // Reuse the app's own root worker — see public/sw.js. Registering a
      // second worker at '/' would evict the local-notification handler.
      // serviceWorkerParam must match the scope we register it under, and
      // serviceWorkerOverrideForTypical is what makes OneSignal honour a
      // custom worker path at all when the app is set up as a typical site.
      serviceWorkerPath: "/sw.js",
      serviceWorkerParam: { scope: "/" },
      serviceWorkerOverrideForTypical: true,
    }).catch((error: unknown) => {
      const detail = describeError(error);
      // The provider survives a page hot refresh even though this module's
      // local state does not. Its API is ready in that case, so continue.
      if (/already initialized/i.test(detail)) return;
      // Only a genuinely *rejected* init is worth retrying from scratch, so
      // this is the one place that drops the cached promise.
      delete pushWindow.__omniflowOneSignalInit;
      throw error;
    });
    pushWindow.__omniflowOneSignalInit = init;
  }

  // Deliberately does not clear __omniflowOneSignalInit when this times out:
  // the init is still in flight. Dropping the promise made the next tap call
  // OneSignal.init() a second time, and the SDK then rebuilt its internals
  // from under the first call — which surfaced as a TypeError on a minified
  // property instead of a real error, with the device never subscribed.
  currentStep = "OneSignal init";
  await withTimeout(init, "Notification service startup", INIT_TIMEOUT_MS);

  if (typeof pushWindow.OneSignal === "undefined") {
    throw new Error(
      "The notification service (cdn.onesignal.com) could not be reached — a content blocker, VPN or Wi-Fi filter is the usual cause.",
    );
  }

  return OneSignal;
}

function waitForSubscriptionId(OneSignal: Exclude<OneSignalClient, null>): Promise<string> {
  const subscription = OneSignal.User.PushSubscription;
  const currentId = (): string | null =>
    subscription.id && subscription.optedIn ? subscription.id : null;

  const existingId = currentId();
  if (existingId) return Promise.resolve(existingId);

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    function cleanup() {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      subscription.removeEventListener("change", onChange);
    }

    function finish(id: string) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(id);
    }

    const onChange = (event: { current: { id?: string | null; optedIn?: boolean } }) => {
      if (!event.current.id || !event.current.optedIn) return;
      finish(event.current.id);
    };

    // react-onesignal queues addEventListener through OneSignalDeferred, so
    // the 'change' being waited on can fire before the listener is attached.
    // Polling the subscription closes that gap.
    const poll = window.setInterval(() => {
      const id = currentId();
      if (id) finish(id);
    }, SUBSCRIPTION_POLL_MS);

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("No device subscription was created. Close and reopen OmniFlow, then try once more."));
    }, SUBSCRIPTION_TIMEOUT_MS);

    subscription.addEventListener("change", onChange);
  });
}

async function saveSubscription(
  subscriptionId: string,
  role?: string | null,
): Promise<boolean> {
  const { error } = await withTimeout(
    supabase.rpc("register_staff_push_device" as never, {
      _player_id: subscriptionId,
      _role: role ?? null,
      _user_agent: navigator.userAgent.slice(0, 300),
    } as never),
    "Saving this phone",
  );
  if (error) return registrationFailed("The device subscription could not be saved", error);

  subscribed = true;
  lastRegistrationError = null;
  return true;
}

/** Load the SDK early so the browser doesn't swallow the subscription state. */
export async function initPush(): Promise<void> {
  try {
    await serialize(() => getOneSignal());
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

/** Last setup failure, used to distinguish permission from registration. */
export function staffPushRegistrationError(): string | null {
  return lastRegistrationError;
}

/** Restore an existing subscription without opening a browser permission prompt. */
export async function restoreStaffPush(
  userId: string,
  role?: string | null,
): Promise<boolean> {
  if (typeof window === "undefined" || !userId || permissionState() !== "granted") return false;
  lastRegistrationError = null;
  return serialize(async () => {
    try {
      beginDiagnostics();
      const OneSignal = await getOneSignal();
      if (!OneSignal) return false;
      currentStep = "login";
      await withTimeout(OneSignal.login(userId), "Staff notification sign-in");
      currentStep = "read subscription";
      const subscriptionId = OneSignal.User.PushSubscription.id;
      if (!subscriptionId || !OneSignal.User.PushSubscription.optedIn) return false;
      return saveSubscription(subscriptionId, role);
    } catch (error) {
      if (repairAfterSdkCrash(error)) return false;
      return registrationFailed("Existing notification setup could not be restored", error);
    } finally {
      endDiagnostics();
    }
  });
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
async function performStaffPushRegistration(
  userId: string,
  role?: string | null,
): Promise<boolean> {
  if (typeof window === "undefined" || !userId) return false;
  beginDiagnostics();
  try {
    const OneSignal = await getOneSignal();
    if (!OneSignal) return registrationFailed("Push is unavailable in this browser");

    currentStep = "login";
    await withTimeout(OneSignal.login(userId), "Staff notification sign-in");

    currentStep = "permission";
    await withTimeout(OneSignal.Notifications.requestPermission(), "Notification permission request");
    if (!OneSignal.Notifications.permission) {
      return registrationFailed("Notification permission was not granted");
    }

    currentStep = "opt in";
    await withTimeout(OneSignal.User.PushSubscription.optIn(), "Device subscription");
    currentStep = "wait for subscription";
    const subscriptionId = await waitForSubscriptionId(OneSignal);
    currentStep = "save device";

    // Goes through the RPC rather than a direct upsert: on a shared browser
    // the subscription ID outlives the sign-in, and only a SECURITY DEFINER
    // can hand the existing row to whoever is signed in now. Without that,
    // the second person's alerts would keep going to the first.
    return saveSubscription(subscriptionId, role);
  } catch (error) {
    if (repairAfterSdkCrash(error)) {
      return registrationFailed(
        "Repairing notification storage",
        "OmniFlow will reload in a moment — then tap Connect this phone once more.",
      );
    }
    return registrationFailed("Device registration did not complete", error);
  } finally {
    endDiagnostics();
  }
}

export function registerStaffPush(
  userId: string,
  role?: string | null,
): Promise<boolean> {
  if (registrationPromise) return registrationPromise;

  lastRegistrationError = null;
  registrationPromise = withTimeout(
    serialize(() => performStaffPushRegistration(userId, role)),
    "Notification setup",
    REGISTRATION_TIMEOUT_MS,
  )
    .catch((error) => registrationFailed("Notification setup did not finish", error))
    .finally(() => {
      registrationPromise = null;
    });
  return registrationPromise;
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
    const OneSignal = await serialize(() => getOneSignal());
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
