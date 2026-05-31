import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `You are an AI business coach for a furniture sales & delivery company.
TONE: Friendly, direct, encouraging. Like a mentor.
ANALYSIS structure:
- Status: Where are they now? (actual numbers)
- Gaps: What's different vs target/team? (quantified)
- Reasons: Why? (root causes)
- Actions: 3-5 specific items
- Impact: realistic forecast

DISPATCH SCHEDULING: When asked to plan a dispatch schedule, use the calendar entries, agent details, job locations, and BOQ to build a time-ordered plan. Consider:
- Agent working hours (09:00–18:00 default, adjust for known constraints)
- Travel time between locations (cluster nearby jobs to the same agent)
- Job complexity from BOQ/description (simple service ~1h, complex install ~2-4h)
- Agent efficiency score if provided (high efficiency = tighter schedule)
- Prioritise overdue jobs and jobs with earlier date_to_attend
- Output as a table: Time | Agent | Customer | Address | Job Type | Est. Duration

ALWAYS use the real data provided. Never invent numbers. Never share other people's personal data.
Use markdown for formatting.`;

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

    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    const role = roleRow?.role as string | undefined;
    if (!role || !["admin", "sales", "service_head"].includes(role)) {
      return json({ error: "AI Assistant not available for your role" }, 403);
    }

    const { messages, question } = await req.json();
    const userQuestion: string = question ?? messages?.[messages.length - 1]?.content ?? "";

    // Fetch role-scoped context
    const { data: profile } = await admin.from("profiles").select("name").eq("id", user.id).maybeSingle();
    const name = profile?.name ?? "there";

    const ctx: Record<string, unknown> = { name, role, asked_at: new Date().toISOString() };
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    if (role === "sales") {
      const { data: leads } = await admin
        .from("leads")
        .select("id,status,value_in_rupees,journey_stage,conversion_probability,created_at,stage_changed_at,decision_timeline,budget_range,customer_name,total_sales,repeat_customer")
        .or(`created_by.eq.${user.id},assigned_to.eq.${user.id}`)
        .is("deleted_at", null);

      const { data: target } = await admin
        .from("sales_targets")
        .select("target_value")
        .eq("user_id", user.id)
        .eq("month", monthStart.toISOString().slice(0, 7))
        .maybeSingle();

      const wonThisMonth = (leads ?? []).filter(
        (l: any) => l.status === "won" && new Date(l.stage_changed_at ?? l.created_at) >= monthStart,
      );
      const achieved = wonThisMonth.reduce((s: number, l: any) => s + Number(l.value_in_rupees || 0), 0);
      const byStage: Record<string, number> = {};
      (leads ?? []).forEach((l: any) => (byStage[l.status] = (byStage[l.status] || 0) + 1));
      const hot = (leads ?? [])
        .filter((l: any) => (l.conversion_probability ?? 0) >= 70 && !["won", "lost", "converted"].includes(l.status))
        .sort((a: any, b: any) => (b.conversion_probability ?? 0) - (a.conversion_probability ?? 0))
        .slice(0, 10)
        .map((l: any) => ({
          name: l.customer_name,
          value: l.value_in_rupees,
          score: l.conversion_probability,
          stage: l.status,
        }));

      // Team benchmarks (aggregate, anonymized)
      const { data: allLeads } = await admin
        .from("leads")
        .select("status,value_in_rupees,conversion_probability,stage_changed_at,created_at")
        .is("deleted_at", null);
      const teamWon = (allLeads ?? []).filter((l: any) => l.status === "won");
      const teamConv = allLeads?.length ? (teamWon.length / allLeads.length) * 100 : 0;

      ctx.your_metrics = {
        target: target?.target_value ?? null,
        achieved_this_month: achieved,
        won_count_this_month: wonThisMonth.length,
        total_leads: leads?.length ?? 0,
        leads_by_stage: byStage,
        hot_leads: hot,
      };
      ctx.team_benchmarks = {
        avg_conversion_pct: Math.round(teamConv * 10) / 10,
        total_leads: allLeads?.length ?? 0,
      };
    } else if (role === "service_head") {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      const { data: jobs } = await admin
        .from("service_jobs")
        .select("id,type,status,date_to_attend,assigned_agent,customer_name,address,description,category,value,is_foc,accounts_approval_status,created_at,completed_at")
        .is("deleted_at", null);

      const { data: agentProfiles } = await admin
        .from("profiles")
        .select("id,name,phone_number");
      const { data: agentRoles } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "field_agent");
      const agentIds = new Set((agentRoles ?? []).map((r: any) => r.user_id));
      const agents = (agentProfiles ?? []).filter((p: any) => agentIds.has(p.id));

      // Compute per-agent job counts for efficiency proxy
      const activeJobs = (jobs ?? []).filter((j: any) => !["completed", "cancelled"].includes(j.status));
      const agentLoad: Record<string, number> = {};
      activeJobs.forEach((j: any) => {
        if (j.assigned_agent) agentLoad[j.assigned_agent] = (agentLoad[j.assigned_agent] || 0) + 1;
      });

      const { data: completedLast30 } = await admin
        .from("service_jobs")
        .select("assigned_agent,completed_at")
        .eq("status", "completed")
        .gte("completed_at", new Date(Date.now() - 30 * 86400000).toISOString())
        .is("deleted_at", null);
      const agentCompletions: Record<string, number> = {};
      (completedLast30 ?? []).forEach((j: any) => {
        if (j.assigned_agent) agentCompletions[j.assigned_agent] = (agentCompletions[j.assigned_agent] || 0) + 1;
      });

      const todayJobs = (jobs ?? []).filter((j: any) => j.date_to_attend === today);
      const tomorrowJobs = (jobs ?? []).filter((j: any) => j.date_to_attend === tomorrow);
      const upcomingUnassigned = (jobs ?? []).filter(
        (j: any) => !j.assigned_agent && j.date_to_attend >= today && !["completed", "cancelled"].includes(j.status),
      );
      const overdue = (jobs ?? []).filter(
        (j: any) => j.date_to_attend && j.date_to_attend < today && !["completed", "cancelled"].includes(j.status),
      );
      const completedThisMonth = (jobs ?? []).filter(
        (j: any) => j.completed_at && new Date(j.completed_at) >= monthStart,
      );

      ctx.deliveries = {
        today_count: todayJobs.length,
        today: todayJobs.map((j: any) => ({
          id: j.id, customer: j.customer_name, address: j.address,
          status: j.status, type: j.type, category: j.category,
          description: j.description, agent_id: j.assigned_agent,
          agent_name: agents.find((a: any) => a.id === j.assigned_agent)?.name ?? null,
        })),
        tomorrow_count: tomorrowJobs.length,
        tomorrow: tomorrowJobs.map((j: any) => ({
          id: j.id, customer: j.customer_name, address: j.address,
          status: j.status, type: j.type, category: j.category,
          description: j.description, agent_id: j.assigned_agent,
          agent_name: agents.find((a: any) => a.id === j.assigned_agent)?.name ?? null,
        })),
        unassigned_upcoming: upcomingUnassigned.map((j: any) => ({
          id: j.id, customer: j.customer_name, address: j.address,
          date: j.date_to_attend, type: j.type, category: j.category, description: j.description,
        })),
        overdue_count: overdue.length,
        overdue: overdue.map((j: any) => ({
          id: j.id, customer: j.customer_name, address: j.address,
          date: j.date_to_attend, agent_name: agents.find((a: any) => a.id === j.assigned_agent)?.name ?? null,
        })),
        completed_this_month: completedThisMonth.length,
        total_active: activeJobs.length,
      };
      ctx.field_agents = agents.map((a: any) => ({
        id: a.id, name: a.name,
        current_load: agentLoad[a.id] || 0,
        completions_last_30d: agentCompletions[a.id] || 0,
      }));
    } else if (role === "admin") {
      const { data: summaryRpc } = await admin.rpc("get_dashboard_summary");
      ctx.summary = summaryRpc;
      const { count: leadCount } = await admin.from("leads").select("*", { count: "exact", head: true }).is("deleted_at", null);
      const { count: jobCount } = await admin.from("service_jobs").select("*", { count: "exact", head: true }).is("deleted_at", null);
      ctx.totals = { leads: leadCount, service_jobs: jobCount };
    }

    const userContent =
      `User: ${name}\nRole: ${role}\nContext data (JSON):\n${JSON.stringify(ctx, null, 2)}\n\n` +
      `Question: ${userQuestion}\n\nAnalyze and respond with specific numbers from the context above.`;

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
      if (aiResp.status === 429) return json({ error: "Rate limit, please retry shortly." }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }, 402);
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
