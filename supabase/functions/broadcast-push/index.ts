/**
 * broadcast-push — Admin-only broadcast push notifications for the Insider app.
 *
 * Sends a push (text / banner / offer) to ALL app customers who have push
 * enabled, via OneSignal. Only staff with the `admin` role may invoke it —
 * unlike send-push, a plain staff JWT is not enough.
 *
 * audience "staff" targets registered OmniFlow staff devices instead, and
 * campaign_type "reengagement" is the one-click nudge asking existing app
 * users to switch notifications back on. The nudge can only reach devices
 * that still hold a subscription; everyone else is caught by the in-app
 * PushOptInBanner the next time they open the Insider app.
 *
 * POST body:
 *   campaign_type    : "text" | "banner" | "offer" | "reengagement"  (required)
 *   audience         : "customers" | "staff"         (optional, default "customers")
 *   title            : string                        (required)
 *   message          : string                        (required)
 *   image_url        : string   (optional — shown as big picture for banner/offer)
 *   link_url         : string   (optional — opened when notification is tapped)
 *   offer_code       : string   (optional — forwarded in data payload)
 *   offer_expires_at : ISO date (optional — forwarded in data payload)
 *
 * Returns { campaign_id, targeted, sent, error? }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ONESIGNAL_API_KEY = Deno.env.get("ONESIGNAL_API_KEY")!;
const ONESIGNAL_APP_ID  = Deno.env.get("ONESIGNAL_APP_ID")!;

// Staff run on their own OneSignal app (see send-staff-push for why). The app
// ID matches the client default in src/lib/push.ts; the key has no fallback,
// so an unconfigured staff broadcast fails loudly rather than sending with
// mismatched credentials.
const STAFF_APP_ID  = Deno.env.get("ONESIGNAL_STAFF_APP_ID")  ?? "4e6e57c1-7555-4f05-81e2-efdb9d6e19d4";
const STAFF_API_KEY = Deno.env.get("ONESIGNAL_STAFF_API_KEY") ?? "";

const ONESIGNAL_URL = "https://onesignal.com/api/v1/notifications";
// OneSignal accepts at most 2000 player IDs per create-notification call.
const BATCH_SIZE = 2000;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Auth — valid staff JWT AND admin role required
// ---------------------------------------------------------------------------
async function getAdminUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (roleErr || !isAdmin) return null;

  return user.id;
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
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const adminId = await getAdminUserId(req);
  if (!adminId) {
    return json({ error: "Unauthorized: admin role required" }, 401);
  }

  let body: {
    action?: "status";
    audience?: string;
    campaign_type: string;
    title: string;
    message: string;
    image_url?: string;
    link_url?: string;
    offer_code?: string;
    offer_expires_at?: string;
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (body.action === "status") {
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
      return json({ error: "Push service is not configured yet." }, 503);
    }
    // Staff reach comes from our own device table — OneSignal's device list
    // spans both apps when they share an app ID and can't tell them apart.
    const { count: staffReachable } = await supabase
      .from("staff_push_devices")
      .select("id", { count: "exact", head: true })
      .eq("push_enabled", true);

    // How many Insider customers the app knows are unreachable right now.
    const { count: needsOptIn } = await supabase
      .from("app_users")
      .select("id", { count: "exact", head: true })
      .or("push_permission.is.null,push_permission.neq.granted");

    const reachable = await getOneSignalReachableCount();
    if (reachable === null) {
      return json({ error: "Could not read registered devices from OneSignal." }, 502);
    }

    // When both apps share one OneSignal app, its device list covers staff
    // too. Take those out so the Insider badge counts customers only.
    const staffCount = staffReachable ?? 0;
    const customerReachable = STAFF_APP_ID === ONESIGNAL_APP_ID
      ? Math.max(0, reachable - staffCount)
      : reachable;

    return json({
      reachable: customerReachable,
      staff_reachable: staffCount,
      needs_opt_in: needsOptIn ?? 0,
    });
  }

  const { campaign_type, title, message, image_url, link_url, offer_code, offer_expires_at } = body;
  const audience = body.audience ?? "customers";

  if (!campaign_type || !title || !message) {
    return json({ error: "Missing required fields: campaign_type, title, message" }, 400);
  }
  if (!["text", "banner", "offer", "reengagement"].includes(campaign_type)) {
    return json({ error: "campaign_type must be one of: text, banner, offer, reengagement" }, 400);
  }
  if (!["customers", "staff"].includes(audience)) {
    return json({ error: "audience must be one of: customers, staff" }, 400);
  }

  // Each audience has its own OneSignal app, so check the pair this send will
  // actually use — a staff broadcast must not pass on the customer credentials.
  if (audience === "staff") {
    if (!STAFF_APP_ID || !STAFF_API_KEY) {
      return json(
        { error: "Staff push is not configured yet (missing ONESIGNAL_STAFF_API_KEY)." },
        503,
      );
    }
  } else if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    return json(
      { error: "Push service is not configured yet (missing OneSignal app ID / API key)." },
      503,
    );
  }

  // ── 1. Create the campaign row ──────────────────────────────────────────
  const { data: campaign, error: campErr } = await supabase
    .from("push_campaigns")
    .insert({
      campaign_type,
      audience,
      title,
      message,
      image_url:        image_url || null,
      link_url:         link_url || null,
      offer_code:       offer_code || null,
      offer_expires_at: offer_expires_at || null,
      status:           "sending",
      created_by:       adminId,
    })
    .select("id")
    .single();

  if (campErr || !campaign) {
    console.error("push_campaigns insert error:", campErr?.message);
    return json({ error: campErr?.message ?? "Failed to create campaign" }, 500);
  }

  // ── 2. Collect the recipients for this audience ─────────────────────────
  // A re-engagement nudge is about reaching people whose notifications are
  // off, so it deliberately ignores the promotional opt-in and falls through
  // to OneSignal's subscribed-device segment below — the widest reach the
  // provider can give us. Customers past that line are unreachable by push
  // by definition; the Insider app's PushOptInBanner catches them instead.
  const isReengagement = campaign_type === "reengagement";

  type Recipient = { customer_id: string | null; onesignal_player_id: string };
  let recipients: Recipient[] = [];

  if (audience === "staff") {
    const { data, error: recErr } = await supabase
      .from("staff_push_devices")
      .select("user_id, onesignal_player_id")
      .eq("push_enabled", true);
    if (recErr) {
      await failCampaign(campaign.id, recErr.message);
      return json({ error: recErr.message }, 500);
    }
    // Staff sends log against staff_user_id, not a customer.
    recipients = (data ?? []).map((d) => ({
      customer_id: null,
      onesignal_player_id: d.onesignal_player_id as string,
      staff_user_id: d.user_id as string,
    })) as Recipient[];
  } else if (!isReengagement) {
    const { data, error: recErr } = await supabase
      .from("app_users")
      .select("customer_id, onesignal_player_id")
      .eq("push_enabled", true)
      .not("onesignal_player_id", "is", null);
    if (recErr) {
      await failCampaign(campaign.id, recErr.message);
      return json({ error: recErr.message }, 500);
    }
    recipients = (data ?? []) as Recipient[];
  }

  // De-duplicate player IDs (a customer re-registering can leave repeats)
  const seen = new Set<string>();
  const targets = recipients.filter((r) => {
    const pid = r.onesignal_player_id;
    if (!pid || seen.has(pid)) return false;
    seen.add(pid);
    return true;
  });

  // ── 3. Send via OneSignal in batches ────────────────────────────────────
  const dataPayload: Record<string, unknown> = {
    type:        `broadcast_${campaign_type}`,
    campaign_id: campaign.id,
    ...(offer_code ? { offer_code } : {}),
    ...(offer_expires_at ? { offer_expires_at } : {}),
    ...(link_url ? { link_url } : {}),
  };

  let sentCount = 0;
  let lastError: string | undefined;

  // Older Insider installs may already be subscribed in OneSignal without
  // having copied their subscription ID into app_users, and a re-engagement
  // nudge deliberately targets everyone still subscribed. Both go out via
  // OneSignal's subscribed-user segment. Staff is never sent this way — the
  // segment spans both apps when they share a OneSignal app ID, so a staff
  // broadcast with no registered devices must send nothing rather than reach
  // every customer.
  if (targets.length === 0 && audience !== "staff") {
    const payload: Record<string, unknown> = {
      app_id: ONESIGNAL_APP_ID,
      included_segments: ["Subscribed Users"],
      headings: { en: title },
      contents: { en: message },
      data: dataPayload,
      ...(link_url ? { url: link_url } : {}),
      ...(image_url
        ? {
            big_picture: image_url,
            chrome_web_image: image_url,
            ios_attachments: { image: image_url },
            huawei_big_picture: image_url,
          }
        : {}),
    };

    try {
      const resp = await fetch(ONESIGNAL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Key ${ONESIGNAL_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });
      const responseText = await resp.text();
      if (resp.ok) {
        const result = JSON.parse(responseText) as { recipients?: number };
        sentCount = result.recipients ?? 0;
        if (sentCount === 0) {
          lastError = isReengagement
            ? "No device currently holds a push subscription, so there is nobody to nudge. Customers with notifications off will see the in-app prompt the next time they open the Insider app."
            : "No device has an active push subscription yet. The Insider app must request notification permission and save the subscription ID before broadcasts can be delivered.";
        }
      } else {
        lastError = `OneSignal ${resp.status}: ${responseText}`;
      }
    } catch (e) {
      lastError = String(e);
    }


    // Stamp the nudge so the dashboard can show when it last went out.
    if (isReengagement && sentCount > 0) {
      const { error: stampErr } = await supabase
        .from("app_users")
        .update({ push_reengaged_at: new Date().toISOString() })
        .not("onesignal_player_id", "is", null);
      if (stampErr) console.error("push_reengaged_at update error:", stampErr.message);
    }

    const status = lastError ? "failed" : "sent";
    await supabase
      .from("push_campaigns")
      .update({
        status,
        recipients_targeted: sentCount,
        recipients_sent: sentCount,
        sent_at: new Date().toISOString(),
        ...(lastError ? { error: lastError } : {}),
      })
      .eq("id", campaign.id);

    return json(
      {
        campaign_id: campaign.id,
        targeted: sentCount,
        sent: sentCount,
        ...(lastError ? { error: lastError } : {}),
      },
      lastError ? 502 : 200,
    );
  }

  // Only reachable for a staff audience — a customer audience with no known
  // devices took the subscribed-segment path above.
  if (targets.length === 0) {
    const err = "No staff device is registered for push yet. Staff must sign in to OmniFlow and allow notifications first.";
    await failCampaign(campaign.id, err);
    return json({ campaign_id: campaign.id, targeted: 0, sent: 0, error: err }, 502);
  }

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const payload: Record<string, unknown> = {
      app_id:             audience === "staff" ? STAFF_APP_ID : ONESIGNAL_APP_ID,
      include_player_ids: batch.map((r) => r.onesignal_player_id),
      headings:           { en: title },
      contents:           { en: message },
      data:               dataPayload,
      ...(link_url ? { url: link_url } : {}),
      // Rich image for banner/offer pushes across platforms
      ...(image_url
        ? {
            big_picture:        image_url, // Android
            chrome_web_image:   image_url, // Chrome / web push
            ios_attachments:    { image: image_url },
            huawei_big_picture: image_url,
          }
        : {}),
    };

    let batchOk = false;
    try {
      const resp = await fetch(ONESIGNAL_URL, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Key ${audience === "staff" ? STAFF_API_KEY : ONESIGNAL_API_KEY}`,
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

    // Per-recipient log rows (bulk insert, mirrors send-push logging).
    // Customer sends key on customer_id, staff sends on staff_user_id.
    const logRows = batch.map((r) => ({
      customer_id:       audience === "staff" ? null : r.customer_id,
      staff_user_id:     audience === "staff"
        ? (r as Recipient & { staff_user_id?: string }).staff_user_id ?? null
        : null,
      notification_type: `broadcast_${campaign_type}`,
      title,
      message,
      sent_at:           new Date().toISOString(),
      delivery_status:   batchOk ? "sent" : "failed",
    }));
    const { error: logErr } = await supabase.from("push_notifications_log").insert(logRows);
    if (logErr) console.error("Log insert error:", logErr.message);
  }

  // ── 4. Finalise campaign row ────────────────────────────────────────────
  const status = sentCount > 0 ? "sent" : "failed";
  await supabase
    .from("push_campaigns")
    .update({
      status,
      recipients_targeted: targets.length,
      recipients_sent:     sentCount,
      sent_at:             new Date().toISOString(),
      ...(lastError ? { error: lastError } : {}),
    })
    .eq("id", campaign.id);

  return json({
    campaign_id: campaign.id,
    targeted:    targets.length,
    sent:        sentCount,
    ...(lastError ? { error: lastError } : {}),
  }, status === "failed" ? 502 : 200);
});

async function failCampaign(id: string, error: string): Promise<void> {
  await supabase
    .from("push_campaigns")
    .update({ status: "failed", error })
    .eq("id", id);
}

async function getOneSignalReachableCount(): Promise<number | null> {
  try {
    // Count only devices that actually hold a push subscription
    // (notification_types > 0). Records with null/negative values exist in
    // OneSignal but cannot receive anything — counting them is misleading.
    let offset = 0;
    let reachable = 0;
    for (let page = 0; page < 10; page++) {
      const response = await fetch(
        `https://onesignal.com/api/v1/players?app_id=${encodeURIComponent(ONESIGNAL_APP_ID)}&limit=300&offset=${offset}`,
        { headers: { "Authorization": `Key ${ONESIGNAL_API_KEY}` } },
      );
      if (!response.ok) {
        console.error("OneSignal device count error:", response.status, await response.text());
        return null;
      }
      const result = await response.json() as {
        total_count?: number;
        players?: { notification_types?: number | null; invalid_identifier?: boolean }[];
      };
      const players = result.players ?? [];
      reachable += players.filter(
        (p) => !p.invalid_identifier && typeof p.notification_types === "number" && p.notification_types > 0,
      ).length;
      offset += players.length;
      if (players.length === 0 || offset >= (result.total_count ?? 0)) break;
    }
    return reachable;
  } catch (error) {
    console.error("OneSignal device count failed:", String(error));
    return null;
  }
}


function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
