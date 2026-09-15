import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  initPush,
  permissionState,
  registerStaffPush,
  staffPushRegistrationError,
} from "@/lib/push";

/**
 * Enrols the signed-in staff member's device for push, so chat, lead and
 * order alerts arrive when the app is closed.
 *
 * Notifications are on by default: the permission prompt is raised as soon as
 * someone signs in, and the device is re-registered on every app open (cheap —
 * OneSignal no-ops when already subscribed) so a cleared subscription heals
 * itself. Until setup succeeds, a persistent prompt keeps the required action
 * visible so a signed-in staff phone cannot silently miss alerts.
 */
const StaffPushRegistrar = () => {
  const { user } = useAuth();
  const [blocked, setBlocked] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const attemptedFor = useRef<string | null>(null);

  const register = useCallback(async () => {
    if (!user) return false;
    setRegistering(true);
    try {
      const ok = await registerStaffPush(user.id, user.role);
      setSetupError(ok ? null : staffPushRegistrationError());
      setBlocked(!ok);
      return ok;
    } finally {
      setRegistering(false);
    }
  }, [user]);

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
        setBlocked(true);
        return;
      }

      const ok = await register();
      if (cancelled) return;
      // Permission and registration are separate. A device can have permission
      // while the provider subscription or database save still failed.
      if (!ok) {
        setBlocked(true);
        if (permissionState() === "granted") {
          console.warn(
            "Staff push registration failed despite granted browser permission.",
            staffPushRegistrationError(),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, register]);

  // Android may finish granting permission after the first registration
  // attempt. Retry when the installed app returns to the foreground.
  useEffect(() => {
    if (!user) return;

    const retryWhenActive = () => {
      if (document.visibilityState === "visible" && permissionState() === "granted") {
        void register();
      }
    };

    document.addEventListener("visibilitychange", retryWhenActive);
    window.addEventListener("focus", retryWhenActive);
    window.addEventListener("online", retryWhenActive);
    return () => {
      document.removeEventListener("visibilitychange", retryWhenActive);
      window.removeEventListener("focus", retryWhenActive);
      window.removeEventListener("online", retryWhenActive);
    };
  }, [user, register]);

  const retry = async () => {
    if (!user) return;
    const ok = await register();
    if (ok) setBlocked(false);
  };

  if (!blocked) return null;

  const state = permissionState();
  const denied = state === "denied";
  const grantedButUnregistered = state === "granted";

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto max-w-md px-4">
      <div className="rounded-lg border border-warning/40 bg-card p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <BellRing className="w-5 h-5 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-semibold">Notifications are off</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {denied
                ? "Your browser is blocking OmniFlow notifications, so chat messages and new lead alerts won't reach you when the app is closed. Allow notifications for this site in your browser settings, then reload."
                : grantedButUnregistered
                  ? "Notification permission is allowed, but this device has not finished connecting. Tap Retry device setup."
                  : "Turn on notifications so chat messages and new lead alerts reach you even when OmniFlow is closed."}
            </p>
            {setupError && grantedButUnregistered && (
              <p className="mt-2 text-xs text-destructive">{setupError}</p>
            )}
            {denied ? (
              <p className="mt-3 text-xs font-medium text-foreground">
                Open this site's notification settings, choose Allow, then return to OmniFlow.
              </p>
            ) : (
              <Button
                onClick={retry}
                disabled={registering}
                size="sm"
                className="mt-3"
              >
                {registering && <Loader2 className="animate-spin" />}
                {registering
                  ? "Connecting device…"
                  : grantedButUnregistered
                    ? "Retry device setup"
                    : "Turn on notifications"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StaffPushRegistrar;
