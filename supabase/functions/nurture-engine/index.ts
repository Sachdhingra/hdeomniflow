// Autonomous lead nurture engine — runs daily/twice-daily.
// Now driven by conversation context (sentiment / concern / intent / no-response timing).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { pickTemplateTitle } from "../_shared/conversation-analysis.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Stage = "new" | "contacted" | "follow_up" | "negotiation" | "overdue" | "won" | "lost" | "converted";
type JourneyStage = "problem" | "exploration" | "evaluation" | "reassurance" | "decision" | "cold";

interface Lead {
  id: string;
  customer_name: string;
  customer_phone: string;
  status: Stage;
  journey_stage: JourneyStage | null;
  liked_product: string | null;
  product_viewed: string | null;
  neighborhood: string | null;
  budget_range: string | null;
  decision_timeline: string | null;
  family_situation: string | null;
  stated_need: string | null;
  value_in_rupees: number;
  concern_type: string | null;
  objection_type: string | null;
  barrier_addressed: boolean | null;
  response_time_minutes: number | null;
  last_message_at: string | null;
  last_response_at: string | null;
  last_payment_link_sent_at: string | null;
  stage_changed_at: string | null;
  journey_stage_changed_at: string | null;
  created_at: string;
  created_by: string | null;
  assigned_to: string | null;
  category: string | null;
  last_inbound_sentiment: string | null;
  last_inbound_concern: string | null;
  last_inbound_intent: string | null;
  unanswered_outbound_count: number | null;
  conversation_message_count: number | null;
  needs_personal_call: boolean | null;
  dead_lead: boolean | null;
}

const daysBetween = (iso: string | null, now: Date) => {
  if (!iso) return 0;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
};
const minsBetween = (iso: string | null, now: Date) => {
  if (!iso) return 0;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
};

const journeyToStatus = (j: JourneyStage): Stage | null => {
  switch (j) {
    case "problem": return "new";
    case "exploration": return "contacted";
    case "evaluation": return "follow_up";
    case "reassurance": return "negotiation";
    case "decision": return "negotiation";
    case "cold": return "overdue";
    default: return null;
  }
};

const SPACE_BY_CATEGORY: Record<string, string> = {
  sofa: "living room", coffee_table: "living room", chair: "living room",
  almirah: "bedroom", bed: "bedroom", mattress: "bedroom",
  dining: "dining area", kitchen: "kitchen", office_table: "office",
};

function fillVars(body: string, lead: Lead): string {
  const map: Record<string, string> = {
    name: lead.customer_name || "there",
    phone: lead.customer_phone,
    neighborhood: lead.neighborhood || "your area",
    product: lead.product_viewed || lead.liked_product || "the piece you liked",
    budget_range: lead.budget_range || "",
    stated_need: lead.stated_need || "",
    family_type: lead.family_situation || "",
    space: lead.category ? (SPACE_BY_CATEGORY[lead.category] || "your home") : "your home",
    amount: Number(lead.value_in_rupees || 0).toLocaleString("en-IN"),
  };
  return body.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (_, n) => map[n] ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const internalSecret = Deno.env.get("NURTURE_ENGINE_SECRET");

  const headerSecret = req.headers.get("x-internal-secret");
  let authorized = false;
  if (internalSecret && headerSecret && headerSecret === internalSecret) authorized = true;
  else {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await userClient.auth.getUser(token);
      const userId = userData?.user?.id;
      if (userId) {
        const adminClient = createClient(supabaseUrl, serviceKey);
        const { data: isAdmin } = await adminClient.rpc("has_role", { _user_id: userId, _role: "admin" });
        if (isAdmin === true) authorized = true;
      }
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const summary = {
    processed: 0, scored: 0, moved_to_overdue: 0, journey_moved: 0,
    auto_sent: 0, alerts_created: 0, escalations_flagged: 0, dead_leads_flagged: 0, errors: 0,
  };
  const now = new Date();

  try {
    // Templates indexed by title (the analyzer picks templates by title)
    const { data: tplRows } = await supabase
      .from("message_templates")
      .select("id, stage, body, title, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    const templatesByTitle = new Map<string, { id: string; body: string; title: string; stage: string }>();
    const templatesByStage = new Map<string, { id: string; body: string; title: string }[]>();
    for (const t of tplRows ?? []) {
      templatesByTitle.set(t.title, t);
      const arr = templatesByStage.get(t.stage) ?? [];
      arr.push({ id: t.id, body: t.body, title: t.title });
      templatesByStage.set(t.stage, arr);
    }

    // Variants by template_id
    const { data: variantRows } = await supabase
      .from("message_template_variants")
      .select("id, template_id, variant_label, body, is_active, sent_count")
      .eq("is_active", true);
    const variantsByTemplate = new Map<string, { id: string; label: string; body: string; sent: number }[]>();
    for (const v of variantRows ?? []) {
      const arr = variantsByTemplate.get(v.template_id) ?? [];
      arr.push({ id: v.id, label: v.variant_label, body: v.body, sent: v.sent_count ?? 0 });
      variantsByTemplate.set(v.template_id, arr);
    }

    const { data: leads, error: fetchErr } = await supabase
      .from("leads")
      .select("id, customer_name, customer_phone, status, journey_stage, liked_product, product_viewed, neighborhood, budget_range, decision_timeline, family_situation, stated_need, value_in_rupees, concern_type, objection_type, barrier_addressed, response_time_minutes, last_message_at, last_response_at, last_payment_link_sent_at, stage_changed_at, journey_stage_changed_at, created_at, created_by, assigned_to, category, last_inbound_sentiment, last_inbound_concern, last_inbound_intent, unanswered_outbound_count, conversation_message_count, needs_personal_call, dead_lead")
      .is("deleted_at", null)
      .not("status", "in", "(won,lost,converted)")
      .eq("dead_lead", false)
      .limit(2000);

    if (fetchErr) throw fetchErr;
    summary.processed = leads?.length ?? 0;

    for (const lead of (leads ?? []) as Lead[]) {
      try {
        // 1. Refresh score
        const { data: scoreData } = await supabase.rpc("calculate_conversion_probability", { _lead_id: lead.id });
        const { data: breakdown } = await supabase.rpc("calculate_score_breakdown", { _lead_id: lead.id });
        await supabase.from("leads").update({
          conversion_probability: typeof scoreData === "number" ? scoreData : null,
          score_breakdown: breakdown ?? {},
        }).eq("id", lead.id);
        summary.scored++;

        // 2. Detect journey stage
        const { data: detected } = await supabase.rpc("detect_journey_stage", { _lead_id: lead.id });
        const newJourney = (detected as JourneyStage) ?? lead.journey_stage ?? "exploration";
        const journeyChanged = newJourney !== lead.journey_stage;

        if (journeyChanged) {
          const mappedStatus = journeyToStatus(newJourney);
          const updates: Record<string, unknown> = { journey_stage: newJourney, journey_stage_auto: true };
          if (newJourney === "cold") updates.cold_at = now.toISOString();
          if (mappedStatus && mappedStatus !== lead.status) updates.status = mappedStatus;
          await supabase.from("leads").update(updates).eq("id", lead.id);
          summary.journey_moved++;
        }

        // 3. Decide next message
        const daysSinceInbound = lead.last_response_at ? daysBetween(lead.last_response_at, now) : daysBetween(lead.created_at, now);
        const unanswered = lead.unanswered_outbound_count ?? 0;
        const pick = pickTemplateTitle({
          journeyStage: newJourney,
          concern: (lead.last_inbound_concern as any) ?? null,
          intent: (lead.last_inbound_intent as any) ?? null,
          daysSinceLastInbound: daysSinceInbound,
          unansweredCount: unanswered,
        });

        let tpl = pick.title ? templatesByTitle.get(pick.title) : undefined;
        // Fallback to first stage template
        if (!tpl) {
          const stageList = templatesByStage.get(newJourney) ?? [];
          if (stageList.length) {
            const first = stageList[0];
            tpl = { id: first.id, body: first.body, title: first.title, stage: newJourney };
          }
        }

        if (tpl) {
          // Pick variant: round-robin by lowest sent_count
          const variants = variantsByTemplate.get(tpl.id) ?? [];
          let bodySource = tpl.body;
          let variantLabel: string | null = null;
          let variantId: string | null = null;
          if (variants.length > 0) {
            const v = [...variants].sort((a, b) => a.sent - b.sent)[0];
            bodySource = v.body;
            variantLabel = v.label;
            variantId = v.id;
          }
          const body = fillVars(bodySource, lead);

          // Skip if this template already sent in last 24h
          const { data: recentSent } = await supabase
            .from("lead_messages")
            .select("id")
            .eq("lead_id", lead.id)
            .eq("template_id", tpl.id)
            .gte("created_at", new Date(now.getTime() - 24 * 3600 * 1000).toISOString())
            .limit(1);

          // Only send if journey changed OR concern detected OR escalation due
          const shouldSend = journeyChanged
            || pick.messageKind.startsWith("no_response")
            || pick.messageKind.startsWith("objection")
            || pick.messageKind.startsWith("concern")
            || pick.messageKind === "ready_nudge";

          if (shouldSend && (!recentSent || recentSent.length === 0)) {
            const seq = (lead.conversation_message_count ?? 0) + 1;
            const { data: inserted } = await supabase.from("lead_messages").insert({
              lead_id: lead.id,
              message_type: "outbound",
              message_body: body,
              template_id: tpl.id,
              template_used: tpl.title,
              journey_stage: newJourney,
              status: "pending",
              variant: variantLabel,
              message_kind: pick.messageKind,
              sequence_number: seq,
              created_by: lead.assigned_to || lead.created_by,
            }).select("id").single();

            try {
              const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
                body: JSON.stringify({ phone: lead.customer_phone, message: body }),
              });
              const sendJson = await sendRes.json().catch(() => ({}));
              const ok = sendRes.ok && sendJson?.success === true;
              const errMsg = ok ? null : (sendJson?.error || `HTTP ${sendRes.status}`);
              if (inserted?.id) {
                await supabase.from("lead_messages").update({
                  status: ok ? "sent" : "failed",
                  sent_at: ok ? now.toISOString() : null,
                }).eq("id", inserted.id);
              }
              if (ok) {
                summary.auto_sent++;
                if (variantId) await supabase.rpc("bump_variant_sent", { _variant_id: variantId });
                await supabase.from("leads").update({
                  conversation_message_count: seq,
                  unanswered_outbound_count: unanswered + 1,
                  last_recommended_message_type: pick.messageKind,
                }).eq("id", lead.id);
              } else {
                await supabase.from("automation_logs").insert({
                  lead_id: lead.id,
                  event_type: "send_failed",
                  success: false,
                  error_message: errMsg,
                  details: {
                    customer_name: lead.customer_name,
                    phone: lead.customer_phone,
                    template: tpl.title,
                    journey_stage: newJourney,
                  },
                });
              }
            } catch (sendErr) {
              const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
              if (inserted?.id) {
                await supabase.from("lead_messages").update({ status: "failed" }).eq("id", inserted.id);
              }
              await supabase.from("automation_logs").insert({
                lead_id: lead.id,
                event_type: "send_failed",
                success: false,
                error_message: msg,
                details: { customer_name: lead.customer_name, phone: lead.customer_phone, template: tpl.title },
              });
              console.error("send-whatsapp failed:", msg);
            }
          }
        }

        // 4. Escalation flags
        const newUnanswered = (unanswered + (tpl ? 1 : 0));
        if (newUnanswered >= 5 && !lead.dead_lead) {
          await supabase.from("leads").update({ dead_lead: true, journey_stage: "cold", needs_personal_call: false }).eq("id", lead.id);
          summary.dead_leads_flagged++;
        } else if (newUnanswered >= 3 && !lead.needs_personal_call) {
          await supabase.from("leads").update({ needs_personal_call: true }).eq("id", lead.id);
          summary.escalations_flagged++;

          // Notify assigned sales person
          const notifyUser = lead.assigned_to || lead.created_by;
          if (notifyUser) {
            await supabase.from("notifications").insert({
              user_id: notifyUser,
              type: "lead_needs_call",
              message: `📞 ${lead.customer_name} hasn't replied to ${newUnanswered} messages — try a phone call`,
              link: "/leads",
            });
          }
        }

        // 5. Alerts (existing logic, condensed)
        const alerts: { alert_type: string; severity: string; message: string }[] = [];
        if (lead.last_message_at && minsBetween(lead.last_message_at, now) > 30 &&
            (!lead.last_response_at || new Date(lead.last_response_at) < new Date(lead.last_message_at))) {
          alerts.push({
            alert_type: "fast_response", severity: "warning",
            message: `${lead.customer_name} — fast response needed (${minsBetween(lead.last_message_at, now)}m)`,
          });
        }
        if (newJourney === "reassurance" && (!lead.last_response_at || daysBetween(lead.last_response_at, now) >= 2)) {
          alerts.push({ alert_type: "site_visit_needed", severity: "info", message: `Schedule site visit or call for ${lead.customer_name}` });
        }
        if (lead.last_payment_link_sent_at && daysBetween(lead.last_payment_link_sent_at, now) >= 1 &&
            (!lead.last_response_at || new Date(lead.last_response_at) < new Date(lead.last_payment_link_sent_at))) {
          alerts.push({ alert_type: "payment_unread", severity: "warning", message: `Payment link unread by ${lead.customer_name}` });
        }
        if (newJourney === "cold") alerts.push({ alert_type: "cold_reengage", severity: "info", message: `${lead.customer_name} went cold` });
        if (lead.last_inbound_concern && lead.last_inbound_intent === "objection") {
          alerts.push({ alert_type: "objection_unhandled", severity: "warning", message: `${lead.last_inbound_concern} concern raised by ${lead.customer_name}` });
        }

        for (const a of alerts) {
          const { data: existing } = await supabase.from("lead_alerts")
            .select("id").eq("lead_id", lead.id).eq("alert_type", a.alert_type).eq("resolved", false).limit(1);
          if (!existing || existing.length === 0) {
            await supabase.from("lead_alerts").insert({ lead_id: lead.id, ...a });
            summary.alerts_created++;
          }
        }
        if (alerts.length > 0) await supabase.from("leads").update({ last_alert_at: now.toISOString() }).eq("id", lead.id);

        // 6. Legacy: idle FOLLOW_UP/NEGOTIATION → OVERDUE
        const daysInStage = daysBetween(lead.stage_changed_at ?? lead.created_at, now);
        if ((lead.status === "follow_up" || lead.status === "negotiation") && daysInStage >= 30) {
          await supabase.from("leads").update({ status: "overdue", journey_stage: "cold", journey_stage_auto: true }).eq("id", lead.id);
          summary.moved_to_overdue++;
        }
      } catch (e) {
        summary.errors++;
        await supabase.from("automation_logs").insert({
          lead_id: lead.id, event_type: "error",
          details: { stage: lead.status, journey: lead.journey_stage },
          success: false, error_message: (e as Error).message,
        });
      }
    }

    await supabase.from("automation_logs").insert({ event_type: "engine_run", details: summary, success: true });

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await supabase.from("automation_logs").insert({
      event_type: "engine_run", details: summary, success: false, error_message: (e as Error).message,
    });
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
