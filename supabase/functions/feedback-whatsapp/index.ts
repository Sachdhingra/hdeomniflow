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
  buildDrawWinnerMessage,
  buildKioskWelcomeMessage,
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
  attempts: number;
  created_at: string;
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
  const ageHours = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
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

  const composed =
    row.kind === "draw_winner"
      ? await composeWinner(row, settings)
      : await composeWelcome(row, settings);

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
        message_kind: row.kind,
        outreach_source: "feedback_kiosk",
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

  if (row.feedback_id) {
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
      .select("id, feedback_id, phone, kind, draw_id, attempts, created_at")
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
