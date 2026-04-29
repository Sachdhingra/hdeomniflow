// Autonomous lead nurture engine — runs daily.
// Responsibilities:
//   1. Refresh conversion_probability + score breakdown for all active leads
//   2. Detect psychology journey stage (problem/exploration/evaluation/reassurance/decision/cold)
//      and move the lead automatically (logged to lead_journey_history via trigger)
//   3. Auto-send a stage-appropriate template (logs to lead_messages, calls send-whatsapp)
//   4. Generate alerts (fast_response, site_visit_needed, payment_unread, cold_reengage)
//   5. Auto-move FOLLOW_UP / NEGOTIATION leads idle 30+ days into OVERDUE
//   6. Log every action to automation_logs
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHOWROOM = {
  name: "Home Decor Enterprises",
  address: "Dehradun (full address)",
  hours: "Mon–Sat, 10 AM – 7 PM",
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
}

const daysBetween = (iso: string | null, now: Date) => {
  if (!iso) return 0;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
};
const minsBetween = (iso: string | null, now: Date) => {
  if (!iso) return 0;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
};

// Map journey stage -> kanban status (so existing flow stays in sync)
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

function fillVars(body: string, lead: Lead): string {
  const map: Record<string, string> = {
    name: lead.customer_name,
    phone: lead.customer_phone,
    neighborhood: lead.neighborhood || "",
    product: lead.product_viewed || lead.liked_product || "the piece you liked",
    budget_range: lead.budget_range || "",
    stated_need: lead.stated_need || "",
    family_type: lead.family_situation || "",
    amount: Number(lead.value_in_rupees || 0).toLocaleString("en-IN"),
  };
  return body.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (_, n) => map[n] ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const summary = {
    processed: 0,
    scored: 0,
    moved_to_overdue: 0,
    journey_moved: 0,
    auto_sent: 0,
    alerts_created: 0,
    queued: 0,
    errors: 0,
  };
  const now = new Date();

  try {
    // Pre-load active templates by stage
    const { data: tplRows } = await supabase
      .from("message_templates")
      .select("id, stage, body, title, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    const templatesByStage = new Map<string, { id: string; body: string; title: string }[]>();
    for (const t of tplRows ?? []) {
      const arr = templatesByStage.get(t.stage) ?? [];
      arr.push({ id: t.id, body: t.body, title: t.title });
      templatesByStage.set(t.stage, arr);
    }

    const { data: leads, error: fetchErr } = await supabase
      .from("leads")
      .select("id, customer_name, customer_phone, status, journey_stage, liked_product, product_viewed, neighborhood, budget_range, decision_timeline, family_situation, stated_need, value_in_rupees, concern_type, objection_type, barrier_addressed, response_time_minutes, last_message_at, last_response_at, last_payment_link_sent_at, stage_changed_at, journey_stage_changed_at, created_at, created_by, assigned_to")
      .is("deleted_at", null)
      .not("status", "in", "(won,lost,converted)")
      .limit(2000);

    if (fetchErr) throw fetchErr;
    summary.processed = leads?.length ?? 0;

    for (const lead of (leads ?? []) as Lead[]) {
      try {
        // 1. Refresh score + breakdown
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

        if (newJourney !== lead.journey_stage) {
          const mappedStatus = journeyToStatus(newJourney);
          const updates: Record<string, unknown> = {
            journey_stage: newJourney,
            journey_stage_auto: true,
          };
          if (newJourney === "cold") updates.cold_at = now.toISOString();
          if (mappedStatus && mappedStatus !== lead.status) {
            updates.status = mappedStatus;
          }
          await supabase.from("leads").update(updates).eq("id", lead.id);
          summary.journey_moved++;

          // 3. Auto-send a stage template (first active one for that stage)
          const tpls = templatesByStage.get(newJourney) ?? [];
          if (tpls.length > 0) {
            const tpl = tpls[0];
            const body = fillVars(tpl.body, lead);

            // Skip if same template sent in last 24h
            const { data: recentSent } = await supabase
              .from("lead_messages")
              .select("id")
              .eq("lead_id", lead.id)
              .eq("template_id", tpl.id)
              .gte("created_at", new Date(now.getTime() - 24 * 3600 * 1000).toISOString())
              .limit(1);

            if (!recentSent || recentSent.length === 0) {
              // Insert as outbound (RLS bypassed via service role)
              const { data: inserted } = await supabase.from("lead_messages").insert({
                lead_id: lead.id,
                message_type: "outbound",
                message_body: body,
                template_id: tpl.id,
                template_used: tpl.title,
                journey_stage: newJourney,
                status: "pending",
                created_by: lead.assigned_to || lead.created_by,
              }).select("id").single();

              // Fire send-whatsapp
              try {
                const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
                  body: JSON.stringify({ phone: lead.customer_phone, message: body }),
                });
                const ok = sendRes.ok;
                if (inserted?.id) {
                  await supabase.from("lead_messages").update({
                    status: ok ? "sent" : "failed",
                    sent_at: ok ? now.toISOString() : null,
                  }).eq("id", inserted.id);
                }
                if (ok) summary.auto_sent++;
              } catch (sendErr) {
                if (inserted?.id) {
                  await supabase.from("lead_messages").update({ status: "failed" }).eq("id", inserted.id);
                }
                console.error("send-whatsapp failed:", sendErr);
              }
            }
          }
        }

        // 4. Alerts
        const alerts: { alert_type: string; severity: string; message: string }[] = [];

        // Fast response: outbound message > 30 min ago, no inbound after
        if (lead.last_message_at && minsBetween(lead.last_message_at, now) > 30 &&
            (!lead.last_response_at || new Date(lead.last_response_at) < new Date(lead.last_message_at))) {
          alerts.push({
            alert_type: "fast_response",
            severity: "warning",
            message: `${lead.customer_name} — fast response needed (${minsBetween(lead.last_message_at, now)}m)`,
          });
        }

        // Site visit needed: in reassurance, no recent inbound
        if (newJourney === "reassurance" && (!lead.last_response_at || daysBetween(lead.last_response_at, now) >= 2)) {
          alerts.push({
            alert_type: "site_visit_needed",
            severity: "info",
            message: `Schedule site visit or call for ${lead.customer_name}`,
          });
        }

        // Payment link unread: sent 24h+ ago with no response
        if (lead.last_payment_link_sent_at && daysBetween(lead.last_payment_link_sent_at, now) >= 1 &&
            (!lead.last_response_at || new Date(lead.last_response_at) < new Date(lead.last_payment_link_sent_at))) {
          alerts.push({
            alert_type: "payment_unread",
            severity: "warning",
            message: `Payment link unread by ${lead.customer_name} — send a gentle reminder`,
          });
        }

        // Cold re-engagement
        if (newJourney === "cold") {
          alerts.push({
            alert_type: "cold_reengage",
            severity: "info",
            message: `${lead.customer_name} went cold — try a "we miss you" message`,
          });
        }

        // Objection unhandled
        if (lead.objection_type && !lead.barrier_addressed) {
          alerts.push({
            alert_type: "objection_unhandled",
            severity: "warning",
            message: `Address ${lead.objection_type} objection for ${lead.customer_name}`,
          });
        }

        for (const a of alerts) {
          // Only one open alert of each type per lead
          const { data: existing } = await supabase
            .from("lead_alerts")
            .select("id")
            .eq("lead_id", lead.id)
            .eq("alert_type", a.alert_type)
            .eq("resolved", false)
            .limit(1);
          if (!existing || existing.length === 0) {
            await supabase.from("lead_alerts").insert({ lead_id: lead.id, ...a });
            summary.alerts_created++;
          }
        }

        if (alerts.length > 0) {
          await supabase.from("leads").update({ last_alert_at: now.toISOString() }).eq("id", lead.id);
        }

        // 5. Legacy: auto-move idle FOLLOW_UP/NEGOTIATION → OVERDUE
        const daysInStage = daysBetween(lead.stage_changed_at ?? lead.created_at, now);
        if ((lead.status === "follow_up" || lead.status === "negotiation") && daysInStage >= 30) {
          await supabase.from("leads").update({ status: "overdue", journey_stage: "cold", journey_stage_auto: true }).eq("id", lead.id);
          summary.moved_to_overdue++;
        }
      } catch (e) {
        summary.errors++;
        await supabase.from("automation_logs").insert({
          lead_id: lead.id,
          event_type: "error",
          details: { stage: lead.status, journey: lead.journey_stage },
          success: false,
          error_message: (e as Error).message,
        });
      }
    }

    await supabase.from("automation_logs").insert({
      event_type: "engine_run",
      details: summary,
      success: true,
    });

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await supabase.from("automation_logs").insert({
      event_type: "engine_run",
      details: summary,
      success: false,
      error_message: (e as Error).message,
    });
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
