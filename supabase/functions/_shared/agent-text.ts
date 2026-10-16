// Pure helpers for the staff coach: turning the model's raw output into
// {reply, actions, quick_replies}, validating follow-up dates, and spotting a
// reply that claims a follow-up was saved when nothing was. No Deno imports, so
// it runs in the edge function and in the unit tests.

export type AgentActionInput = Record<string, unknown>;

export interface AgentOutput {
  reply: string;
  actions: AgentActionInput[];
  quick_replies: string[];
}

export const KNOWN_ACTION_TYPES = ["add_note", "set_follow_up"] as const;
const FALLBACK_REPLY = "Sorry, I lost my train of thought — can you say that again?";

const cleanReplies = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim().slice(0, 40)).slice(0, 3)
    : [];

interface Found {
  obj: Record<string, unknown>;
  start: number;
  end: number; // exclusive
}

// Every JSON object that appears anywhere in `text`, found by balanced-brace
// scanning (string- and escape-aware). The model sometimes wraps the JSON in
// prose, or splits its answer around it; a naive "starts with {" parse misses
// that and the actions are silently lost.
export function extractJsonObjects(text: string): Found[] {
  const out: Found[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end === -1) {
      i++;
      continue;
    }
    try {
      const obj = JSON.parse(text.slice(i, end));
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        out.push({ obj, start: i, end });
        i = end;
        continue;
      }
    } catch {
      // not valid JSON as a whole — try again from the next character, which
      // can still find valid objects nested inside a broken outer one
    }
    i++;
  }
  return out;
}

const isActionObject = (o: Record<string, unknown>) =>
  typeof o.type === "string" && (KNOWN_ACTION_TYPES as readonly string[]).includes(o.type);

const dedupeActions = (list: AgentActionInput[]): AgentActionInput[] => {
  const seen = new Set<string>();
  return list.filter((a) => {
    const k = JSON.stringify(a);
    return seen.has(k) ? false : (seen.add(k), true);
  });
};

export function parseAgentOutput(raw: string, depth = 0): AgentOutput {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const found = extractJsonObjects(text);

  // 1. A proper envelope: {"reply": "...", "actions": [...], ...}
  const envelope = found.find((f) => typeof f.obj.reply === "string");
  if (envelope) {
    const o = envelope.obj;
    const reply = String(o.reply).trim();
    const actions = Array.isArray(o.actions) ? (o.actions as AgentActionInput[]) : [];
    const quick = cleanReplies(o.quick_replies);
    // The model sometimes double-wraps: the "reply" string is itself a JSON
    // envelope. Unwrap it, keeping the actions from both layers.
    if (depth < 2 && /^(```|\{)/.test(reply)) {
      const inner = parseAgentOutput(reply, depth + 1);
      if (inner.reply !== FALLBACK_REPLY) {
        return {
          reply: inner.reply,
          actions: dedupeActions([...actions, ...inner.actions]),
          quick_replies: inner.quick_replies.length ? inner.quick_replies : quick,
        };
      }
    }
    return { reply: reply || FALLBACK_REPLY, actions, quick_replies: quick };
  }

  // 2. Prose with JSON blobs mixed in: take the actions, drop the blobs.
  const actions: AgentActionInput[] = [];
  let quick: string[] = [];
  const consumed: Found[] = [];
  for (const f of found) {
    const o = f.obj;
    if (Array.isArray(o.actions)) {
      actions.push(...(o.actions as AgentActionInput[]));
      if (o.quick_replies) quick = cleanReplies(o.quick_replies);
      consumed.push(f);
    } else if (isActionObject(o)) {
      actions.push(o);
      consumed.push(f);
    } else if (Array.isArray(o.quick_replies)) {
      quick = cleanReplies(o.quick_replies);
      consumed.push(f);
    }
  }
  if (consumed.length > 0) {
    let prose = text;
    // Remove from the end so earlier offsets stay valid. Nested objects that were
    // already inside a consumed one are skipped.
    const spans = consumed.filter((c, idx) => !consumed.some((d, k) => k !== idx && d.start <= c.start && d.end >= c.end && (d.start < c.start || d.end > c.end)));
    for (const s of [...spans].sort((a, b) => b.start - a.start)) prose = prose.slice(0, s.start) + prose.slice(s.end);
    return { reply: tidy(prose) || FALLBACK_REPLY, actions, quick_replies: quick };
  }

  // 3. Malformed envelope (unescaped quotes etc.): pull the fields out by regex.
  const m = text.match(/"reply"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"(?:quick_replies|actions)"|\})/);
  if (m) {
    const arr = (key: string): unknown[] => {
      const a = text.match(new RegExp('"' + key + '"\\s*:\\s*(\\[[^\\]]*\\])'));
      if (!a) return [];
      try {
        const v = JSON.parse(a[1]);
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    };
    return {
      reply: m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'),
      actions: arr("actions") as AgentActionInput[],
      quick_replies: cleanReplies(arr("quick_replies")),
    };
  }

  // 4. Plain prose. Never show raw JSON to staff.
  const prose = tidy(text);
  if (!prose || prose.startsWith("{")) return { reply: FALLBACK_REPLY, actions: [], quick_replies: [] };
  return { reply: prose, actions: [], quick_replies: [] };
}

const tidy = (s: string) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

// ── dates ───────────────────────────────────────────────────────────────────
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const parseDate = (d: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const dt = new Date(`${d}T12:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d ? null : dt;
};

export const addDaysISO = (date: string, days: number): string => {
  const d = parseDate(date);
  if (!d) throw new Error(`bad date ${date}`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
};

// "Today", "tomorrow", and the next days with weekday names — so the model never
// has to do calendar arithmetic ("kal", "Monday", "next week").
export function calendarContext(todayISO: string, days = 8): { date: string; label: string; weekday: string }[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDaysISO(todayISO, i);
    return {
      date,
      weekday: WEEKDAYS[parseDate(date)!.getUTCDay()],
      label: i === 0 ? "today" : i === 1 ? "tomorrow" : `in ${i} days`,
    };
  });
}

// A flat shape (not a union) so it narrows the same under strict and non-strict TypeScript.
export interface FollowUpCheck {
  ok: boolean;
  reason?: string;
  date?: string;
  time?: string | null;
}

export function validateFollowUp(date: unknown, time: unknown, todayISO: string): FollowUpCheck {
  if (typeof date !== "string" || !parseDate(date)) return { ok: false, reason: "the date wasn't clear" };
  if (date < todayISO) return { ok: false, reason: "that date has already passed" };
  if (date > addDaysISO(todayISO, 365)) return { ok: false, reason: "that date is more than a year away" };
  let t: string | null = null;
  if (time !== undefined && time !== null && time !== "") {
    if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, reason: "the time wasn't clear" };
    t = time;
  }
  return { ok: true, date, time: t };
}

// What a reply says it saved. Checked sentence by sentence so a question
// ("kya main follow-up set karun?") or an unrelated "ho gaya" is not a claim.
export interface SavedClaims {
  followUp: boolean;
  note: boolean;
}

const FOLLOW_UP_WORD = /follow[\s-]?up|reminder/i;
const FOLLOW_UP_DONE =
  /(set kar|set ho|set kiy|set done|\bis set\b|has been set|i['’]?ve set|i have set|have set|been scheduled|\bscheduled\b|rescheduled|reschedule kar|\bupdated\b|update kar|adjust(ed)?\b|adjust kar|\band set (a|the)\b|laga diya|lagaya|laga di\b|ho gaya|ho gayi|kar diya|kar di\b|kar liya|add kar|added)/i;
const NOTE_WORD = /\bnot(e|es|ed)\b/i;
const NOTE_DONE =
  /(add kar|kar diya|kar di\b|kar liya|noted down|i['’]?ve (noted|added|saved)|i have (noted|added|saved)|made a note|added a note|note (saved|added)|\bmaine\b|note kar (deta|dunga|diya|liya|raha|rahi)|likh diya|likh liya|\bsaved\b)/i;

export function savedClaims(reply: string): SavedClaims {
  const out: SavedClaims = { followUp: false, note: false };
  for (const raw of reply.split(/(?<=[.!?।\n])\s+/)) {
    const sentence = raw.trim();
    if (!sentence || /\?\s*(\W*)$/.test(sentence)) continue; // a question is not a claim
    if (FOLLOW_UP_WORD.test(sentence) && FOLLOW_UP_DONE.test(sentence)) out.followUp = true;
    if (NOTE_WORD.test(sentence) && NOTE_DONE.test(sentence)) out.note = true;
  }
  return out;
}

// Kept for callers that only care about follow-ups.
export function claimsFollowUpSaved(reply: string): boolean {
  return savedClaims(reply).followUp;
}
