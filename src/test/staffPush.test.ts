import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression cover for src/lib/push.ts — staff device registration.
 *
 * The bug these guard: a slow OneSignal.init() used to have its cached promise
 * thrown away on timeout, so the next "Connect this phone" tap started a
 * SECOND init while the first was still running. The SDK rebuilt its internals
 * underneath the first call and every later API call died inside the minified
 * CDN bundle with "Cannot read properties of undefined (reading 'Qe')" — which
 * is what sales phones showed instead of ever registering.
 */

type Subscription = {
  id: string | null;
  optedIn: boolean;
  optIn: ReturnType<typeof vi.fn>;
  optOut: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

const subscription: Subscription = {
  id: null,
  optedIn: false,
  optIn: vi.fn(),
  optOut: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

const oneSignal = {
  init: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  Debug: { setLogLevel: vi.fn() },
  Notifications: {
    permission: true,
    requestPermission: vi.fn(),
  },
  User: { PushSubscription: subscription },
};

const rpc = vi.fn();

vi.mock("react-onesignal", () => ({ default: oneSignal }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
  },
}));

/** Fresh module state per test — push.ts caches the SDK client at module scope. */
async function loadPush() {
  vi.resetModules();
  return import("@/lib/push");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();

  subscription.id = null;
  subscription.optedIn = false;
  subscription.optIn.mockResolvedValue(undefined);
  oneSignal.init.mockResolvedValue(undefined);
  oneSignal.login.mockResolvedValue(undefined);
  oneSignal.Notifications.permission = true;
  oneSignal.Notifications.requestPermission.mockResolvedValue(undefined);
  rpc.mockResolvedValue({ error: null });

  delete (window as { __omniflowOneSignalInit?: unknown }).__omniflowOneSignalInit;
  // Stands in for the CDN bundle having executed.
  (window as { OneSignal?: unknown }).OneSignal = oneSignal;
  Object.defineProperty(window, "PushManager", { value: class {}, configurable: true });
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      register: vi.fn().mockResolvedValue({}),
      ready: Promise.resolve({}),
    },
    configurable: true,
  });
  Object.defineProperty(window, "Notification", {
    value: { permission: "granted" },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registerStaffPush", () => {
  it("stores the subscription against the signed-in staff user", async () => {
    subscription.optIn.mockImplementation(async () => {
      subscription.id = "player-123";
      subscription.optedIn = true;
    });

    const push = await loadPush();
    const result = push.registerStaffPush("user-1", "sales");
    await vi.runAllTimersAsync();

    expect(await result).toBe(true);
    expect(oneSignal.login).toHaveBeenCalledWith("user-1");
    expect(rpc).toHaveBeenCalledWith(
      "register_staff_push_device",
      expect.objectContaining({ _player_id: "player-123", _role: "sales" }),
    );
    expect(push.staffPushRegistrationError()).toBeNull();
    expect(push.pushDeliversSystemNotifications()).toBe(true);
  });

  it("never starts a second init when a slow one outruns the startup timeout", async () => {
    // An init that never settles — a phone on weak mobile data.
    oneSignal.init.mockReturnValue(new Promise<void>(() => {}));

    const push = await loadPush();
    const first = push.registerStaffPush("user-1", "sales");
    await vi.advanceTimersByTimeAsync(31_000);

    expect(await first).toBe(false);
    expect(push.staffPushRegistrationError()).toMatch(/Notification service startup timed out/);
    expect(oneSignal.init).toHaveBeenCalledTimes(1);

    // The tap the sales person makes next must reuse the in-flight init.
    const second = push.registerStaffPush("user-1", "sales");
    await vi.advanceTimersByTimeAsync(31_000);

    expect(await second).toBe(false);
    expect(oneSignal.init).toHaveBeenCalledTimes(1);
    expect(oneSignal.login).not.toHaveBeenCalled();
  });

  it("retries init once it has genuinely failed", async () => {
    oneSignal.init.mockRejectedValueOnce(new Error("Service worker registration failed"));

    const push = await loadPush();
    const first = push.registerStaffPush("user-1", "sales");
    await vi.runAllTimersAsync();
    expect(await first).toBe(false);

    subscription.optIn.mockImplementation(async () => {
      subscription.id = "player-456";
      subscription.optedIn = true;
    });
    const second = push.registerStaffPush("user-1", "sales");
    await vi.runAllTimersAsync();

    expect(await second).toBe(true);
    expect(oneSignal.init).toHaveBeenCalledTimes(2);
  });

  it("explains the opaque crash thrown inside the OneSignal bundle", async () => {
    oneSignal.login.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'Qe')"),
    );

    const push = await loadPush();
    const result = push.registerStaffPush("user-1", "sales");
    await vi.runAllTimersAsync();

    expect(await result).toBe(false);
    const message = push.staffPushRegistrationError() ?? "";
    expect(message).toContain("reading 'Qe'");
    expect(message).toContain("cdn.onesignal.com");
  });

  it("reports that the SDK never loaded rather than crashing later", async () => {
    delete (window as { OneSignal?: unknown }).OneSignal;

    const push = await loadPush();
    const result = push.registerStaffPush("user-1", "sales");
    await vi.runAllTimersAsync();

    expect(await result).toBe(false);
    expect(push.staffPushRegistrationError()).toMatch(/could not be reached/);
    expect(oneSignal.login).not.toHaveBeenCalled();
  });

  it("picks up a subscription that arrives without a change event", async () => {
    // OneSignal's wrapper queues addEventListener through OneSignalDeferred, so
    // the event can fire before the listener is attached. Polling covers it.
    subscription.optIn.mockImplementation(async () => {
      setTimeout(() => {
        subscription.id = "player-late";
        subscription.optedIn = true;
      }, 2_000);
    });

    const push = await loadPush();
    const result = push.registerStaffPush("user-1", "sales");
    await vi.runAllTimersAsync();

    expect(await result).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "register_staff_push_device",
      expect.objectContaining({ _player_id: "player-late" }),
    );
  });

  it("keeps the innermost failure instead of the outer wrapper's message", async () => {
    rpc.mockResolvedValue({ error: { message: "permission denied for function" } });
    subscription.optIn.mockImplementation(async () => {
      subscription.id = "player-789";
      subscription.optedIn = true;
    });

    const push = await loadPush();
    const result = push.registerStaffPush("user-1", "sales");
    await vi.runAllTimersAsync();

    expect(await result).toBe(false);
    expect(push.staffPushRegistrationError()).toBe(
      "The device subscription could not be saved: permission denied for function",
    );
  });
});

describe("restoreStaffPush", () => {
  it("re-saves an existing subscription without prompting", async () => {
    subscription.id = "player-existing";
    subscription.optedIn = true;

    const push = await loadPush();
    const result = push.restoreStaffPush("user-2", "sales");
    await vi.runAllTimersAsync();

    expect(await result).toBe(true);
    expect(oneSignal.Notifications.requestPermission).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "register_staff_push_device",
      expect.objectContaining({ _player_id: "player-existing", _role: "sales" }),
    );
  });

  it("does not touch the SDK before the browser has granted permission", async () => {
    Object.defineProperty(window, "Notification", {
      value: { permission: "default" },
      configurable: true,
    });

    const push = await loadPush();
    expect(await push.restoreStaffPush("user-2", "sales")).toBe(false);
    expect(oneSignal.init).not.toHaveBeenCalled();
  });
});
