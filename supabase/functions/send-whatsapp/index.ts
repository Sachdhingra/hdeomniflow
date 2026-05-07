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
  return `+${digits}`; // already has country code
}

function waFrom(): string {
  const f = (TWILIO_WHATSAPP_FROM || "").trim();
  if (!f) return "";
  // Strip any existing "whatsapp:" prefix so we control exactly one
  const num = f.startsWith("whatsapp:") ? f.slice(9) : f;
  return `whatsapp:${normalizePhone(num) || num}`;
}

async function sendViaTwilio(params: {
  phone: string;
  message?: string;
  // Twilio Content API template support (HX... sid)
  content_sid?: string;
  content_variables?: Record<string, string>;
}): Promise<SendResult> {
  const e164 = normalizePhone(params.phone);
  if (!e164) return { success: false, error: "Invalid phone number", phone: params.phone };

  if (!TWILIO_ACCOUNT_SID) {
    return { success: false, error: "TWILIO_ACCOUNT_SID not configured", phone: e164 };
  }
  if (!TWILIO_AUTH_TOKEN) {
    return { success: false, error: "TWILIO_AUTH_TOKEN not configured", phone: e164 };
  }
  const from = waFrom();
  if (!from) {
    return { success: false, error: "TWILIO_WHATSAPP_FROM not configured", phone: e164 };
  }

  const body = new URLSearchParams();
  body.set("To", `whatsapp:${e164}`);
  body.set("From", from);
  if (params.content_sid) {
    body.set("ContentSid", params.content_sid);
    if (params.content_variables && Object.keys(params.content_variables).length > 0) {
      body.set("ContentVariables", JSON.stringify(params.content_variables));
    }
  } else {
    body.set("Body", params.message || "");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  // Basic auth: AccountSid:AuthToken
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
      body,
    });

    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch (_) { /* keep raw */ }

    if (!res.ok) {
      // Twilio error format: { code, message, more_info, status }
      const err = parsed?.message || parsed?.error_message || `HTTP ${res.status}`;
      console.error("[send-whatsapp] Twilio error:", parsed?.code, err);
      return { success: false, error: err, phone: e164, providerResponse: parsed };
    }

    const message_id = parsed?.sid;
    console.log("[send-whatsapp] ✓ sent", { message_id, status: parsed?.status });
    return { success: true, message_id, phone: e164, providerResponse: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-whatsapp] fetch failed:", msg);
    return { success: false, error: msg, phone: e164 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
      // Back-compat: callers may still pass Meta-style template_name; use plain message fallback
      template_name,
      template_body_values,
      template_id,
      journey_stage,
    } = body || {};

    if (!phone) {
      return new Response(JSON.stringify({ success: false, error: "phone is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!content_sid && !message) {
      return new Response(
        JSON.stringify({ success: false, error: "Either content_sid or message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // First attempt + one retry on failure
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

    return new Response(
      JSON.stringify({
        success: result.success,
        message_id: result.message_id,
        error: result.error,
        phone: result.phone,
        provider: "twilio",
      }),
      {
        status: result.success ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("send-whatsapp error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
