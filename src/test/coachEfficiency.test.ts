import { describe, expect, it } from "vitest";
import {
  addDays,
  checkinStats,
  dailyResponse,
  formatDuration,
  istMidnightMs,
  longestQuietStretch,
  median,
  rangeFor,
  signalsFor,
  type CoachMsgRow,
} from "@/lib/coachEfficiency";

const at = (iso: string) => `2026-10-12T${iso}+05:30`;
const msg = (
  sender: "agent" | "staff",
  kind: CoachMsgRow["kind"],
  time: string,
  actions: unknown[] | null = null,
  user = "u1",
): CoachMsgRow => ({ user_id: user, sender, kind, created_at: at(time), actions });

const DAY_START = istMidnightMs("2026-10-12");
const DAY_END = istMidnightMs("2026-10-13");

describe("median", () => {
  it("handles empty, odd and even lists", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe("checkinStats", () => {
  it("counts a reply before the next check-in and measures reply time", () => {
    const rows = [
      msg("agent", "checkin", "11:30:00"),
      msg("staff", "reply", "11:42:00"),
      msg("agent", "checkin", "13:30:00"),
    ];
    const s = checkinStats(rows, DAY_START, DAY_END);
    expect(s.sent).toBe(2);
    expect(s.replied).toBe(1);
    expect(s.responseRate).toBe(50);
    expect(s.medianReplyMinutes).toBe(12);
  });

  it("does not count a reply that lands after the next check-in", () => {
    const rows = [
      msg("agent", "checkin", "11:30:00"),
      msg("agent", "checkin", "13:30:00"),
      msg("staff", "reply", "13:40:00"), // answers the 13:30 one, not 11:30
    ];
    const s = checkinStats(rows, DAY_START, DAY_END);
    expect(s.sent).toBe(2);
    expect(s.replied).toBe(1);
  });

  it("stops looking for a reply after 3 hours", () => {
    const rows = [msg("agent", "checkin", "11:30:00"), msg("staff", "reply", "15:00:00")];
    expect(checkinStats(rows, DAY_START, DAY_END).replied).toBe(0);
  });

  it("counts a late-evening reply that arrives after the range ends", () => {
    const rows = [
      msg("agent", "checkin", "19:30:00"),
      { ...msg("staff", "reply", "20:05:00"), created_at: "2026-10-12T20:05:00+05:30" },
    ];
    expect(checkinStats(rows, DAY_START, DAY_END).replied).toBe(1);
  });

  it("ignores check-ins outside the range and returns null rate when none sent", () => {
    const rows = [msg("agent", "checkin", "11:30:00")];
    const s = checkinStats(rows, istMidnightMs("2026-10-13"), istMidnightMs("2026-10-14"));
    expect(s.sent).toBe(0);
    expect(s.responseRate).toBeNull();
    expect(s.medianReplyMinutes).toBeNull();
  });

  it("sums actions the coach applied and counts staff messages in range", () => {
    const rows = [
      msg("agent", "checkin", "11:30:00"),
      msg("staff", "reply", "11:40:00"),
      msg("agent", "reply", "11:40:30", [{ type: "add_note" }, { type: "set_follow_up" }]),
      msg("staff", "reply", "11:50:00"),
      msg("agent", "reply", "11:50:30", []),
    ];
    const s = checkinStats(rows, DAY_START, DAY_END);
    expect(s.actionsApplied).toBe(2);
    expect(s.staffMessages).toBe(2);
  });
});

describe("longestQuietStretch", () => {
  const start = istMidnightMs("2026-10-12") + 11 * 3_600_000; // 11:00 IST
  const min = (n: number) => start + n * 60_000;

  it("finds the largest gap between events, including the window edges", () => {
    const q = longestQuietStretch([min(30), min(45), min(200)], start, min(300))!;
    expect(q.minutes).toBe(155); // 45 -> 200
    expect(q.fromMs).toBe(min(45));
    expect(q.toMs).toBe(min(200));
  });

  it("treats no events as one quiet window", () => {
    expect(longestQuietStretch([], start, min(180))!.minutes).toBe(180);
  });

  it("counts the stretch from the last event to the end of the window", () => {
    expect(longestQuietStretch([min(10)], start, min(190))!.minutes).toBe(180);
  });

  it("returns null when the window is too short to judge", () => {
    expect(longestQuietStretch([], start, min(30))).toBeNull();
  });

  it("ignores events outside the window", () => {
    expect(longestQuietStretch([min(-50), min(400)], start, min(120))!.minutes).toBe(120);
  });
});

describe("signalsFor", () => {
  const base = {
    coachOn: true,
    checkinsSent: 4,
    responseRate: 50,
    recentCheckinsSent: 2,
    recentCheckinsReplied: 1,
    overdueFollowUps: 0,
    quietMinutesToday: 30,
    presentToday: true,
  };
  it("is quiet for a normal day", () => {
    expect(signalsFor(base)).toEqual([]);
  });
  it("flags two unanswered check-ins in a row", () => {
    expect(signalsFor({ ...base, recentCheckinsReplied: 0 }).map(s => s.key)).toContain("silent");
  });
  it("never flags a rep the coach is not on for", () => {
    expect(signalsFor({ ...base, coachOn: false, recentCheckinsReplied: 0, responseRate: null }).map(s => s.key)).not.toContain("silent");
  });
  it("flags long quiet stretches only for people who are present", () => {
    expect(signalsFor({ ...base, quietMinutesToday: 130 }).map(s => s.key)).toContain("quiet");
    expect(signalsFor({ ...base, quietMinutesToday: 130, presentToday: false }).map(s => s.key)).not.toContain("quiet");
  });
  it("flags many overdue follow-ups and praises high engagement", () => {
    const keys = signalsFor({ ...base, overdueFollowUps: 12, responseRate: 90 }).map(s => s.key);
    expect(keys).toEqual(expect.arrayContaining(["overdue", "engaged"]));
  });
});

describe("dates and ranges", () => {
  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(135)).toBe("2 h 15 min");
  });
  it("adds days across month ends in IST", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });
  it("builds 1, 7 and 30 day ranges ending today (IST)", () => {
    const now = new Date("2026-10-12T20:00:00Z"); // 01:30 IST on the 13th
    expect(rangeFor("today", now).fromDate).toBe("2026-10-13");
    expect(rangeFor("7d", now).fromDate).toBe("2026-10-07");
    expect(rangeFor("30d", now).fromDate).toBe("2026-09-14");
    expect(rangeFor("7d", now).toMs - rangeFor("7d", now).fromMs).toBe(7 * 86_400_000);
  });
});

describe("dailyResponse", () => {
  it("builds one point per day with a null rate on empty days", () => {
    const rows = new Map<string, CoachMsgRow[]>([
      ["u1", [msg("agent", "checkin", "11:30:00"), msg("staff", "reply", "11:35:00")]],
      ["u2", [msg("agent", "checkin", "11:30:00", null, "u2")]],
    ]);
    const d = dailyResponse(rows, "2026-10-11", 3);
    expect(d.map(x => x.date)).toEqual(["2026-10-11", "2026-10-12", "2026-10-13"]);
    expect(d[0]).toMatchObject({ sent: 0, replied: 0, rate: null });
    expect(d[1]).toMatchObject({ sent: 2, replied: 1, rate: 50 });
    expect(d[2].rate).toBeNull();
  });
});
