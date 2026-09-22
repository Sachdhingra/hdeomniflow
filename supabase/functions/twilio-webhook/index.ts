// Twilio inbound webhook — handles WhatsApp messages and delivery status updates.
// Twilio POSTs URL-encoded form data (NOT JSON), so we parse it accordingly.
//
// Configure in Twilio Console → Messaging → Senders → WhatsApp:
//   Messaging URL (POST)   → https://<project>.supabase.co/functions/v1/twilio-webhook
//   Status Callback URL    → https://<project>.supabase.co/functions/v1/twilio-webhook
//
// Required env vars (Supabase secrets):
//   TWILIO_AUTH_TOKEN  — used to validate X-Twilio-Signature (optional but recommended)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { analyzeInbound, detectBinaryReply } from "../_shared/conversation-analysis.ts";
import { normalizeIndianPhone } from "../_shared/indian-phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Twilio signature: HMAC-SHA1( authToken, url + sorted-params )
async function verifyTwilioSignature(
  rawUrl: string,
  params: Record<string, string>,
  signature: string | null,
): Promise<boolean> {
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) return false;
  if (!signature) return false;

  // Sort params alphabetically and concatenate key+value
  const sorted = Object.keys(params).sort();
  const msg = rawUrl + sorted.map((k) => k + params[k]).join("");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return computed === signature;
}

function normalizePhone(raw: string | undefined | null): string {
  return normalizeIndianPhone(raw);
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

    // Twilio signs the public callback URL, while the edge runtime can expose a
    // rewritten request URL. Validate both canonical forms without weakening auth.
    const sig = req.headers.get("x-twilio-signature");
    const callbackUrls = [
      `${supabaseUrl}/functions/v1/twilio-webhook`,
      req.url,
    ];
    const signatureValid = (await Promise.all(
      [...new Set(callbackUrls)].map((url) => verifyTwilioSignature(url, params, sig)),
    )).some(Boolean);
    if (!signatureValid) {
      console.error("[twilio-webhook] invalid signature", {
        hasSignature: Boolean(sig),
        messageSid: params["MessageSid"] || params["SmsSid"] || null,
      });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageSid = params["MessageSid"] || "";
    const messageStatus = (params["MessageStatus"] || "").toLowerCase();
    const fromRaw = params["From"] || ""; // e.g. "whatsapp:+919876543210"
    const toRaw = params["To"] || "";     // e.g. "whatsapp:+14155238886"
    const body = params["Body"] || "";
    console.log("[twilio-webhook] callback", {
      messageSid: messageSid || null,
      direction: params["Direction"] || "inbound",
      status: messageStatus || null,
      hasBody: Boolean(body),
    });

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
        const { error: leadStatusError } = await supabase.from("lead_messages").update(updates).eq("provider_message_id", messageSid);
        if (leadStatusError) console.error("[twilio-webhook] lead status update failed:", leadStatusError);
        const { error: messageLogError } = await supabase.from("message_logs").update({ status: updates.status, error_message: updates.error_message || null }).eq("provider_message_id", messageSid);
        if (messageLogError) console.error("[twilio-webhook] message log update failed:", messageLogError);
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

    const buttonReply = (params["ButtonPayload"] || params["ButtonText"] || "").trim();
    let text = buttonReply || body.trim();
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
      if (messageSid) {
        const { data: existingInbound, error: existingInboundError } = await supabase
          .from("lead_messages")
          .select("id")
          .eq("provider_message_id", messageSid)
          .limit(1);
        if (existingInboundError) {
          console.error("[twilio-webhook] inbound duplicate check failed:", existingInboundError);
          throw existingInboundError;
        }
        if (existingInbound?.length) {
          console.log("[twilio-webhook] duplicate inbound accepted", { messageSid });
          return new Response("<Response/>", {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "text/xml" },
          });
        }
      }

      const analysis = analyzeInbound(text);
      const binaryReply = detectBinaryReply(text);
      const seq = (lead.sequence ?? 0) + 1;
      const now = new Date().toISOString();

      const { error: inboundInsertError } = await supabase.from("lead_messages").insert({
        lead_id: lead.id,
        message_type: "inbound",
        message_body: text.slice(0, 4000),
        status: "delivered",
        sent_at: now,
        response_received: true,
        sentiment: analysis.sentiment,
        intent: analysis.intent,
        concern: analysis.concern,
        length_category: analysis.length_category,
        sequence_number: seq,
        provider_message_id: messageSid || null,
        outreach_source: "inbound",
      });
      if (inboundInsertError) {
        console.error("[twilio-webhook] inbound insert failed:", inboundInsertError);
        throw inboundInsertError;
      }

      const leadUpdates: Record<string, unknown> = {
        last_inbound_sentiment: analysis.sentiment,
        last_inbound_concern: analysis.concern,
        last_inbound_intent: analysis.intent,
        conversation_message_count: seq,
        unanswered_outbound_count: 0,
        concern_type: analysis.concern ?? undefined,
        ...(analysis.intent === "objection"
          ? { barrier_addressed: false, objection_type: analysis.concern ?? "general" }
          : {}),
      };
      if (["interested", "ready_to_buy"].includes(analysis.intent)) {
        leadUpdates.needs_personal_call = false;
        leadUpdates.dead_lead = false;
        leadUpdates.automation_paused = false;
      }
      if (binaryReply === "yes") {
        leadUpdates.follow_up_reply_state = "interested";
        leadUpdates.follow_up_reply_at = now;
      } else if (binaryReply === "no") {
        leadUpdates.follow_up_reply_state = "reason_requested";
        leadUpdates.follow_up_reply_at = now;
        leadUpdates.automation_paused = true;
      }
      const { error: leadUpdateError } = await supabase.from("leads").update(leadUpdates).eq("id", lead.id);
      if (leadUpdateError) console.error("[twilio-webhook] lead reply update failed:", leadUpdateError);

      const notifyUser = lead.assigned_to || lead.created_by;
      if (notifyUser) {
        const notificationMessage = binaryReply === "yes"
          ? `🔥 ${lead.customer_name} is interested — reply now`
          : binaryReply === "no"
            ? `${lead.customer_name} said no — reason requested for salesperson review`
            : `New WhatsApp reply from ${lead.customer_name}: ${text.slice(0, 120)}`;
        const { error: notificationError } = await supabase.from("notifications").insert({
          user_id: notifyUser,
          type: binaryReply === "yes" ? "whatsapp_interested" : binaryReply === "no" ? "whatsapp_reason_requested" : "whatsapp_reply",
          message: notificationMessage,
          link: "/leads",
        });
        if (notificationError) console.error("[twilio-webhook] salesperson notification failed:", notificationError);
      }
      const replyAlertType = binaryReply === "yes" ? "whatsapp_interested" : binaryReply === "no" ? "whatsapp_reason_requested" : "whatsapp_reply";
      const { data: existingReplyAlert } = await supabase.from("lead_alerts")
        .select("id").eq("lead_id", lead.id).eq("alert_type", replyAlertType).eq("resolved", false).limit(1);
      if (!existingReplyAlert?.length) {
        const { error: alertError } = await supabase.from("lead_alerts").insert({
          lead_id: lead.id,
          alert_type: replyAlertType,
          severity: binaryReply === "yes" ? "critical" : binaryReply === "no" ? "warning" : "info",
          message: binaryReply === "yes" ? `Interested — reply now: ${text.slice(0, 120)}` : binaryReply === "no" ? "Customer said no — reason requested" : `New WhatsApp reply: ${text.slice(0, 160)}`,
        });
        if (alertError) console.error("[twilio-webhook] lead alert failed:", alertError);
      }

      if (binaryReply === "no") {
        const { data: priorReason } = await supabase.from("lead_messages")
          .select("id").eq("lead_id", lead.id).eq("message_kind", "negative_reason_request")
          .gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString()).limit(1);
        if (!priorReason?.length) {
          await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({
              phone,
              message: "Thank you for letting us know. What is the main reason — price, timing, or the product? Reply with one option and your salesperson will help accordingly.",
              lead_id: lead.id,
              user_id: notifyUser,
              outreach_source: "automatic",
              message_kind: "negative_reason_request",
            }),
          }).catch((error) => console.error("[twilio-webhook] reason request failed:", error));
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
    } else {
      // Log unmatched inbound for debugging
      await supabase.from("automation_logs").insert({
        event_type: "twilio_inbound_unmatched",
        success: true,
        details: { phone, text: text.slice(0, 500), message_sid: messageSid },
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
