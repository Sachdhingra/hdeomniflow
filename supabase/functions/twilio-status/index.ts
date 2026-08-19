// Twilio status callback webhook. Twilio POSTs message status updates here as
// application/x-www-form-urlencoded. We update lead_messages + message_logs
// rows by MessageSid (stored as provider_message_id).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Map Twilio MessageStatus → our internal status.
function mapStatus(twilioStatus: string): string {
  switch ((twilioStatus || "").toLowerCase()) {
    case "queued":
    case "accepted":
    case "scheduled":
      return "queued";
    case "sending":
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "undelivered":
    case "failed":
      return "failed";
    default:
      return twilioStatus || "unknown";
  }
}

// Validate Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken,
// fullUrl + sorted key/value pairs)). Fails closed when unconfigured.
async function verifyTwilioSignature(url: string, params: URLSearchParams, signature: string | null): Promise<boolean> {
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    console.error("[twilio-status] TWILIO_AUTH_TOKEN not configured — rejecting");
    return false;
  }
  if (!signature) return false;

  let payload = url;
  for (const key of [...params.keys()].sort()) payload += key + params.get(key);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return expected === signature;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const ct = req.headers.get("content-type") || "";
    const rawBody = await req.text();
    let params: URLSearchParams;
    if (ct.includes("application/json")) {
      const j = JSON.parse(rawBody || "{}");
      params = new URLSearchParams();
      for (const [k, v] of Object.entries(j ?? {})) params.set(k, String(v));
    } else {
      params = new URLSearchParams(rawBody);
    }

    const callbackUrl = `${supabaseUrl}/functions/v1/twilio-status`;
    const signature = req.headers.get("X-Twilio-Signature") || req.headers.get("x-twilio-signature");
    if (!(await verifyTwilioSignature(callbackUrl, params, signature))) {
      console.error("[twilio-status] invalid signature — rejected");
      return new Response("invalid signature", { status: 403, headers: corsHeaders });
    }

    const sid = params.get("MessageSid") || params.get("SmsSid");
    const twilioStatus = params.get("MessageStatus") || params.get("SmsStatus") || "";
    const errorCode = params.get("ErrorCode");
    const errorMessage = params.get("ErrorMessage");

    console.log("[twilio-status]", { sid, twilioStatus, errorCode, errorMessage });

    if (!sid) {
      return new Response("missing MessageSid", { status: 400, headers: corsHeaders });
    }

    const status = mapStatus(twilioStatus);
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const now = new Date().toISOString();

    const leadMsgUpdate: Record<string, unknown> = { status };
    if (status === "delivered") leadMsgUpdate.delivered_at = now;
    if (status === "read") leadMsgUpdate.read_at = now;
    if (status === "failed") {
      leadMsgUpdate.failed_at = now;
      leadMsgUpdate.error_message = errorMessage || (errorCode ? `Twilio error ${errorCode}` : "delivery failed");
    }

    const { error: lmErr } = await supabase
      .from("lead_messages")
      .update(leadMsgUpdate)
      .eq("provider_message_id", sid);
    if (lmErr) console.error("[twilio-status] lead_messages update:", lmErr);

    const logUpdate: Record<string, unknown> = { status };
    if (status === "failed") logUpdate.error_message = errorMessage || (errorCode ? `Twilio error ${errorCode}` : "delivery failed");
    if (status === "sent" || status === "delivered") logUpdate.sent_at = now;

    const { error: mlErr } = await supabase
      .from("message_logs")
      .update(logUpdate)
      .eq("provider_message_id", sid);
    if (mlErr) console.error("[twilio-status] message_logs update:", mlErr);

    // also update auto_nurture_messages by twilio_message_sid
    const { error: anErr } = await supabase
      .from("auto_nurture_messages")
      .update({ status, ...(status === "sent" ? { sent_at: now } : {}), ...(status === "failed" ? { error_message: errorMessage || null } : {}) })
      .eq("twilio_message_sid", sid);
    if (anErr) console.error("[twilio-status] auto_nurture_messages update:", anErr);

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("[twilio-status] error:", e);
    return new Response("error", { status: 500, headers: corsHeaders });
  }
});
