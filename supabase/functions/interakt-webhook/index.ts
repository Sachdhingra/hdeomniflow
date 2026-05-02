// Public webhook endpoint that receives Interakt events:
//  - Inbound customer messages (analysed for sentiment/concern/intent)
//  - Outbound delivery / read status updates
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { analyzeInbound } from "../_shared/conversation-analysis.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-interakt-secret",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("INTERAKT_WEBHOOK_SECRET");

function normalizePhone(raw: string | undefined | null): string {
  return (raw || "").replace(/\D/g, "");
}

async function findLeadByPhone(supabase: any, phone: string): Promise<{ id: string; sequence: number } | null> {
  if (!phone) return null;
  const last10 = phone.slice(-10);
  const { data } = await supabase
    .from("leads")
    .select("id, customer_phone, conversation_message_count, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!data) return null;
  const match = data.find((l: any) => normalizePhone(l.customer_phone).endsWith(last10));
  return match ? { id: match.id, sequence: match.conversation_message_count ?? 0 } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
    const eventType: string = payload.type || payload.event || "unknown";
    const data = payload.data || payload;

    const phone = normalizePhone(
      data.customer?.phone_number || data.phone_number || data.from || data.recipient || data.to,
    );

    if (eventType === "message_received" || eventType === "message" || data.message) {
      const text =
        data.message?.message || data.message?.text || data.text || data.body || "[non-text message]";

      const lead = await findLeadByPhone(supabase, phone);
      if (lead) {
        const analysis = analyzeInbound(String(text));
        const seq = (lead.sequence ?? 0) + 1;

        await supabase.from("lead_messages").insert({
          lead_id: lead.id,
          message_type: "inbound",
          message_body: String(text).slice(0, 4000),
          status: "delivered",
          sent_at: new Date().toISOString(),
          response_received: true,
          sentiment: analysis.sentiment,
          intent: analysis.intent,
          concern: analysis.concern,
          length_category: analysis.length_category,
          sequence_number: seq,
        });

        // Update lead conversation context. An inbound = customer responded, so
        // reset the unanswered counter and "needs personal call" flag.
        await supabase.from("leads").update({
          last_inbound_sentiment: analysis.sentiment,
          last_inbound_concern: analysis.concern,
          last_inbound_intent: analysis.intent,
          conversation_message_count: seq,
          unanswered_outbound_count: 0,
          needs_personal_call: false,
          dead_lead: false,
          // store concern in the existing column too so legacy UI still surfaces it
          concern_type: analysis.concern ?? undefined,
          // mark objection as addressed = false if they're now objecting
          ...(analysis.intent === "objection" ? { barrier_addressed: false, objection_type: analysis.concern ?? "general" } : {}),
        }).eq("id", lead.id);

        // Increment reply_count on the most recent outbound variant (A/B tracking)
        const { data: lastOut } = await supabase
          .from("lead_messages")
          .select("id, variant, template_id")
          .eq("lead_id", lead.id)
          .eq("message_type", "outbound")
          .order("sent_at", { ascending: false })
          .limit(1);
        if (lastOut && lastOut.length && lastOut[0].variant && lastOut[0].template_id) {
          const { data: v } = await supabase
            .from("message_template_variants")
            .select("id")
            .eq("template_id", lastOut[0].template_id)
            .eq("variant_label", lastOut[0].variant)
            .maybeSingle();
          if (v?.id) await supabase.rpc("bump_variant_reply", { _variant_id: v.id });
          await supabase.from("lead_messages").update({ response_received: true }).eq("id", lastOut[0].id);
        }
      } else {
        await supabase.from("automation_logs").insert({
          event_type: "interakt_inbound_unmatched",
          success: true,
          details: { phone, text: String(text).slice(0, 500) },
        });
      }
    } else if (
      eventType === "message_delivered" || eventType === "message_read" ||
      eventType === "message_sent" || eventType === "message_failed"
    ) {
      const lead = await findLeadByPhone(supabase, phone);
      if (lead) {
        const updates: Record<string, unknown> = {};
        if (eventType === "message_delivered") { updates.status = "delivered"; updates.delivered_at = new Date().toISOString(); }
        else if (eventType === "message_read") { updates.status = "read"; updates.read_at = new Date().toISOString(); }
        else if (eventType === "message_failed") { updates.status = "failed"; }
        if (Object.keys(updates).length) {
          const { data: msgs } = await supabase
            .from("lead_messages")
            .select("id")
            .eq("lead_id", lead.id)
            .eq("message_type", "outbound")
            .order("sent_at", { ascending: false })
            .limit(1);
          if (msgs && msgs.length) {
            await supabase.from("lead_messages").update(updates).eq("id", msgs[0].id);
          }
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("interakt-webhook error:", err);
    const msg = err instanceof Error ? err.message : String(err);
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
