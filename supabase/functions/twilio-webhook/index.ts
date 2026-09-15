// Twilio inbound webhook — handles WhatsApp messages and delivery status updates.
// Twilio POSTs URL-encoded form data (NOT JSON), so we parse it accordingly.
//
// Quick replies are the main path: an automated message goes out as a template
// with 2-3 buttons, the customer taps one, and WhatsApp returns the exact
// ButtonPayload. That payload is matched against the flow definition — no
// keyword guessing — and the declared effect is applied to the lead board and
// answered instantly with the next question.
//
// Configure in Twilio Console → Messaging → Senders → WhatsApp:
//   Messaging URL (POST)   → https://<project>.supabase.co/functions/v1/twilio-webhook
//   Status Callback URL    → https://<project>.supabase.co/functions/v1/twilio-webhook
//
// Required env vars (Supabase secrets):
//   TWILIO_AUTH_TOKEN  — used to validate X-Twilio-Signature (optional but recommended)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { analyzeInbound } from "../_shared/conversation-analysis.ts";
import { resolveQuickReply, type QuickReplyEffect } from "../_shared/quick-reply-flow.ts";
import { sendQuickReplyStep, type QuickReplyLead } from "../_shared/quick-reply-send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

// Fields the flow needs on top of what the phone-lookup RPC returns.
const LEAD_FLOW_COLUMNS =
  "id, customer_name, customer_phone, liked_product, product_viewed, stated_need, category, " +
  "assigned_to, created_by, conversation_message_count, qr_step, qr_answer_count, qr_opted_out, qr_snooze_until";

// Twilio signature: HMAC-SHA1( authToken, url + sorted-params )
async function verifyTwilioSignature(
  rawUrl: string,
  params: Record<string, string>,
  signature: string | null,
): Promise<boolean> {
  if (!TWILIO_AUTH_TOKEN) return true; // skip when not configured
  if (!signature) return false;

  // Sort params alphabetically and concatenate key+value
  const sorted = Object.keys(params).sort();
  const msg = rawUrl + sorted.map((k) => k + params[k]).join("");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TWILIO_AUTH_TOKEN),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return computed === signature;
}

function normalizePhone(raw: string | undefined | null): string {
  // Strip "whatsapp:" prefix and any non-digit chars except leading +
  const s = (raw || "").replace(/^whatsapp:/i, "").trim();
  return s.replace(/[^\d+]/g, "");
}

async function findLeadByPhone(
  supabase: any,
  phone: string,
): Promise<{ id: string; sequence: number; assigned_to: string | null; created_by: string | null; customer_name: string } | null> {
  if (!phone) return null;
  const { data, error } = await supabase.rpc("find_latest_lead_by_phone", { p_phone: phone });
  if (error) {
    console.error("[twilio-webhook] lead lookup failed:", error);
    return null;
  }
  const match = data?.[0];
  return match ? {
    id: match.id,
    sequence: match.conversation_message_count ?? 0,
    assigned_to: match.assigned_to ?? null,
    created_by: match.created_by ?? null,
    customer_name: match.customer_name || "Customer",
  } : null;
}

/**
 * Which question was this tap answering? The replied-to message SID pins it
 * exactly; the lead's last asked step is the fallback for clients that do not
 * send one.
 */
async function resolveAnsweredStep(
  supabase: any,
  repliedSid: string,
  fallbackStep: string | null,
): Promise<string | null> {
  if (repliedSid) {
    const { data } = await supabase.rpc("find_flow_step_by_provider_message", { p_sid: repliedSid });
    const hit = data?.[0]?.flow_step;
    if (hit) return hit as string;
  }
  return fallbackStep;
}

/** Turn a tapped button's declared effect into lead-board changes. */
function leadUpdatesFor(effect: QuickReplyEffect, now: Date): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (effect.journeyStage) {
    updates.journey_stage = effect.journeyStage;
    updates.journey_stage_auto = true;
    updates.journey_stage_changed_at = now.toISOString();
    if (effect.journeyStage === "cold") updates.cold_at = now.toISOString();
  }
  if (effect.intent) updates.last_inbound_intent = effect.intent;
  if (effect.sentiment) updates.last_inbound_sentiment = effect.sentiment;
  if (effect.concern) {
    updates.last_inbound_concern = effect.concern;
    updates.concern_type = effect.concern;
  }
  if (effect.intent === "objection") {
    updates.barrier_addressed = false;
    updates.objection_type = effect.concern ?? "general";
  }
  if (effect.handoff?.call) updates.needs_personal_call = true;
  if (effect.optOut) {
    updates.qr_opted_out = true;
    updates.qr_step = null;
  }
  if (effect.snoozeDays) {
    updates.qr_snooze_until = new Date(
      now.getTime() + effect.snoozeDays * 24 * 3600 * 1000,
    ).toISOString();
  }
  if (effect.close === "lost") updates.status = "lost";
  return updates;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Twilio always POSTs — ignore other methods
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const rawBody = await req.text();
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

    // Verify Twilio signature when auth token is configured
    if (TWILIO_AUTH_TOKEN) {
      const sig = req.headers.get("x-twilio-signature");
      const reqUrl = req.url;
      if (!(await verifyTwilioSignature(reqUrl, params, sig))) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const messageSid = params["MessageSid"] || "";
    const messageStatus = (params["MessageStatus"] || "").toLowerCase();
    const fromRaw = params["From"] || ""; // e.g. "whatsapp:+919876543210"
    const body = params["Body"] || "";
    // Quick-reply fields. ButtonPayload is the authoritative answer.
    const buttonPayload = (params["ButtonPayload"] || "").trim();
    const buttonText = (params["ButtonText"] || "").trim();
    const repliedSid = (params["OriginalRepliedMessageSid"] || "").trim();

    // ── Delivery/read status update ──────────────────────────────────────────
    // Twilio fires this when MessageStatus is sent/delivered/read/failed/undelivered
    const STATUS_EVENTS = new Set(["sent", "delivered", "read", "failed", "undelivered"]);
    if (STATUS_EVENTS.has(messageStatus)) {
      // recipient_id is the customer's number (the "To" when we sent, now in "To")
      // For status callbacks, "To" = customer, "From" = our Twilio number
      const ts = new Date().toISOString();
      const updates: Record<string, unknown> = {};
      if (messageStatus === "delivered") {
        updates.status = "delivered";
        updates.delivered_at = ts;
      } else if (messageStatus === "read") {
        updates.status = "read";
        updates.read_at = ts;
      } else if (messageStatus === "failed" || messageStatus === "undelivered") {
        updates.status = "failed";
        updates.failed_at = ts;
        updates.error_message = params["ErrorMessage"] || (params["ErrorCode"] ? `Twilio error ${params["ErrorCode"]}` : "delivery failed");
      }
      if (messageSid && Object.keys(updates).length) {
        await supabase.from("lead_messages").update(updates).eq("provider_message_id", messageSid);
        await supabase.from("message_logs").update({ status: updates.status, error_message: updates.error_message || null }).eq("provider_message_id", messageSid);
      }

      // Twilio expects an empty TwiML 200 OK for status callbacks
      return new Response("<Response/>", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // ── Inbound message ──────────────────────────────────────────────────────
    const phone = normalizePhone(fromRaw);
    const numMedia = parseInt(params["NumMedia"] || "0", 10);

    let text = (buttonText || body).trim();
    if (!text && numMedia > 0) {
      const mediaType = (params["MediaContentType0"] || "").split("/")[0];
      text = mediaType === "image" ? "[image]"
           : mediaType === "audio" ? "[audio]"
           : mediaType === "video" ? "[video]"
           : "[media]";
    }
    if (!text) text = "[non-text message]";

    const lead = await findLeadByPhone(supabase, phone);

    if (lead) {
      const now = new Date();
      const seq = (lead.sequence ?? 0) + 1;
      const notifyUser = lead.assigned_to || lead.created_by;

      // Full lead row — the flow needs opt-out, snooze and the pending step.
      const { data: leadRow } = await supabase
        .from("leads")
        .select(LEAD_FLOW_COLUMNS)
        .eq("id", lead.id)
        .maybeSingle();

      const answeredStep = await resolveAnsweredStep(
        supabase,
        repliedSid,
        (leadRow?.qr_step as string | null) ?? null,
      );

      const quickReply = resolveQuickReply({
        stepKey: answeredStep,
        payload: buttonPayload,
        buttonText,
        body,
      });

      // Free-text analysis is still the fallback for customers who type.
      const analysis = analyzeInbound(text);
      const effect = quickReply?.button.effect;

      await supabase.from("lead_messages").insert({
        lead_id: lead.id,
        message_type: "inbound",
        message_body: text.slice(0, 4000),
        status: "delivered",
        sent_at: now.toISOString(),
        response_received: true,
        sentiment: effect?.sentiment ?? analysis.sentiment,
        intent: effect?.intent ?? analysis.intent,
        concern: effect?.concern ?? analysis.concern,
        length_category: analysis.length_category,
        sequence_number: seq,
        provider_message_id: messageSid || null,
        outreach_source: "inbound",
        flow_step: quickReply?.step?.key ?? answeredStep ?? null,
        quick_reply_payload: quickReply?.button.payload ?? null,
        quick_reply_label: quickReply?.button.label ?? null,
      });

      // Common to every inbound: they answered, so the silence counters reset.
      const leadUpdates: Record<string, unknown> = {
        conversation_message_count: seq,
        unanswered_outbound_count: 0,
        dead_lead: false,
        // last_response_at / response_time_minutes are owned by the
        // lead_messages_sync_stats trigger on the insert above.
      };

      if (quickReply && effect) {
        // A tap is an explicit answer — apply exactly what the flow declares.
        Object.assign(leadUpdates, leadUpdatesFor(effect, now));
        leadUpdates.qr_last_payload = quickReply.button.payload;
        leadUpdates.qr_last_label = quickReply.button.label;
        leadUpdates.qr_last_answer_at = now.toISOString();
        leadUpdates.qr_answer_count = ((leadRow?.qr_answer_count as number | null) ?? 0) + 1;
        if (!effect.handoff?.call) leadUpdates.needs_personal_call = false;
      } else {
        // Typed reply — keep the existing keyword analysis.
        leadUpdates.last_inbound_sentiment = analysis.sentiment;
        leadUpdates.last_inbound_concern = analysis.concern;
        leadUpdates.last_inbound_intent = analysis.intent;
        leadUpdates.needs_personal_call = false;
        if (analysis.concern) leadUpdates.concern_type = analysis.concern;
        if (analysis.intent === "objection") {
          leadUpdates.barrier_addressed = false;
          leadUpdates.objection_type = analysis.concern ?? "general";
        }
      }

      await supabase.from("leads").update(leadUpdates).eq("id", lead.id);

      // Staff-facing signal.
      if (notifyUser) {
        await supabase.from("notifications").insert({
          user_id: notifyUser,
          type: quickReply ? "whatsapp_quick_reply" : "whatsapp_reply",
          message: quickReply
            ? `👆 ${lead.customer_name} tapped "${quickReply.button.label}"` +
              (effect?.handoff ? ` — ${effect.handoff.task}` : "")
            : `New WhatsApp reply from ${lead.customer_name}: ${text.slice(0, 120)}`,
          link: "/leads",
        });
      }

      // An alert only when a human actually has something to do.
      const alertType = effect?.handoff ? "quick_reply_action" : "whatsapp_reply";
      const alertMessage = effect?.handoff
        ? `${lead.customer_name} tapped "${quickReply!.button.label}" — ${effect.handoff.task}`
        : `New WhatsApp reply: ${text.slice(0, 160)}`;
      const alertSeverity = effect?.handoff?.severity ?? "info";
      const raiseAlert = !quickReply || !!effect?.handoff;

      if (raiseAlert) {
        const { data: existingAlert } = await supabase.from("lead_alerts")
          .select("id").eq("lead_id", lead.id).eq("alert_type", alertType).eq("resolved", false).limit(1);
        if (!existingAlert?.length) {
          await supabase.from("lead_alerts").insert({
            lead_id: lead.id,
            alert_type: alertType,
            severity: alertSeverity,
            message: alertMessage,
          });
        }
      }

      // Update reply_count on the last outbound variant for A/B tracking
      const { data: lastOut } = await supabase
        .from("lead_messages")
        .select("id, variant, template_id")
        .eq("lead_id", lead.id)
        .eq("message_type", "outbound")
        .order("sent_at", { ascending: false })
        .limit(1);
      if (lastOut?.length && lastOut[0].variant && lastOut[0].template_id) {
        const { data: v } = await supabase
          .from("message_template_variants")
          .select("id")
          .eq("template_id", lastOut[0].template_id)
          .eq("variant_label", lastOut[0].variant)
          .maybeSingle();
        if (v?.id) await supabase.rpc("bump_variant_reply", { _variant_id: v.id });
        await supabase
          .from("lead_messages")
          .update({ response_received: true })
          .eq("id", lastOut[0].id);
      }

      await supabase.from("automation_logs").insert({
        lead_id: lead.id,
        event_type: quickReply ? "quick_reply_received" : "inbound_text_received",
        success: true,
        details: {
          step: quickReply?.step?.key ?? answeredStep ?? null,
          payload: quickReply?.button.payload ?? null,
          matched_by: quickReply?.matchedBy ?? null,
          handoff: effect?.handoff?.task ?? null,
        },
      });

      // Answer the tap right away — this is what makes it feel like a chat.
      if (effect?.next && leadRow && !effect.optOut) {
        const flowLead: QuickReplyLead = {
          ...(leadRow as QuickReplyLead),
          // The row was read before the update above; use the fresh counter.
          conversation_message_count: seq,
          qr_opted_out: false,
        };
        const sendResult = await sendQuickReplyStep({
          supabase,
          supabaseUrl,
          serviceKey: serviceRoleKey,
          lead: flowLead,
          stepKey: effect.next,
          source: "flow_reply",
          now,
        });
        if (!sendResult.sent && notifyUser) {
          // Never leave a customer hanging mid-conversation.
          await supabase.from("lead_alerts").insert({
            lead_id: lead.id,
            alert_type: "quick_reply_stalled",
            severity: "warning",
            message:
              `Could not auto-send the next question to ${lead.customer_name} ` +
              `(${sendResult.skipped ?? sendResult.error}) — reply manually.`,
          });
        }
      }
    } else {
      // Log unmatched inbound for debugging
      await supabase.from("automation_logs").insert({
        event_type: "twilio_inbound_unmatched",
        success: true,
        details: {
          phone,
          text: text.slice(0, 500),
          message_sid: messageSid,
          button_payload: buttonPayload || null,
        },
      });
    }

    // Twilio expects an empty TwiML 200 OK (no auto-reply)
    return new Response("<Response/>", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  } catch (err: unknown) {
    console.error("twilio-webhook error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    const supabase2 = createClient(supabaseUrl, serviceRoleKey);
    await supabase2.from("automation_logs").insert({
      event_type: "twilio_webhook_error",
      success: false,
      error_message: msg,
    });
    // Always return 200 so Twilio doesn't retry indefinitely
    return new Response("<Response/>", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  }
});
