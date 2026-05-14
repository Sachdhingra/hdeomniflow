import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `You are an AI business intelligence assistant for a furniture CRM called FurnCRM.

PERSONA: Sharp, data-driven business coach. You have full access to real sales data. Think like a senior sales manager doing a weekly pipeline review.

CAPABILITIES:
- You can name individual salespeople and their specific leads
- You can identify leads that are overdue, stale (no action 7+ days), stuck in a stage, or at risk
- You can compare reps against each other and against benchmarks
- You can calculate pace-to-target and forecast month-end achievement
- You can give specific corrections: "Saurabh has 3 leads in negotiation for 10+ days with no follow-up — these need action today"

ANALYSIS STRUCTURE (adapt length to the question):
1. **Status** — where they are right now with actual numbers
2. **Urgent items** — name specific leads/people that need action today
3. **Gaps & root causes** — what's different vs target, and why
4. **Specific actions** — 3-5 items, name names, mention lead values
5. **Forecast** — realistic month-end projection

RULES:
- ALWAYS use numbers from the context. Never invent figures.
- Always name specific leads and salespeople when analyzing problems.
- Use markdown tables when listing multiple leads.
- For stale leads: days_in_stage > 7 with no upcoming follow-up = needs action now.
- For at-risk leads: high value + overdue or stuck = highest priority.
- Days left in month matters for pace calculation.`;

function daysBetween(from: string | null, to: Date): number {
  if (!from) return 0;
  return Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 86400000));
}

function monthStartStr(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysLeftInMonth(): number {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return end.getDate() - now.getDate();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const role = roleRow?.role as string | undefined;
    if (!role || !["admin", "sales", "service_head"].includes(role)) {
      return json({ error: "AI Assistant not available for your role" }, 403);
    }

    const { messages, question } = await req.json();
    const userQuestion: string = question ?? messages?.[messages.length - 1]?.content ?? "";

    const { data: profile } = await admin.from("profiles").select("name").eq("id", user.id).maybeSingle();
    const name = profile?.name ?? "there";

    const now = new Date();
    const mStart = monthStartStr();
    const currentMonth = now.toISOString().slice(0, 7);

    const ctx: Record<string, unknown> = {
      name,
      role,
      asked_at: now.toISOString(),
      month: currentMonth,
      days_left_in_month: daysLeftInMonth(),
    };

    // ─────────────────────────────────────────────
    // ADMIN: full per-person lead intelligence
    // ─────────────────────────────────────────────
    if (role === "admin") {
      // 1. Sales profiles
      const { data: salesRoles } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "sales");
      const salesIds = (salesRoles ?? []).map((r: any) => r.user_id);

      const { data: salesProfiles } = await admin
        .from("profiles")
        .select("id, name")
        .in("id", salesIds)
        .eq("active", true);
      const profileMap: Record<string, string> = {};
      (salesProfiles ?? []).forEach((p: any) => (profileMap[p.id] = p.name));

      // 2. Targets this month
      const { data: targets } = await admin
        .from("sales_targets")
        .select("user_id, target_value")
        .eq("month", currentMonth);
      const targetMap: Record<string, number> = {};
      (targets ?? []).forEach((t: any) => (targetMap[t.user_id] = Number(t.target_value)));

      // 3. All active (open) leads — full detail
      const { data: activeLeads } = await admin
        .from("leads")
        .select("id,customer_name,value_in_rupees,status,category,assigned_to,created_by,stage_changed_at,next_follow_up_date,last_follow_up,notes,conversion_probability,journey_stage,neighborhood,concern_type,created_at")
        .not("status", "in", '("won","lost","converted")')
        .is("deleted_at", null)
        .order("value_in_rupees", { ascending: false })
        .limit(400);

      // 4. Won/lost this month
      const { data: closedThisMonth } = await admin
        .from("leads")
        .select("id,customer_name,value_in_rupees,status,category,assigned_to,stage_changed_at")
        .in("status", ["won", "lost", "converted"])
        .gte("stage_changed_at", mStart)
        .is("deleted_at", null);

      // 5. Build per-person data
      const todayStr = now.toISOString().slice(0, 10);

      const salesTeam = (salesProfiles ?? []).map((sp: any) => {
        const myActive = (activeLeads ?? []).filter(
          (l: any) => l.assigned_to === sp.id || (l.assigned_to == null && l.created_by === sp.id),
        );
        const myClosedThisMonth = (closedThisMonth ?? []).filter((l: any) => l.assigned_to === sp.id);
        const myWonThisMonth = myClosedThisMonth.filter((l: any) => l.status === "won");
        const myLostThisMonth = myClosedThisMonth.filter((l: any) => l.status === "lost");

        const achievedThisMonth = myWonThisMonth.reduce(
          (s: number, l: any) => s + Number(l.value_in_rupees || 0),
          0,
        );
        const target = targetMap[sp.id] ?? 0;

        // Flag each active lead
        const flaggedLeads = myActive.map((l: any) => {
          const daysInStage = daysBetween(l.stage_changed_at ?? l.created_at, now);
          const isOverdue = l.status === "overdue";
          const hasUpcomingFollowUp = l.next_follow_up_date && l.next_follow_up_date >= todayStr;
          const isStale = daysInStage >= 7 && !hasUpcomingFollowUp && !isOverdue;
          const isPastFollowUp = l.next_follow_up_date && l.next_follow_up_date < todayStr;
          return {
            customer: l.customer_name,
            value: Number(l.value_in_rupees || 0),
            category: l.category,
            status: l.status,
            days_in_stage: daysInStage,
            next_follow_up: l.next_follow_up_date ?? null,
            overdue: isOverdue,
            stale: isStale,
            follow_up_missed: isPastFollowUp && !isOverdue,
            probability: l.conversion_probability ?? null,
            concern: l.concern_type ?? null,
            notes: l.notes ? String(l.notes).slice(0, 150) : null,
          };
        });

        // Sort: overdue first, then stale, then by value
        flaggedLeads.sort((a: any, b: any) => {
          if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
          if (a.stale !== b.stale) return a.stale ? -1 : 1;
          return b.value - a.value;
        });

        const overdueCount = flaggedLeads.filter((l: any) => l.overdue).length;
        const staleCount = flaggedLeads.filter((l: any) => l.stale).length;
        const missedCount = flaggedLeads.filter((l: any) => l.follow_up_missed).length;
        const hotCount = flaggedLeads.filter((l: any) => (l.probability ?? 0) >= 70).length;

        // All-time won for conversion rate
        // (approximate from available data)
        const totalHistorical = myActive.length + myClosedThisMonth.length;
        const conversionRate = totalHistorical > 0
          ? Math.round((myWonThisMonth.length / totalHistorical) * 100 * 10) / 10
          : 0;

        return {
          name: sp.name,
          target_this_month: target,
          achieved_this_month: achievedThisMonth,
          pct_to_target: target > 0 ? Math.round((achievedThisMonth / target) * 100) : null,
          gap_to_target: target > 0 ? Math.max(0, target - achievedThisMonth) : null,
          pipeline_summary: {
            active_leads: myActive.length,
            overdue: overdueCount,
            stale_7d_no_followup: staleCount,
            missed_follow_ups: missedCount,
            hot_leads_70pct_plus: hotCount,
            won_this_month_count: myWonThisMonth.length,
            won_this_month_value: achievedThisMonth,
            lost_this_month: myLostThisMonth.length,
            conversion_rate_pct: conversionRate,
          },
          active_leads: flaggedLeads.slice(0, 30), // top 30 by priority
          won_this_month: myWonThisMonth.map((l: any) => ({
            customer: l.customer_name,
            value: Number(l.value_in_rupees || 0),
            category: l.category,
          })),
          lost_this_month: myLostThisMonth.map((l: any) => ({
            customer: l.customer_name,
            value: Number(l.value_in_rupees || 0),
            category: l.category,
          })),
        };
      });

      // Team-level summary
      const totalOverdue = salesTeam.reduce(
        (s: number, p: any) => s + p.pipeline_summary.overdue, 0,
      );
      const totalStale = salesTeam.reduce(
        (s: number, p: any) => s + p.pipeline_summary.stale_7d_no_followup, 0,
      );
      const totalWonValue = salesTeam.reduce(
        (s: number, p: any) => s + p.achieved_this_month, 0,
      );
      const totalTarget = salesTeam.reduce(
        (s: number, p: any) => s + (p.target_this_month || 0), 0,
      );
      const topPerformer = [...salesTeam].sort(
        (a: any, b: any) => b.achieved_this_month - a.achieved_this_month,
      )[0]?.name ?? "—";
      const mostBehind = [...salesTeam]
        .filter((p: any) => p.target_this_month > 0)
        .sort((a: any, b: any) => (a.pct_to_target ?? 0) - (b.pct_to_target ?? 0))[0]?.name ?? "—";

      ctx.sales_team = salesTeam;
      ctx.team_summary = {
        total_active_leads: (activeLeads ?? []).length,
        total_overdue,
        total_stale_7d: totalStale,
        team_won_this_month: totalWonValue,
        team_target_this_month: totalTarget,
        team_pct_to_target: totalTarget > 0 ? Math.round((totalWonValue / totalTarget) * 100) : null,
        top_performer_this_month: topPerformer,
        most_behind_on_target: mostBehind,
        days_left_in_month: daysLeftInMonth(),
      };

    // ─────────────────────────────────────────────
    // SALES: own pipeline with full lead detail
    // ─────────────────────────────────────────────
    } else if (role === "sales") {
      const { data: target } = await admin
        .from("sales_targets")
        .select("target_value")
        .eq("user_id", user.id)
        .eq("month", currentMonth)
        .maybeSingle();

      // Own active leads
      const { data: activeLeads } = await admin
        .from("leads")
        .select("id,customer_name,value_in_rupees,status,category,stage_changed_at,next_follow_up_date,last_follow_up,notes,conversion_probability,journey_stage,neighborhood,concern_type,created_at")
        .eq("assigned_to", user.id)
        .not("status", "in", '("won","lost","converted")')
        .is("deleted_at", null)
        .order("value_in_rupees", { ascending: false });

      // Won/lost this month
      const { data: closedThisMonth } = await admin
        .from("leads")
        .select("id,customer_name,value_in_rupees,status,category,stage_changed_at")
        .eq("assigned_to", user.id)
        .in("status", ["won", "lost", "converted"])
        .gte("stage_changed_at", mStart)
        .is("deleted_at", null);

      const wonThisMonth = (closedThisMonth ?? []).filter((l: any) => l.status === "won");
      const lostThisMonth = (closedThisMonth ?? []).filter((l: any) => l.status === "lost");
      const achieved = wonThisMonth.reduce(
        (s: number, l: any) => s + Number(l.value_in_rupees || 0),
        0,
      );
      const targetVal = target ? Number(target.target_value) : 0;
      const todayStr = now.toISOString().slice(0, 10);

      const flaggedLeads = (activeLeads ?? []).map((l: any) => {
        const daysInStage = daysBetween(l.stage_changed_at ?? l.created_at, now);
        const isOverdue = l.status === "overdue";
        const hasUpcomingFollowUp = l.next_follow_up_date && l.next_follow_up_date >= todayStr;
        const isStale = daysInStage >= 7 && !hasUpcomingFollowUp && !isOverdue;
        const isPastFollowUp = l.next_follow_up_date && l.next_follow_up_date < todayStr;
        return {
          customer: l.customer_name,
          value: Number(l.value_in_rupees || 0),
          category: l.category,
          status: l.status,
          days_in_stage: daysInStage,
          next_follow_up: l.next_follow_up_date ?? null,
          overdue: isOverdue,
          stale: isStale,
          follow_up_missed: isPastFollowUp && !isOverdue,
          probability: l.conversion_probability ?? null,
          concern: l.concern_type ?? null,
          neighborhood: l.neighborhood ?? null,
          notes: l.notes ? String(l.notes).slice(0, 200) : null,
        };
      });

      flaggedLeads.sort((a: any, b: any) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.stale !== b.stale) return a.stale ? -1 : 1;
        return b.value - a.value;
      });

      // Required-to-win pace
      const daysLeft = daysLeftInMonth();
      const gap = Math.max(0, targetVal - achieved);
      const avgDailyRequired = daysLeft > 0 ? Math.round(gap / daysLeft) : gap;

      ctx.your_metrics = {
        target: targetVal || null,
        achieved_this_month: achieved,
        pct_to_target: targetVal > 0 ? Math.round((achieved / targetVal) * 100) : null,
        gap_to_target: targetVal > 0 ? gap : null,
        days_left_in_month: daysLeft,
        daily_avg_needed_to_hit_target: targetVal > 0 ? avgDailyRequired : null,
        won_this_month: wonThisMonth.map((l: any) => ({
          customer: l.customer_name,
          value: Number(l.value_in_rupees || 0),
          category: l.category,
        })),
        lost_this_month: lostThisMonth.map((l: any) => ({
          customer: l.customer_name,
          value: Number(l.value_in_rupees || 0),
        })),
      };
      ctx.pipeline = {
        total_active: flaggedLeads.length,
        overdue_count: flaggedLeads.filter((l: any) => l.overdue).length,
        stale_count: flaggedLeads.filter((l: any) => l.stale).length,
        missed_follow_ups: flaggedLeads.filter((l: any) => l.follow_up_missed).length,
        hot_leads: flaggedLeads.filter((l: any) => (l.probability ?? 0) >= 70).length,
        leads: flaggedLeads, // full detail, all active leads
      };

    // ─────────────────────────────────────────────
    // SERVICE HEAD
    // ─────────────────────────────────────────────
    } else if (role === "service_head") {
      const today = now.toISOString().slice(0, 10);
      const { data: jobs } = await admin
        .from("service_jobs")
        .select("id,type,status,date_to_attend,assigned_agent,customer_name,address,accounts_approval_status,created_at,completed_at,value")
        .is("deleted_at", null)
        .order("date_to_attend");

      const { data: agentProfiles } = await admin
        .from("profiles")
        .select("id, name")
        .eq("active", true);
      const agentMap: Record<string, string> = {};
      (agentProfiles ?? []).forEach((p: any) => (agentMap[p.id] = p.name));

      const todayJobs = (jobs ?? []).filter((j: any) => j.date_to_attend === today);
      const overdue = (jobs ?? []).filter(
        (j: any) =>
          j.date_to_attend &&
          j.date_to_attend < today &&
          !["completed", "cancelled"].includes(j.status),
      );
      const completedThisMonth = (jobs ?? []).filter(
        (j: any) => j.completed_at && j.completed_at >= mStart,
      );
      const pending = (jobs ?? []).filter(
        (j: any) => !["completed", "cancelled"].includes(j.status),
      );

      ctx.deliveries = {
        today_count: todayJobs.length,
        today: todayJobs.map((j: any) => ({
          customer: j.customer_name,
          status: j.status,
          agent: j.assigned_agent ? (agentMap[j.assigned_agent] ?? j.assigned_agent) : "Unassigned",
          address: j.address,
        })),
        overdue_count: overdue.length,
        overdue_jobs: overdue.slice(0, 10).map((j: any) => ({
          customer: j.customer_name,
          date: j.date_to_attend,
          status: j.status,
          agent: j.assigned_agent ? (agentMap[j.assigned_agent] ?? "?") : "Unassigned",
        })),
        completed_this_month: completedThisMonth.length,
        total_pending: pending.length,
      };
    }

    // ─────────────────────────────────────────────
    // Build prompt and call AI
    // ─────────────────────────────────────────────
    const userContent =
      `User: ${name} | Role: ${role} | Date: ${now.toISOString().slice(0, 10)}\n\n` +
      `=== LIVE DATA CONTEXT ===\n${JSON.stringify(ctx, null, 2)}\n` +
      `=== END CONTEXT ===\n\n` +
      `Question: ${userQuestion}\n\n` +
      `Answer with specific names, lead values, and action items from the data above.`;

    const aiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...((messages ?? []).slice(0, -1) as { role: string; content: string }[]),
      { role: "user", content: userContent },
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: aiMessages,
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return json({ error: "Rate limit — please retry shortly." }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted. Top up in Settings → Workspace → Usage." }, 402);
      const t = await aiResp.text();
      console.error("AI error", aiResp.status, t);
      return json({ error: "AI gateway error" }, 500);
    }

    const aiJson = await aiResp.json();
    const reply = aiJson?.choices?.[0]?.message?.content ?? "";
    return json({ reply, role });
  } catch (e) {
    console.error("ai-assistant error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
