// Daily Performance Summary - emails per-user sales metrics and team service metrics via Gmail connector.
// Triggered daily at 11:00 IST by pg_cron. Reports cover the previous calendar day plus MTD and FYTD.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GMAIL_API_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY")!;
const INTERNAL_SECRET = Deno.env.get("DAILY_REPORT_SECRET") ?? "";

const GMAIL_GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

// Recipient map: profile.name (lowercased first token) -> external Gmail
const SALES_RECIPIENTS: Record<string, { display: string; email: string }> = {
  shivam:  { display: "HDE Shivam",  email: "hdeshivam@gmail.com" },
  amit:    { display: "Amit Bhatt",  email: "hdeamitbhatt@gmail.com" },
  nisha:   { display: "Nisha",       email: "hdebooking@gmail.com" },
  saurabh: { display: "HDE Saurabh", email: "hdesaurabh@gmail.com" },
  reena:   { display: "Reena Dora",  email: "hdereena123@gmail.com" },
};
const SERVICE_RECIPIENT = { display: "HDE Service", email: "hdeservice815@gmail.com" };

function fyStart(d = new Date()): Date {
  const y = d.getUTCFullYear();
  return d.getUTCMonth() >= 3 ? new Date(Date.UTC(y, 3, 1)) : new Date(Date.UTC(y - 1, 3, 1));
}
function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function istDateLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" }).format(d);
}
function rupees(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendGmail(to: string, subject: string, body: string) {
  const raw = b64url(
    [
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      body,
    ].join("\r\n"),
  );
  const res = await fetch(`${GMAIL_GATEWAY}/users/me/messages/send`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GMAIL_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gmail send failed [${res.status}]: ${text}`);
  return text;
}

type Lead = {
  status: string;
  value_in_rupees: number | null;
  created_at: string;
  stage_changed_at: string | null;
  next_follow_up_date: string | null;
  assigned_to: string | null;
};

function aggSales(leads: Lead[], userId: string, reportDate: Date) {
  const dayStr = reportDate.toISOString().slice(0, 10);
  const mStart = monthStart(reportDate).toISOString();
  const fStart = fyStart(reportDate).toISOString();
  const todayStr = new Date().toISOString().slice(0, 10);

  const mine = leads.filter(l => l.assigned_to === userId);
  const onDay = (l: Lead, iso: string) => iso.slice(0, 10) === dayStr;

  const leads_today = mine.filter(l => onDay(l, l.created_at)).length;
  const won_today_list = mine.filter(l => l.status === "won" && l.stage_changed_at && onDay(l, l.stage_changed_at));
  const conversions_today = won_today_list.length;
  const won_value_today = won_today_list.reduce((s, l) => s + Number(l.value_in_rupees || 0), 0);

  const active = mine.filter(l => !["won", "lost", "converted"].includes(l.status));
  const pipeline_value = active.reduce((s, l) => s + Number(l.value_in_rupees || 0), 0);
  const overdue_followups = mine.filter(l =>
    !["won", "lost", "converted"].includes(l.status) &&
    l.next_follow_up_date && l.next_follow_up_date < todayStr
  ).length;

  const monthLeads = mine.filter(l => l.created_at >= mStart);
  const monthWon = monthLeads.filter(l => l.status === "won");
  const leads_month = monthLeads.length;
  const conversions_month = monthWon.length;
  const revenue_month = monthWon.reduce((s, l) => s + Number(l.value_in_rupees || 0), 0);
  const win_rate_month = leads_month ? +((conversions_month / leads_month) * 100).toFixed(1) : 0;

  const fyLeads = mine.filter(l => l.created_at >= fStart);
  const fyWon = fyLeads.filter(l => l.status === "won");
  const leads_fy = fyLeads.length;
  const conversions_fy = fyWon.length;
  const revenue_fy = fyWon.reduce((s, l) => s + Number(l.value_in_rupees || 0), 0);
  const conversion_rate_fy = leads_fy ? +((conversions_fy / leads_fy) * 100).toFixed(1) : 0;

  return {
    leads_today, conversions_today, won_value_today, pipeline_value, overdue_followups,
    leads_month, conversions_month, revenue_month, win_rate_month,
    leads_fy, conversions_fy, revenue_fy, conversion_rate_fy,
  };
}

function salesSuggestions(m: ReturnType<typeof aggSales>): string[] {
  const out: string[] = [];
  if (m.leads_month > 0 && m.win_rate_month < 10)
    out.push(`📌 Win rate is ${m.win_rate_month}% (target 15%). Focus on lead quality and objection handling.`);
  if (m.overdue_followups > 3)
    out.push(`📌 You have ${m.overdue_followups} overdue follow-ups. Prioritise these today.`);
  if (m.leads_today === 0)
    out.push("📌 No new leads added yesterday. Plan outreach activities today.");
  if (m.leads_fy > 0 && m.conversion_rate_fy < 10)
    out.push(`📌 FY conversion rate is ${m.conversion_rate_fy}%. Increase follow-up frequency and engagement.`);
  if (out.length === 0) out.push("✅ Great performance! Keep the momentum going.");
  return out;
}

function buildSalesEmail(name: string, reportDate: Date, m: ReturnType<typeof aggSales>) {
  const fyLabel = `${fyStart(reportDate).getUTCFullYear()}-${fyStart(reportDate).getUTCFullYear() + 1}`;
  const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(reportDate);
  const lines = [
    `Hi ${name},`,
    "",
    `Here is your performance snapshot for ${istDateLabel(reportDate)}:`,
    "",
    "═══════════════════════════════════════════",
    "📊 YESTERDAY'S PERFORMANCE",
    "═══════════════════════════════════════════",
    "",
    `🎯 New Leads: ${m.leads_today}`,
    `✅ Conversions: ${m.conversions_today}`,
    `💰 Won Value: ${rupees(m.won_value_today)}`,
    `📈 Pipeline (Active): ${rupees(m.pipeline_value)}`,
    `⏰ Overdue Follow-ups: ${m.overdue_followups}`,
    "",
    "═══════════════════════════════════════════",
    `📈 THIS MONTH (${monthLabel})`,
    "═══════════════════════════════════════════",
    "",
    `Total Leads: ${m.leads_month}`,
    `Conversions: ${m.conversions_month}`,
    `Win Rate: ${m.win_rate_month}%`,
    `Revenue: ${rupees(m.revenue_month)}`,
    "",
    "═══════════════════════════════════════════",
    `💼 FINANCIAL YEAR (FY ${fyLabel})`,
    "═══════════════════════════════════════════",
    "",
    `Total Leads: ${m.leads_fy}`,
    `Conversions: ${m.conversions_fy}`,
    `Conversion Rate: ${m.conversion_rate_fy}%`,
    `Revenue: ${rupees(m.revenue_fy)}`,
    "",
    "═══════════════════════════════════════════",
    "💡 SUGGESTIONS FOR IMPROVEMENT",
    "═══════════════════════════════════════════",
    "",
    ...salesSuggestions(m),
    "",
    "Keep pushing! 🚀",
    "",
    "— OmniFlow, Home Decor Enterprises",
  ];
  return lines.join("\n");
}

type Job = {
  status: string;
  created_at: string;
  completed_at: string | null;
  date_to_attend: string | null;
  category: string | null;
};

function aggService(jobs: Job[], reportDate: Date) {
  const dayStr = reportDate.toISOString().slice(0, 10);
  const mStart = monthStart(reportDate).toISOString();
  const fStart = fyStart(reportDate).toISOString();
  const todayStr = new Date().toISOString().slice(0, 10);

  const dayJobs = jobs.filter(j => j.created_at.slice(0, 10) === dayStr);
  const completedDay = dayJobs.filter(j => j.status === "completed").length;
  const jobs_today = dayJobs.length;
  const completion_rate_today = jobs_today ? +((completedDay / jobs_today) * 100).toFixed(1) : 0;
  const CLOSED_STATUSES = ["completed", "accounts_rejected"];
  const pending_jobs = jobs.filter(j => !CLOSED_STATUSES.includes(j.status)).length;
  // Only flag jobs past-due within the current month so the count reflects recent
  // missed appointments, not an ever-growing FY backlog of old open jobs.
  const mStartStr = mStart.slice(0, 10);
  const critical_pending = jobs.filter(j =>
    !CLOSED_STATUSES.includes(j.status) &&
    j.date_to_attend &&
    j.date_to_attend >= mStartStr &&
    j.date_to_attend < todayStr
  ).length;

  const monthJobs = jobs.filter(j => j.created_at >= mStart);
  const monthCompleted = monthJobs.filter(j => j.status === "completed");
  const completion_rate_month = monthJobs.length
    ? +((monthCompleted.length / monthJobs.length) * 100).toFixed(1) : 0;
  const completionDays = monthCompleted
    .filter(j => j.completed_at)
    .map(j => (new Date(j.completed_at!).getTime() - new Date(j.created_at).getTime()) / 86400000);
  const avg_completion_days = completionDays.length
    ? +(completionDays.reduce((a, b) => a + b, 0) / completionDays.length).toFixed(1) : 0;

  const typeMap: Record<string, number> = {};
  for (const j of monthJobs) {
    const k = j.category || "uncategorised";
    typeMap[k] = (typeMap[k] || 0) + 1;
  }
  const top_types = Object.entries(typeMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const fyJobs = jobs.filter(j => j.created_at >= fStart);
  const fyCompleted = fyJobs.filter(j => j.status === "completed").length;
  const completion_rate_fy = fyJobs.length ? +((fyCompleted / fyJobs.length) * 100).toFixed(1) : 0;

  return {
    jobs_today, completed_today: completedDay, completion_rate_today, pending_jobs, critical_pending,
    jobs_month: monthJobs.length, completed_month: monthCompleted.length, completion_rate_month, avg_completion_days,
    top_types,
    jobs_fy: fyJobs.length, completed_fy: fyCompleted, completion_rate_fy,
  };
}

function serviceSuggestions(m: ReturnType<typeof aggService>): string[] {
  const out: string[] = [];
  if (m.jobs_today > 0 && m.completion_rate_today < 80)
    out.push(`📌 Yesterday's completion rate was ${m.completion_rate_today}% (target 90%+). Review resource allocation.`);
  if (m.pending_jobs > 5)
    out.push(`📌 ${m.pending_jobs} jobs are pending. Accelerate completion or allocate more agents.`);
  if (m.critical_pending > 2)
    out.push(`⚠️ URGENT: ${m.critical_pending} jobs are past their scheduled date. Address immediately.`);
  if (m.jobs_month > 0 && m.completion_rate_month < 85)
    out.push(`📌 Monthly completion rate: ${m.completion_rate_month}%. Push for 90%+ this month.`);
  if (out.length === 0) out.push("✅ Excellent service performance! Keep it up.");
  return out;
}

function buildServiceEmail(name: string, reportDate: Date, m: ReturnType<typeof aggService>) {
  const fyLabel = `${fyStart(reportDate).getUTCFullYear()}-${fyStart(reportDate).getUTCFullYear() + 1}`;
  const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(reportDate);
  const topLines = m.top_types.length
    ? m.top_types.map(([k, v]) => `  • ${k}: ${v}`).join("\n")
    : "  • (no jobs this month)";
  const lines = [
    `Hi ${name},`,
    "",
    `Here is the service performance overview for ${istDateLabel(reportDate)}:`,
    "",
    "═══════════════════════════════════════════",
    "🔧 YESTERDAY'S SERVICE METRICS",
    "═══════════════════════════════════════════",
    "",
    `Total Jobs: ${m.jobs_today}`,
    `Completed: ${m.completed_today}`,
    `Completion Rate: ${m.completion_rate_today}%`,
    `Pending (overall): ${m.pending_jobs}`,
    `🔴 Past-due pending: ${m.critical_pending}`,
    "",
    "═══════════════════════════════════════════",
    `📈 THIS MONTH (${monthLabel})`,
    "═══════════════════════════════════════════",
    "",
    `Total Jobs: ${m.jobs_month}`,
    `Completed: ${m.completed_month}`,
    `Completion Rate: ${m.completion_rate_month}%`,
    `Avg Completion Time: ${m.avg_completion_days} days`,
    "",
    "Top Service Categories:",
    topLines,
    "",
    "═══════════════════════════════════════════",
    `💼 FINANCIAL YEAR (FY ${fyLabel})`,
    "═══════════════════════════════════════════",
    "",
    `Total Jobs: ${m.jobs_fy}`,
    `Completed: ${m.completed_fy}`,
    `Completion Rate: ${m.completion_rate_fy}%`,
    "",
    "═══════════════════════════════════════════",
    "⚠️ ACTION ITEMS",
    "═══════════════════════════════════════════",
    "",
    ...serviceSuggestions(m),
    "",
    "Great work team! 💪",
    "",
    "— OmniFlow, Home Decor Enterprises",
  ];
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: cron uses vault-stored shared secret verified via RPC; admins can also trigger
  const headerSecret = req.headers.get("x-internal-secret") ?? "";
  let authorized = false;
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);
  if (headerSecret) {
    const { data: ok } = await adminClient.rpc("verify_daily_report_secret", { _token: headerSecret });
    if (ok === true) authorized = true;
  }
  if (!authorized && INTERNAL_SECRET !== "" && headerSecret === INTERNAL_SECRET) {
    authorized = true;
  }
  if (!authorized) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.auth.getClaims(token);
      const uid = data?.claims?.sub;
      if (uid) {
        const { data: isAdmin } = await adminClient.rpc("has_role", { _user_id: uid, _role: "admin" });
        if (isAdmin === true) authorized = true;
      }
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Report covers "yesterday" in IST
    const nowUtc = new Date();
    const istNow = new Date(nowUtc.getTime() + 5.5 * 3600 * 1000);
    const reportDate = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - 1));
    const dateLabel = istDateLabel(reportDate);

    // Profiles for resolving sales user IDs
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .eq("active", true);

    const profileByFirstName = new Map<string, { id: string; name: string }>();
    for (const p of profiles ?? []) {
      const key = (p.name ?? "").trim().toLowerCase().split(/\s+/)[0];
      if (key && !profileByFirstName.has(key)) profileByFirstName.set(key, p);
    }

    const fStart = fyStart(reportDate).toISOString();
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("status, value_in_rupees, created_at, stage_changed_at, next_follow_up_date, assigned_to")
      .is("deleted_at", null)
      .gte("created_at", fStart);
    if (leadsErr) throw leadsErr;

    const results: { recipient: string; status: string; error?: string }[] = [];

    // Sales emails
    for (const [key, r] of Object.entries(SALES_RECIPIENTS)) {
      const prof = profileByFirstName.get(key);
      if (!prof) {
        results.push({ recipient: r.email, status: "skipped_no_profile" });
        continue;
      }
      const metrics = aggSales((leads ?? []) as Lead[], prof.id, reportDate);
      const body = buildSalesEmail(r.display, reportDate, metrics);
      const subject = `Your Daily Performance Summary — ${dateLabel}`;
      try {
        await sendGmail(r.email, subject, body);
        results.push({ recipient: r.email, status: "sent" });
      } catch (e: any) {
        console.error("send fail", r.email, e.message);
        results.push({ recipient: r.email, status: "failed", error: e.message });
      }
    }

    // Service head email
    const { data: jobs, error: jobsErr } = await supabase
      .from("service_jobs")
      .select("status, created_at, completed_at, date_to_attend, category")
      .is("deleted_at", null)
      .gte("created_at", fStart);
    if (jobsErr) throw jobsErr;

    const svcMetrics = aggService((jobs ?? []) as Job[], reportDate);
    const svcBody = buildServiceEmail(SERVICE_RECIPIENT.display, reportDate, svcMetrics);
    const svcSubject = `Daily Service Performance Summary — ${dateLabel}`;
    try {
      await sendGmail(SERVICE_RECIPIENT.email, svcSubject, svcBody);
      results.push({ recipient: SERVICE_RECIPIENT.email, status: "sent" });
    } catch (e: any) {
      console.error("svc send fail", e.message);
      results.push({ recipient: SERVICE_RECIPIENT.email, status: "failed", error: e.message });
    }

    const sent = results.filter(r => r.status === "sent").length;
    return new Response(
      JSON.stringify({ success: true, total: results.length, sent, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("daily-performance-summary error", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
