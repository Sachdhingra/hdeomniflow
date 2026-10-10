/**
 * staff-agent — per-person AI coach (sales pilot).
 *
 * Two entry points on one function:
 *   { action: "tick" }              pg_cron (x-internal-secret), every 2 hours.
 *                                   Sends each present sales rep a check-in.
 *   { action: "chat", message,      Staff JWT. The rep replies to the agent;
 *     voice?, language?, tts_voice? } the agent answers and may update their
 *                                   own leads (note / follow-up date). With
 *                                   voice:true the reply is short, spoken-
 *                                   style, and returned with Gemini audio.
 *   { action: "tts_health" }         pg_cron secret. Reports which voice providers work.
 *   { action: "speak", message_id } Staff JWT. Audio for one of the rep's own
 *                                   agent messages (reads a check-in aloud).
 *
 * Guardrails
 *   - Only staff with attendance today (clocked in, not clocked out) get a
 *     check-in or can chat. Enforced here, not just in the UI.
 *   - Pilot allow-list (PILOT_USER_IDS) limits who is enabled.
 *   - Working hours 11:00-20:00 IST for ticks. Chat works whenever present.
 *   - Each agent sees only that person's own leads and targets.
 *   - Actions are limited to the rep's own leads and to add_note /
 *     set_follow_up. Stage changes are only ever suggested.
 *   - The agent never contacts customers.
 *   - One check-in per user per slot (unique index), so retries are safe.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { DEFAULT_TTS_VOICE, GEMINI_TTS_VOICES, synthesizeSpeech } from "../_shared/gemini-tts.ts";
import { elevenLabsConfigured, synthesizeElevenLabs } from "../_shared/elevenlabs-tts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const INTERNAL_SECRET = Deno.env.get("LOYALTY_CRON_SECRET") ?? "";

const MODEL = "google/gemini-2.5-flash";
const TZ = "Asia/Kolkata";
const WORK_START_HOUR = 11;
const WORK_END_HOUR = 20;
// Pilot allow-list: only these reps (saurabh, reena) get check-ins and chat.
// Empty the array to open the coach to every active sales rep.
const PILOT_USER_IDS: string[] = [
  "55ace8a7-69c6-49aa-b801-81f6f39b292f", // saurabh
  "2fc7636b-968a-44a2-973c-bd202952752a", // reena
];
const inPilot = (id: string) => PILOT_USER_IDS.length === 0 || PILOT_USER_IDS.includes(id);
const CLOSED_STATUSES = ["won", "lost"];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── time helpers (IST) ──────────────────────────────────────────────────────
function istParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    month: `${get("year")}-${get("month")}`,
    hour: Number(get("hour")) % 24,
  };
}

// ── attendance gate ─────────────────────────────────────────────────────────
// Present = clocked in today and not yet clocked out.
async function presentUserIds(userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const { data } = await admin
    .from("attendance")
    .select("user_id")
    .eq("date", istParts().date)
    .not("clock_in", "is", null)
    .is("clock_out", null)
    .in("user_id", userIds);
  return new Set((data ?? []).map((r: any) => r.user_id));
}

// ── sales context (own data only) ───────────────────────────────────────────
async function buildSalesContext(userId: string) {
  const now = new Date();
  const ist = istParts(now);
  const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000).toISOString();
  const dayStart = new Date(`${ist.date}T00:00:00+05:30`).toISOString();
  const monthStart = new Date(`${ist.month}-01T00:00:00+05:30`).toISOString();

  const [{ data: openLeads }, { data: wonMonth }, { data: target }, { data: stageToday }] = await Promise.all([
    admin.from("leads")
      .select("id,customer_name,value_in_rupees,status,category,next_follow_up_date,next_follow_up_time,last_follow_up,updated_at,created_at,notes")
      .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
      .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
      .is("deleted_at", null)
      .order("value_in_rupees", { ascending: false })
      .limit(60),
    admin.from("leads")
      .select("value_in_rupees")
      .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
      .eq("status", "won")
      .gte("updated_at", monthStart)
      .is("deleted_at", null),
    admin.from("sales_targets").select("target_value").eq("user_id", userId).eq("month", ist.month).maybeSingle(),
    admin.from("lead_stage_history")
      .select("lead_id,old_stage,new_stage,changed_at")
      .eq("changed_by_id", userId)
      .gte("changed_at", dayStart)
      .order("changed_at", { ascending: false })
      .limit(40),
  ]);

  const leads = openLeads ?? [];
  const today = ist.date;
  const nameById = new Map(leads.map((l: any) => [l.id, l.customer_name]));
  const missing = [...new Set((stageToday ?? []).map((x: any) => x.lead_id))].filter((id) => !nameById.has(id));
  if (missing.length) {
    const { data: extra } = await admin.from("leads").select("id,customer_name").in("id", missing);
    (extra ?? []).forEach((l: any) => nameById.set(l.id, l.customer_name));
  }
  const daysSince = (iso: string | null) =>
    iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000) : null;

  const slim = (l: any) => ({
    id: l.id, customer: l.customer_name, value: Number(l.value_in_rupees), status: l.status,
    category: l.category, follow_up: l.next_follow_up_date, follow_up_time: l.next_follow_up_time,
    days_since_touch: daysSince(l.last_follow_up),
  });

  const dueToday = leads.filter((l: any) => l.next_follow_up_date === today);
  const overdue = leads.filter((l: any) => l.next_follow_up_date && l.next_follow_up_date < today);
  const stale = leads.filter((l: any) =>
    !l.next_follow_up_date && (daysSince(l.last_follow_up) ?? 0) >= 7);
  const touchedLast2h = leads.filter((l: any) => l.updated_at >= twoHoursAgo);
  const newToday = leads.filter((l: any) => l.created_at >= dayStart);

  const wonValue = (wonMonth ?? []).reduce((s: number, r: any) => s + Number(r.value_in_rupees || 0), 0);
  const targetValue = target ? Number(target.target_value) : null;
  const dim = new Date(Number(ist.month.slice(0, 4)), Number(ist.month.slice(5, 7)), 0).getDate();

  return {
    ist_date: today,
    ist_hour: ist.hour,
    month_won_value: wonValue,
    month_target: targetValue,
    target_pct: targetValue ? Math.round((wonValue / targetValue) * 100) : null,
    days_left_in_month: dim - Number(today.slice(8, 10)),
    open_leads_count: leads.length,
    activity_last_2h: {
      leads_updated: touchedLast2h.map(slim),
    },
    activity_today: {
      leads_created: newToday.map(slim),
      stage_moves: (stageToday ?? []).map((s: any) => ({
        customer: nameById.get(s.lead_id) ?? "a lead", from: s.old_stage, to: s.new_stage, at: s.changed_at,
      })),
    },
    due_today: dueToday.slice(0, 15).map(slim),
    overdue: overdue.slice(0, 15).map(slim),
    no_followup_set_and_stale: stale.slice(0, 10).map(slim),
    top_open_leads: leads.slice(0, 10).map(slim),
  };
}

// ── LLM ─────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the personal sales coach inside OmniFlow for a furniture retail business in India. You talk to one salesperson. Be warm, upbeat and brief — like a sharp friend who wants them to have a great day, never a boss policing them.

STYLE
- Reply in the language the rep writes in (English, Hindi, Hinglish, Punjabi...). If they haven't written yet, use friendly Hinglish. Keep customer and product names as they appear.
- Short: a check-in is at most ~90 words. Use at most 1-2 emoji. No tables, no long lists.
- Celebrate real wins first (name them), then give 2-3 concrete next actions, each naming a customer and why now.
- Use ONLY numbers and names in the context. Never invent figures or leads.
- End a check-in with one easy question that invites a reply, e.g. what happened with a specific lead, or what blocked them.
- Never promise to contact customers. You only coach and update the rep's own notes/follow-ups.

WHEN THE REP REPLIES
- Understand what they did. If they mention a customer outcome that matches a lead in the context, you may record it.
- You may take ONLY these actions, using lead ids from the context:
  - add_note: {"type":"add_note","lead_id":"...","text":"short factual note"}
  - set_follow_up: {"type":"set_follow_up","lead_id":"...","date":"YYYY-MM-DD"}
  Only act when the rep clearly said it. If unsure which lead, ask. Suggest stage changes in words; never apply them.

CONVERSATION (when the rep replies)
- This is a back-and-forth, not a report. React in one short sentence to what they said, then ask ONE question — never more than two.
- Follow a natural arc across turns: what happened -> what is blocking them -> what they will do in the next 2 hours. Once they have named next steps, recap in one line and, if a lead and date are clear, set the follow-up.
- Match their energy: if they sound tired or frustrated, empathise first and make the next step tiny. If they won something, celebrate it.
- If they ask for help (a pitch, an objection, what to say to a customer, a comparison), give a crisp suggestion they can use right now, using only facts in the context.

OUTPUT: respond with a single JSON object and nothing else:
{"reply":"<message to the rep>","quick_replies":["<short tap-reply>", ...],"actions":[ ... ]}
"quick_replies": 2-3 very short (max 5 words) things the rep might want to say next, written in the rep's language. For check-ins "actions" and "quick_replies" must be [].

CHECK-IN FORMAT: for a [SYSTEM CHECK-IN] message, ignore the JSON output rule and write the message to the rep as plain text only.`;

// Appended when the rep is talking by voice: the reply is read aloud.
const VOICE_PROMPT = `

VOICE MODE — your reply will be spoken aloud by text-to-speech, so:
- Plain spoken sentences only: no markdown, emoji, bullets, symbols or digits-with-symbols.
- At most about 45 words (2-3 short sentences), ending with ONE short question.
- Say rupee amounts in words ("four lakh rupees"), never "₹400000".
- "quick_replies" must be [].`;

async function callLLM(messages: { role: string; content: string }[]): Promise<string> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages }),
  });
  if (!resp.ok) {
    console.error("staff-agent LLM error", resp.status, await resp.text());
    throw new Error(resp.status === 429 ? "rate_limited" : resp.status === 402 ? "credits_exhausted" : "llm_error");
  }
  const j = await resp.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

type AgentReply = { reply: string; actions: any[]; quick_replies: string[] };

const cleanReplies = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim().slice(0, 40)).slice(0, 3)
    : [];

function parseAgentJson(raw: string): AgentReply {
  const fallback = "Sorry, I lost my train of thought — can you say that again?";
  const stripped = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  // Models often emit JSON with raw newlines or unescaped quotes inside the
  // reply, which JSON.parse rejects — so fall back to pulling the fields out.
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const candidate = stripped.slice(start, end + 1);
    try {
      const o = JSON.parse(candidate);
      if (typeof o?.reply === "string") {
        return { reply: o.reply, actions: Array.isArray(o.actions) ? o.actions : [], quick_replies: cleanReplies(o.quick_replies) };
      }
    } catch { /* fall through */ }
    const m = candidate.match(/"reply"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"(?:quick_replies|actions)"|\})/);
    if (m) {
      const parseArr = (key: string): any[] => {
        const a = candidate.match(new RegExp('"' + key + '"\\s*:\\s*(\\[[^\\]]*\\])'));
        if (!a) return [];
        try { const v = JSON.parse(a[1]); return Array.isArray(v) ? v : []; } catch { return []; }
      };
      return {
        reply: m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'),
        actions: parseArr("actions"),
        quick_replies: cleanReplies(parseArr("quick_replies")),
      };
    }
  }
  // Never show raw JSON to staff.
  if (stripped.startsWith("{")) return { reply: fallback, actions: [], quick_replies: [] };
  return { reply: stripped || fallback, actions: [], quick_replies: [] };
}

// ── apply agent actions, limited to the rep's own leads ─────────────────────
async function applyActions(userId: string, actions: any[]) {
  const applied: any[] = [];
  const today = istParts().date;
  for (const a of actions.slice(0, 5)) {
    if (!a || typeof a.lead_id !== "string") continue;
    const { data: lead } = await admin
      .from("leads")
      .select("id,notes,assigned_to,created_by")
      .eq("id", a.lead_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lead || (lead.assigned_to !== userId && lead.created_by !== userId)) continue;

    if (a.type === "add_note" && typeof a.text === "string" && a.text.trim()) {
      const stamp = `[${today} coach] ${a.text.trim().slice(0, 300)}`;
      const notes = lead.notes ? `${lead.notes}\n${stamp}` : stamp;
      const { error } = await admin.from("leads").update({ notes, updated_by: userId }).eq("id", lead.id);
      if (!error) applied.push({ type: "add_note", lead_id: lead.id, text: a.text.trim().slice(0, 300) });
    } else if (a.type === "set_follow_up" && /^\d{4}-\d{2}-\d{2}$/.test(a.date ?? "") && a.date >= today) {
      const { error } = await admin
        .from("leads")
        .update({ next_follow_up_date: a.date, updated_by: userId })
        .eq("id", lead.id);
      if (!error) applied.push({ type: "set_follow_up", lead_id: lead.id, date: a.date });
    }
  }
  return applied;
}

// ── tick ────────────────────────────────────────────────────────────────────
async function handleTick() {
  const ist = istParts();
  if (ist.hour < WORK_START_HOUR || ist.hour >= WORK_END_HOUR) {
    return json({ skipped: "outside_working_hours", ist_hour: ist.hour });
  }

  const { data: roleRows } = await admin.from("user_roles").select("user_id").eq("role", "sales");
  const salesIds = (roleRows ?? []).map((r: any) => r.user_id);
  const { data: profiles } = await admin
    .from("profiles").select("id,name").in("id", salesIds).eq("active", true);
  const activeIds = (profiles ?? []).map((p: any) => p.id).filter(inPilot);
  const nameOf = new Map((profiles ?? []).map((p: any) => [p.id, p.name as string]));
  const present = await presentUserIds(activeIds);

  // Slot = the current hour boundary; cron fires on the hour in UTC.
  const slot = new Date();
  slot.setUTCMinutes(0, 0, 0);
  const isFirstSlot = ist.hour < WORK_START_HOUR + 2;
  const isLastSlot = ist.hour >= WORK_END_HOUR - 1;

  let sent = 0;
  const skippedNotPresent = activeIds.length - present.size;
  const failures: string[] = [];

  for (const userId of present) {
    try {
      const ctx = await buildSalesContext(userId);
      const { data: history } = await admin
        .from("staff_agent_messages")
        .select("sender,content")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(6);
      const past = (history ?? []).reverse().map((m: any) => ({
        role: m.sender === "agent" ? "assistant" : "user", content: m.content,
      }));

      const mood = isFirstSlot
        ? "This is the morning kick-off: greet them, set today's top 3 priorities."
        : isLastSlot
          ? "This is the last check-in of the day: ask them to wrap up — what got done, what slips to tomorrow — and set one follow-up for first thing tomorrow."
          : "This is a mid-day check-in: react to the last 2 hours of activity, then set the next 2 hours.";

      const raw = await callLLM([
        { role: "system", content: SYSTEM_PROMPT },
        ...past,
        {
          role: "user",
          content:
            `[SYSTEM CHECK-IN for ${nameOf.get(userId) ?? "the rep"}] ${mood}\n` +
            `If the last 2 hours show no activity, be encouraging and point at the single best next lead — do not scold.\n` +
            `CONTEXT:\n${JSON.stringify(ctx)}`,
        },
      ]);
      const reply = parseAgentJson(raw).reply;

      const { error } = await admin.from("staff_agent_messages").insert({
        user_id: userId, agent_role: "sales", sender: "agent", kind: "checkin",
        content: reply, slot_at: slot.toISOString(),
      });
      if (error) {
        // Unique-slot violation means this slot was already sent — fine.
        if (error.code !== "23505") failures.push(`${userId}: ${error.message}`);
        continue;
      }
      sent++;

      // Best-effort push; the in-app thread is the source of truth.
      fetch(`${SUPABASE_URL}/functions/v1/send-staff-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
        body: JSON.stringify({
          user_ids: [userId],
          type: "agent_checkin",
          title: "Your sales coach 👋",
          message: reply.length > 140 ? reply.slice(0, 137) + "…" : reply,
          data: { url: "/my-day" },
        }),
      }).catch((e) => console.error("staff-agent push failed", e));
    } catch (e) {
      failures.push(`${userId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return json({ sent, present: present.size, skipped_not_present: skippedNotPresent, failures });
}

// ── chat ────────────────────────────────────────────────────────────────────
type VoiceOpts = { voice: boolean; language: string; ttsVoice: string };

const READING_INSTRUCTION: Record<string, string> = {
  en: "Speak this in a warm, upbeat, friendly coach voice:",
  hi: "Speak this in a warm, upbeat, friendly coach voice, in Hindi (natural Hinglish is fine):",
  pa: "Speak this in a warm, upbeat, friendly coach voice, in Punjabi:",
};

const plainForSpeech = (t: string) =>
  t.replace(/[*_`#>]+/g, "").replace(/\s*\n+\s*/g, " ").trim();

// Voice fallback chain: Gemini TTS -> ElevenLabs -> (client) browser voice.
// Returns audio from the first provider that works; if none do, audio is null
// and the client speaks with the browser's own voice.
async function speak(text: string, o: VoiceOpts) {
  const plain = plainForSpeech(text);
  const gemini = await synthesizeSpeech(plain, o.ttsVoice, GEMINI_API_KEY, READING_INSTRUCTION[o.language] ?? READING_INSTRUCTION.en);
  if (gemini.audio) return { audio: gemini.audio, mimeType: gemini.mimeType, provider: "gemini", ttsError: null };

  const eleven = await synthesizeElevenLabs(plain);
  if (eleven.audio) return { audio: eleven.audio, mimeType: eleven.mimeType, provider: "elevenlabs", ttsError: null };

  console.error("staff-agent TTS: all server voices failed", { gemini: gemini.error, elevenlabs: eleven.error });
  return { audio: null, mimeType: null, provider: null, ttsError: `gemini: ${gemini.error}; elevenlabs: ${eleven.error}` };
}

// Cron-secret diagnostic: which voice providers work right now (no audio returned).
async function handleTtsHealth() {
  const [gemini, eleven] = await Promise.all([
    synthesizeSpeech("Test", DEFAULT_TTS_VOICE, GEMINI_API_KEY, "Say:"),
    synthesizeElevenLabs("Test"),
  ]);
  return json({
    gemini: gemini.audio ? { ok: true } : { ok: false, error: gemini.error },
    elevenlabs: eleven.audio
      ? { ok: true, key_present: true }
      : { ok: false, key_present: elevenLabsConfigured(), error: eleven.error },
  });
}

async function handleSpeak(userId: string, messageId: string, o: VoiceOpts) {
  if (!inPilot(userId)) return json({ error: "not_in_pilot" }, 403);
  const { data: msg } = await admin
    .from("staff_agent_messages")
    .select("content")
    .eq("id", messageId)
    .eq("user_id", userId)
    .eq("sender", "agent")
    .maybeSingle();
  if (!msg) return json({ error: "message_not_found" }, 404);
  return json(await speak(msg.content, o));
}

async function handleChat(userId: string, message: string, o: VoiceOpts) {
  if (!inPilot(userId)) {
    return json({ error: "not_in_pilot", message: "Your coach isn't switched on for you yet — coming soon!" }, 403);
  }
  const text = message.trim().slice(0, 2000);
  if (!text) return json({ error: "empty_message" }, 400);

  const present = await presentUserIds([userId]);
  if (!present.has(userId)) {
    return json({
      error: "not_present",
      message: "Clock in on the Attendance page to chat with your coach.",
    }, 403);
  }

  const [ctx, { data: history }, { data: profile }] = await Promise.all([
    buildSalesContext(userId),
    admin.from("staff_agent_messages").select("sender,content")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
    admin.from("profiles").select("name").eq("id", userId).maybeSingle(),
  ]);
  const past = (history ?? []).reverse().map((m: any) => ({
    role: m.sender === "agent" ? "assistant" : "user", content: m.content,
  }));

  const { data: staffRow, error: insErr } = await admin.from("staff_agent_messages").insert({
    user_id: userId, agent_role: "sales", sender: "staff", kind: "reply", content: text,
  }).select("id").single();
  if (insErr) return json({ error: "save_failed" }, 500);

  let parsed;
  try {
    const raw = await callLLM([
      { role: "system", content: SYSTEM_PROMPT + (o.voice ? VOICE_PROMPT : "") },
      ...past,
      {
        role: "user",
        content: `[${profile?.name ?? "Rep"} says] ${text}\n\nCONTEXT (fresh):\n${JSON.stringify(ctx)}`,
      },
    ]);
    parsed = parseAgentJson(raw);
  } catch (e) {
    const code = e instanceof Error ? e.message : "llm_error";
    return json({ error: code, message: "Your coach is unavailable right now — try again in a moment." }, code === "rate_limited" ? 429 : 502);
  }

  const applied = await applyActions(userId, parsed.actions);
  const { data: agentRow } = await admin.from("staff_agent_messages").insert({
    user_id: userId, agent_role: "sales", sender: "agent", kind: "reply",
    content: parsed.reply, actions: applied,
  }).select("id").single();

  const audio = o.voice ? await speak(parsed.reply, o) : { audio: null, mimeType: null, provider: null, ttsError: null };
  return json({
    reply: parsed.reply,
    quick_replies: o.voice ? [] : parsed.quick_replies,
    applied,
    staff_message_id: staffRow.id,
    agent_message_id: agentRow?.id,
    ...audio,
  });
}

const voiceOpts = (body: any): VoiceOpts => ({
  voice: body.voice === true,
  language: ["en", "hi", "pa"].includes(body.language) ? body.language : "en",
  ttsVoice: GEMINI_TTS_VOICES.includes(body.tts_voice) ? body.tts_voice : DEFAULT_TTS_VOICE,
});

// ── entry ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));

    const secret = req.headers.get("x-internal-secret");
    if (body.action === "tick") {
      if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) return json({ error: "unauthorized" }, 401);
      return await handleTick();
    }

    if (body.action === "tts_health") {
      if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) return json({ error: "unauthorized" }, 401);
      return await handleTtsHealth();
    }

    if (body.action === "chat") {
      const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return json({ error: "unauthorized" }, 401);
      const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
      if (roleRow?.role !== "sales") return json({ error: "agent_not_available_for_role" }, 403);
      return await handleChat(user.id, String(body.message ?? ""), voiceOpts(body));
    }

    if (body.action === "speak") {
      const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return json({ error: "unauthorized" }, 401);
      return await handleSpeak(user.id, String(body.message_id ?? ""), voiceOpts(body));
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("staff-agent error", e);
    return json({ error: "internal_error" }, 500);
  }
});
