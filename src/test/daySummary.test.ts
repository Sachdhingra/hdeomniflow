import { describe, expect, it } from "vitest";
import {
  attentionFor,
  buildReport,
  fallbackHeadline,
  formatInr,
  headlinePrompt,
  parseHeadlineJson,
  type DayFacts,
  type RepDay,
} from "../../supabase/functions/_shared/day-summary";

const rep = (over: Partial<RepDay> = {}): RepDay => ({
  id: "r1",
  name: "saurabh",
  present: true,
  late: false,
  presentLast7: 6,
  newLeads: 1,
  stageMoves: 4,
  leadsTouched: 8,
  wonCount: 0,
  wonValue: 0,
  lostCount: 0,
  coachOn: true,
  coachSent: 5,
  coachReplied: 3,
  followUpsSetByCoach: 2,
  dueTodayOpen: 1,
  dueTomorrow: 3,
  topDueTomorrow: [{ customer: "Bipendra", value: 400000 }],
  overdue: 4,
  monthWon: 500000,
  monthTarget: 2000000,
  pushRegistered: true,
  ...over,
});

const facts = (reps: RepDay[], over: Partial<DayFacts> = {}): DayFacts => ({
  date: "2026-10-24",
  dayOfMonth: 24,
  daysInMonth: 31,
  reps,
  service: { completedToday: 2, scheduledTomorrow: 6, unassignedTomorrow: 2 },
  accounts: { servicePending: 3, billsPending: 4 },
  ...over,
});

const month = { dayOfMonth: 24, daysInMonth: 31 };

describe("formatInr", () => {
  it("uses lakh and crore", () => {
    expect(formatInr(950)).toBe("₹950");
    expect(formatInr(1_250_000)).toBe("₹12.5 L");
    expect(formatInr(25_000_000)).toBe("₹2.5 Cr");
  });
});

describe("attentionFor", () => {
  it("is null for a normal working day", () => {
    expect(attentionFor(rep({ monthWon: 1_500_000 }), month)).toBeNull();
  });

  it("flags a rep who ignored the coach all day", () => {
    const a = attentionFor(rep({ coachSent: 5, coachReplied: 0, monthWon: 1_500_000 }), month)!;
    expect(a.reasons).toEqual(["Didn't reply to any of 5 coach check-ins"]);
    expect(a.score).toBe(3);
  });

  it("flags a present rep with almost no activity", () => {
    const a = attentionFor(rep({ newLeads: 0, stageMoves: 0, leadsTouched: 1, monthWon: 1_500_000 }), month)!;
    expect(a.reasons[0]).toMatch(/Very little CRM activity/);
  });

  it("flags absence only for someone who normally works, not long leave", () => {
    expect(attentionFor(rep({ present: false, presentLast7: 5, monthWon: 1_500_000 }), month)?.reasons[0]).toMatch(/Not in today/);
    expect(attentionFor(rep({ present: false, presentLast7: 0, monthWon: 1_500_000 }), month)).toBeNull();
  });

  it("flags missed follow-ups, scaled by how many", () => {
    expect(attentionFor(rep({ dueTodayOpen: 5, monthWon: 1_500_000 }), month)!.score).toBe(2);
    expect(attentionFor(rep({ dueTodayOpen: 12, monthWon: 1_500_000 }), month)!.score).toBe(3);
    expect(attentionFor(rep({ dueTodayOpen: 4, monthWon: 1_500_000 }), month)).toBeNull();
  });

  it("treats a standing overdue backlog as context, not news — unless it is huge", () => {
    expect(attentionFor(rep({ overdue: 38, monthWon: 1_500_000 }), month)).toBeNull();
    expect(attentionFor(rep({ overdue: 44, monthWon: 1_500_000 }), month)!.reasons).toEqual(["44 overdue follow-ups piling up"]);
    const withOther = attentionFor(rep({ overdue: 38, dueTodayOpen: 6, monthWon: 1_500_000 }), month)!;
    expect(withOther.reasons).toEqual(["6 follow-ups due today weren't actioned", "38 overdue follow-ups piling up"]);
  });

  it("flags a target well behind pace", () => {
    const behind = attentionFor(rep({ monthWon: 200_000 }), month)!; // 10% vs ~77% pace
    expect(behind.reasons[0]).toMatch(/Month target at 10% \(on-pace is 77%\)/);
  });

  it("does not judge targets early in the month or when no target is set", () => {
    expect(attentionFor(rep({ monthWon: 0 }), { dayOfMonth: 5, daysInMonth: 31 })).toBeNull();
    expect(attentionFor(rep({ monthWon: 0, monthTarget: null }), month)).toBeNull();
  });

  it("does not raise attention for the notifications note alone, but adds it to a real concern", () => {
    expect(attentionFor(rep({ pushRegistered: false, monthWon: 1_500_000 }), month)).toBeNull();
    const a = attentionFor(rep({ pushRegistered: false, coachReplied: 0, monthWon: 1_500_000 }), month)!;
    expect(a.reasons).toHaveLength(2);
    expect(a.reasons[1]).toMatch(/Notifications not set up/);
  });

  it("sorts the most serious reasons first", () => {
    const a = attentionFor(rep({ overdue: 20, coachReplied: 0, monthWon: 1_500_000 }), month)!;
    expect(a.reasons[0]).toMatch(/Didn't reply/);
    expect(a.reasons[1]).toMatch(/overdue/);
    expect(a.score).toBe(4);
  });
});

describe("buildReport", () => {
  const busy = rep({ id: "a", name: "reena", stageMoves: 10, newLeads: 3, wonCount: 1, wonValue: 640000, leadsTouched: 15, dueTomorrow: 9, topDueTomorrow: [{ customer: "Jitender", value: 150000 }], monthWon: 1_700_000 });
  const quiet = rep({ id: "b", name: "shivam", stageMoves: 0, newLeads: 0, leadsTouched: 0, coachReplied: 0, dueTomorrow: 2, topDueTomorrow: [{ customer: "Gagan", value: 90000 }], monthWon: 1_700_000 });
  const away = rep({ id: "c", name: "sachin", present: false, presentLast7: 0, newLeads: 0, stageMoves: 0, leadsTouched: 0, coachOn: false, coachSent: 0, coachReplied: 0, dueTomorrow: 0, topDueTomorrow: [], monthTarget: null });
  const report = buildReport(facts([busy, quiet, away]));

  it("totals the day and ignores the rep on long leave when counting who was expected", () => {
    expect(report.totals.repsExpected).toBe(2);
    expect(report.totals.repsPresent).toBe(2);
    expect(report.totals).toMatchObject({ newLeads: 3, wonCount: 1, wonValue: 640000, stageMoves: 10, dueTomorrow: 11 });
  });

  it("writes plain, number-backed 'done' lines", () => {
    expect(report.done[0]).toBe("3 new leads, 1 deal won (₹6.4 L), 0 lost.");
    expect(report.done.join(" ")).toMatch(/Most active: reena \(10 moves, 3 new leads, 1 won\)/);
    expect(report.done.join(" ")).toMatch(/Coach check-ins: 3 of 10 answered/);
    expect(report.done.at(-1)).toBe("Service: 2 jobs completed today.");
  });

  it("builds tomorrow's plan from follow-ups, service and accounts", () => {
    expect(report.tomorrow[0]).toBe("11 follow-ups due tomorrow (reena 9, shivam 2).");
    expect(report.tomorrow[1]).toBe("Biggest follow-ups: Jitender ₹1.5 L (reena), Gagan ₹90,000 (shivam).");
    expect(report.tomorrow.join(" ")).toMatch(/Service: 6 jobs scheduled tomorrow, 2 not yet assigned/);
    expect(report.tomorrow.join(" ")).toMatch(/Accounts: 7 approvals waiting \(3 service\/delivery, 4 card bills\)/);
  });

  it("names who needs attention and why, and only them", () => {
    expect(report.attention.map(a => a.name)).toEqual(["shivam"]);
    expect(report.attention[0].reasons.join(" ")).toMatch(/Very little CRM activity/);
  });

  it("has a template headline that mentions attention", () => {
    expect(report.headline).toBe("2/2 reps in, 3 new leads, 1 won (₹6.4 L); 1 person needs attention.");
    expect(report.headlineBy).toBe("template");
  });

  it("handles a day with nothing on and nothing planned without awkward text", () => {
    const empty = buildReport(
      facts([rep({ newLeads: 0, stageMoves: 1, leadsTouched: 3, coachSent: 0, coachReplied: 0, dueTomorrow: 0, topDueTomorrow: [], dueTodayOpen: 0, overdue: 0, monthWon: 1_500_000 })], {
        service: { completedToday: 0, scheduledTomorrow: 0, unassignedTomorrow: 0 },
        accounts: { servicePending: 0, billsPending: 0 },
      }),
    );
    expect(empty.tomorrow).toEqual(["No follow-ups are scheduled for tomorrow yet."]);
    expect(empty.done.join(" ")).not.toMatch(/Coach check-ins/);
    expect(empty.headline).toMatch(/no one needs special attention/);
  });

  it("uses singular wording for one", () => {
    const one = buildReport(facts([rep({ newLeads: 1, wonCount: 1, wonValue: 50000, dueTodayOpen: 1, dueTomorrow: 1, overdue: 1, monthWon: 1_500_000 })]));
    expect(one.done[0]).toBe("1 new lead, 1 deal won (₹50,000), 0 lost.");
    expect(one.tomorrow.join(" ")).toMatch(/1 follow-up due tomorrow/);
    expect(one.tomorrow.join(" ")).toMatch(/1 follow-up due today wasn't actioned/);
  });

  it("caps attention at five people, most serious first", () => {
    const many = Array.from({ length: 8 }, (_, i) => rep({ id: `r${i}`, name: `rep${i}`, coachReplied: 0, overdue: i * 8, monthWon: 1_500_000 }));
    const r = buildReport(facts(many));
    expect(r.attention).toHaveLength(5);
    expect(r.attention[0].score).toBeGreaterThanOrEqual(r.attention[4].score);
  });
});

describe("the AI headline", () => {
  const report = buildReport(facts([rep({ monthWon: 1_500_000 })]));

  it("gives the model only facts and asks for strict JSON", () => {
    const p = headlinePrompt(report);
    expect(p).toMatch(/Use ONLY the facts below/);
    expect(p).toMatch(/Reply with ONLY this JSON/);
    expect(p).toContain(report.headline);
  });

  it("parses a good reply, with or without a code fence", () => {
    const good = '{"headline":"A steady day.","focus":["Call Bipendra first.","Clear shivam\'s backlog."]}';
    expect(parseHeadlineJson(good)).toEqual({ headline: "A steady day.", focus: ["Call Bipendra first.", "Clear shivam's backlog."] });
    expect(parseHeadlineJson("```json\n" + good + "\n```")?.headline).toBe("A steady day.");
  });

  it("limits focus to three lines and rejects unusable replies", () => {
    const four = JSON.stringify({ headline: "H", focus: ["1", "2", "3", "4"] });
    expect(parseHeadlineJson(four)?.focus).toHaveLength(3);
    expect(parseHeadlineJson("not json")).toBeNull();
    expect(parseHeadlineJson('{"headline":""}')).toBeNull();
    expect(parseHeadlineJson(JSON.stringify({ headline: "x".repeat(400) }))).toBeNull();
    expect(parseHeadlineJson('{"headline":"ok"}')).toEqual({ headline: "ok", focus: [] });
  });

  it("exposes the template headline for fallback use", () => {
    expect(fallbackHeadline(report.totals, [])).toMatch(/no one needs special attention/);
  });
});
