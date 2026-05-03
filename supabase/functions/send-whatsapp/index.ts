// Send WhatsApp messages via Meta Cloud API (graph.facebook.com).
// Replaces the previous Interakt integration. Same input contract so all
// existing callers (nurture-engine, SendTemplateDialog, etc.) keep working.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
const META_PHONE_NUMBER_ID = Deno.env.get("META_PHONE_NUMBER_ID");
const GRAPH_VERSION = "v21.0";

interface SendResult {
  success: boolean;
  message_id?: string;
  error?: string;
  phone: string;
  providerResponse?: unknown;
}

// Normalize a phone string into E.164-ish form. Meta Cloud API accepts
// numbers WITHOUT a leading "+" — just country code + number, all digits.
// Default country code is 91 (India).
function normalizePhone(raw: string): { e164: string; digits: string } {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return { e164: "", digits: "" };
  // Already has a country code (10+ local digits assumed)
  if (digits.length > 10) return { e164: `+${digits}`, digits };
  return { e164: `+91${digits}`, digits: `91${digits}` };
}

async function sendViaMeta(params: {
  phone: string;
  message?: string;
  template_name?: string;
  template_language?: string;
  template_body_values?: string[];
  template_header_values?: string[];
  template_button_values?: string[];
}): Promise<SendResult> {
  const { e164, digits } = normalizePhone(params.phone);
  if (!digits) return { success: false, error: "Invalid phone number", phone: e164 };
  if (!META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) {
    return {
      success: false,
      error: "META_ACCESS_TOKEN or META_PHONE_NUMBER_ID not configured",
      phone: e164,
    };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${META_PHONE_NUMBER_ID}/messages`;

  let payload: Record<string, unknown>;
  if (params.template_name) {
    // Template (HSM) — works outside the 24h window
    const components: Record<string, unknown>[] = [];
    if (params.template_header_values?.length) {
      components.push({
        type: "header",
        parameters: params.template_header_values.map((v) => ({ type: "text", text: v })),
      });
    }
    if (params.template_body_values?.length) {
      components.push({
        type: "body",
        parameters: params.template_body_values.map((v) => ({ type: "text", text: v })),
      });
    }
    if (params.template_button_values?.length) {
      params.template_button_values.forEach((v, idx) => {
        components.push({
          type: "button",
          sub_type: "url",
          index: String(idx),
          parameters: [{ type: "text", text: v }],
        });
      });
    }
    payload = {
      messaging_product: "whatsapp",
      to: digits,
      type: "template",
      template: {
        name: params.template_name,
        language: { code: params.template_language || "en" },
        ...(components.length ? { components } : {}),
      },
    };
  } else {
    // Free-text session message — only allowed within 24h customer window
    payload = {
      messaging_product: "whatsapp",
      to: digits,
      type: "text",
      text: { body: params.message || "" },
    };
  }

  console.log("[send-whatsapp] →", { url, to: digits, kind: params.template_name ? "template" : "text" });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch (_) { /* keep raw */ }

    if (!res.ok) {
      const metaErr = parsed?.error?.message || `HTTP ${res.status}`;
      console.error("[send-whatsapp] Meta error:", metaErr, parsed);
      return { success: false, error: metaErr, phone: e164, providerResponse: parsed };
    }
    const message_id = parsed?.messages?.[0]?.id;
    console.log("[send-whatsapp] ✓ sent", { message_id });
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
      template_name,
      template_language,
      template_body_values,
      template_header_values,
      template_button_values,
      template_id,
    } = body || {};

    if (!phone) {
      return new Response(JSON.stringify({ success: false, error: "phone is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!template_name && !message) {
      return new Response(
        JSON.stringify({ success: false, error: "Either template_name or message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // First attempt + one retry
    let result = await sendViaMeta({
      phone, message, template_name, template_language,
      template_body_values, template_header_values, template_button_values,
    });
    let retryCount = 0;
    if (!result.success) {
      retryCount = 1;
      console.warn("[send-whatsapp] retrying after:", result.error);
      result = await sendViaMeta({
        phone, message, template_name, template_language,
        template_body_values, template_header_values, template_button_values,
      });
    }

    const storedBody = template_name
      ? `[template:${template_name}] ${(template_body_values || []).join(" | ")}`.trim()
      : (message as string);

    await supabase.from("message_logs").insert({
      phone: result.phone,
      recipient_name: user_name || null,
      recipient_user_id: user_id || null,
      message: storedBody,
      provider: "meta",
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
        message_id: result.message_id,
        error: result.error,
        phone: result.phone,
        provider: "meta",
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
