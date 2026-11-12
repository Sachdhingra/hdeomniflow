import { describe, expect, it } from "vitest";
import {
  IDLE_NUDGE_MINUTES,
  phoneDigits,
  pickAccountsItems,
  pickSalesItems,
  pickServiceItems,
  shouldNudge,
  slotFor,
  trimCheckin,
  type LeadLite,
} from "../../supabase/functions/_shared/checkin";

const TODAY = "2026-11-12";
const NOW = Date.parse("2026-11-12T10:00:00+05:30");
const lead = (over: Partial<LeadLite> = {}): LeadLite => ({
  id: "L1", customer_name: "Bipendra", customer_phone: "98765 43210", value_in_rupees: 400000,
  next_follow_up_date: TODAY, last_follow_up: null, ...over,
});

describe("phoneDigits", () => {
  it("normalises Indian mobiles for tel: and wa.me", () => {
    expect(phoneDigits("98765 43210")).toBe("919876543210");
    expect(phoneDigits("+91-98765-43210")).toBe("919876543210");
    expect(phoneDigits("09876543210")).toBe("919876543210");
  });
  it("returns null for anything else", () => {
    expect(phoneDigits("12345")).toBeNull();
    expect(phoneDigits(null)).toBeNull();
    expect(phoneDigits("")).toBeNull();
  });
});

describe("pickSalesItems", () => {
  it("puts the biggest due/overdue lead first and says why", () => {
    const items = pickSalesItems([
      lead({ id: "a", customer_name: "Small", value_in_rupees: 20000 }),
      lead({ id: "b", customer_name: "Big overdue", value_in_rupees: 900000, next_follow_up_date: "2026-11-09" }),
      lead({ id: "c", customer_name: "Future", next_follow_up_date: "2026-11-20" }),
    ], TODAY, NOW);
    expect(items.map(i => i.title)).toEqual(["Big overdue", "Small"]);
    expect(items[0].reason).toBe("overdue 3 days · ₹9.0 L");
    expect(items[1].reason).toBe("follow-up due today · ₹20,000");
    expect(items[0]).toMatchObject({ kind: "lead", lead_id: "b", state: "pending", phone: "919876543210" });
  });

  it("caps at three and falls back to stale leads with no follow-up", () => {
    const many = Array.from({ length: 5 }, (_, i) => lead({ id: `d${i}`, customer_name: `D${i}`, value_in_rupees: 1000 * (i + 1) }));
    expect(pickSalesItems(many, TODAY, NOW)).toHaveLength(3);
    const stale = lead({ id: "s", customer_name: "Quiet", next_follow_up_date: null, last_follow_up: "2026-11-01T10:00:00+05:30" });
    const items = pickSalesItems([stale], TODAY, NOW);
    expect(items[0].reason).toBe("no follow-up set · ₹4.0 L");
  });

  it("returns nothing when there's nothing to chase", () => {
    expect(pickSalesItems([lead({ next_follow_up_date: "2026-12-01" })], TODAY, NOW)).toEqual([]);
  });
});

describe("pickServiceItems", () => {
  const job = (id: string, date: string | null, agent: string | null) => ({ id, customer_name: id, date_to_attend: date, assigned_agent: agent });
  it("orders: no agent now, no agent tomorrow, then the most overdue", () => {
    const items = pickServiceItems([
      job("late", "2026-11-05", "A"),
      job("tmrw", "2026-11-13", null),
      job("now", TODAY, null),
      job("later", "2026-11-14", null),
    ], TODAY, "2026-11-13");
    expect(items.map(i => i.title)).toEqual(["now", "tmrw", "late"]);
    expect(items.map(i => i.reason)).toEqual(["no agent · due today", "no agent · due tomorrow", "7 days overdue"]);
    expect(items[0].route).toBe("/service-jobs");
  });
});

describe("pickAccountsItems", () => {
  it("takes the oldest service approval, the oldest card bill and the biggest approval", () => {
    const items = pickAccountsItems(
      [
        { id: "j1", customer_name: "Old job", value: 5000, completed_at: "2026-10-01T10:00:00Z", updated_at: null },
        { id: "j2", customer_name: "Big job", value: 90000, completed_at: "2026-11-10T10:00:00Z", updated_at: null },
      ],
      [{ id: "b1", bill_reference: "INV-7", net_bill_amount: 12000, created_at: "2026-09-01T10:00:00Z" }],
      NOW,
    );
    expect(items.map(i => i.title)).toEqual(["Old job", "Bill INV-7", "Big job"]);
    expect(items[1]).toMatchObject({ id: "bill:b1", route: "/card-bills", kind: "approval" });
    expect(items[0].reason).toMatch(/^service approval · waiting 41 days · ₹5,000$/);
  });
  it("doesn't repeat one job as both oldest and biggest", () => {
    const items = pickAccountsItems([{ id: "j", customer_name: "Only", value: 100000, completed_at: "2026-11-01T00:00:00Z", updated_at: null }], [], NOW);
    expect(items).toHaveLength(1);
  });
});

describe("slotFor / shouldNudge", () => {
  const base = { slot: "mid" as const, hasItems: true, minutesIdle: 30, priorityHit: false, recentChatMinutes: Infinity };
  it("maps the five cron hours onto first / mid / last", () => {
    expect([11, 13, 15, 17, 19].map(slotFor)).toEqual(["first", "mid", "mid", "mid", "last"]);
  });
  it("always sends the morning and evening check-ins", () => {
    expect(shouldNudge({ ...base, slot: "first", hasItems: false }).send).toBe(true);
    expect(shouldNudge({ ...base, slot: "last", minutesIdle: 0, recentChatMinutes: 1 }).send).toBe(true);
  });
  it("skips a mid-day check-in for someone who is busy", () => {
    expect(shouldNudge(base)).toEqual({ send: false, reason: "busy or nothing urgent" });
  });
  it("sends after enough quiet, or when something important is waiting", () => {
    expect(shouldNudge({ ...base, minutesIdle: IDLE_NUDGE_MINUTES }).send).toBe(true);
    expect(shouldNudge({ ...base, priorityHit: true }).send).toBe(true);
  });
  it("never sends mid-conversation or with nothing to point at", () => {
    expect(shouldNudge({ ...base, minutesIdle: 200, priorityHit: true, recentChatMinutes: 10 }).send).toBe(false);
    expect(shouldNudge({ ...base, minutesIdle: 200, hasItems: false }).send).toBe(false);
  });
  it("can't judge idleness when the role has no measurable activity", () => {
    expect(shouldNudge({ ...base, minutesIdle: null }).send).toBe(false);
    expect(shouldNudge({ ...base, minutesIdle: null, priorityHit: true }).send).toBe(true);
  });
});

describe("trimCheckin", () => {
  it("leaves a short message alone", () => {
    expect(trimCheckin("Pehle Bipendra ko call karo.", 50)).toBe("Pehle Bipendra ko call karo.");
  });
  it("cuts a long one at a sentence end", () => {
    const long = "Great work today! Call Bipendra first, he is due today. " + "Then think about the rest of the long list of customers again and again ".repeat(6);
    const out = trimCheckin(long, 20);
    expect(out).toBe("Great work today! Call Bipendra first, he is due today.");
  });
  it("cuts at the word limit when there's no sentence break", () => {
    const out = trimCheckin(Array.from({ length: 80 }, (_, i) => `w${i}`).join(" "), 10);
    expect(out.endsWith("…")).toBe(true);
    expect(out.split(" ")).toHaveLength(10);
  });
});
