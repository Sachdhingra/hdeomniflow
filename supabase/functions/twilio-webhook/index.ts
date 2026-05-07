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
import { analyzeInbound } from "../_shared/conversation-analysis.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

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
  supabase: ReturnType<typeof createClient>,
  phone: string,
): Promise<{ id: string; sequence: number } | null> {
  if (!phone) return null;
  const last10 = phone.replace(/^\+/, "").slice(-10);
  const { data } = await supabase
    .from("leads")
    .select("id, customer_phone, conversation_message_count, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!data) return null;
  const match = data.find((l: any) =>
    normalizePhone(l.customer_phone).replace(/^\+/, "").slice(-10) === last10
  );
  return match
    ? { id: match.id, sequence: match.conversation_message_count ?? 0 }
    : null;
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
    const toRaw = params["To"] || "";     // e.g. "whatsapp:+14155238886"
    const body = params["Body"] || "";

    // ── Delivery/read status update ──────────────────────────────────────────
    // Twilio fires this when MessageStatus is sent/delivered/read/failed/undelivered
    const STATUS_EVENTS = new Set(["sent", "delivered", "read", "failed", "undelivered"]);
    if (STATUS_EVENTS.has(messageStatus)) {
      // recipient_id is the customer's number (the "To" when we sent, now in "To")
      // For status callbacks, "To" = customer, "From" = our Twilio number
      const recipientPhone = normalizePhone(toRaw);
      const lead = await findLeadByPhone(supabase, recipientPhone);
      if (lead) {
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
        }

        if (Object.keys(updates).length) {
          const { data: msgs } = await supabase
            .from("lead_messages")
            .select("id")
            .eq("lead_id", lead.id)
            .eq("message_type", "outbound")
            .order("sent_at", { ascending: false })
            .limit(1);
          if (msgs?.length) {
            await supabase.from("lead_messages").update(updates).eq("id", msgs[0].id);
          }
        }
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

    let text = body.trim();
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
      const analysis = analyzeInbound(text);
      const seq = (lead.sequence ?? 0) + 1;

      await supabase.from("lead_messages").insert({
        lead_id: lead.id,
        message_type: "inbound",
        message_body: text.slice(0, 4000),
        status: "delivered",
        sent_at: new Date().toISOString(),
        response_received: true,
        sentiment: analysis.sentiment,
        intent: analysis.intent,
        concern: analysis.concern,
        length_category: analysis.length_category,
        sequence_number: seq,
      });

      await supabase.from("leads").update({
        last_inbound_sentiment: analysis.sentiment,
        last_inbound_concern: analysis.concern,
        last_inbound_intent: analysis.intent,
        conversation_message_count: seq,
        unanswered_outbound_count: 0,
        needs_personal_call: false,
        dead_lead: false,
        concern_type: analysis.concern ?? undefined,
        ...(analysis.intent === "objection"
          ? { barrier_addressed: false, objection_type: analysis.concern ?? "general" }
          : {}),
      }).eq("id", lead.id);

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
