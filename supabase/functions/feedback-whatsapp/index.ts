/**
 * feedback-whatsapp — sends the kiosk WhatsApp messages.
 *
 * Drains public.pending_thank_you_messages:
 *   kind = 'kiosk_welcome' → personalised thank-you + Google review ask + the
 *                            monthly lucky-draw explainer. Queued by the
 *                            AFTER INSERT trigger on customer_feedback, which
 *                            also pokes this function through pg_net, so the
 *                            message lands seconds after the customer types
 *                            their name and number at the kiosk.
 *   kind = 'draw_winner'   → the winner announcement, queued by
 *                            fn_run_monthly_draw().
 *   kind = 'delivery_review' → Google review ask, queued the moment a delivery
 *                            service job is marked completed.
 *   kind = 'website_share' → our website link. Queued when a kiosk review is
 *                            confirmed (sent at once) and after every delivery
 *                            review ask (sent website_share_delay_hours later).
 *
 * A pg_cron job hits this every 5 minutes as a safety net for anything the
 * instant poke missed (pg_net down, function cold-start failure, etc).
 *
 * Auth: x-internal-secret matching LOYALTY_CRON_SECRET, or the service-role key
 * as a bearer token. Never callable by the kiosk itself — the kiosk runs
 * signed-out and must not be able to send WhatsApp messages to any number.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import {
  buildDeliveryReviewMessage,
  buildDrawWinnerMessage,
  buildKioskWelcomeMessage,
  buildWebsiteShareMessage,
  firstName,
} from "../_shared/kiosk-messages.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("LOYALTY_CRON_SECRET") ?? "";
const SEND_WHATSAPP_URL = `${SUPABASE_URL}/functions/v1/send-whatsapp`;

const MAX_ATTEMPTS = 3;
const DEFAULT_BATCH = 25;
/**
 * A welcome message is only worth sending while the visit is still fresh. If a
 * row sat in the queue longer than this (an outage, a misconfigured secret),
 * drop it rather than surprising a customer days later.
 */
const MAX_QUEUE_AGE_HOURS = 24;
/** At most one delivery review ask / one website link per number in this window. */
const REPEAT_WINDOW_DAYS = 30;
/** A negative WhatsApp reply this recent stops a delivery review ask. */
const NEGATIVE_LOOKBACK_DAYS = 7;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

interface QueueRow {
  id: string;
  feedback_id: string | null;
  phone: string;
  kind: string;
  draw_id: string | null;
  service_job_id: string | null;
  lead_id: string | null;
  customer_name: string | null;
  attempts: number;
  created_at: string;
  scheduled_send_time: string;
}

interface Settings {
  businessName: string;
  businessPhone: string;
  reviewUrl: string;
  drawEnabled: boolean;
  drawPrize: string;
  minDrawEntries: number;
  welcomeContentSid: string;
  winnerContentSid: string;
  websiteUrl: string;
  deliveryReviewContentSid: string;
  websiteShareContentSid: string;
}

async function loadSettings(): Promise<Settings> {
  const { data } = await supabase
    .from("app_settings")
    .select("key,value")
    .in("key", [
      "business_name",
      "business_phone",
      "google_review_url",
      "monthly_draw_enabled",
      "monthly_draw_min_entries",
      "monthly_draw_prize",
      "kiosk_welcome_content_sid",
      "draw_winner_content_sid",
      "website_url",
      "delivery_review_content_sid",
      "website_share_content_sid",
    ]);

  const map = new Map<string, string>(
    (data ?? []).map((r: { key: string; value: string }) => [r.key, (r.value ?? "").trim()]),
  );
  const min = parseInt(map.get("monthly_draw_min_entries") ?? "", 10);

  return {
    businessName: map.get("business_name") || "Home Decor Enterprises",
    businessPhone: map.get("business_phone") || "",
    // The placeholder the project ships with is not a real review link.
    reviewUrl: (map.get("google_review_url") || "").includes("REPLACE_ME")
      ? ""
      : map.get("google_review_url") || "",
    drawEnabled: (map.get("monthly_draw_enabled") || "true").toLowerCase() !== "false",
    drawPrize: map.get("monthly_draw_prize") || "",
    minDrawEntries: Number.isFinite(min) && min > 0 ? min : 50,
    welcomeContentSid: map.get("kiosk_welcome_content_sid") || "",
    winnerContentSid: map.get("draw_winner_content_sid") || "",
    websiteUrl: map.get("website_url") || "https://hdefurniture.netlify.app",
    deliveryReviewContentSid: map.get("delivery_review_content_sid") || "",
    websiteShareContentSid: map.get("website_share_content_sid") || "",
  };
}

/** Has this phone number ever confirmed a Google review before? */
async function hasReviewedBefore(phone: string, exceptFeedbackId: string | null): Promise<boolean> {
  let query = supabase
    .from("customer_feedback")
    .select("id")
    .eq("customer_phone", phone)
    .eq("reviewed_on_google", true)
    .limit(1);
  if (exceptFeedbackId) query = query.neq("id", exceptFeedbackId);
  const { data } = await query;
  return (data?.length ?? 0) > 0;
}

interface Composed {
  message: string;
  contentSid?: string;
  contentVariables?: Record<string, string>;
  recipientName: string;
  /** Logged against the lead's conversation when known. */
  leadId?: string | null;
}

/** A queue row that should not be sent, with the reason recorded on it. */
interface Skip {
  skip: string;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** The lead for this row: the job's source lead, else a lead with the same number. */
async function resolveLeadId(row: QueueRow): Promise<string | null> {
  if (row.lead_id) return row.lead_id;
  if (row.service_job_id) {
    const { data: job } = await supabase
      .from("service_jobs")
      .select("source_lead_id")
      .eq("id", row.service_job_id)
      .maybeSingle();
    if (job?.source_lead_id) return job.source_lead_id;
  }
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("customer_phone", row.phone)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return lead?.id ?? null;
}

/**
 * Has the customer sent a clearly negative WhatsApp reply since `since`?
 * Inbound message rows are the source of truth for replies.
 */
async function repliedNegatively(leadId: string | null, since: string): Promise<boolean> {
  if (!leadId) return false;
  const { data } = await supabase
    .from("lead_messages")
    .select("id")
    .eq("lead_id", leadId)
    .eq("message_type", "inbound")
    .gte("created_at", since)
    .or("sentiment.eq.negative,intent.eq.not_interested")
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/** Was a message of this kind already sent to this number recently? */
async function sentRecently(phone: string, kind: string, exceptId: string): Promise<boolean> {
  const { data } = await supabase
    .from("pending_thank_you_messages")
    .select("id")
    .eq("phone", phone)
    .eq("kind", kind)
    .eq("status", "sent")
    .neq("id", exceptId)
    .gte("sent_at", daysAgo(REPEAT_WINDOW_DAYS))
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function composeDeliveryReview(row: QueueRow, settings: Settings): Promise<Composed | Skip> {
  if (!settings.reviewUrl) return { skip: "google_review_url is not set" };

  const { data: job } = await supabase
    .from("service_jobs")
    .select("customer_name, status, deleted_at")
    .eq("id", row.service_job_id ?? "")
    .maybeSingle();
  if (!job || job.deleted_at) return { skip: "delivery job no longer exists" };
  if (job.status !== "completed") return { skip: "delivery is no longer marked completed" };

  if (await hasReviewedBefore(row.phone, null)) return { skip: "customer has already reviewed us" };
  if (await sentRecently(row.phone, "delivery_review", row.id)) {
    return { skip: `review already requested in the last ${REPEAT_WINDOW_DAYS} days` };
  }

  const leadId = await resolveLeadId(row);
  if (await repliedNegatively(leadId, daysAgo(NEGATIVE_LOOKBACK_DAYS))) {
    return { skip: "customer recently replied negatively — no review ask" };
  }

  const name = job.customer_name || row.customer_name || "";
  return {
    message: buildDeliveryReviewMessage({
      customerName: name,
      businessName: settings.businessName,
      businessPhone: settings.businessPhone,
      reviewUrl: settings.reviewUrl,
    }),
    recipientName: name,
    leadId,
    contentSid: settings.deliveryReviewContentSid || undefined,
    contentVariables: settings.deliveryReviewContentSid
      ? { "1": firstName(name), "2": settings.reviewUrl }
      : undefined,
  };
}

async function composeWebsiteShare(row: QueueRow, settings: Settings): Promise<Composed | Skip> {
  if (!settings.websiteUrl) return { skip: "website_url is not set" };
  if (await sentRecently(row.phone, "website_share", row.id)) {
    return { skip: `website already shared in the last ${REPEAT_WINDOW_DAYS} days` };
  }

  const leadId = await resolveLeadId(row);
  // Anything negative since the review ask went out means we stay quiet.
  if (await repliedNegatively(leadId, row.created_at)) {
    return { skip: "customer replied negatively — website not shared" };
  }

  let reviewConfirmed = false;
  let name = row.customer_name || "";
  if (row.feedback_id) {
    const { data: fb } = await supabase
      .from("customer_feedback")
      .select("customer_name, reviewed_on_google")
      .eq("id", row.feedback_id)
      .maybeSingle();
    reviewConfirmed = fb?.reviewed_on_google === true;
    name = fb?.customer_name || name;
  }

  return {
    message: buildWebsiteShareMessage({
      customerName: name,
      businessName: settings.businessName,
      websiteUrl: settings.websiteUrl,
      reviewConfirmed,
    }),
    recipientName: name,
    leadId,
    contentSid: settings.websiteShareContentSid || undefined,
    contentVariables: settings.websiteShareContentSid
      ? { "1": firstName(name), "2": settings.websiteUrl }
      : undefined,
  };
}

async function composeWelcome(row: QueueRow, settings: Settings): Promise<Composed | null> {
  if (!row.feedback_id) return null;
  const { data: fb } = await supabase
    .from("customer_feedback")
    .select("id, customer_name, customer_phone, overall_rating, reviewed_on_google")
    .eq("id", row.feedback_id)
    .maybeSingle();
  if (!fb) return null;

  const alreadyReviewed =
    fb.reviewed_on_google === true ||
    (await hasReviewedBefore(fb.customer_phone, fb.id));

  const message = buildKioskWelcomeMessage({
    customerName: fb.customer_name,
    businessName: settings.businessName,
    businessPhone: settings.businessPhone,
    reviewUrl: settings.reviewUrl,
    alreadyReviewed,
    overallRating: fb.overall_rating,
    drawEnabled: settings.drawEnabled,
    drawPrize: settings.drawPrize,
    minDrawEntries: settings.minDrawEntries,
  });

  return {
    message,
    recipientName: fb.customer_name,
    contentSid: settings.welcomeContentSid || undefined,
    contentVariables: settings.welcomeContentSid
      ? { "1": firstName(fb.customer_name), "2": settings.reviewUrl }
      : undefined,
  };
}

async function composeWinner(row: QueueRow, settings: Settings): Promise<Composed | null> {
  if (!row.draw_id) return null;
  const { data: draw } = await supabase
    .from("monthly_draws")
    .select("draw_month, winner_name, total_entries, prize")
    .eq("id", row.draw_id)
    .maybeSingle();
  if (!draw) return null;

  const prize = draw.prize || settings.drawPrize;
  const message = buildDrawWinnerMessage({
    customerName: draw.winner_name || "",
    businessName: settings.businessName,
    businessPhone: settings.businessPhone,
    drawMonth: draw.draw_month,
    totalEntries: draw.total_entries,
    prize,
  });

  return {
    message,
    recipientName: draw.winner_name || "",
    contentSid: settings.winnerContentSid || undefined,
    contentVariables: settings.winnerContentSid
      ? {
          "1": firstName(draw.winner_name),
          "2": String(draw.draw_month).slice(0, 7),
          "3": prize || "a special gift",
        }
      : undefined,
  };
}

async function sendOne(row: QueueRow, settings: Settings): Promise<"sent" | "failed" | "skipped"> {
  // Measured from when the row was due, so a deliberately delayed message
  // (the website share) is not dropped for waiting as designed.
  const dueAt = new Date(row.scheduled_send_time || row.created_at).getTime();
  const ageHours = (Date.now() - dueAt) / 3_600_000;
  if (ageHours > MAX_QUEUE_AGE_HOURS) {
    await supabase
      .from("pending_thank_you_messages")
      .update({
        status: "cancelled",
        error_message: `stale: queued ${Math.round(ageHours)}h ago`,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    console.warn(`[feedback-whatsapp] dropping stale ${row.kind} for ${row.phone}`);
    return "skipped";
  }

  const result =
    row.kind === "draw_winner"
      ? await composeWinner(row, settings)
      : row.kind === "delivery_review"
        ? await composeDeliveryReview(row, settings)
        : row.kind === "website_share"
          ? await composeWebsiteShare(row, settings)
          : await composeWelcome(row, settings);

  if (result && "skip" in result) {
    await supabase
      .from("pending_thank_you_messages")
      .update({
        status: "cancelled",
        error_message: result.skip,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    console.log(`[feedback-whatsapp] skipped ${row.kind} for ${row.phone}: ${result.skip}`);
    return "skipped";
  }
  const composed = result;

  if (!composed) {
    // The feedback or draw row is gone — nothing left to say.
    await supabase
      .from("pending_thank_you_messages")
      .update({
        status: "cancelled",
        error_message: "source record no longer exists",
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return "skipped";
  }

  const attempts = (row.attempts ?? 0) + 1;
  let ok = false;
  let error = "";
  let providerMessageId: string | null = null;

  try {
    const res = await fetch(SEND_WHATSAPP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // send-whatsapp accepts the service-role key as a bearer token.
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        phone: row.phone,
        message: composed.message,
        user_name: composed.recipientName,
        content_sid: composed.contentSid,
        content_variables: composed.contentVariables,
        lead_id: composed.leadId ?? undefined,
        message_kind: row.kind,
        outreach_source: row.service_job_id ? "delivery_review" : "feedback_kiosk",
      }),
    });
    const body = await res.json().catch(() => ({}));
    ok = res.ok && body?.success === true;
    error = ok ? "" : body?.error || `HTTP ${res.status}`;
    providerMessageId = body?.message_id ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const now = new Date().toISOString();
  await supabase
    .from("pending_thank_you_messages")
    .update({
      // Keep retrying a transient failure until MAX_ATTEMPTS, then give up so
      // the queue does not grow forever.
      status: ok ? "sent" : attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      message: composed.message,
      attempts,
      last_attempt_at: now,
      sent_at: ok ? now : null,
      provider_message_id: providerMessageId,
      error_message: ok ? null : error,
    })
    .eq("id", row.id);

  if (row.feedback_id && row.kind === "kiosk_welcome") {
    await supabase
      .from("customer_feedback")
      .update({
        thank_you_template: composed.message,
        thank_you_sent: ok,
        thank_you_sent_at: ok ? now : null,
      })
      .eq("id", row.feedback_id);
  }

  if (ok && row.draw_id) {
    await supabase
      .from("monthly_draws")
      .update({ winner_notified_at: now })
      .eq("id", row.draw_id);
  }

  if (!ok) console.error(`[feedback-whatsapp] ${row.kind} → ${row.phone} failed: ${error}`);
  return ok ? "sent" : "failed";
}

function authorized(req: Request): boolean {
  const headerSecret = req.headers.get("x-internal-secret") ?? "";
  if (INTERNAL_SECRET && headerSecret === INTERNAL_SECRET) return true;
  const auth = req.headers.get("Authorization") ?? "";
  return auth.startsWith("Bearer ") && auth.slice(7).trim() === SERVICE_ROLE;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!authorized(req)) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(Number(body?.limit) || DEFAULT_BATCH, 100);

    // The trigger passes the queue_id of the row it just created, but there is
    // no need to single it out: draining everything pending, oldest first,
    // sends that row in this same invocation and clears any backlog with it.
    const { data: rows, error } = await supabase
      .from("pending_thank_you_messages")
      .select(
        "id, feedback_id, phone, kind, draw_id, service_job_id, lead_id, customer_name, attempts, created_at, scheduled_send_time",
      )
      .eq("status", "pending")
      .lte("scheduled_send_time", new Date().toISOString())
      .lt("attempts", MAX_ATTEMPTS)
      .order("scheduled_send_time", { ascending: true })
      .limit(limit);
    if (error) throw error;

    const queue = (rows ?? []) as QueueRow[];
    if (queue.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settings = await loadSettings();
    const results = { sent: 0, failed: 0, skipped: 0 };
    for (const row of queue) {
      const outcome = await sendOne(row, settings);
      results[outcome] += 1;
    }

    console.log("[feedback-whatsapp] batch done", results);
    return new Response(JSON.stringify({ success: true, processed: queue.length, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[feedback-whatsapp] error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
