/**
 * broadcast-push — Admin-only broadcast push notifications for the Insider app.
 *
 * Sends a push (text / banner / offer) to ALL app customers who have push
 * enabled, via OneSignal. Only staff with the `admin` role may invoke it —
 * unlike send-push, a plain staff JWT is not enough.
 *
 * POST body:
 *   campaign_type    : "text" | "banner" | "offer"   (required)
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
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
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

  const { campaign_type, title, message, image_url, link_url, offer_code, offer_expires_at } = body;

  if (!campaign_type || !title || !message) {
    return json({ error: "Missing required fields: campaign_type, title, message" }, 400);
  }
  if (!["text", "banner", "offer"].includes(campaign_type)) {
    return json({ error: "campaign_type must be one of: text, banner, offer" }, 400);
  }

  // ── 1. Create the campaign row ──────────────────────────────────────────
  const { data: campaign, error: campErr } = await supabase
    .from("push_campaigns")
    .insert({
      campaign_type,
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

  // ── 2. Collect all push-enabled app customers ───────────────────────────
  const { data: recipients, error: recErr } = await supabase
    .from("app_users")
    .select("customer_id, onesignal_player_id")
    .eq("push_enabled", true)
    .not("onesignal_player_id", "is", null);

  if (recErr) {
    await failCampaign(campaign.id, recErr.message);
    return json({ error: recErr.message }, 500);
  }

  // De-duplicate player IDs (a customer re-registering can leave repeats)
  const seen = new Set<string>();
  const targets = (recipients ?? []).filter((r) => {
    const pid = r.onesignal_player_id as string;
    if (seen.has(pid)) return false;
    seen.add(pid);
    return true;
  });

  if (targets.length === 0) {
    await supabase
      .from("push_campaigns")
      .update({ status: "sent", recipients_targeted: 0, recipients_sent: 0, sent_at: new Date().toISOString() })
      .eq("id", campaign.id);
    return json({ campaign_id: campaign.id, targeted: 0, sent: 0 });
  }

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

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const payload: Record<string, unknown> = {
      app_id:             ONESIGNAL_APP_ID,
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

    // Per-customer log rows (bulk insert, mirrors send-push logging)
    const logRows = batch.map((r) => ({
      customer_id:       r.customer_id,
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
