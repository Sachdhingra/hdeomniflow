// Webhook endpoint for Meta Cloud API (WhatsApp Business).
// Handles:
//   GET  — hub verification challenge required by Meta when registering a webhook
//   POST — inbound customer messages and delivery/read status updates
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { analyzeInbound, detectBinaryReply } from "../_shared/conversation-analysis.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Set META_WEBHOOK_VERIFY_TOKEN to the same token you enter in Meta's webhook settings.
const META_WEBHOOK_VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
// Set META_APP_SECRET to your Meta App secret for payload signature verification.
const META_APP_SECRET = Deno.env.get("META_APP_SECRET");

function normalizePhone(raw: string | undefined | null): string {
  return (raw || "").replace(/\D/g, "");
}

async function verifyMetaSignature(rawBody: string, sigHeader: string | null): Promise<boolean> {
  if (!META_APP_SECRET) {
    console.error("[interakt-webhook] META_APP_SECRET not configured — rejecting request");
    return false; // fail closed: never trust unverified payloads
  }
  if (!sigHeader?.startsWith("sha256=")) return false;
  const expected = sigHeader.slice(7); // strip "sha256="
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const actual = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return actual === expected;
}

async function findLeadByPhone(supabase: any, phone: string): Promise<{ id: string; sequence: number; assigned_to: string | null; created_by: string | null; customer_name: string } | null> {
  if (!phone) return null;
  const last10 = normalizePhone(phone).slice(-10);
  if (!last10) return null;
  // Push suffix match to DB via ILIKE — avoids the 50-lead client-side cap
  const { data } = await supabase
    .from("leads")
    .select("id, conversation_message_count, assigned_to, created_by, customer_name")
    .is("deleted_at", null)
    .ilike("customer_phone", `%${last10}`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!data?.length) return null;
  return { id: data[0].id, sequence: data[0].conversation_message_count ?? 0, assigned_to: data[0].assigned_to, created_by: data[0].created_by, customer_name: data[0].customer_name || "Customer" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Meta webhook verification: GET with hub.mode=subscribe
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && META_WEBHOOK_VERIFY_TOKEN && token === META_WEBHOOK_VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const rawBody = await req.text();

    // Verify Meta payload signature when APP_SECRET is configured
    if (META_APP_SECRET) {
      const sig = req.headers.get("x-hub-signature-256");
      if (!(await verifyMetaSignature(rawBody, sig))) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (_) {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Meta Cloud API webhook envelope: { object, entry: [{ changes: [{ value }] }] }
    if (payload.object === "whatsapp_business_account") {
      for (const entry of (payload.entry || [])) {
        for (const change of (entry.changes || [])) {
          const value = change.value || {};

          // ── Inbound messages ──────────────────────────────────────────────
          for (const msg of (value.messages || [])) {
            const phone = normalizePhone(msg.from);
            let text = "[non-text message]";
            switch (msg.type) {
              case "text":       text = msg.text?.body || ""; break;
              case "image":      text = "[image]"; break;
              case "audio":      text = "[audio]"; break;
              case "video":      text = "[video]"; break;
              case "document":   text = "[document]"; break;
              case "sticker":    text = "[sticker]"; break;
              case "location":   text = "[location]"; break;
              case "interactive":
                text = msg.interactive?.button_reply?.title
                  || msg.interactive?.list_reply?.title
                  || "[interactive]";
                break;
              case "button":     text = msg.button?.text || "[button]"; break;
            }

            const lead = await findLeadByPhone(supabase, phone);
            if (lead) {
              const analysis = analyzeInbound(String(text));
              const binaryReply = detectBinaryReply(String(text));
              const seq = (lead.sequence ?? 0) + 1;
              const now = new Date().toISOString();

              await supabase.from("lead_messages").insert({
                lead_id: lead.id,
                message_type: "inbound",
                message_body: String(text).slice(0, 4000),
                status: "delivered",
                sent_at: msg.timestamp
                  ? new Date(Number(msg.timestamp) * 1000).toISOString()
                  : new Date().toISOString(),
                response_received: true,
                sentiment: analysis.sentiment,
                intent: analysis.intent,
                concern: analysis.concern,
                length_category: analysis.length_category,
                sequence_number: seq,
              });

              const leadUpdate: Record<string, unknown> = {
                last_inbound_sentiment: analysis.sentiment,
                last_inbound_concern: analysis.concern,
                last_inbound_intent: analysis.intent,
                conversation_message_count: seq,
                unanswered_outbound_count: 0,
              };
              if (binaryReply === "yes") {
                leadUpdate.follow_up_reply_state = "interested";
                leadUpdate.follow_up_reply_at = now;
                leadUpdate.automation_paused = false;
              } else if (binaryReply === "no") {
                leadUpdate.follow_up_reply_state = "reason_requested";
                leadUpdate.follow_up_reply_at = now;
                leadUpdate.automation_paused = true;
              }
              // Only clear dead_lead / needs_personal_call on positive engagement
              if (analysis.intent === "interested" || analysis.intent === "ready_to_buy") {
                leadUpdate.dead_lead = false;
                leadUpdate.needs_personal_call = false;
              }
              if (analysis.concern) leadUpdate.concern_type = analysis.concern;
              if (analysis.intent === "objection") {
                leadUpdate.barrier_addressed = false;
                leadUpdate.objection_type = analysis.concern ?? "general";
              }
              await supabase.from("leads").update(leadUpdate).eq("id", lead.id);

              const notifyUser = lead.assigned_to || lead.created_by;
              if (notifyUser) {
                await supabase.from("notifications").insert({
                  user_id: notifyUser,
                  type: binaryReply === "yes" ? "whatsapp_interested" : binaryReply === "no" ? "whatsapp_reason_requested" : "whatsapp_reply",
                  message: binaryReply === "yes" ? `🔥 ${lead.customer_name} is interested — reply now` : binaryReply === "no" ? `${lead.customer_name} said no — reason requested for salesperson review` : `New WhatsApp reply from ${lead.customer_name}: ${String(text).slice(0, 120)}`,
                  link: "/leads",
                });
              }
              const alertType = binaryReply === "yes" ? "whatsapp_interested" : binaryReply === "no" ? "whatsapp_reason_requested" : "whatsapp_reply";
              const { data: existingAlert } = await supabase.from("lead_alerts").select("id")
                .eq("lead_id", lead.id).eq("alert_type", alertType).eq("resolved", false).limit(1);
              if (!existingAlert?.length) {
                await supabase.from("lead_alerts").insert({
                  lead_id: lead.id,
                  alert_type: alertType,
                  severity: binaryReply === "yes" ? "critical" : binaryReply === "no" ? "warning" : "info",
                  message: binaryReply === "yes" ? "Interested — reply now" : binaryReply === "no" ? "Customer said no — ask the reason" : `New WhatsApp reply: ${String(text).slice(0, 160)}`,
                });
              }
              if (binaryReply === "no") {
                const { data: priorReason } = await supabase.from("lead_messages").select("id")
                  .eq("lead_id", lead.id).eq("message_kind", "negative_reason_request")
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
                  }).catch((error) => console.error("[interakt-webhook] reason request failed:", error));
                }
              }

              // Increment reply_count on the most recent outbound variant (A/B tracking)
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
                await supabase.from("lead_messages").update({ response_received: true }).eq("id", lastOut[0].id);
              }
            } else {
              await supabase.from("automation_logs").insert({
                event_type: "whatsapp_inbound_unmatched",
                success: true,
                details: { phone, text: String(text).slice(0, 500) },
              });
            }
          }

          // ── Delivery / read status updates ────────────────────────────────
          for (const statusObj of (value.statuses || [])) {
            const phone = normalizePhone(statusObj.recipient_id);
            const lead = await findLeadByPhone(supabase, phone);
            if (!lead) continue;

            const updates: Record<string, unknown> = {};
            const ts = statusObj.timestamp
              ? new Date(Number(statusObj.timestamp) * 1000).toISOString()
              : new Date().toISOString();

            if (statusObj.status === "delivered") {
              updates.status = "delivered";
              updates.delivered_at = ts;
            } else if (statusObj.status === "read") {
              updates.status = "read";
              updates.read_at = ts;
            } else if (statusObj.status === "failed") {
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
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("whatsapp-webhook error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("automation_logs").insert({
      event_type: "whatsapp_webhook_error",
      success: false,
      error_message: msg,
    });
    return new Response(JSON.stringify({ received: true, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
