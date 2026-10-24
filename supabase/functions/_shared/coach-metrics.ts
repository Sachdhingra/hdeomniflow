// Pure coach/IST calculations shared by the admin dashboard (browser) and the
// edge functions (Deno): how a rep engages with their coach, and IST day maths.
// No imports, so it runs in both.


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

export const isApplied = (a: CoachAction) => a.ok !== false;

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
  const done = coachActions.filter(isApplied);
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

// IST helpers. India has no DST, so a fixed +05:30 offset is exact.
export const IST_OFFSET = "+05:30";
export const istDateString = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
export const istMidnightMs = (date: string): number => Date.parse(`${date}T00:00:00${IST_OFFSET}`);

export function addDays(date: string, days: number): string {
  const d = new Date(istMidnightMs(date) + days * 86_400_000);
  return istDateString(d);
}
