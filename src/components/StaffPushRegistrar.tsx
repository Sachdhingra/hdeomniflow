import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  permissionState,
  registerStaffPush,
  restoreStaffPush,
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
  const [blocked, setBlocked] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const restoredFor = useRef<string | null>(null);

  const register = useCallback(async () => {
    if (!user) return false;
    setSetupError(null);
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
    // Restore only an existing subscription. Permission and opt-in are always
    // initiated by the one visible button so mobile browsers keep the tap's
    // user gesture and never leave an automatic prompt hanging.
    if (restoredFor.current === user.id) return;
    restoredFor.current = user.id;

    let cancelled = false;
    (async () => {
      const ok = await restoreStaffPush(user.id, user.role);
      if (cancelled) return;
      setBlocked(!ok);
      setSetupError(ok ? null : staffPushRegistrationError());
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const activate = async () => {
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
                  ? "Permission is allowed. Tap once to finish connecting this phone."
                  : "Turn on notifications so chat messages and new lead alerts reach you even when OmniFlow is closed."}
            </p>
            {setupError && !denied && (
              <p className="mt-2 text-xs text-destructive">{setupError}</p>
            )}
            {denied ? (
              <p className="mt-3 text-xs font-medium text-foreground">
                Open this site's notification settings, choose Allow, then return to OmniFlow.
              </p>
            ) : (
              <Button
                onClick={activate}
                disabled={registering}
                size="sm"
                className="mt-3"
              >
                {registering && <Loader2 className="animate-spin" />}
                {registering
                  ? "Connecting device…"
                  : grantedButUnregistered
                    ? "Connect this phone"
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
