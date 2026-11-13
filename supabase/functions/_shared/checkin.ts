// Pure helpers behind the short, action-first coach check-ins: which items go on
// the tap-cards under a check-in, whether a mid-day check-in is worth sending at
// all, and keeping the message itself short. No Deno, no I/O, so it is unit-tested
// and shared by the staff-agent function and the app.

import { formatInr } from "./day-summary.ts";

export type ItemKind = "lead" | "job" | "approval";

// One tap-card under a check-in. Lead cards can set a follow-up in one tap; job and
// approval cards open the right screen. The coach never edits jobs or approvals.
export interface CheckinItem {
  id: string;
  kind: ItemKind;
  title: string;
  reason: string;
  lead_id?: string;
  phone?: string | null; // digits only, with the 91 country code
  route?: string;
  state: "pending" | "done" | "skipped";
  result?: string; // "Follow-up set for 2026-11-14"
}

export const MAX_ITEMS = 3;
export const HIGH_VALUE_LEAD = 100_000;
// A mid-day check-in is only sent after this long without CRM/desk activity.
export const IDLE_NUDGE_MINUTES = 90;
// ...and never while the person is in the middle of a coach conversation.
export const RECENT_CHAT_MINUTES = 45;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const dayDiff = (later: string, earlier: string) =>
  Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);

// Indian mobile numbers -> "91XXXXXXXXXX" for tel:/wa.me links; null if it doesn't look like one.
export function phoneDigits(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return null;
}

// ── sales ────────────────────────────────────────────────────────────────────
export interface LeadLite {
  id: string;
  customer_name: string;
  customer_phone?: string | null;
  value_in_rupees: number | string | null;
  next_follow_up_date: string | null;
  last_follow_up: string | null;
}

// Today's follow-ups and overdue ones, biggest first (due-today wins a tie), then
// big leads nobody has a follow-up on. Three at most.
export function pickSalesItems(leads: LeadLite[], today: string, now: number): CheckinItem[] {
  const value = (l: LeadLite) => Number(l.value_in_rupees || 0);
  const due = leads
    .filter(l => l.next_follow_up_date && l.next_follow_up_date <= today)
    .sort((a, b) => value(b) - value(a) || (a.next_follow_up_date === today ? -1 : 1));
  const stale = leads
    .filter(l => {
      if (l.next_follow_up_date || !l.last_follow_up) return false;
      return (now - Date.parse(l.last_follow_up)) / 86_400_000 >= 7;
    })
    .sort((a, b) => value(b) - value(a));

  return [...due, ...stale].slice(0, MAX_ITEMS).map(l => {
    const v = value(l) > 0 ? ` · ${formatInr(value(l))}` : "";
    let reason: string;
    if (l.next_follow_up_date === today) reason = `follow-up due today${v}`;
    else if (l.next_follow_up_date) reason = `overdue ${plural(dayDiff(today, l.next_follow_up_date), "day")}${v}`;
    else reason = `no follow-up set${v}`;
    return {
      id: l.id, kind: "lead" as const, title: l.customer_name, reason,
      lead_id: l.id, phone: phoneDigits(l.customer_phone), state: "pending" as const,
    };
  });
}

// ── service head ─────────────────────────────────────────────────────────────
export interface JobLite {
  id: string;
  customer_name: string;
  date_to_attend: string | null;
  assigned_agent: string | null;
  value?: number | string | null;
}

// Jobs with no agent that are due now, then no agent tomorrow, then the most overdue.
export function pickServiceItems(jobs: JobLite[], today: string, tomorrow: string): CheckinItem[] {
  const needNow = jobs.filter(j => !j.assigned_agent && j.date_to_attend && j.date_to_attend <= today);
  const needTomorrow = jobs.filter(j => !j.assigned_agent && j.date_to_attend === tomorrow);
  const late = jobs
    .filter(j => j.assigned_agent && j.date_to_attend && j.date_to_attend < today)
    .sort((a, b) => String(a.date_to_attend).localeCompare(String(b.date_to_attend)));

  const picked: CheckinItem[] = [];
  const seen = new Set<string>();
  const add = (j: JobLite, reason: string) => {
    if (picked.length >= MAX_ITEMS || seen.has(j.id)) return;
    seen.add(j.id);
    picked.push({ id: j.id, kind: "job", title: j.customer_name, reason, route: "/service-jobs", state: "pending" });
  };
  needNow.forEach(j => add(j, j.date_to_attend === today ? "no agent · due today" : `no agent · ${plural(dayDiff(today, String(j.date_to_attend)), "day")} late`));
  needTomorrow.forEach(j => add(j, "no agent · due tomorrow"));
  late.forEach(j => add(j, `${plural(dayDiff(today, String(j.date_to_attend)), "day")} overdue`));
  return picked;
}

// ── accounts ─────────────────────────────────────────────────────────────────
export interface ApprovalJobLite {
  id: string;
  customer_name: string;
  value: number | string | null;
  completed_at: string | null;
  updated_at: string | null;
}
export interface ApprovalBillLite {
  id: string;
  bill_reference: string | null;
  net_bill_amount: number | string | null;
  created_at: string | null;
}

const waitingDays = (iso: string | null, now: number) =>
  iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000)) : 0;

// The oldest service approval, the oldest card bill, and the biggest service approval.
export function pickAccountsItems(jobs: ApprovalJobLite[], bills: ApprovalBillLite[], now: number): CheckinItem[] {
  const picked: CheckinItem[] = [];
  const seen = new Set<string>();
  const jobItem = (j: ApprovalJobLite): CheckinItem => ({
    id: j.id, kind: "approval", title: j.customer_name,
    reason: `service approval · waiting ${plural(waitingDays(j.completed_at ?? j.updated_at, now), "day")}${Number(j.value) > 0 ? ` · ${formatInr(Number(j.value))}` : ""}`,
    route: "/accounts/approvals", state: "pending",
  });
  const oldestJob = [...jobs].sort((a, b) => Date.parse(a.completed_at ?? a.updated_at ?? "") - Date.parse(b.completed_at ?? b.updated_at ?? ""))[0];
  const oldestBill = [...bills].sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""))[0];
  const biggestJob = [...jobs].sort((a, b) => Number(b.value || 0) - Number(a.value || 0))[0];

  const add = (item: CheckinItem) => {
    if (picked.length >= MAX_ITEMS || seen.has(item.id)) return;
    seen.add(item.id);
    picked.push(item);
  };
  if (oldestJob) add(jobItem(oldestJob));
  if (oldestBill) {
    add({
      id: `bill:${oldestBill.id}`, kind: "approval", title: oldestBill.bill_reference ? `Bill ${oldestBill.bill_reference}` : "Card bill",
      reason: `card bill · waiting ${plural(waitingDays(oldestBill.created_at, now), "day")}${Number(oldestBill.net_bill_amount) > 0 ? ` · ${formatInr(Number(oldestBill.net_bill_amount))}` : ""}`,
      route: "/card-bills", state: "pending",
    });
  }
  if (biggestJob && Number(biggestJob.value) > 0) add(jobItem(biggestJob));
  return picked;
}

// ── should this check-in go out? ─────────────────────────────────────────────
export type Slot = "first" | "mid" | "last";

export function slotFor(istHour: number): Slot {
  if (istHour < 13) return "first";
  if (istHour >= 19) return "last";
  return "mid";
}

export interface NudgeInput {
  slot: Slot;
  hasItems: boolean;
  // Minutes since the person last did anything we can see (null = we can't see it
  // for this role). Measured from clock-in, 11 am or their last coach message if later.
  minutesIdle: number | null;
  // Something important is waiting regardless of activity (e.g. a big follow-up untouched today).
  priorityHit: boolean;
  recentChatMinutes: number;
}

// The morning and evening check-ins always go out. A mid-day one goes out only when
// there is something to point at AND the person has gone quiet or something big is
// waiting — and never mid-conversation.
export function shouldNudge(i: NudgeInput): { send: boolean; reason: string } {
  if (i.slot !== "mid") return { send: true, reason: i.slot };
  if (!i.hasItems) return { send: false, reason: "nothing to point at" };
  if (i.recentChatMinutes < RECENT_CHAT_MINUTES) return { send: false, reason: "in a conversation" };
  if (i.priorityHit) return { send: true, reason: "important item waiting" };
  if (i.minutesIdle !== null && i.minutesIdle >= IDLE_NUDGE_MINUTES) return { send: true, reason: "gone quiet" };
  return { send: false, reason: "busy or nothing urgent" };
}

// ── keep the message short ───────────────────────────────────────────────────
// The prompt asks for ~35 words; this is the safety net. Cuts at a sentence end
// when it can, otherwise at the word limit.
export function trimCheckin(text: string, maxWords = 50): string {
  const t = text.trim();
  const words = t.split(/\s+/);
  if (words.length <= maxWords) return t;
  const head = words.slice(0, maxWords).join(" ");
  const lastEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf("।"));
  if (lastEnd > head.length * 0.4) return head.slice(0, lastEnd + 1).trim();
  return `${head.replace(/[,;:\s]+$/, "")}…`;
}

// "Done ✅ / Thodi der baad / Atak gaya" — same three taps for every role.
export const CHECKIN_QUICK_REPLIES = ["Done ✅", "Thodi der baad", "Atak gaya"];
