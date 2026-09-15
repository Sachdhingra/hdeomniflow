// Sends one step of the quick-reply conversation flow and keeps the lead board
// in sync. Shared by nurture-engine (opens a conversation) and twilio-webhook
// (answers a tap instantly, like a chat bot).
//
// Every send goes through here so the guard rails hold in both paths:
// opt-out, snooze, quiet hours, per-lead daily cap and no repeat of the same
// question inside 24h.
import {
  buildContentVariables,
  getQuickReplyStep,
  type QuickReplyStep,
} from "./quick-reply-flow.ts";

/** Max automated quick-reply messages to one lead in a day, both paths combined. */
export const DAILY_STEP_CAP = 6;

/** Business-initiated sends stay inside these IST hours. */
const QUIET_HOURS_START_IST = 21; // 9pm
const QUIET_HOURS_END_IST = 9; // 9am

export interface QuickReplyLead {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  liked_product?: string | null;
  product_viewed?: string | null;
  stated_need?: string | null;
  category?: string | null;
  assigned_to?: string | null;
  created_by?: string | null;
  conversation_message_count?: number | null;
  qr_opted_out?: boolean | null;
  qr_snooze_until?: string | null;
}

export type SendSource = "automatic" | "flow_reply" | "manual";

export interface SendStepResult {
  sent: boolean;
  /** Present when we deliberately did not send. Never an error. */
  skipped?:
    | "opted_out"
    | "snoozed"
    | "quiet_hours"
    | "daily_cap"
    | "duplicate_24h"
    | "unknown_step"
    | "template_not_configured";
  error?: string;
  messageId?: string;
  leadMessageId?: string;
}

const SHOWROOM_NAME = "Dehradun";

const CATEGORY_INTEREST: Record<string, string> = {
  sofa: "a new sofa",
  coffee_table: "a coffee table",
  almirah: "an almirah / wardrobe",
  dining: "a dining set",
  mattress: "a mattress",
  bed: "a bed",
  kitchen: "a modular kitchen",
  chair: "a chair",
  office_table: "an office table",
  kiosk: "furniture for your home",
  others: "furniture for your home",
};

function clean(v?: string | null): string {
  const s = (v || "").trim();
  if (!s || s.toLowerCase() === "null" || s.length < 2) return "";
  return s;
}

export function firstNameOf(name?: string | null): string {
  const s = (name || "").trim().replace(/\s+(s i f|old data)\b.*$/i, "");
  const part = s.split(/\s+/)[0] || "";
  if (!part) return "there";
  return part.charAt(0).toUpperCase() + part.slice(1);
}

export function interestOf(lead: QuickReplyLead): string {
  const raw =
    clean(lead.liked_product) ||
    clean(lead.product_viewed) ||
    clean(lead.stated_need) ||
    CATEGORY_INTEREST[(lead.category || "").toLowerCase()] ||
    "furniture for your home";
  return raw.length > 60 ? raw.slice(0, 57).trim() + "..." : raw;
}

/** IST hour (UTC+5:30) for the given instant. */
export function istHour(now: Date): number {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCHours();
}

export function isQuietHour(now: Date): boolean {
  const h = istHour(now);
  return h >= QUIET_HOURS_START_IST || h < QUIET_HOURS_END_IST;
}

/**
 * Twilio Content SID for a step. The DB registry is authoritative so an admin
 * can paste a SID the moment Meta approves the template; the env var is a
 * fallback for local runs.
 */
export async function resolveContentSid(
  supabase: any,
  stepKey: string,
  cache?: Map<string, string | null>,
): Promise<string | null> {
  if (cache?.has(stepKey)) return cache.get(stepKey) ?? null;

  let sid: string | null = null;
  const { data } = await supabase
    .from("whatsapp_quick_reply_steps")
    .select("content_sid, is_active")
    .eq("step_key", stepKey)
    .maybeSingle();
  if (data?.is_active !== false) sid = clean(data?.content_sid) || null;

  if (!sid) {
    const envKey = "WA_QR_SID_" + stepKey.replace(/^qr_/, "").toUpperCase();
    sid = clean(Deno.env.get(envKey)) || null;
  }
  cache?.set(stepKey, sid);
  return sid;
}

/**
 * Send one flow step to one lead.
 *
 * `source` decides how strict we are: "automatic" is business-initiated and
 * obeys quiet hours; "flow_reply" answers a tap the customer just made, so it
 * goes out immediately whatever the clock says.
 */
export async function sendQuickReplyStep(opts: {
  supabase: any;
  supabaseUrl: string;
  serviceKey: string;
  lead: QuickReplyLead;
  stepKey: string;
  source: SendSource;
  now?: Date;
  sidCache?: Map<string, string | null>;
}): Promise<SendStepResult> {
  const { supabase, supabaseUrl, serviceKey, lead, stepKey, source } = opts;
  const now = opts.now ?? new Date();

  const step: QuickReplyStep | null = getQuickReplyStep(stepKey);
  if (!step) return { sent: false, skipped: "unknown_step" };

  if (lead.qr_opted_out) return { sent: false, skipped: "opted_out" };

  if (source === "automatic") {
    if (lead.qr_snooze_until && new Date(lead.qr_snooze_until) > now) {
      return { sent: false, skipped: "snoozed" };
    }
    if (isQuietHour(now)) return { sent: false, skipped: "quiet_hours" };
  }

  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("lead_messages")
    .select("id, flow_step")
    .eq("lead_id", lead.id)
    .eq("message_type", "outbound")
    .not("flow_step", "is", null)
    .gte("created_at", dayAgo);

  const recentRows = recent ?? [];
  if (recentRows.length >= DAILY_STEP_CAP) return { sent: false, skipped: "daily_cap" };
  // Never ask the same question twice in a day — that is what makes people mute us.
  if (recentRows.some((r: { flow_step: string | null }) => r.flow_step === stepKey)) {
    return { sent: false, skipped: "duplicate_24h" };
  }

  const contentSid = await resolveContentSid(supabase, stepKey, opts.sidCache);
  if (!contentSid) {
    await supabase.from("automation_logs").insert({
      lead_id: lead.id,
      event_type: "quick_reply_template_missing",
      success: false,
      error_message: `No Twilio Content SID configured for step "${stepKey}"`,
      details: { step: stepKey, title: step.title, source },
    });
    return { sent: false, skipped: "template_not_configured" };
  }

  const variables = buildContentVariables(step, {
    first_name: firstNameOf(lead.customer_name),
    interest: interestOf(lead),
    showroom: SHOWROOM_NAME,
  });

  const seq = (lead.conversation_message_count ?? 0) + 1;
  const preview = step.question.replace(
    /\{\{\s*(\d+)\s*\}\}/g,
    (_m, n: string) => variables[n] ?? "",
  );

  const { data: inserted } = await supabase
    .from("lead_messages")
    .insert({
      lead_id: lead.id,
      message_type: "outbound",
      message_body: preview,
      template_used: `quick_reply:${stepKey}`,
      status: "pending",
      flow_step: stepKey,
      message_kind: `quick_reply_${stepKey.replace(/^qr_/, "")}`,
      sequence_number: seq,
      outreach_source: source === "manual" ? "manual" : "automatic",
      created_by: lead.assigned_to || lead.created_by || null,
    })
    .select("id")
    .single();

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        phone: lead.customer_phone,
        content_sid: contentSid,
        content_variables: variables,
        lead_id: lead.id,
        lead_message_id: inserted?.id,
        user_id: lead.assigned_to || lead.created_by,
        template_name: `quick_reply:${stepKey}`,
        outreach_source: source === "manual" ? "manual" : "automatic",
        message_kind: `quick_reply_${stepKey.replace(/^qr_/, "")}`,
        flow_step: stepKey,
        message_body: preview,
      }),
    });
    const json = await res.json().catch(() => ({}));
    const ok = res.ok && json?.success === true;

    if (!ok) {
      const error = json?.error || `HTTP ${res.status}`;
      await supabase.from("automation_logs").insert({
        lead_id: lead.id,
        event_type: "quick_reply_send_failed",
        success: false,
        error_message: error,
        details: { step: stepKey, source, phone: lead.customer_phone },
      });
      return { sent: false, error, leadMessageId: inserted?.id };
    }

    await supabase
      .from("leads")
      .update({
        qr_step: stepKey,
        qr_step_sent_at: now.toISOString(),
        conversation_message_count: seq,
        // last_message_at is set by the lead_messages_sync_stats trigger.
      })
      .eq("id", lead.id);

    return { sent: true, messageId: json?.message_id, leadMessageId: inserted?.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (inserted?.id) {
      await supabase
        .from("lead_messages")
        .update({ status: "failed", failed_at: now.toISOString(), error_message: error })
        .eq("id", inserted.id);
    }
    await supabase.from("automation_logs").insert({
      lead_id: lead.id,
      event_type: "quick_reply_send_failed",
      success: false,
      error_message: error,
      details: { step: stepKey, source },
    });
    return { sent: false, error, leadMessageId: inserted?.id };
  }
}
