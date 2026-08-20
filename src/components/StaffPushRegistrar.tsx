import { useEffect, useRef, useState } from "react";
import { BellRing, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { initPush, permissionState, registerStaffPush } from "@/lib/push";

const DISMISS_KEY = "omniflow_push_prompt_dismissed";
const DISMISS_DAYS = 7;

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Enrols the signed-in staff member's device for push, so chat, lead and
 * order alerts arrive when the app is closed.
 *
 * Notifications are on by default: the permission prompt is raised as soon as
 * someone signs in, and the device is re-registered on every app open (cheap —
 * OneSignal no-ops when already subscribed) so a cleared subscription heals
 * itself. If the browser blocked notifications, a dismissible banner explains
 * how to switch them back on instead of silently going quiet.
 */
const StaffPushRegistrar = () => {
  const { user } = useAuth();
  const [blocked, setBlocked] = useState(false);
  const attemptedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // Once per signed-in user per page load.
    if (attemptedFor.current === user.id) return;
    attemptedFor.current = user.id;

    let cancelled = false;
    (async () => {
      await initPush();
      if (cancelled) return;

      if (permissionState() === "denied") {
        setBlocked(!dismissedRecently());
        return;
      }

      const ok = await registerStaffPush(user.id, user.role);
      if (cancelled) return;
      // Registration fails when the user dismissed the browser prompt — show
      // the banner so they have a way back.
      if (!ok && permissionState() !== "granted") {
        setBlocked(!dismissedRecently());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const retry = async () => {
    if (!user) return;
    const ok = await registerStaffPush(user.id, user.role);
    if (ok) setBlocked(false);
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setBlocked(false);
  };

  if (!blocked) return null;

  const denied = permissionState() === "denied";

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto max-w-md px-4">
      <div className="relative rounded-xl border border-warning/40 bg-card p-4 shadow-xl">
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3 pr-6">
          <BellRing className="w-5 h-5 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-semibold">Notifications are off</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {denied
                ? "Your browser is blocking OmniFlow notifications, so chat messages and new lead alerts won't reach you when the app is closed. Allow notifications for this site in your browser settings, then reload."
                : "Turn on notifications so chat messages and new lead alerts reach you even when OmniFlow is closed."}
            </p>
            {!denied && (
              <button
                onClick={retry}
                className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                Turn on notifications
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StaffPushRegistrar;
