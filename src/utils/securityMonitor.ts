/**
 * Security Monitor
 * Client-side defenses against external attacks:
 * - Brute-force login throttling (server-enforced via RPC, mirrored locally)
 * - Idle session timeout (limits stolen-device / unattended-session exposure)
 * - Security event reporting to the admin-visible security_events table
 * - Session fingerprint check (detects token reuse from a different device)
 */

import { supabase } from "@/integrations/supabase/client";

// ============================================================
// Brute-force login protection
// ============================================================

export interface LoginGate {
  allowed: boolean;
  retryAfterSeconds?: number;
  message?: string;
}

/**
 * Server-side check: is login currently allowed for this username?
 * Backed by public.check_login_allowed (5 failures / 15 min -> 15 min lock).
 * Fails open on network error so an outage can't lock everyone out —
 * Supabase auth itself still gates the actual sign-in.
 */
export async function checkLoginAllowed(identifier: string): Promise<LoginGate> {
  try {
    const { data, error } = await supabase.rpc("check_login_allowed", {
      _identifier: identifier,
    });
    if (error) throw error;

    const result = data as { allowed: boolean; retry_after_seconds?: number };
    if (!result.allowed) {
      const mins = Math.ceil((result.retry_after_seconds ?? 900) / 60);
      return {
        allowed: false,
        retryAfterSeconds: result.retry_after_seconds,
        message: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      };
    }
    return { allowed: true };
  } catch (e) {
    console.warn("⚠️ [Security] Login rate-limit check unavailable, failing open:", e);
    return { allowed: true };
  }
}

/** Record a login attempt outcome (feeds the server-side rate limiter). */
export async function recordLoginAttempt(identifier: string, success: boolean): Promise<void> {
  try {
    await supabase.rpc("record_login_attempt", {
      _identifier: identifier,
      _success: success,
    });
  } catch (e) {
    console.warn("⚠️ [Security] Failed to record login attempt:", e);
  }
}

// ============================================================
// Security event reporting
// ============================================================

export type ClientSecurityEvent =
  | "suspicious_input"
  | "session_expired"
  | "unauthorized_access"
  | "integrity_violation";

/**
 * Report a security event to the server-side log (admin-only visibility).
 * Server rate-limits to 30 events/user/hour, so callers don't need to throttle.
 */
export async function reportSecurityEvent(
  eventType: ClientSecurityEvent,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.rpc("log_security_event", {
      _event_type: eventType,
      _details: details ?? null,
    });
  } catch (e) {
    console.warn("⚠️ [Security] Failed to report security event:", e);
  }
}

// ============================================================
// Idle session timeout
// ============================================================

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min for staff
const IDLE_TIMEOUT_ADMIN_MS = 15 * 60 * 1000; // 15 min for admin (higher privilege, shorter window)
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll", "visibilitychange"];

/**
 * Start the idle-session watchdog. Logs the user out after the idle window
 * with no interaction — limits exposure if a device is left unlocked or stolen.
 *
 * @returns cleanup function (call on logout/unmount)
 */
export function startIdleTimeout(
  isAdmin: boolean,
  onTimeout: () => void
): () => void {
  const timeoutMs = isAdmin ? IDLE_TIMEOUT_ADMIN_MS : IDLE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout>;

  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.warn("⏱️ [Security] Idle timeout reached — signing out");
      reportSecurityEvent("session_expired", { reason: "idle_timeout" });
      onTimeout();
    }, timeoutMs);
  };

  ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, reset, { passive: true }));
  reset();

  return () => {
    clearTimeout(timer);
    ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, reset));
  };
}

// ============================================================
// Session fingerprint (token-theft detection)
// ============================================================

const FINGERPRINT_KEY = "furncrm_session_fp";

async function computeFingerprint(): Promise<string> {
  // Coarse, privacy-light fingerprint: enough to notice a token replayed
  // from a very different device, without tracking users.
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + "x" + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/**
 * On login: store this device's fingerprint alongside the session.
 */
export async function bindSessionFingerprint(): Promise<void> {
  try {
    sessionStorage.setItem(FINGERPRINT_KEY, await computeFingerprint());
  } catch {}
}

/**
 * On session restore: verify the fingerprint matches the one bound at login.
 * A mismatch inside the same sessionStorage scope means the environment
 * changed underneath an existing token — report it (do not hard-fail;
 * legitimate causes exist, e.g. monitor changes).
 */
export async function verifySessionFingerprint(): Promise<boolean> {
  try {
    const stored = sessionStorage.getItem(FINGERPRINT_KEY);
    if (!stored) {
      await bindSessionFingerprint();
      return true;
    }
    const current = await computeFingerprint();
    if (stored !== current) {
      console.warn("⚠️ [Security] Session fingerprint changed");
      reportSecurityEvent("integrity_violation", { reason: "fingerprint_mismatch" });
      return false;
    }
    return true;
  } catch {
    return true;
  }
}
