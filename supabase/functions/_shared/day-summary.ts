// The admin's 8:05 pm day summary: turns one day's facts into a short report —
// what was done, the plan for tomorrow, and who needs special attention.
//
// Pure (no imports, no I/O) so it is unit-tested and used both by the edge
// function that builds the report and by the UI that renders it. Every number in
// the report is computed here from the facts; the AI only writes the headline and
// a few "focus" lines on top, so a wrong figure can never come from the model.

export interface RepDay {
  id: string;
  name: string;
  present: boolean;
  late: boolean;
  presentLast7: number; // days with a clock-in in the last 7 (incl. today)
  newLeads: number;
  stageMoves: number; // real moves; the app's automatic overdue flips are excluded
  leadsTouched: number; // leads updated by the rep; automatic flips excluded
  wonCount: number;
  wonValue: number;
  lostCount: number;
  coachOn: boolean;
  coachSent: number;
  coachReplied: number;
  followUpsSetByCoach: number;
  dueTodayOpen: number; // follow-ups still dated today at 8 pm: not actioned
  dueTomorrow: number;
  topDueTomorrow: { customer: string; value: number }[];
  overdue: number;
  monthWon: number;
  monthTarget: number | null;
  pushRegistered: boolean | null;
}

// The service head's day. Their work lives in service jobs, not leads, so they
// get their own facts and rules rather than being squeezed into RepDay.
export interface StaffDay {
  id: string;
  name: string;
  present: boolean;
  late: boolean;
  presentLast7: number;
  coachOn: boolean;
  coachSent: number;
  coachReplied: number;
  pushRegistered: boolean | null;
}

export type ServiceHeadDay = StaffDay;
export type AccountsHeadDay = StaffDay;

// Desk numbers and the head are optional: reports stored before the service head
// joined the summary don't carry them.
export interface ServiceFacts {
  completedToday: number;
  scheduledTomorrow: number;
  unassignedTomorrow: number;
  dueTodayOpen?: number; // jobs dated today still not completed at 8 pm
  overdueOpen?: number; // open jobs dated before today
  rejectedByAccounts?: number;
  head?: ServiceHeadDay | null;
}

// Accounts' approval queue. Handled/oldest numbers and the person are optional for
// the same reason: older stored reports don't carry them.
export interface AccountsFacts {
  servicePending: number;
  billsPending: number;
  approvedToday?: number; // by the accounts person, jobs + card bills
  rejectedToday?: number;
  oldestServiceDays?: number | null;
  oldestBillDays?: number | null;
  head?: AccountsHeadDay | null;
}

export interface DayFacts {
  date: string; // YYYY-MM-DD (IST)
  dayOfMonth: number;
  daysInMonth: number;
  reps: RepDay[];
  service: ServiceFacts;
  accounts: AccountsFacts;
}

export interface AttentionItem {
  repId: string;
  name: string;
  reasons: string[];
  score: number;
}

export interface DayReport {
  date: string;
  headline: string;
  focus: string[]; // up to 3 short lines for tomorrow, written by the AI (empty if it failed)
  headlineBy: "ai" | "template";
  totals: {
    repsExpected: number;
    repsPresent: number;
    newLeads: number;
    wonCount: number;
    wonValue: number;
    lostCount: number;
    stageMoves: number;
    leadsTouched: number;
    coachSent: number;
    coachReplied: number;
    followUpsSetByCoach: number;
    dueTomorrow: number;
    dueTodayOpen: number;
    overdue: number;
  };
  done: string[];
  tomorrow: string[];
  attention: AttentionItem[];
  reps: RepDay[];
  service: ServiceFacts;
  accounts: AccountsFacts;
}

export function formatInr(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)} Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// A rep counts as "expected today" if they have been working recently — so
// someone on a long leave doesn't show up as absent every single day.
export const isExpected = (r: RepDay) => r.present || r.presentLast7 > 0;

export function attentionFor(r: RepDay, f: Pick<DayFacts, "dayOfMonth" | "daysInMonth">): AttentionItem | null {
  const reasons: { text: string; weight: number }[] = [];

  if (!r.present && r.presentLast7 >= 3) {
    reasons.push({ text: "Not in today (was in most of this week)", weight: 3 });
  }
  if (r.coachOn && r.coachSent >= 3 && r.coachReplied === 0) {
    reasons.push({ text: `Didn't reply to any of ${r.coachSent} coach check-ins`, weight: 3 });
  }
  if (r.present && r.newLeads === 0 && r.stageMoves === 0 && r.leadsTouched <= 2) {
    reasons.push({ text: `Very little CRM activity (${plural(r.stageMoves, "stage move")}, ${plural(r.leadsTouched, "lead")} updated)`, weight: 3 });
  }
  if (r.dueTodayOpen >= 5) {
    reasons.push({ text: `${r.dueTodayOpen} follow-ups due today weren't actioned`, weight: r.dueTodayOpen >= 10 ? 3 : 2 });
  }
  // A standing backlog is context, not news: on its own it never makes the list
  // (weight 1 < 2), it only adds a line for someone already flagged — unless it is
  // truly huge.
  if (r.overdue >= 15) {
    reasons.push({ text: `${r.overdue} overdue follow-ups piling up`, weight: r.overdue >= 40 ? 2 : 1 });
  }
  if (r.monthTarget && r.monthTarget > 0 && f.dayOfMonth >= 10) {
    const actual = (r.monthWon / r.monthTarget) * 100;
    const pace = (f.dayOfMonth / f.daysInMonth) * 100;
    if (actual < pace - 30) {
      reasons.push({ text: `Month target at ${Math.round(actual)}% (on-pace is ${Math.round(pace)}%)`, weight: 2 });
    }
  }
  if (r.coachOn && r.pushRegistered === false) {
    reasons.push({ text: "Notifications not set up, so coach check-ins can't reach their phone", weight: 1 });
  }

  const score = sum(reasons.map(x => x.weight));
  // One minor note alone (just notifications) is not "special attention".
  if (score < 2) return null;
  return { repId: r.id, name: r.name, reasons: reasons.sort((a, b) => b.weight - a.weight).map(x => x.text), score };
}

// Same bar as for reps: a score of 2 or more earns a place on the list.
export function serviceHeadAttention(h: ServiceHeadDay, s: ServiceFacts): AttentionItem | null {
  const reasons: { text: string; weight: number }[] = [];
  const dueOpen = s.dueTodayOpen ?? 0;
  const overdue = s.overdueOpen ?? 0;

  if (!h.present && h.presentLast7 >= 3) {
    reasons.push({ text: "Not in today (was in most of this week)", weight: 3 });
  }
  if (h.coachOn && h.coachSent >= 3 && h.coachReplied === 0) {
    reasons.push({ text: `Didn't reply to any of ${h.coachSent} coach check-ins`, weight: 3 });
  }
  if (dueOpen >= 5) {
    reasons.push({ text: `${dueOpen} service jobs due today are still open`, weight: dueOpen >= 10 ? 3 : 2 });
  }
  if (s.unassignedTomorrow >= 3) {
    reasons.push({ text: `${s.unassignedTomorrow} of tomorrow's ${s.scheduledTomorrow} jobs have no agent yet`, weight: 2 });
  }
  if (overdue >= 10) {
    reasons.push({ text: `${overdue} overdue service jobs piling up`, weight: overdue >= 25 ? 2 : 1 });
  }
  if ((s.rejectedByAccounts ?? 0) >= 3) {
    reasons.push({ text: `${s.rejectedByAccounts} jobs rejected by accounts need fixing`, weight: 1 });
  }
  if (h.coachOn && h.pushRegistered === false) {
    reasons.push({ text: "Notifications not set up, so coach check-ins can't reach their phone", weight: 1 });
  }

  const score = sum(reasons.map(x => x.weight));
  if (score < 2) return null;
  return { repId: h.id, name: `${h.name} (service head)`, reasons: reasons.sort((a, b) => b.weight - a.weight).map(x => x.text), score };
}

export function accountsHeadAttention(h: AccountsHeadDay, a: AccountsFacts): AttentionItem | null {
  const reasons: { text: string; weight: number }[] = [];
  const waiting = a.servicePending + a.billsPending;
  const handled = (a.approvedToday ?? 0) + (a.rejectedToday ?? 0);
  const oldest = Math.max(a.oldestServiceDays ?? 0, a.oldestBillDays ?? 0);

  if (!h.present && h.presentLast7 >= 3) {
    reasons.push({ text: "Not in today (was in most of this week)", weight: 3 });
  }
  if (h.coachOn && h.coachSent >= 3 && h.coachReplied === 0) {
    reasons.push({ text: `Didn't reply to any of ${h.coachSent} coach check-ins`, weight: 3 });
  }
  // Only when the queue is big and untouched all day — a quiet queue is fine.
  if (h.present && waiting >= 20 && handled === 0) {
    reasons.push({ text: `Nothing approved or rejected today with ${waiting} waiting`, weight: 3 });
  }
  if (oldest >= 30) {
    reasons.push({ text: `Oldest approval has been waiting ${oldest} days`, weight: 1 });
  }
  if (h.coachOn && h.pushRegistered === false) {
    reasons.push({ text: "Notifications not set up, so coach check-ins can't reach their phone", weight: 1 });
  }

  const score = sum(reasons.map(x => x.weight));
  if (score < 2) return null;
  return { repId: h.id, name: `${h.name} (accounts)`, reasons: reasons.sort((x, y) => y.weight - x.weight).map(x => x.text), score };
}

const activityScore = (r: RepDay) => r.stageMoves + r.newLeads * 2 + r.wonCount * 5 + r.leadsTouched * 0.5;

export function buildReport(facts: DayFacts): DayReport {
  const reps = facts.reps;
  const expected = reps.filter(isExpected);
  const present = reps.filter(r => r.present);

  const totals = {
    repsExpected: expected.length,
    repsPresent: present.length,
    newLeads: sum(reps.map(r => r.newLeads)),
    wonCount: sum(reps.map(r => r.wonCount)),
    wonValue: sum(reps.map(r => r.wonValue)),
    lostCount: sum(reps.map(r => r.lostCount)),
    stageMoves: sum(reps.map(r => r.stageMoves)),
    leadsTouched: sum(reps.map(r => r.leadsTouched)),
    coachSent: sum(reps.map(r => r.coachSent)),
    coachReplied: sum(reps.map(r => r.coachReplied)),
    followUpsSetByCoach: sum(reps.map(r => r.followUpsSetByCoach)),
    dueTomorrow: sum(reps.map(r => r.dueTomorrow)),
    dueTodayOpen: sum(reps.map(r => r.dueTodayOpen)),
    overdue: sum(reps.map(r => r.overdue)),
  };

  const head = facts.service.head ?? null;
  const headAttention = head ? serviceHeadAttention(head, facts.service) : null;
  const acct = facts.accounts.head ?? null;
  const acctAttention = acct ? accountsHeadAttention(acct, facts.accounts) : null;
  const attention = [...reps.map(r => attentionFor(r, facts)), headAttention, acctAttention]
    .filter((x): x is AttentionItem => x !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 5);

  // ── what was done ────────────────────────────────────────────────────────
  const done: string[] = [];
  const outcome = [
    plural(totals.newLeads, "new lead"),
    `${plural(totals.wonCount, "deal")} won${totals.wonCount ? ` (${formatInr(totals.wonValue)})` : ""}`,
    `${totals.lostCount} lost`,
  ];
  done.push(`${outcome.join(", ")}.`);
  done.push(`Reps made ${plural(totals.stageMoves, "stage move")} and updated ${plural(totals.leadsTouched, "lead")} (automatic overdue changes not counted).`);
  const top = [...present].sort((a, b) => activityScore(b) - activityScore(a)).filter(r => activityScore(r) > 0).slice(0, 2);
  if (top.length > 0) {
    done.push(
      `Most active: ${top
        .map(r => `${r.name} (${plural(r.stageMoves, "move")}, ${plural(r.newLeads, "new lead")}${r.wonCount ? `, ${r.wonCount} won` : ""})`)
        .join("; ")}.`,
    );
  }
  if (totals.coachSent > 0) {
    done.push(
      `Coach check-ins: ${totals.coachReplied} of ${totals.coachSent} answered; ${plural(totals.followUpsSetByCoach, "follow-up")} saved from chat.`,
    );
  }
  done.push(`Service: ${plural(facts.service.completedToday, "job")} completed today.`);
  if (head) {
    const dueOpen = facts.service.dueTodayOpen;
    const deskBits = [
      head.present ? (head.late ? "in today (late)" : "in today") : "not in today",
      head.coachSent > 0 ? `${head.coachReplied} of ${plural(head.coachSent, "coach check-in")} answered` : null,
      dueOpen !== undefined ? `${dueOpen} ${dueOpen === 1 ? "job" : "jobs"} due today still open` : null,
    ].filter(Boolean);
    done.push(`Service head ${head.name}: ${deskBits.join("; ")}.`);
  }
  if (acct) {
    const a = facts.accounts;
    const handled = (a.approvedToday ?? 0) + (a.rejectedToday ?? 0);
    const bits = [
      acct.present ? (acct.late ? "in today (late)" : "in today") : "not in today",
      acct.coachSent > 0 ? `${acct.coachReplied} of ${plural(acct.coachSent, "coach check-in")} answered` : null,
      a.approvedToday !== undefined ? `${plural(handled, "approval")} handled (${a.approvedToday} approved, ${a.rejectedToday ?? 0} rejected)` : null,
    ].filter(Boolean);
    done.push(`Accounts ${acct.name}: ${bits.join("; ")}.`);
  }

  // ── plan for tomorrow ────────────────────────────────────────────────────
  const tomorrow: string[] = [];
  if (totals.dueTomorrow > 0) {
    const byRep = [...reps]
      .filter(r => r.dueTomorrow > 0)
      .sort((a, b) => b.dueTomorrow - a.dueTomorrow)
      .slice(0, 4)
      .map(r => `${r.name} ${r.dueTomorrow}`)
      .join(", ");
    tomorrow.push(`${plural(totals.dueTomorrow, "follow-up")} due tomorrow (${byRep}).`);
    const biggest = reps
      .flatMap(r => r.topDueTomorrow.map(t => ({ ...t, rep: r.name })))
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);
    if (biggest.length > 0 && biggest[0].value > 0) {
      tomorrow.push(`Biggest follow-ups: ${biggest.map(b => `${b.customer} ${formatInr(b.value)} (${b.rep})`).join(", ")}.`);
    }
  } else {
    tomorrow.push("No follow-ups are scheduled for tomorrow yet.");
  }
  if (totals.dueTodayOpen > 0 || totals.overdue > 0) {
    tomorrow.push(
      `${plural(totals.dueTodayOpen, "follow-up")} due today ${totals.dueTodayOpen === 1 ? "wasn't" : "weren't"} actioned and will show as overdue; ${totals.overdue} overdue in total.`,
    );
  }
  if (facts.service.scheduledTomorrow > 0) {
    tomorrow.push(
      `Service: ${plural(facts.service.scheduledTomorrow, "job")} scheduled tomorrow${facts.service.unassignedTomorrow > 0 ? `, ${facts.service.unassignedTomorrow} not yet assigned` : ""}.`,
    );
  }
  const overdueJobs = facts.service.overdueOpen ?? 0;
  const rejectedJobs = facts.service.rejectedByAccounts ?? 0;
  if (overdueJobs > 0 || rejectedJobs > 0) {
    tomorrow.push(
      `Service backlog: ${plural(overdueJobs, "overdue job")}${rejectedJobs > 0 ? `, ${plural(rejectedJobs, "job")} rejected by accounts to fix` : ""}.`,
    );
  }
  const approvals = facts.accounts.servicePending + facts.accounts.billsPending;
  if (approvals > 0) {
    const oldest = Math.max(facts.accounts.oldestServiceDays ?? 0, facts.accounts.oldestBillDays ?? 0);
    tomorrow.push(
      `Accounts: ${plural(approvals, "approval")} waiting (${facts.accounts.servicePending} service/delivery, ${facts.accounts.billsPending} card bills)${oldest > 0 ? `, oldest ${plural(oldest, "day")}` : ""}.`,
    );
  }

  return {
    date: facts.date,
    headline: fallbackHeadline(totals, attention),
    focus: [],
    headlineBy: "template",
    totals,
    done,
    tomorrow,
    attention,
    reps,
    service: facts.service,
    accounts: facts.accounts,
  };
}

export function fallbackHeadline(t: DayReport["totals"], attention: AttentionItem[]): string {
  const attn = attention.length > 0 ? `${attention.length} ${attention.length === 1 ? "person needs" : "people need"} attention` : "no one needs special attention";
  return `${t.repsPresent}/${t.repsExpected} reps in, ${plural(t.newLeads, "new lead")}, ${t.wonCount} won${t.wonCount ? ` (${formatInr(t.wonValue)})`: ""}; ${attn}.`;
}

// ── the AI's small part ──────────────────────────────────────────────────────
export function headlinePrompt(report: DayReport): string {
  return (
    `You write the headline for a business owner's end-of-day summary of a furniture showroom's sales team, service desk and accounts.\n` +
    `Use ONLY the facts below. Never invent numbers or names. Plain, calm, specific; no hype, no emoji.\n\n` +
    `FACTS:\n${JSON.stringify({ headline: report.headline, done: report.done, tomorrow: report.tomorrow, attention: report.attention.map(a => ({ name: a.name, reasons: a.reasons })) })}\n\n` +
    `Reply with ONLY this JSON: {"headline":"<one sentence, max 30 words>","focus":["<up to 3 short lines for tomorrow, max 18 words each, each naming a person or a number from the facts>"]}`
  );
}

export function parseHeadlineJson(raw: string): { headline: string; focus: string[] } | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const o = JSON.parse(text.slice(start, end + 1));
    const headline = typeof o.headline === "string" ? o.headline.trim() : "";
    if (!headline || headline.length > 300) return null;
    const focus = Array.isArray(o.focus)
      ? o.focus.filter((x: unknown) => typeof x === "string" && x.trim()).map((x: string) => x.trim().slice(0, 160)).slice(0, 3)
      : [];
    return { headline, focus };
  } catch {
    return null;
  }
}
