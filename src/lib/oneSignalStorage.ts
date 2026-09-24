/**
 * OneSignal's page SDK keeps its user model in the ONE_SIGNAL_SDK_DB IndexedDB
 * database. When that database will not open (corrupted, left at an
 * incompatible version, or stuck mid-upgrade), OneSignal.init() logs
 * "IndexedDB unavailable" and *resolves* without building its user model.
 * The next call, login(), then dies inside the minified bundle with
 * "Cannot read properties of undefined (reading 'Qe')".
 *
 * Nothing on the device ever registered with OmniFlow's OneSignal app, so the
 * database holds nothing worth keeping: when it is unusable, delete it and
 * let the SDK rebuild it.
 */
export const ONESIGNAL_DB = "ONE_SIGNAL_SDK_DB";
/** The newest schema version the v16 SDK opens it at. */
const ONESIGNAL_DB_VERSION = 7;
const STORAGE_STEP_MS = 5_000;

type Probe = { ok: boolean; reason?: string };

function settleWithin<T>(executor: (done: (value: T) => void) => void, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (value: T) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => done(fallback), STORAGE_STEP_MS);
    executor(done);
  });
}

/** Open the existing database read-only style, never creating or upgrading it. */
function probe(): Promise<Probe> {
  return settleWithin<Probe>((done) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(ONESIGNAL_DB);
    } catch (error) {
      done({ ok: false, reason: error instanceof Error ? error.name : String(error) });
      return;
    }
    request.onupgradeneeded = (event) => {
      // Database did not exist. Abort so it is not created at version 1 —
      // the SDK's own upgrade from 0 must be the one that builds it.
      if (event.oldVersion === 0) request.transaction?.abort();
    };
    request.onsuccess = () => {
      const db = request.result;
      const version = db.version;
      db.close();
      done(
        version > ONESIGNAL_DB_VERSION
          ? { ok: false, reason: `saved at unsupported version ${version}` }
          : { ok: true },
      );
    };
    request.onerror = (event) => {
      const name = request.error?.name ?? "UnknownError";
      if (name === "AbortError") {
        event.preventDefault();
        done({ ok: true });
        return;
      }
      done({ ok: false, reason: name });
    };
    request.onblocked = () => done({ ok: false, reason: "blocked by another open copy of OmniFlow" });
  }, { ok: false, reason: "did not open in time" });
}

/** Delete the SDK database. Resolves false when the browser would not do it. */
export function deleteOneSignalDatabase(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return Promise.resolve(false);
  return settleWithin<boolean>((done) => {
    try {
      const request = indexedDB.deleteDatabase(ONESIGNAL_DB);
      request.onsuccess = () => done(true);
      request.onerror = () => done(false);
      request.onblocked = () => done(false);
    } catch {
      done(false);
    }
  }, false);
}

/**
 * Make sure OneSignal will be able to open its database. Returns null when it
 * can (repairing it first if needed), or a message the phone's user can act on.
 */
export async function ensureOneSignalStorage(): Promise<string | null> {
  if (typeof indexedDB === "undefined") return null;

  const first = await probe();
  if (first.ok) return null;

  console.warn(`OneSignal storage unusable (${first.reason}); rebuilding it.`);
  await deleteOneSignalDatabase();

  const second = await probe();
  if (second.ok) return null;

  return (
    `This phone's notification storage could not be opened (${second.reason}). ` +
    "Close every OmniFlow tab and window, then in Chrome open Settings → Site settings → " +
    "All sites → this site → Clear & reset, reopen OmniFlow and tap again. " +
    "Also check the phone is not out of storage and that you are not in an Incognito tab."
  );
}
