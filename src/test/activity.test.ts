import { describe, expect, it } from "vitest";
import { autoFlipTimesByLead, isAutoStatusFlip, isAutoTouch } from "../../supabase/functions/_shared/activity";

describe("isAutoStatusFlip", () => {
  it("recognises the app's automatic overdue transitions only", () => {
    expect(isAutoStatusFlip("follow_up", "overdue")).toBe(true);
    expect(isAutoStatusFlip("contacted", "overdue")).toBe(true);
    expect(isAutoStatusFlip("overdue", "follow_up")).toBe(true);
    expect(isAutoStatusFlip("contacted", "negotiation")).toBe(false);
    expect(isAutoStatusFlip("overdue", "negotiation")).toBe(false); // a rep chose this
    expect(isAutoStatusFlip("overdue", "lost")).toBe(false);
    expect(isAutoStatusFlip(null, "new")).toBe(false);
  });
});

describe("isAutoTouch", () => {
  const t0 = Date.parse("2026-10-15T10:00:00Z");
  const rows = [
    { lead_id: "A", old_stage: "follow_up", new_stage: "overdue", changed_at: new Date(t0).toISOString() },
    { lead_id: "B", old_stage: "contacted", new_stage: "negotiation", changed_at: new Date(t0).toISOString() },
  ];
  const map = autoFlipTimesByLead(rows);

  it("only indexes automatic flips", () => {
    expect([...map.keys()]).toEqual(["A"]);
  });
  it("treats an update at the same moment as the flip as automatic", () => {
    expect(isAutoTouch("A", t0 + 800, map)).toBe(true);
    expect(isAutoTouch("A", t0 - 4000, map)).toBe(true);
  });
  it("does not discount a real edit made later, or a different lead", () => {
    expect(isAutoTouch("A", t0 + 60_000, map)).toBe(false);
    expect(isAutoTouch("B", t0, map)).toBe(false);
    expect(isAutoTouch("Z", t0, map)).toBe(false);
  });
});
