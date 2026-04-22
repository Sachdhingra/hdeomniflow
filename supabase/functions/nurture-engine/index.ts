// Autonomous lead nurture engine — runs daily.
// Responsibilities:
//   1. Refresh conversion_probability for all active leads
//   2. Auto-move FOLLOW_UP / NEGOTIATION leads idle 30+ days into OVERDUE
//   3. Queue stage-based WhatsApp templates into auto_nurture_messages (status='pending', no send)
//   4. Log every action to automation_logs
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

interface Lead {
  id: string;
  customer_name: string;
  customer_phone: string;
  status: Stage;
  liked_product: string | null;
  value_in_rupees: number;
  concern_type: string | null;
  stage_changed_at: string | null;
  created_at: string;
}

const daysBetween = (iso: string | null, now: Date) => {
  if (!iso) return 0;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
};

function buildMessage(lead: Lead, stage: Stage, days: number, concern: string | null): { type: string; body: string } | null {
  const name = lead.customer_name;
  const product = lead.liked_product || "the piece you liked";
  const sig = `\n\n📍 ${SHOWROOM.address}\n🕐 ${SHOWROOM.hours}\n\n${SHOWROOM.name}`;

  if (stage === "new" && days === 0) {
    return { type: "welcome", body: `Hi ${name}! 👋\n\nThanks for visiting ${SHOWROOM.name}!\n\nWe loved that you checked out ${product}. Whenever you're ready to discuss, we're here.${sig}` };
  }
  if (stage === "follow_up") {
    if (days === 1) return { type: "followup_day_1", body: `Hi ${name}! 👋\n\nDiscussed with family yet? 😊\n${product} is still available. When can you bring them by?${sig}` };
    if (days === 7) return { type: "followup_day_7", body: `Hi ${name}! 👋\n\nYour ${product} is getting popular — stock is limited. Don't delay if you're interested!${sig}` };
    if (days === 14) return { type: "followup_day_14", body: `Hi ${name}! 👋\n\nSpecial this weekend: family deal on ${product}. Bring family to decide together!${sig}` };
    if (days === 21) return { type: "followup_day_21", body: `Hi ${name}! 👋\n\nStill interested in ${product}? We're ready whenever you are — how can we help?${sig}` };
  }
  if (stage === "negotiation") {
    if (days === 1) return { type: "negotiation_diagnose", body: `Hi ${name}! 👋\n\nI sense ₹${Number(lead.value_in_rupees).toLocaleString("en-IN")} feels like a lot, and that's okay.\n\nWhat's holding you back?\nA) Budget feels tight\nB) Want to see other designs\nC) Need to discuss with family\nD) Better timing later\nE) Something else\n\nReply A, B, C, D, or E.${sig}` };
    if (days === 5) {
      if (concern === "budget") return { type: "negotiation_budget", body: `Hi ${name}! 👋\n\nLet's make this work!\n✅ Pay 50% now, 50% later\n✅ 0% EMI available\n\nReply 1 or 2 — our team will prepare exact plan for ${product}.${sig}` };
      if (concern === "design") return { type: "negotiation_design", body: `Hi ${name}! 👋\n\nWe have options:\nBUDGET — similar design, lower price\nMID — your original (most popular)\nPREMIUM — best in class\n\nWhich appeals? A, B, or C?${sig}` };
      if (concern === "family") return { type: "negotiation_family", body: `Hi ${name}! 👋\n\nSmart — bring your family to decide together. ${product} is on display. When can you visit?${sig}` };
      if (concern === "timing") return { type: "negotiation_timing", body: `Hi ${name}! 👋\n\nNo rush! When would be ideal — 3 months, 6 months, end of year? We'll reach out then. (Prices only go up 📈)${sig}` };
      return { type: "negotiation_day_5_generic", body: `Hi ${name}! 👋\n\nAny update on ${product}? Happy to help with payment, design, or family-visit options.${sig}` };
    }
    if (days === 10) return { type: "negotiation_day_10", body: `Hi ${name}! 👋\n\nFollowing up on ${product}. Anything I can clarify to help you decide?${sig}` };
    if (days === 20) return { type: "negotiation_final", body: `Hi ${name}! 👋\n\nFinal check-in: anything I missed? Payment, design, delivery, warranty — let's finalize!${sig}` };
  }
  if (stage === "overdue" && days === 0) {
    return { type: "overdue_reengage", body: `Hi ${name}! 👋\n\nWe miss you! ❤️\n\nWhat's holding you back?\nA) Not the right design\nB) Price still high\nC) Family not interested\nD) Better timing later\nE) Not interested anymore\n\nReply A–E and we'll help!${sig}` };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const summary = { processed: 0, scored: 0, moved_to_overdue: 0, queued: 0, errors: 0 };
  const now = new Date();

  try {
    const { data: leads, error: fetchErr } = await supabase
      .from("leads")
      .select("id, customer_name, customer_phone, status, liked_product, value_in_rupees, concern_type, stage_changed_at, created_at")
      .is("deleted_at", null)
      .in("status", ["new", "contacted", "follow_up", "negotiation", "overdue"])
      .limit(2000);

    if (fetchErr) throw fetchErr;
    summary.processed = leads?.length ?? 0;

    for (const lead of (leads ?? []) as Lead[]) {
      try {
        // 1. Refresh score
        const { data: scoreData } = await supabase.rpc("calculate_conversion_probability", { _lead_id: lead.id });
        if (typeof scoreData === "number") {
          await supabase.from("leads").update({ conversion_probability: scoreData }).eq("id", lead.id);
          summary.scored++;
        }

        // 2. Auto-move to OVERDUE
        const daysInStage = daysBetween(lead.stage_changed_at ?? lead.created_at, now);
        let effectiveStage: Stage = lead.status;
        let effectiveDays = daysInStage;

        if ((lead.status === "follow_up" || lead.status === "negotiation") && daysInStage >= 30) {
          await supabase.from("leads").update({ status: "overdue" }).eq("id", lead.id);
          effectiveStage = "overdue";
          effectiveDays = 0;
          summary.moved_to_overdue++;
          await supabase.from("automation_logs").insert({
            lead_id: lead.id,
            event_type: "stage_changed",
            details: { from: lead.status, to: "overdue", reason: "auto_30_day_idle" },
            success: true,
          });
        }

        // 3. Queue stage-based message
        const tpl = buildMessage(lead, effectiveStage, effectiveDays, lead.concern_type);
        if (tpl) {
          // Skip if same message_type already queued/sent in last 24h
          const { data: recent } = await supabase
            .from("auto_nurture_messages")
            .select("id")
            .eq("lead_id", lead.id)
            .eq("message_type", tpl.type)
            .gte("created_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
            .limit(1);

          if (!recent || recent.length === 0) {
            await supabase.from("auto_nurture_messages").insert({
              lead_id: lead.id,
              trigger_stage: effectiveStage,
              days_in_stage: effectiveDays,
              concern_type: lead.concern_type,
              message_type: tpl.type,
              message_body: tpl.body,
              status: "pending",
              scheduled_for: now.toISOString(),
            });
            summary.queued++;
          }
        }
      } catch (e) {
        summary.errors++;
        await supabase.from("automation_logs").insert({
          lead_id: lead.id,
          event_type: "error",
          details: { stage: lead.status },
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
