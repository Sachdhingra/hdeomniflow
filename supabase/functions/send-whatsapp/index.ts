// Send WhatsApp messages via Twilio REST API (direct, no third-party gateway).
// Required Supabase secrets:
//   TWILIO_ACCOUNT_SID   — starts with "AC", from console.twilio.com
//   TWILIO_AUTH_TOKEN    — Auth Token from console.twilio.com
//   TWILIO_WHATSAPP_FROM — e.g. "+14155238886" for sandbox, or your approved WA number
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_WHATSAPP_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM");

// Log secret availability at cold-start so it shows up in Supabase function logs
console.log("[send-whatsapp] secrets check →", {
  TWILIO_ACCOUNT_SID: TWILIO_ACCOUNT_SID ? `${TWILIO_ACCOUNT_SID.slice(0, 4)}…` : "MISSING",
  TWILIO_AUTH_TOKEN: TWILIO_AUTH_TOKEN ? "set" : "MISSING",
  TWILIO_WHATSAPP_FROM: TWILIO_WHATSAPP_FROM || "MISSING",
});

interface SendResult {
  success: boolean;
  message_id?: string;
  error?: string;
  phone: string;
  providerResponse?: unknown;
}

// Normalize to E.164. Adds +91 only for bare 10-digit Indian numbers.
function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`; // already has a country code prefix
}

function waFrom(): string {
  const f = (TWILIO_WHATSAPP_FROM || "").trim();
  if (!f) return "";
  const num = f.startsWith("whatsapp:") ? f.slice(9) : f;
  return `whatsapp:${normalizePhone(num) || num}`;
}

async function sendViaTwilio(params: {
  phone: string;
  message?: string;
  content_sid?: string;
  content_variables?: Record<string, string>;
}): Promise<SendResult> {
  const e164 = normalizePhone(params.phone);
  if (!e164) return { success: false, error: "Invalid phone number", phone: params.phone };

  if (!TWILIO_ACCOUNT_SID) {
    return { success: false, error: "TWILIO_ACCOUNT_SID secret not set in Supabase", phone: params.phone };
  }
  if (!TWILIO_AUTH_TOKEN) {
    return { success: false, error: "TWILIO_AUTH_TOKEN secret not set in Supabase", phone: params.phone };
  }
  const from = waFrom();
  if (!from) {
    return { success: false, error: "TWILIO_WHATSAPP_FROM secret not set in Supabase", phone: e164 };
  }

  const formBody = new URLSearchParams();
  formBody.set("To", `whatsapp:${e164}`);
  formBody.set("From", from);
  if (params.content_sid) {
    formBody.set("ContentSid", params.content_sid);
    if (params.content_variables && Object.keys(params.content_variables).length > 0) {
      formBody.set("ContentVariables", JSON.stringify(params.content_variables));
    }
  } else {
    formBody.set("Body", params.message || "");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  console.log("[send-whatsapp] →", {
    to: `whatsapp:${e164}`,
    from,
    kind: params.content_sid ? "template" : "text",
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
    });

    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch (_) { /* keep raw */ }

    if (!res.ok) {
      // Twilio error body: { code, message, more_info, status }
      const err = parsed?.message || parsed?.error_message || `HTTP ${res.status}`;
      const twilioCode = parsed?.code ? ` (Twilio code ${parsed.code})` : "";
      console.error("[send-whatsapp] Twilio rejected:", err, twilioCode, parsed);
      return { success: false, error: `${err}${twilioCode}`, phone: e164, providerResponse: parsed };
    }

    console.log("[send-whatsapp] ✓ sent", { sid: parsed?.sid, status: parsed?.status });
    return { success: true, message_id: parsed?.sid, phone: e164, providerResponse: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-whatsapp] fetch error:", msg);
    return { success: false, error: msg, phone: e164 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Always respond with HTTP 200 — success/failure is in the JSON body.
  // Returning 4xx/5xx causes supabase.functions.invoke() to put the response
  // in `error` instead of `data`, hiding the actual Twilio error from callers.
  const ok = (payload: object) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json();
    const {
      phone,
      message,
      user_id,
      user_name,
      lead_id,
      content_sid,
      content_variables,
      template_name,
      template_body_values,
      template_id,
      journey_stage,
    } = body || {};

    if (!phone) {
      return ok({ success: false, error: "phone is required" });
    }
    if (!content_sid && !message) {
      return ok({ success: false, error: "Either content_sid or message is required" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // First attempt + one retry on transient failure
    let result = await sendViaTwilio({ phone, message, content_sid, content_variables });
    let retryCount = 0;
    if (!result.success) {
      retryCount = 1;
      console.warn("[send-whatsapp] retrying after:", result.error);
      result = await sendViaTwilio({ phone, message, content_sid, content_variables });
    }

    const storedBody = content_sid
      ? `[twilio-template:${content_sid}] ${JSON.stringify(content_variables || {})}`
      : template_name
        ? `[template:${template_name}] ${(template_body_values || []).join(" | ")}`.trim()
        : (message as string);

    // Log every attempt regardless of outcome
    await supabase.from("message_logs").insert({
      phone: result.phone,
      recipient_name: user_name || null,
      recipient_user_id: user_id || null,
      message: storedBody,
      provider: "twilio",
      status: result.success ? "sent" : "failed",
      retry_count: retryCount,
      error_message: result.error || null,
      sent_at: result.success ? new Date().toISOString() : null,
    });

    if (lead_id && result.success) {
      await supabase.from("lead_messages").insert({
        lead_id,
        message_type: "outbound",
        message_body: storedBody,
        template_used: template_name || (content_sid ? `twilio:${content_sid}` : null),
        template_id: template_id || null,
        journey_stage: journey_stage || null,
        status: "sent",
        sent_at: new Date().toISOString(),
        created_by: user_id || null,
      });
    }

    return ok({
      success: result.success,
      message_id: result.message_id,
      error: result.error,
      phone: result.phone,
      provider: "twilio",
    });
  } catch (error) {
    console.error("[send-whatsapp] unhandled error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return ok({ success: false, error: msg });
  }
});
