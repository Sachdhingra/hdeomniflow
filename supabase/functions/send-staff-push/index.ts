/**
 * send-staff-push — OmniFlow staff app push notification sender.
 *
 * The staff app used to rely on ServiceWorkerRegistration.showNotification()
 * driven by a live realtime subscription, which only fires while a tab is
 * open. This function delivers the same alerts through OneSignal so they
 * arrive when the app is closed.
 *
 * POST body:
 *   user_ids : string[] (required unless `roles` is given) — auth.users IDs
 *   roles    : string[] (optional) — app_role values; expands to their users
 *   type     : string   (required) — label stored in push_notifications_log
 *   title    : string   (required)
 *   message  : string   (required)
 *   data     : object   (optional) — forwarded to the app; `url` drives the
 *              deep link opened when the notification is tapped
 *
 * Returns { sent: number, targeted: number, error?: string }
 *
 * Invocation patterns:
 *   - From the notifications / chat_messages database triggers
 *     (x-internal-secret header) — the path that works with the app closed
 *   - From the admin dashboard for staff broadcasts (admin JWT)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET   = Deno.env.get("LOYALTY_CRON_SECRET") ?? "";

// Staff may run on their own OneSignal app; fall back to the Insider
// credentials so a single-app setup keeps working without extra config.
const ONESIGNAL_APP_ID  = Deno.env.get("ONESIGNAL_STAFF_APP_ID")
  ?? Deno.env.get("ONESIGNAL_APP_ID")!;
const ONESIGNAL_API_KEY = Deno.env.get("ONESIGNAL_STAFF_API_KEY")
  ?? Deno.env.get("ONESIGNAL_API_KEY")!;

const ONESIGNAL_URL = "https://onesignal.com/api/v1/notifications";
// OneSignal accepts at most 2000 player IDs per create-notification call.
const BATCH_SIZE = 2000;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

// ---------------------------------------------------------------------------
// Auth — the database triggers use the internal secret, the dashboard an
// admin JWT. A plain staff JWT is not enough to push to other people.
// ---------------------------------------------------------------------------
async function isAuthorized(req: Request): Promise<boolean> {
  const internalSecret = req.headers.get("x-internal-secret");
  if (INTERNAL_SECRET && internalSecret === INTERNAL_SECRET) return true;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return false;

  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  return isAdmin === true;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!(await isAuthorized(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: {
    action?: "status";
    user_ids?: string[];
    roles?: string[];
    type?: string;
    title?: string;
    message?: string;
    data?: Record<string, unknown>;
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    return json({ error: "Push service is not configured yet." }, 503);
  }

  // Reach probe for the dashboard badge.
  if (body.action === "status") {
    const { count, error } = await supabase
      .from("staff_push_devices")
      .select("id", { count: "exact", head: true })
      .eq("push_enabled", true);
    return error
      ? json({ error: error.message }, 500)
      : json({ reachable: count ?? 0 });
  }

  const { user_ids, roles, type, title, message, data: extraData } = body;
  if (!type || !title || !message) {
    return json({ error: "Missing required fields: type, title, message" }, 400);
  }

  // ── 1. Resolve the recipient set ────────────────────────────────────────
  const targetUserIds = new Set<string>(user_ids ?? []);

  if (roles?.length) {
    const { data: roleRows, error: roleErr } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", roles);
    if (roleErr) return json({ error: roleErr.message }, 500);
    for (const r of roleRows ?? []) targetUserIds.add(r.user_id as string);
  }

  if (targetUserIds.size === 0) {
    return json({ error: "No recipients: pass user_ids or roles" }, 400);
  }

  // ── 2. Look up their enabled devices ────────────────────────────────────
  const { data: devices, error: devErr } = await supabase
    .from("staff_push_devices")
    .select("user_id, onesignal_player_id")
    .in("user_id", [...targetUserIds])
    .eq("push_enabled", true);

  if (devErr) {
    console.error("staff_push_devices lookup error:", devErr.message);
    return json({ error: devErr.message }, 500);
  }

  // One person can have several devices; de-duplicate the player IDs.
  const seen = new Set<string>();
  const targets = (devices ?? []).filter((d) => {
    const pid = d.onesignal_player_id as string;
    if (!pid || seen.has(pid)) return false;
    seen.add(pid);
    return true;
  });

  if (targets.length === 0) {
    return json({ sent: 0, targeted: 0, error: "No registered staff devices for these recipients." });
  }

  // ── 3. Send via OneSignal in batches ────────────────────────────────────
  const url = typeof extraData?.url === "string" ? extraData.url : undefined;
  let sentCount = 0;
  let lastError: string | undefined;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const payload: Record<string, unknown> = {
      app_id:             ONESIGNAL_APP_ID,
      include_player_ids: batch.map((d) => d.onesignal_player_id),
      headings:           { en: title },
      contents:           { en: message },
      data:               { type, ...(extraData ?? {}) },
      // Staff alerts are operational — make them land with sound + vibration.
      priority:           10,
      android_channel_name: "OmniFlow Alerts",
      ...(url ? { url: absoluteUrl(url) } : {}),
    };

    let batchOk = false;
    try {
      const resp = await fetch(ONESIGNAL_URL, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Key ${ONESIGNAL_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        batchOk = true;
        sentCount += batch.length;
      } else {
        lastError = `OneSignal ${resp.status}: ${await resp.text()}`;
        console.error("OneSignal error:", lastError);
      }
    } catch (e) {
      lastError = String(e);
      console.error("OneSignal fetch failed:", lastError);
    }

    // Mirror send-push logging so the dashboard has one delivery history.
    const logRows = batch.map((d) => ({
      staff_user_id:     d.user_id,
      notification_type: type,
      title,
      message,
      sent_at:           new Date().toISOString(),
      delivery_status:   batchOk ? "sent" : "failed",
    }));
    const { error: logErr } = await supabase.from("push_notifications_log").insert(logRows);
    if (logErr) console.error("Log insert error:", logErr.message);
  }

  return json({
    sent:     sentCount,
    targeted: targets.length,
    ...(lastError ? { error: lastError } : {}),
  }, sentCount === 0 ? 502 : 200);
});

/** OneSignal needs an absolute launch URL; triggers pass app-relative paths. */
function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = Deno.env.get("OMNIFLOW_APP_URL") ?? "";
  if (!base) return path;
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
