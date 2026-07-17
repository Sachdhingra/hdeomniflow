/**
 * send-push — Elite Card Loyalty push notification sender.
 *
 * POST body:
 *   customer_id  : UUID (required)
 *   type         : string  (required) — arbitrary label stored in log
 *   title        : string  (required)
 *   message      : string  (required)
 *   data         : object  (optional) — custom key-value pairs forwarded to app
 *   promotional  : boolean (optional, default false) — promotional sends respect
 *                  the customer's push_enabled (Offers & Promotions) setting;
 *                  transactional/loyalty sends (default) are always delivered
 *
 * Returns { sent: boolean, log_id: string | null, error?: string }
 *
 * Invocation patterns:
 *   - From UI after bill approval / redemption approval (authenticated JWT)
 *   - From loyalty-cron edge function (x-internal-secret header)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ONESIGNAL_API_KEY   = Deno.env.get("ONESIGNAL_API_KEY")!;
const ONESIGNAL_APP_ID    = Deno.env.get("ONESIGNAL_APP_ID")!;
const INTERNAL_SECRET     = Deno.env.get("LOYALTY_CRON_SECRET") ?? "";

const ONESIGNAL_URL = "https://onesignal.com/api/v1/notifications";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Auth check — accept either a valid staff JWT or the internal cron secret
// ---------------------------------------------------------------------------
async function isAuthorized(req: Request): Promise<boolean> {
  const internalSecret = req.headers.get("x-internal-secret");
  if (INTERNAL_SECRET && internalSecret === INTERNAL_SECRET) return true;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return !error && user !== null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, x-internal-secret",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!(await isAuthorized(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: {
    customer_id: string;
    type: string;
    title: string;
    message: string;
    data?: Record<string, unknown>;
    promotional?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { customer_id, type, title, message, data: extraData, promotional } = body;
  if (!customer_id || !type || !title || !message) {
    return json({ error: "Missing required fields: customer_id, type, title, message" }, 400);
  }

  // ── 1. Look up OneSignal player_id from app_users ───────────────────────
  // push_enabled only gates promotional sends; account/loyalty pushes
  // (points expiry, redemption reminders, birthdays) are always delivered.
  const { data: appUser, error: auErr } = await supabase
    .from("app_users")
    .select("onesignal_player_id, push_enabled")
    .eq("customer_id", customer_id)
    .maybeSingle();

  if (auErr) {
    console.error("app_users lookup error:", auErr.message);
    return json({ sent: false, log_id: null, error: auErr.message }, 500);
  }

  const optedOut = promotional === true && appUser?.push_enabled === false;
  const playerId: string | null = optedOut ? null : appUser?.onesignal_player_id ?? null;

  // ── 2. Send via OneSignal if player ID is available ────────────────────
  let onesignalSuccess = false;
  let onesignalError: string | undefined;

  if (playerId) {
    const payload = {
      app_id:             ONESIGNAL_APP_ID,
      include_player_ids: [playerId],
      headings:           { en: title },
      contents:           { en: message },
      data:               { type, customer_id, ...(extraData ?? {}) },
    };

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
        onesignalSuccess = true;
      } else {
        const errBody = await resp.text();
        onesignalError = `OneSignal ${resp.status}: ${errBody}`;
        console.error("OneSignal error:", onesignalError);
      }
    } catch (fetchErr) {
      onesignalError = String(fetchErr);
      console.error("OneSignal fetch failed:", onesignalError);
    }
  }

  // ── 3. Log to push_notifications_log ────────────────────────────────────
  const { data: logRow, error: logErr } = await supabase
    .from("push_notifications_log")
    .insert({
      customer_id,
      notification_type: type,
      title,
      message,
      sent_at:           new Date().toISOString(),
      delivery_status:   playerId
        ? (onesignalSuccess ? "sent" : "failed")
        : (optedOut ? "opted_out" : "no_device"),
    })
    .select("id")
    .single();

  if (logErr) {
    console.error("Log insert error:", logErr.message);
  }

  return json({
    sent:    onesignalSuccess,
    log_id:  logRow?.id ?? null,
    ...(onesignalError ? { error: onesignalError } : {}),
  });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":                 "application/json",
      "Access-Control-Allow-Origin":  "*",
    },
  });
}
