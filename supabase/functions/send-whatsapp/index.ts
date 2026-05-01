// Send WhatsApp messages via Interakt (https://www.interakt.ai/)
// Supports both pre-approved templates and free-text session messages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERAKT_API_KEY = Deno.env.get("INTERAKT_API_KEY");

// Interakt public messaging API
const INTERAKT_URL = "https://api.interakt.ai/v1/public/message/";

interface SendResult {
  success: boolean;
  error?: string;
  providerResponse?: unknown;
}

// Normalize phone: strip non-digits and split into countryCode + number.
// Default country code is 91 (India). If phone already starts with a country
// code (10+ digits), we split off the last 10 digits as the local number.
function splitPhone(raw: string): { countryCode: string; phoneNumber: string } {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length > 10) {
    return {
      countryCode: digits.slice(0, digits.length - 10),
      phoneNumber: digits.slice(-10),
    };
  }
  return { countryCode: "91", phoneNumber: digits };
}

async function sendViaInterakt(params: {
  phone: string;
  message?: string;
  user_name?: string;
  template_name?: string;
  template_language?: string;
  template_body_values?: string[];
  template_header_values?: string[];
  template_button_values?: string[];
}): Promise<SendResult> {
  if (!INTERAKT_API_KEY) {
    return { success: false, error: "INTERAKT_API_KEY not configured" };
  }

  const { countryCode, phoneNumber } = splitPhone(params.phone);
  if (!phoneNumber) {
    return { success: false, error: "Invalid phone number" };
  }

  const payload: Record<string, unknown> = {
    countryCode: `+${countryCode}`,
    phoneNumber,
    callbackData: "omniflow",
  };

  if (params.user_name) {
    payload.traits = { name: params.user_name };
  }

  if (params.template_name) {
    // Template (HSM) message — works outside the 24h window
    payload.type = "Template";
    payload.template = {
      name: params.template_name,
      languageCode: params.template_language || "en",
      bodyValues: params.template_body_values || [],
      headerValues: params.template_header_values || [],
      buttonValues: params.template_button_values
        ? { 0: params.template_button_values }
        : {},
    };
  } else {
    // Free-text session message — only works within the 24h customer window
    payload.type = "Text";
    payload.data = { message: params.message || "" };
  }

  try {
    const res = await fetch(INTERAKT_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${INTERAKT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch (_) { /* keep raw */ }

    if (!res.ok) {
      return {
        success: false,
        error: `HTTP ${res.status}: ${text}`,
        providerResponse: parsed,
      };
    }
    // Interakt returns { result: true/false, message: "..." }
    const ok =
      typeof parsed === "object" && parsed !== null && (parsed as any).result === true;
    if (!ok) {
      return {
        success: false,
        error: (parsed as any)?.message || "Interakt rejected the message",
        providerResponse: parsed,
      };
    }
    return { success: true, providerResponse: parsed };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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
      template_name,
      template_language,
      template_body_values,
      template_header_values,
      template_button_values,
      template_id,
    } = body || {};

    if (!phone) {
      return new Response(
        JSON.stringify({ error: "phone is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!template_name && !message) {
      return new Response(
        JSON.stringify({ error: "Either template_name or message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // First attempt
    let result = await sendViaInterakt({
      phone,
      message,
      user_name,
      template_name,
      template_language,
      template_body_values,
      template_header_values,
      template_button_values,
    });

    // Retry once on failure
    let retryCount = 0;
    if (!result.success) {
      console.warn(`[send-whatsapp] First attempt failed: ${result.error}. Retrying…`);
      retryCount = 1;
      result = await sendViaInterakt({
        phone,
        message,
        user_name,
        template_name,
        template_language,
        template_body_values,
        template_header_values,
        template_button_values,
      });
    }

    // Build the message body string we store in the DB
    const storedBody = template_name
      ? `[template:${template_name}] ${(template_body_values || []).join(" | ")}`.trim()
      : (message as string);

    // Log to message_logs (provider-level audit)
    await supabase.from("message_logs").insert({
      phone,
      recipient_name: user_name || null,
      recipient_user_id: user_id || null,
      message: storedBody,
      provider: "interakt",
      status: result.success ? "sent" : "failed",
      retry_count: retryCount,
      error_message: result.error || null,
      sent_at: result.success ? new Date().toISOString() : null,
    });

    // If tied to a lead, also log into lead_messages so it appears in the
    // lead's conversation timeline and triggers the lead-stats trigger.
    if (lead_id && result.success) {
      await supabase.from("lead_messages").insert({
        lead_id,
        message_type: "outbound",
        message_body: storedBody,
        template_used: template_name || null,
        template_id: template_id || null,
        status: "sent",
        sent_at: new Date().toISOString(),
        created_by: user_id || null,
      });
    }

    return new Response(
      JSON.stringify({
        success: result.success,
        provider: "interakt",
        error: result.error,
      }),
      {
        status: result.success ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: unknown) {
    console.error("send-whatsapp error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
