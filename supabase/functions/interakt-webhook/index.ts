// Public webhook endpoint that receives Interakt events:
//  - Inbound customer messages
//  - Outbound delivery / read status updates
//
// Configure in Interakt: Settings → Developer Settings → Webhooks
// URL: https://<project-ref>.supabase.co/functions/v1/interakt-webhook
// No auth required (public). We optionally verify a shared header secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-interakt-secret",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("INTERAKT_WEBHOOK_SECRET"); // optional

function normalizePhone(raw: string | undefined | null): string {
  return (raw || "").replace(/\D/g, "");
}

// Try to find the most recent matching lead for a given phone number.
async function findLeadByPhone(supabase: any, phone: string): Promise<string | null> {
  if (!phone) return null;
  const last10 = phone.slice(-10);
  const { data } = await supabase
    .from("leads")
    .select("id, customer_phone, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!data) return null;
  const match = data.find((l: any) => normalizePhone(l.customer_phone).endsWith(last10));
  return match ? match.id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Optional shared-secret check
  if (WEBHOOK_SECRET) {
    const got = req.headers.get("x-interakt-secret");
    if (got !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const payload = await req.json();
    // Interakt event schema: { type: "...", data: { ... } }
    const eventType: string = payload.type || payload.event || "unknown";
    const data = payload.data || payload;

    // Identify the customer phone
    const phone = normalizePhone(
      data.customer?.phone_number ||
        data.phone_number ||
        data.from ||
        data.recipient ||
        data.to,
    );

    if (eventType === "message_received" || eventType === "message" || data.message) {
      // Inbound customer message
      const text =
        data.message?.message ||
        data.message?.text ||
        data.text ||
        data.body ||
        "[non-text message]";

      const leadId = await findLeadByPhone(supabase, phone);
      if (leadId) {
        await supabase.from("lead_messages").insert({
          lead_id: leadId,
          message_type: "inbound",
          message_body: String(text).slice(0, 4000),
          status: "delivered",
          sent_at: new Date().toISOString(),
          response_received: true,
        });
      } else {
        // Log unmatched inbound for visibility
        await supabase.from("automation_logs").insert({
          event_type: "interakt_inbound_unmatched",
          success: true,
          details: { phone, text: String(text).slice(0, 500) },
        });
      }
    } else if (
      eventType === "message_delivered" ||
      eventType === "message_read" ||
      eventType === "message_sent" ||
      eventType === "message_failed"
    ) {
      // Status updates — best-effort match by phone + most recent outbound
      const leadId = await findLeadByPhone(supabase, phone);
      if (leadId) {
        const updates: Record<string, unknown> = {};
        if (eventType === "message_delivered") {
          updates.status = "delivered";
          updates.delivered_at = new Date().toISOString();
        } else if (eventType === "message_read") {
          updates.status = "read";
          updates.read_at = new Date().toISOString();
        } else if (eventType === "message_failed") {
          updates.status = "failed";
        }
        if (Object.keys(updates).length) {
          // Update the most recent outbound message for this lead
          const { data: msgs } = await supabase
            .from("lead_messages")
            .select("id")
            .eq("lead_id", leadId)
            .eq("message_type", "outbound")
            .order("sent_at", { ascending: false })
            .limit(1);
          if (msgs && msgs.length) {
            await supabase.from("lead_messages").update(updates).eq("id", msgs[0].id);
          }
        }
      }
    }

    // Always 200 so Interakt doesn't retry endlessly
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("interakt-webhook error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    // Log but still return 200 to avoid retry storms
    await supabase.from("automation_logs").insert({
      event_type: "interakt_webhook_error",
      success: false,
      error_message: msg,
    });
    return new Response(JSON.stringify({ received: true, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
