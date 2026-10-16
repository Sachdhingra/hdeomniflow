// Pure calculations behind the admin "Coach Efficiency" dashboard. Kept free of
// Supabase/React so they can be unit-tested — these numbers are about people,
// so the definitions must be exact and boringly predictable.

// What the coach did to a lead from a chat reply. `ok === false` means it was
// refused (wrong owner, past date, save failed…) — older rows have no `ok` and
// were always successes.
export interface CoachAction {
  type: "set_follow_up" | "add_note" | string;
  ok?: boolean;
  lead_id?: string;
  customer?: string;
  date?: string;
  time?: string | null;
  from?: string | null;
  text?: string;
  reason?: string;
}

export interface CoachMsgRow {
  user_id: string;
  sender: "agent" | "staff";
  kind: "checkin" | "reply" | "system";
  created_at: string;
  actions: CoachAction[] | null;
}

const applied = (a: CoachAction) => a.ok !== false;

export interface CheckinStats {
  sent: number;
  replied: number;
  responseRate: number | null; // 0-100, null when nothing was sent
  medianReplyMinutes: number | null;
  actionsApplied: number; // notes + follow-ups the coach saved from chat
  followUpsSet: number; // follow-up dates the coach saved on leads
  notesSaved: number;
  actionsRefused: number; // things the coach tried to save but couldn't
  staffMessages: number;
}

// A rep "replied" to a check-in if they wrote anything back before the next
// check-in, or within this many minutes, whichever comes first.
export const REPLY_WINDOW_MINUTES = 180;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Check-in engagement for ONE rep. `rows` are that rep's messages, any order.
// Only check-ins sent inside [fromMs, toMs) are counted; replies may land after
// toMs (a 7:30 pm check-in answered at 8:05 pm still counts).
export function checkinStats(rows: CoachMsgRow[], fromMs: number, toMs: number): CheckinStats {
  const msgs = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const checkins = msgs.filter(m => m.kind === "checkin" && m.sender === "agent");
  const staff = msgs.filter(m => m.sender === "staff");
  const replyMinutes: number[] = [];
  let sent = 0;
  let replied = 0;

  checkins.forEach((c, i) => {
    const t = Date.parse(c.created_at);
    if (t < fromMs || t >= toMs) return;
    sent++;
    const nextCheckin = checkins[i + 1] ? Date.parse(checkins[i + 1].created_at) : Infinity;
    const end = Math.min(nextCheckin, t + REPLY_WINDOW_MINUTES * 60_000);
    const reply = staff.find(s => {
      const st = Date.parse(s.created_at);
      return st > t && st < end;
    });
    if (reply) {
      replied++;
      replyMinutes.push((Date.parse(reply.created_at) - t) / 60_000);
    }
  });

  const inRange = (m: CoachMsgRow) => {
    const t = Date.parse(m.created_at);
    return t >= fromMs && t < toMs;
  };
  const coachActions = msgs
    .filter(m => m.sender === "agent" && m.kind === "reply" && inRange(m))
    .flatMap(m => (Array.isArray(m.actions) ? m.actions : []));
  const done = coachActions.filter(applied);
  return {
    sent,
    replied,
    responseRate: sent > 0 ? Math.round((replied / sent) * 100) : null,
    medianReplyMinutes: median(replyMinutes),
    actionsApplied: done.length,
    followUpsSet: done.filter(a => a.type === "set_follow_up").length,
    notesSaved: done.filter(a => a.type === "add_note").length,
    actionsRefused: coachActions.length - done.length,
    staffMessages: staff.filter(inRange).length,
  };
}

export interface ScheduledFollowUp {
  userId: string;
  atMs: number; // when the coach saved it
  leadId: string;
  customer: string | null;
  date: string; // the follow-up date it set
  time: string | null;
  from: string | null; // the date it replaced
}

// Follow-up dates the coach saved on leads in [fromMs, toMs), newest first.
export function scheduledFollowUps(rows: CoachMsgRow[], fromMs: number, toMs: number): ScheduledFollowUp[] {
  const out: ScheduledFollowUp[] = [];
  for (const m of rows) {
    const t = Date.parse(m.created_at);
    if (m.sender !== "agent" || t < fromMs || t >= toMs || !Array.isArray(m.actions)) continue;
    for (const a of m.actions) {
      if (a.type !== "set_follow_up" || !applied(a) || !a.lead_id || !a.date) continue;
      out.push({ userId: m.user_id, atMs: t, leadId: a.lead_id, customer: a.customer ?? null, date: a.date, time: a.time ?? null, from: a.from ?? null });
    }
  }
  return out.sort((x, y) => y.atMs - x.atMs);
}

export type SyncState = "in_sync" | "changed" | "closed" | "missing";

// Is the follow-up the coach set still what's on the lead? "changed" usually means
// the rep (or someone) moved it afterwards — worth seeing, not necessarily wrong.
export function followUpSyncState(
  setDate: string,
  lead: { next_follow_up_date: string | null; status: string } | undefined,
): SyncState {
  if (!lead) return "missing";
  if (lead.next_follow_up_date === setDate) return "in_sync";
  if (lead.status === "won" || lead.status === "lost") return "closed";
  return "changed";
}

export interface QuietStretch {
  minutes: number;
  fromMs: number;
  toMs: number;
}

// Longest stretch with no recorded CRM activity inside [startMs, endMs].
// Returns null if the window is shorter than `minWindowMinutes` (too little time
// to say anything fair).
export function longestQuietStretch(
  eventsMs: number[],
  startMs: number,
  endMs: number,
  minWindowMinutes = 60,
): QuietStretch | null {
  if (endMs - startMs < minWindowMinutes * 60_000) return null;
  const pts = [startMs, ...eventsMs.filter(t => t > startMs && t < endMs).sort((a, b) => a - b), endMs];
  let best: QuietStretch = { minutes: 0, fromMs: startMs, toMs: startMs };
  for (let i = 1; i < pts.length; i++) {
    const minutes = (pts[i] - pts[i - 1]) / 60_000;
    if (minutes > best.minutes) best = { minutes, fromMs: pts[i - 1], toMs: pts[i] };
  }
  return best;
}

export type Signal = { key: string; label: string; tone: "warn" | "info" };

export interface SignalInput {
  coachOn: boolean;
  checkinsSent: number;
  responseRate: number | null;
  recentCheckinsSent: number; // last two check-ins
  recentCheckinsReplied: number;
  overdueFollowUps: number;
  quietMinutesToday: number | null;
  presentToday: boolean;
  // Has a phone registered for notifications? null = unknown.
  pushRegistered?: boolean | null;
}

// Plain-language flags an admin can act on. Deliberately few and conservative.
export function signalsFor(i: SignalInput): Signal[] {
  const out: Signal[] = [];
  if (i.coachOn && i.recentCheckinsSent >= 2 && i.recentCheckinsReplied === 0) {
    out.push({ key: "silent", label: "Not replying to check-ins", tone: "warn" });
  }
  if (i.presentToday && i.quietMinutesToday !== null && i.quietMinutesToday >= 120) {
    out.push({ key: "quiet", label: `No CRM activity for ${formatDuration(i.quietMinutesToday)}`, tone: "warn" });
  }
  if (i.coachOn && i.pushRegistered === false) {
    out.push({ key: "no_push", label: "Notifications not set up", tone: "warn" });
  }
  if (i.overdueFollowUps >= 10) {
    out.push({ key: "overdue", label: `${i.overdueFollowUps} overdue follow-ups`, tone: "warn" });
  }
  if (i.coachOn && i.checkinsSent >= 3 && i.responseRate !== null && i.responseRate >= 80) {
    out.push({ key: "engaged", label: "Highly engaged", tone: "info" });
  }
  return out;
}

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

// IST helpers. India has no DST, so a fixed +05:30 offset is exact.
export const IST_OFFSET = "+05:30";
export const istDateString = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
export const istMidnightMs = (date: string): number => Date.parse(`${date}T00:00:00${IST_OFFSET}`);

export function addDays(date: string, days: number): string {
  const d = new Date(istMidnightMs(date) + days * 86_400_000);
  return istDateString(d);
}

export type RangeKey = "today" | "7d" | "30d";

export function rangeFor(key: RangeKey, now = new Date()) {
  const today = istDateString(now);
  const days = key === "today" ? 1 : key === "7d" ? 7 : 30;
  const fromDate = addDays(today, -(days - 1));
  return {
    today,
    fromDate,
    toDate: today,
    fromMs: istMidnightMs(fromDate),
    toMs: istMidnightMs(addDays(today, 1)),
    days,
  };
}

// Daily response rate series for the chart: one point per IST day in the range.
export function dailyResponse(
  rowsByUser: Map<string, CoachMsgRow[]>,
  fromDate: string,
  days: number,
): { date: string; sent: number; replied: number; rate: number | null }[] {
  const out: { date: string; sent: number; replied: number; rate: number | null }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const fromMs = istMidnightMs(date);
    const toMs = istMidnightMs(addDays(date, 1));
    let sent = 0;
    let replied = 0;
    rowsByUser.forEach(rows => {
      const s = checkinStats(rows, fromMs, toMs);
      sent += s.sent;
      replied += s.replied;
    });
    out.push({ date, sent, replied, rate: sent > 0 ? Math.round((replied / sent) * 100) : null });
  }
  return out;
}
