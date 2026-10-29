/**
 * daily-admin-summary — the admin's end-of-day report, built at 8:05 pm IST.
 *
 *   POST { source?, notify?, date?, force?, dry_run? }
 *     x-internal-secret (pg_cron)   OR   an admin's user JWT (Day Summary page)
 *
 * Gathers the day's facts for the sales team and the service head (plus an accounts line),
 * turns them into a short report — what was done, the plan for tomorrow, who needs
 * special attention — and stores it for the admin pop-up. All numbers come from
 * code (_shared/day-summary.ts); the AI only writes the headline and a few focus
 * lines on top, and the report is complete without it.
 *
 *   - One report per day. A second cron call returns the existing one unless force.
 *   - notify (default true for cron, false for a manual run) pushes the headline
 *     to the admins' phones.
 *   - dry_run returns the report without storing or notifying (for checking).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { addDays, checkinStats, istDateString, istMidnightMs, type CoachMsgRow } from "../_shared/coach-metrics.ts";
import { autoFlipTimesByLead, isAutoStatusFlip, isAutoTouch } from "../_shared/activity.ts";
import { buildReport, headlinePrompt, parseHeadlineJson, type DayFacts, type RepDay, type ServiceHeadDay } from "../_shared/day-summary.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("LOYALTY_CRON_SECRET") ?? "";
const MODEL = "google/gemini-2.5-flash";
const CLOSED = ["won", "lost", "converted"];
const OPEN_JOB_STATUSES = ["pending", "assigned", "on_route", "on_site", "in_progress", "rescheduled"];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// PostgREST returns at most 1000 rows per request — page through everything.
// deno-lint-ignore no-explicit-any
async function fetchAll<T = any>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
}

async function collectFacts(date: string): Promise<DayFacts> {
  const dayStart = istMidnightMs(date);
  const dayEnd = istMidnightMs(addDays(date, 1));
  const dayStartIso = new Date(dayStart).toISOString();
  const dayEndIso = new Date(dayEnd).toISOString();
  const tomorrow = addDays(date, 1);
  const month = date.slice(0, 7);
  const monthStartIso = new Date(istMidnightMs(`${month}-01`)).toISOString();
  const weekStart = addDays(date, -6);

  const { data: roleRows } = await admin.from("user_roles").select("user_id").eq("role", "sales");
  const salesIds = (roleRows ?? []).map((r: { user_id: string }) => r.user_id);
  const { data: profiles } = await admin.from("profiles").select("id,name").in("id", salesIds).eq("active", true);
  const reps = (profiles ?? []) as { id: string; name: string }[];
  const ids = reps.map((r) => r.id);

  const [attendance, stages, touched, created, coachMsgs, dueTomorrow, dueToday, overdue, wonMonth, targets, pushRows] = await Promise.all([
    fetchAll<{ user_id: string; date: string; clock_in: string | null; status: string }>((a, b) =>
      admin.from("attendance").select("user_id,date,clock_in,status").in("user_id", ids).gte("date", weekStart).lte("date", date).range(a, b)),
    fetchAll<{ lead_id: string; old_stage: string | null; new_stage: string | null; changed_by_id: string; changed_at: string }>((a, b) =>
      admin.from("lead_stage_history").select("lead_id,old_stage,new_stage,changed_by_id,changed_at").in("changed_by_id", ids)
        .gte("changed_at", dayStartIso).lt("changed_at", dayEndIso).range(a, b)),
    fetchAll<{ id: string; updated_by: string; updated_at: string }>((a, b) =>
      admin.from("leads").select("id,updated_by,updated_at").in("updated_by", ids).is("deleted_at", null)
        .gte("updated_at", dayStartIso).lt("updated_at", dayEndIso).range(a, b)),
    fetchAll<{ created_by: string }>((a, b) =>
      admin.from("leads").select("created_by").in("created_by", ids).is("deleted_at", null)
        .gte("created_at", dayStartIso).lt("created_at", dayEndIso).range(a, b)),
    fetchAll<CoachMsgRow>((a, b) =>
      admin.from("staff_agent_messages").select("user_id,sender,kind,created_at,actions").in("user_id", ids)
        .gte("created_at", dayStartIso).order("created_at", { ascending: true }).range(a, b)),
    fetchAll<{ assigned_to: string; customer_name: string; value_in_rupees: number }>((a, b) =>
      admin.from("leads").select("assigned_to,customer_name,value_in_rupees").in("assigned_to", ids).is("deleted_at", null)
        .not("status", "in", `(${CLOSED.join(",")})`).eq("next_follow_up_date", tomorrow).range(a, b)),
    fetchAll<{ assigned_to: string }>((a, b) =>
      admin.from("leads").select("assigned_to").in("assigned_to", ids).is("deleted_at", null)
        .not("status", "in", `(${CLOSED.join(",")})`).eq("next_follow_up_date", date).range(a, b)),
    fetchAll<{ assigned_to: string }>((a, b) =>
      admin.from("leads").select("assigned_to").in("assigned_to", ids).is("deleted_at", null)
        .not("status", "in", `(${CLOSED.join(",")})`).lt("next_follow_up_date", date).range(a, b)),
    fetchAll<{ assigned_to: string; value_in_rupees: number }>((a, b) =>
      admin.from("leads").select("assigned_to,value_in_rupees").in("assigned_to", ids).is("deleted_at", null)
        .in("status", ["won", "converted"]).gte("updated_at", monthStartIso).range(a, b)),
    fetchAll<{ user_id: string; target_value: number }>((a, b) =>
      admin.from("sales_targets").select("user_id,target_value").eq("month", month).in("user_id", ids).range(a, b)),
    fetchAll<{ user_id: string; push_enabled: boolean | null }>((a, b) =>
      admin.from("staff_push_devices").select("user_id,push_enabled").in("user_id", ids).range(a, b)),
  ]);

  // Won / lost today: the lead's value comes from the leads table.
  const closedIds = [...new Set(stages.filter((s) => ["won", "converted", "lost"].includes(String(s.new_stage))).map((s) => s.lead_id))];
  const closedLeads = closedIds.length
    ? await fetchAll<{ id: string; value_in_rupees: number }>((a, b) =>
        admin.from("leads").select("id,value_in_rupees").in("id", closedIds).range(a, b))
    : [];
  const valueOf = new Map(closedLeads.map((l) => [l.id, Number(l.value_in_rupees || 0)]));

  // The app flips leads to/from "overdue" by itself and credits whichever rep had
  // it open — not the rep's own work, so it is not counted.
  const autoFlips = autoFlipTimesByLead(stages);
  const realStages = stages.filter((s) => !isAutoStatusFlip(s.old_stage, s.new_stage));
  const realTouched = touched.filter((t) => !isAutoTouch(t.id, Date.parse(t.updated_at), autoFlips));

  const msgsByUser = new Map<string, CoachMsgRow[]>();
  coachMsgs.forEach((m) => msgsByUser.set(m.user_id, [...(msgsByUser.get(m.user_id) ?? []), m]));
  const pushUsers = new Set(pushRows.filter((p) => p.push_enabled !== false).map((p) => p.user_id));

  const repDays: RepDay[] = reps.map((rep) => {
    const att = attendance.filter((a) => a.user_id === rep.id && a.clock_in);
    const today = att.find((a) => a.date === date);
    const coach = checkinStats(msgsByUser.get(rep.id) ?? [], dayStart, dayEnd);
    const wonIds = new Set(realStages.filter((s) => s.changed_by_id === rep.id && ["won", "converted"].includes(String(s.new_stage))).map((s) => s.lead_id));
    const lostIds = new Set(realStages.filter((s) => s.changed_by_id === rep.id && s.new_stage === "lost").map((s) => s.lead_id));
    const mine = dueTomorrow.filter((d) => d.assigned_to === rep.id);
    const target = targets.find((t) => t.user_id === rep.id);
    return {
      id: rep.id,
      name: rep.name,
      present: !!today,
      late: today?.status === "late",
      presentLast7: att.length,
      newLeads: created.filter((c) => c.created_by === rep.id).length,
      stageMoves: realStages.filter((s) => s.changed_by_id === rep.id).length,
      leadsTouched: realTouched.filter((t) => t.updated_by === rep.id).length,
      wonCount: wonIds.size,
      wonValue: [...wonIds].reduce((n, id) => n + (valueOf.get(id) ?? 0), 0),
      lostCount: lostIds.size,
      coachOn: coach.sent > 0,
      coachSent: coach.sent,
      coachReplied: coach.replied,
      followUpsSetByCoach: coach.followUpsSet,
      dueTodayOpen: dueToday.filter((d) => d.assigned_to === rep.id).length,
      dueTomorrow: mine.length,
      topDueTomorrow: [...mine]
        .sort((a, b) => Number(b.value_in_rupees) - Number(a.value_in_rupees))
        .slice(0, 3)
        .map((m) => ({ customer: m.customer_name, value: Number(m.value_in_rupees || 0) })),
      overdue: overdue.filter((o) => o.assigned_to === rep.id).length,
      monthWon: wonMonth.filter((w) => w.assigned_to === rep.id).reduce((n, w) => n + Number(w.value_in_rupees || 0), 0),
      monthTarget: target ? Number(target.target_value) : null,
      pushRegistered: pushUsers.has(rep.id),
    };
  });

  // The service head: attendance, coach engagement and push, like a rep.
  const { data: headRoleRows } = await admin.from("user_roles").select("user_id").eq("role", "service_head");
  const headIds = (headRoleRows ?? []).map((r: { user_id: string }) => r.user_id);
  const { data: headProfiles } = headIds.length
    ? await admin.from("profiles").select("id,name").in("id", headIds).eq("active", true)
    : { data: [] as { id: string; name: string }[] };
  const headProfile = (headProfiles ?? [])[0] as { id: string; name: string } | undefined;
  let head: ServiceHeadDay | null = null;
  if (headProfile) {
    const [headAtt, headMsgs, headPush] = await Promise.all([
      fetchAll<{ date: string; clock_in: string | null; status: string }>((a, b) =>
        admin.from("attendance").select("date,clock_in,status").eq("user_id", headProfile.id).gte("date", weekStart).lte("date", date).range(a, b)),
      fetchAll<CoachMsgRow>((a, b) =>
        admin.from("staff_agent_messages").select("user_id,sender,kind,created_at,actions").eq("user_id", headProfile.id)
          .gte("created_at", dayStartIso).order("created_at", { ascending: true }).range(a, b)),
      fetchAll<{ push_enabled: boolean | null }>((a, b) =>
        admin.from("staff_push_devices").select("push_enabled").eq("user_id", headProfile.id).range(a, b)),
    ]);
    const att = headAtt.filter((a) => a.clock_in);
    const todayAtt = att.find((a) => a.date === date);
    const coach = checkinStats(headMsgs, dayStart, dayEnd);
    head = {
      id: headProfile.id,
      name: headProfile.name,
      present: !!todayAtt,
      late: todayAtt?.status === "late",
      presentLast7: att.length,
      coachOn: coach.sent > 0,
      coachSent: coach.sent,
      coachReplied: coach.replied,
      pushRegistered: headPush.some((p) => p.push_enabled !== false),
    };
  }

  const [completedToday, scheduledTomorrow, unassignedTomorrow, servicePending, billsPending, dueTodayOpen, overdueOpen, rejectedByAccounts] = await Promise.all([
    count(admin.from("service_jobs").select("id", { count: "exact", head: true }).eq("status", "completed").is("deleted_at", null)
      .gte("completed_at", dayStartIso).lt("completed_at", dayEndIso)),
    count(admin.from("service_jobs").select("id", { count: "exact", head: true }).eq("date_to_attend", tomorrow).neq("status", "completed").is("deleted_at", null)),
    count(admin.from("service_jobs").select("id", { count: "exact", head: true }).eq("date_to_attend", tomorrow).neq("status", "completed").is("deleted_at", null).is("assigned_agent", null)),
    count(admin.from("service_jobs").select("id", { count: "exact", head: true }).eq("accounts_approval_status", "pending").is("deleted_at", null)),
    count(admin.from("card_bill_entries").select("id", { count: "exact", head: true }).eq("approval_status", "pending")),
    count(admin.from("service_jobs").select("id", { count: "exact", head: true }).eq("date_to_attend", date).in("status", OPEN_JOB_STATUSES).is("deleted_at", null)),
    count(admin.from("service_jobs").select("id", { count: "exact", head: true }).lt("date_to_attend", date).in("status", OPEN_JOB_STATUSES).is("deleted_at", null)),
    count(admin.from("service_jobs").select("id", { count: "exact", head: true }).eq("status", "accounts_rejected").is("deleted_at", null)),
  ]);

  const dayOfMonth = Number(date.slice(8, 10));
  const daysInMonth = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
  return {
    date,
    dayOfMonth,
    daysInMonth,
    reps: repDays,
    service: { completedToday, scheduledTomorrow, unassignedTomorrow, dueTodayOpen, overdueOpen, rejectedByAccounts, head },
    accounts: { servicePending, billsPending },
  };
}

async function writeHeadline(report: ReturnType<typeof buildReport>) {
  if (!LOVABLE_API_KEY) return report;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: headlinePrompt(report) }] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      console.error("daily-admin-summary AI error", resp.status);
      return report;
    }
    const j = await resp.json();
    const parsed = parseHeadlineJson(j?.choices?.[0]?.message?.content ?? "");
    if (parsed) return { ...report, headline: parsed.headline, focus: parsed.focus, headlineBy: "ai" as const };
  } catch (e) {
    console.error("daily-admin-summary AI failed", e);
  }
  return report;
}

async function authorize(req: Request): Promise<"cron" | "admin" | null> {
  if (INTERNAL_SECRET && req.headers.get("x-internal-secret") === INTERNAL_SECRET) return "cron";
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return null;
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  return role ? "admin" : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const who = await authorize(req);
    if (!who) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const date: string = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") ? body.date : istDateString(new Date());
    const source: string = who === "cron" ? "cron" : "manual";
    const notify: boolean = typeof body.notify === "boolean" ? body.notify : who === "cron";
    const force = body.force === true;
    const dryRun = body.dry_run === true;

    if (!dryRun && !force) {
      const { data: existing } = await admin.from("admin_daily_summaries").select("id,summary_date").eq("summary_date", date).maybeSingle();
      if (existing) return json({ ok: true, existing: true, id: existing.id, date });
    }

    const report = await writeHeadline(buildReport(await collectFacts(date)));
    if (dryRun) return json({ ok: true, dry_run: true, date, report });

    const { data: row, error } = await admin
      .from("admin_daily_summaries")
      .upsert({ summary_date: date, headline: report.headline, report, source, generated_at: new Date().toISOString() }, { onConflict: "summary_date" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    if (notify) {
      const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
      const userIds = (admins ?? []).map((a: { user_id: string }) => a.user_id);
      if (userIds.length > 0) {
        // Best effort — the pop-up in the admin panel is the real delivery.
        await fetch(`${SUPABASE_URL}/functions/v1/send-staff-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
          body: JSON.stringify({
            user_ids: userIds,
            type: "daily_summary",
            title: "Today's summary is ready",
            message: report.headline.length > 140 ? `${report.headline.slice(0, 137)}…` : report.headline,
            data: { url: "/" },
          }),
        }).catch((e) => console.error("daily-admin-summary push failed", e));
      }
    }

    return json({ ok: true, existing: false, id: row.id, date, headline: report.headline, headlineBy: report.headlineBy });
  } catch (e) {
    console.error("daily-admin-summary error", e);
    return json({ error: "internal_error", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
