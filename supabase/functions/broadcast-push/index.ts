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
 *   link_url         : string   (optional — customer pushes show it as a button on
 *                                 the Insider home screen; staff pushes open it on tap)
 *   offer_code       : string   (optional — forwarded in data payload)
 *   offer_expires_at : ISO date (optional — forwarded in data payload)
 *
 * Returns { campaign_id, targeted, sent, error? }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { mirrorToWhatsApp } from "../_shared/whatsapp-mirror.ts";
import { mirrorStaffAlertToWhatsApp } from "../_shared/staff-whatsapp.ts";

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

// Tapping a customer broadcast opens the Insider home screen, where the push
// stays on show for 24 hours (see push_notifications_log.expires_at).
const PWA_URL = Deno.env.get("PWA_URL") ?? "https://homedecorinsider.lovable.app";
const IN_APP_TTL_MS = 24 * 60 * 60 * 1000;

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
    // Staff reach comes from our own device table.
    const { count: staffReachable } = await supabase
      .from("staff_push_devices")
      .select("id", { count: "exact", head: true })
      .eq("push_enabled", true);

    // Customer reach is counted from the same place a broadcast sends to: the
    // push tokens the Insider app saved on app_users. OneSignal's legacy
    // /players endpoint returns nothing for apps on its User Model, which is
    // what left this badge stuck at 0 while broadcasts were being delivered.
    const { data: tokenRows, error: tokenErr } = await supabase
      .from("app_users")
      .select("onesignal_player_id")
      .not("onesignal_player_id", "is", null);
    if (tokenErr) {
      console.error("Could not count Insider push tokens:", tokenErr.message);
      return json({ error: "Could not read registered Insider devices." }, 502);
    }
    const customerReachable = new Set(
      (tokenRows ?? []).map((r) => r.onesignal_player_id as string),
    ).size;

    // Unreachable customers: no saved token, or the browser said no / never
    // answered. A saved token with a blank push_permission is an account that
    // registered before permission tracking existed — it is reachable.
    const { count: needsOptIn } = await supabase
      .from("app_users")
      .select("id", { count: "exact", head: true })
      .or("onesignal_player_id.is.null,push_permission.in.(denied,default)");

    return json({
      reachable: customerReachable,
      staff_reachable: staffReachable ?? 0,
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

  // A staff broadcast also goes to WhatsApp for the desk roles (sales,
  // service_head, accounts — see staff-whatsapp.ts), including
  // those who never connected a phone for push. Runs alongside the push.
  let staffWhatsApp: Promise<number> = Promise.resolve(0);
  if (audience === "staff") {
    staffWhatsApp = (async () => {
      const { data: staffRows, error: staffErr } = await supabase.from("user_roles").select("user_id");
      if (staffErr) throw new Error(staffErr.message);
      return mirrorStaffAlertToWhatsApp(
        supabase,
        (staffRows ?? []).map((r) => r.user_id as string),
        { type: `broadcast_${campaign_type}`, title, message },
      );
    })().catch((e) => {
      console.error("Staff WhatsApp broadcast failed:", String(e));
      return 0;
    });
  }

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

  // Where a tap lands. Customers go to the Insider home screen with this
  // campaign highlighted; any link_url becomes a button on that card. Staff
  // keep the old behaviour of opening link_url directly.
  const clickUrl = audience === "staff"
    ? (link_url || undefined)
    : `${PWA_URL}/home?push=${campaign.id}`;

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
      ...(clickUrl ? { url: clickUrl } : {}),
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

    // The segment send has no per-device list, so give every Insider customer
    // the in-app copy — otherwise the home screen would have nothing to show
    // when they tap the push. The nudge is about switching notifications on
    // and has nothing to show in-app.
    if (!isReengagement && sentCount > 0) {
      await logInAppCopies(campaign.id, {
        campaign_type, title, message, image_url, link_url, offer_code, offer_expires_at,
      });
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
    const whatsappSent = await staffWhatsApp;
    return json(
      { campaign_id: campaign.id, targeted: 0, sent: 0, whatsapp_sent: whatsappSent, error: err },
      whatsappSent > 0 ? 200 : 502,
    );
  }

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const payload: Record<string, unknown> = {
      app_id:             audience === "staff" ? STAFF_APP_ID : ONESIGNAL_APP_ID,
      include_player_ids: batch.map((r) => r.onesignal_player_id),
      headings:           { en: title },
      contents:           { en: message },
      data:               dataPayload,
      ...(clickUrl ? { url: clickUrl } : {}),
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
    const nowIso = new Date().toISOString();
    const logRows = batch.map((r) => ({
      customer_id:       audience === "staff" ? null : r.customer_id,
      staff_user_id:     audience === "staff"
        ? (r as Recipient & { staff_user_id?: string }).staff_user_id ?? null
        : null,
      notification_type: `broadcast_${campaign_type}`,
      title,
      message,
      sent_at:           nowIso,
      // In-app feed fields — the Insider app shows these for 24 hours.
      image_url:         image_url || null,
      link_url:          link_url || null,
      offer_code:        offer_code || null,
      offer_expires_at:  offer_expires_at || null,
      campaign_id:       campaign.id,
      expires_at:        new Date(Date.now() + IN_APP_TTL_MS).toISOString(),
      delivery_status:   batchOk ? "sent" : "failed",
    }));
    const { error: logErr } = await supabase.from("push_notifications_log").insert(logRows);
    if (logErr) console.error("Log insert error:", logErr.message);

    // Mirror the same notification on WhatsApp for customer audiences.
    if (audience !== "staff") {
      try {
        await mirrorToWhatsApp(
          supabase,
          batch
            .filter((r) => !!r.customer_id)
            .map((r) => ({ customer_id: r.customer_id as string, title, message })),
        );
      } catch (e) {
        console.error("WhatsApp mirror failed:", String(e));
      }
    }
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

  const whatsappSent = await staffWhatsApp;
  return json({
    campaign_id:   campaign.id,
    targeted:      targets.length,
    sent:          sentCount,
    ...(audience === "staff" ? { whatsapp_sent: whatsappSent } : {}),
    ...(lastError ? { error: lastError } : {}),
  }, status === "failed" && whatsappSent === 0 ? 502 : 200);
});

type InAppFields = {
  campaign_type: string;
  title: string;
  message: string;
  image_url?: string;
  link_url?: string;
  offer_code?: string;
  offer_expires_at?: string;
};

/** One push_notifications_log row per Insider customer, shown in-app for 24 hours. */
async function logInAppCopies(campaignId: string, f: InAppFields): Promise<void> {
  const { data, error } = await supabase
    .from("app_users")
    .select("customer_id")
    .not("customer_id", "is", null);
  if (error) {
    console.error("In-app copy recipients error:", error.message);
    return;
  }

  const customerIds = [...new Set((data ?? []).map((r) => r.customer_id as string))];
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + IN_APP_TTL_MS).toISOString();
  const rows = customerIds.map((customer_id) => ({
    customer_id,
    notification_type: `broadcast_${f.campaign_type}`,
    title:             f.title,
    message:           f.message,
    sent_at:           nowIso,
    image_url:         f.image_url || null,
    link_url:          f.link_url || null,
    offer_code:        f.offer_code || null,
    offer_expires_at:  f.offer_expires_at || null,
    campaign_id:       campaignId,
    expires_at:        expiresIso,
    delivery_status:   "sent",
  }));

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const { error: logErr } = await supabase
      .from("push_notifications_log")
      .insert(rows.slice(i, i + BATCH_SIZE));
    if (logErr) console.error("In-app copy insert error:", logErr.message);
  }
}

async function failCampaign(id: string, error: string): Promise<void> {
  await supabase
    .from("push_campaigns")
    .update({ status: "failed", error })
    .eq("id", id);
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
