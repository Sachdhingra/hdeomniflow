import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---------------------------------------------------------------------------
// Provider abstraction – swap implementation without changing callers
// ---------------------------------------------------------------------------
interface SendResult {
  success: boolean;
  error?: string;
}

/** Phase 1 – WhatsApp Web bot (external Node.js service) */
async function sendViaWeb(phone: string, message: string): Promise<SendResult> {
  const webhookUrl = Deno.env.get("WHATSAPP_WEB_WEBHOOK_URL");
  if (!webhookUrl) {
    // No webhook configured yet – log only (placeholder mode)
    console.log(`[WhatsApp-Web Placeholder] To: ${phone} | Message: ${message}`);
    return { success: true };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, message }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${body}` };
    }
    await res.text(); // consume body
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Phase 2 – Gupshup / Meta Cloud API (future) */
async function sendViaApi(phone: string, message: string): Promise<SendResult> {
  const apiKey = Deno.env.get("WHATSAPP_API_KEY");
  const apiUrl = Deno.env.get("WHATSAPP_API_URL");

  if (!apiKey || !apiUrl) {
    return { success: false, error: "WHATSAPP_API_KEY or WHATSAPP_API_URL not configured" };
  }

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ phone, message }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${body}` };
    }
    await res.text();
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Provider registry
const providers: Record<string, (phone: string, msg: string) => Promise<SendResult>> = {
  web: sendViaWeb,
  api: sendViaApi,
};

// ---------------------------------------------------------------------------
// Edge function handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { phone, message, user_id, user_name } = await req.json();

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ error: "phone and message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine messaging mode – default "web"
    const mode = Deno.env.get("MESSAGING_MODE") || "web";
    const sendFn = providers[mode] || providers.web;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // First attempt
    let result = await sendFn(phone, message);

    // Retry once on failure
    if (!result.success) {
      console.warn(`[send-whatsapp] First attempt failed: ${result.error}. Retrying…`);
      result = await sendFn(phone, message);
    }

    // Log to message_logs table
    await supabase.from("message_logs").insert({
      phone,
      recipient_name: user_name || null,
      recipient_user_id: user_id || null,
      message,
      provider: mode,
      status: result.success ? "sent" : "failed",
      retry_count: result.success ? 0 : 1,
      error_message: result.error || null,
      sent_at: result.success ? new Date().toISOString() : null,
    });

    return new Response(
      JSON.stringify({ success: result.success, provider: mode, error: result.error }),
      {
        status: result.success ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
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
