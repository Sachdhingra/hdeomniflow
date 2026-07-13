// Gemini TTS voice reminder briefing.
// Gathers the caller's pending work (overdue leads, follow-ups, today's jobs,
// pending accounts approvals), writes a short spoken script with Gemini, and
// synthesizes it to audio with the Gemini TTS API. Returns base64 WAV; when
// GEMINI_API_KEY is not configured the client falls back to browser speech.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  DEFAULT_TTS_VOICE as DEFAULT_VOICE,
  GEMINI_TTS_VOICES as GEMINI_VOICES,
  synthesizeSpeech,
} from "../_shared/gemini-tts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

const ALLOWED_ROLES = ["admin", "sales", "service_head", "accounts"];
const SCRIPT_MODEL = "google/gemini-2.5-flash";
const ALLOWED_LANGUAGES = ["en", "hi"] as const;
type BriefingLanguage = (typeof ALLOWED_LANGUAGES)[number];

// ── helpers ──────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Spoken-friendly Indian rupee amounts ("4.5 lakh rupees", not "₹450000")
function speakRupees(n: number): string {
  if (n >= 1_00_00_000) return `${Math.round((n / 1_00_00_000) * 10) / 10} crore rupees`;
  if (n >= 1_00_000) return `${Math.round((n / 1_00_000) * 10) / 10} lakh rupees`;
  if (n >= 1000) return `${Math.round(n / 1000)} thousand rupees`;
  return `${Math.round(n)} rupees`;
}

function istGreeting(lang: BriefingLanguage = "en"): string {
  const istHour = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
  if (lang === "hi") {
    if (istHour < 12) return "सुप्रभात";
    if (istHour < 17) return "नमस्ते";
    return "शुभ संध्या";
  }
  if (istHour < 12) return "Good morning";
  if (istHour < 17) return "Good afternoon";
  return "Good evening";
}

// ── reminder gathering ───────────────────────────────────

type ReminderContext = Record<string, unknown>;

async function gatherSalesReminders(admin: any, userId: string): Promise<ReminderContext> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: leads } = await admin
    .from("leads")
    .select("customer_name,value_in_rupees,status,next_follow_up_date,stage_changed_at,created_at")
    .eq("assigned_to", userId)
    .not("status", "in", '("won","lost","converted")')
    .is("deleted_at", null)
    .order("value_in_rupees", { ascending: false })
    .limit(200);

  const all = leads ?? [];
  const overdue = all.filter((l: any) => l.status === "overdue");
  const dueToday = all.filter((l: any) => l.next_follow_up_date === todayStr);
  const missed = all.filter(
    (l: any) => l.next_follow_up_date && l.next_follow_up_date < todayStr && l.status !== "overdue",
  );
  const pick = (arr: any[]) =>
    arr.slice(0, 5).map((l: any) => ({
      customer: l.customer_name,
      value: Number(l.value_in_rupees || 0),
    }));

  return {
    overdue_count: overdue.length,
    overdue_value: overdue.reduce((s: number, l: any) => s + Number(l.value_in_rupees || 0), 0),
    overdue_top: pick(overdue),
    follow_ups_due_today_count: dueToday.length,
    follow_ups_due_today: pick(dueToday),
    missed_follow_ups_count: missed.length,
    missed_follow_ups: pick(missed),
    active_leads: all.length,
  };
}

async function gatherServiceReminders(admin: any): Promise<ReminderContext> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: jobs } = await admin
    .from("service_jobs")
    .select("customer_name,type,status,date_to_attend,assigned_agent")
    .not("status", "in", '("completed","cancelled")')
    .is("deleted_at", null)
    .limit(500);

  const all = jobs ?? [];
  const today = all.filter((j: any) => j.date_to_attend === todayStr);
  const overdue = all.filter((j: any) => j.date_to_attend && j.date_to_attend < todayStr);
  const unassigned = all.filter((j: any) => !j.assigned_agent && j.date_to_attend && j.date_to_attend >= todayStr);
  const pick = (arr: any[]) =>
    arr.slice(0, 5).map((j: any) => ({ customer: j.customer_name, type: j.type }));

  return {
    jobs_today_count: today.length,
    jobs_today: pick(today),
    overdue_jobs_count: overdue.length,
    overdue_jobs: pick(overdue),
    unassigned_upcoming_count: unassigned.length,
    unassigned_upcoming: pick(unassigned),
  };
}

async function gatherAccountsReminders(admin: any): Promise<ReminderContext> {
  const { data: pending } = await admin
    .from("service_jobs")
    .select("customer_name,type,value,date_received")
    .eq("accounts_approval_status", "pending")
    .is("deleted_at", null)
    .order("date_received", { ascending: true })
    .limit(100);

  const all = pending ?? [];
  return {
    pending_approvals_count: all.length,
    pending_approvals_value: all.reduce((s: number, j: any) => s + Number(j.value || 0), 0),
    oldest_pending: all.slice(0, 5).map((j: any) => ({
      customer: j.customer_name,
      type: j.type,
      value: Number(j.value || 0),
      received: j.date_received,
    })),
  };
}

async function gatherAdminReminders(admin: any): Promise<ReminderContext> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [{ data: leads }, service, accounts] = await Promise.all([
    admin
      .from("leads")
      .select("customer_name,value_in_rupees,status,next_follow_up_date,assigned_to")
      .not("status", "in", '("won","lost","converted")')
      .is("deleted_at", null)
      .order("value_in_rupees", { ascending: false })
      .limit(400),
    gatherServiceReminders(admin),
    gatherAccountsReminders(admin),
  ]);

  const allLeads = leads ?? [];
  const overdue = allLeads.filter((l: any) => l.status === "overdue");
  const dueToday = allLeads.filter((l: any) => l.next_follow_up_date === todayStr);

  return {
    team_overdue_leads_count: overdue.length,
    team_overdue_leads_value: overdue.reduce((s: number, l: any) => s + Number(l.value_in_rupees || 0), 0),
    team_overdue_top: overdue.slice(0, 5).map((l: any) => ({
      customer: l.customer_name,
      value: Number(l.value_in_rupees || 0),
    })),
    team_follow_ups_due_today: dueToday.length,
    service: service,
    accounts: accounts,
  };
}

// ── script generation ────────────────────────────────────

function listNames(items: any[], max = 3): string {
  return items.slice(0, max).map((i: any) => i.customer).filter(Boolean).join(", ");
}

// Deterministic script used when the AI gateway is unavailable.
function buildFallbackScript(name: string, role: string, ctx: ReminderContext): string {
  const parts: string[] = [`${istGreeting()} ${name}. Here is your reminder briefing.`];

  if (role === "sales") {
    const c = ctx as any;
    if (c.overdue_count > 0) {
      parts.push(
        `You have ${c.overdue_count} overdue lead${c.overdue_count > 1 ? "s" : ""} worth ${speakRupees(c.overdue_value)}${
          c.overdue_top.length ? `, including ${listNames(c.overdue_top)}` : ""
        }.`,
      );
    }
    if (c.follow_ups_due_today_count > 0) {
      parts.push(
        `${c.follow_ups_due_today_count} follow-up${c.follow_ups_due_today_count > 1 ? "s are" : " is"} due today${
          c.follow_ups_due_today.length ? `: ${listNames(c.follow_ups_due_today)}` : ""
        }.`,
      );
    }
    if (c.missed_follow_ups_count > 0) {
      parts.push(`${c.missed_follow_ups_count} follow-up${c.missed_follow_ups_count > 1 ? "s were" : " was"} missed and need${c.missed_follow_ups_count > 1 ? "" : "s"} rescheduling.`);
    }
    if (parts.length === 1) parts.push(`Your pipeline is clean — no overdue leads or pending follow-ups. Great work.`);
  } else if (role === "service_head") {
    const c = ctx as any;
    if (c.jobs_today_count > 0) parts.push(`${c.jobs_today_count} service job${c.jobs_today_count > 1 ? "s are" : " is"} scheduled for today.`);
    if (c.overdue_jobs_count > 0) parts.push(`${c.overdue_jobs_count} job${c.overdue_jobs_count > 1 ? "s are" : " is"} overdue${c.overdue_jobs.length ? `, including ${listNames(c.overdue_jobs)}` : ""}.`);
    if (c.unassigned_upcoming_count > 0) parts.push(`${c.unassigned_upcoming_count} upcoming job${c.unassigned_upcoming_count > 1 ? "s" : ""} still need${c.unassigned_upcoming_count > 1 ? "" : "s"} an agent assigned.`);
    if (parts.length === 1) parts.push(`All jobs are on track — nothing overdue or unassigned right now.`);
  } else if (role === "accounts") {
    const c = ctx as any;
    if (c.pending_approvals_count > 0) {
      parts.push(
        `${c.pending_approvals_count} dispatch${c.pending_approvals_count > 1 ? "es are" : " is"} waiting for accounts approval, totalling ${speakRupees(c.pending_approvals_value)}${
          c.oldest_pending.length ? `. Oldest first: ${listNames(c.oldest_pending)}` : ""
        }.`,
      );
    } else {
      parts.push(`Your approval queue is empty — nothing pending right now.`);
    }
  } else {
    const c = ctx as any;
    if (c.team_overdue_leads_count > 0) parts.push(`The team has ${c.team_overdue_leads_count} overdue leads worth ${speakRupees(c.team_overdue_leads_value)}.`);
    if (c.team_follow_ups_due_today > 0) parts.push(`${c.team_follow_ups_due_today} follow-ups are due today across the team.`);
    const s = c.service as any;
    if (s?.jobs_today_count > 0) parts.push(`${s.jobs_today_count} service jobs are scheduled today${s.overdue_jobs_count > 0 ? `, and ${s.overdue_jobs_count} are overdue` : ""}.`);
    const a = c.accounts as any;
    if (a?.pending_approvals_count > 0) parts.push(`${a.pending_approvals_count} dispatches are waiting on accounts approval.`);
    if (parts.length === 1) parts.push(`Everything looks clear across sales, service and accounts.`);
  }

  parts.push(`That's your briefing. Have a productive day.`);
  return parts.join(" ");
}

async function generateScript(name: string, role: string, ctx: ReminderContext, language: BriefingLanguage): Promise<string> {
  const fallback = buildFallbackScript(name, role, ctx);
  if (!LOVABLE_API_KEY) return fallback;

  const langInstruction = language === "hi"
    ? "Write the ENTIRE briefing in natural conversational Hindi (Devanagari script). Use Hindi numerals-in-words for rupee amounts (e.g. 'साढ़े चार लाख रुपये'), never symbols or digits like ₹450000. Keep English proper nouns (customer names, product names) as-is. Warm but direct tone. Under 120 words."
    : "Write the briefing in English. Warm but direct, like a sharp assistant. Under 120 words. Say rupee amounts in words (e.g. '4.5 lakh rupees'), never symbols or digits like ₹450000.";

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SCRIPT_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You write short spoken reminder briefings for a furniture CRM, to be read aloud by a text-to-speech voice. " +
              "Rules: plain text only, no markdown, no emoji, no headings, no bullet points. " +
              langInstruction + " " +
              "Greet the person by first name. " +
              "Mention the most urgent items with specific customer names and amounts. " +
              "Only use facts from the provided data — never invent anything. End with one short encouraging line.",
          },
          {
            role: "user",
            content: `Person: ${name}\nRole: ${role}\nReminder data:\n${JSON.stringify(ctx, null, 2)}`,
          },
        ],
      }),
    });
    if (!resp.ok) {
      console.error("script generation failed", resp.status, await resp.text());
      return fallback;
    }
    const data = await resp.json();
    const script = data?.choices?.[0]?.message?.content?.trim();
    return script || fallback;
  } catch (e) {
    console.error("script generation error", e);
    return fallback;
  }
}

// ── handler ──────────────────────────────────────────────

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
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return json({ error: "Voice reminders are not available for your role" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const voice = GEMINI_VOICES.includes(body?.voice) ? body.voice : DEFAULT_VOICE;
    const language: BriefingLanguage = ALLOWED_LANGUAGES.includes(body?.language) ? body.language : "en";

    const { data: profile } = await admin.from("profiles").select("name").eq("id", user.id).maybeSingle();
    const name = (profile?.name ?? "there").split(" ")[0];

    let ctx: ReminderContext;
    if (role === "sales") ctx = await gatherSalesReminders(admin, user.id);
    else if (role === "service_head") ctx = await gatherServiceReminders(admin);
    else if (role === "accounts") ctx = await gatherAccountsReminders(admin);
    else ctx = await gatherAdminReminders(admin);

    const script = await generateScript(name, role, ctx, language);
    const speech = await synthesizeSpeech(script, voice, GEMINI_API_KEY);

    return json({
      script,
      voice,
      language,
      audio: speech.audio ?? null,
      mimeType: speech.mimeType ?? null,
      ttsError: speech.error ?? null,
      role,
    });
  } catch (e) {
    console.error("voice-reminder error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
