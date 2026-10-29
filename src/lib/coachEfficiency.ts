// Pure calculations behind the admin "Coach Efficiency" dashboard. Kept free of
// Supabase/React so they can be unit-tested — these numbers are about people,
// so the definitions must be exact and boringly predictable.
//
// The engagement and IST-date pieces live in supabase/functions/_shared/coach-metrics
// so the 8:05 pm day-summary edge function counts exactly the same way.
import {
  addDays,
  checkinStats,
  isApplied,
  istDateString,
  istMidnightMs,
  median,
  type CoachAction,
  type CoachMsgRow,
} from "../../supabase/functions/_shared/coach-metrics";

export {
  IST_OFFSET,
  REPLY_WINDOW_MINUTES,
  addDays,
  checkinStats,
  istDateString,
  istMidnightMs,
  median,
} from "../../supabase/functions/_shared/coach-metrics";
export type { CheckinStats, CoachAction, CoachMsgRow } from "../../supabase/functions/_shared/coach-metrics";

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
      if (a.type !== "set_follow_up" || !isApplied(a) || !a.lead_id || !a.date) continue;
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

export interface DeskSignalInput {
  role: "service_head" | "accounts";
  coachOn: boolean;
  checkinsSent: number;
  responseRate: number | null;
  recentCheckinsSent: number;
  recentCheckinsReplied: number;
  presentToday: boolean;
  pushRegistered?: boolean | null;
  hourIST: number; // "not done yet today" flags wait until mid-afternoon
  // service head
  dueTodayOpen?: number;
  overdueOpen?: number;
  unassignedTomorrow?: number;
  // accounts
  waiting?: number;
  handledToday?: number;
}

// Flags for the service head and accounts. Their work is not in the CRM, so the
// "quiet" and "overdue follow-up" signals don't apply; these read the desk instead.
export function deskSignalsFor(i: DeskSignalInput): Signal[] {
  const out: Signal[] = [];
  if (i.coachOn && i.recentCheckinsSent >= 2 && i.recentCheckinsReplied === 0) {
    out.push({ key: "silent", label: "Not replying to check-ins", tone: "warn" });
  }
  if (i.coachOn && i.pushRegistered === false) {
    out.push({ key: "no_push", label: "Notifications not set up", tone: "warn" });
  }
  if (i.role === "service_head") {
    if (i.presentToday && i.hourIST >= 15 && (i.dueTodayOpen ?? 0) >= 5) {
      out.push({ key: "due_open", label: `${i.dueTodayOpen} jobs due today still open`, tone: "warn" });
    }
    if ((i.unassignedTomorrow ?? 0) >= 3) {
      out.push({ key: "unassigned", label: `${i.unassignedTomorrow} of tomorrow's jobs have no agent`, tone: "warn" });
    }
    if ((i.overdueOpen ?? 0) >= 25) {
      out.push({ key: "overdue_jobs", label: `${i.overdueOpen} overdue service jobs`, tone: "warn" });
    }
  } else if (i.presentToday && i.hourIST >= 15 && (i.waiting ?? 0) >= 20 && (i.handledToday ?? 0) === 0) {
    out.push({ key: "untouched", label: `Nothing approved or rejected yet today (${i.waiting} waiting)`, tone: "warn" });
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
