/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from "vitest";
import { applyActions } from "../../supabase/functions/_shared/agent-actions";

const ME = "rep-1";
const TODAY = "2026-10-13";

type Row = Record<string, unknown>;

// Minimal chainable stand-in for the supabase-js calls applyActions makes.
function fakeDb(rows: Row[], opts: { failUpdate?: boolean; ignoreDate?: boolean } = {}) {
  const updates: { id: unknown; patch: Row }[] = [];
  const from = () => {
    const f: { id?: unknown; patch?: Row } = {};
    const q: any = {
      select: () => q,
      is: () => q,
      eq: (_col: string, v: unknown) => {
        f.id = v;
        return q;
      },
      update: (patch: Row) => {
        f.patch = patch;
        return q;
      },
      maybeSingle: async () => {
        const row = rows.find((r) => r.id === f.id);
        return { data: row ? { ...row } : null, error: null }; // a copy, like the real client
      },
      single: async () => {
        const row = rows.find((r) => r.id === f.id);
        if (opts.failUpdate || !row) return { data: null, error: { message: "boom" } };
        updates.push({ id: f.id, patch: f.patch! });
        if (!opts.ignoreDate) Object.assign(row, f.patch);
        return { data: row, error: null };
      },
      then: (res: (v: unknown) => void) => {
        const row = rows.find((r) => r.id === f.id);
        if (opts.failUpdate || !row) return res({ error: { message: "boom" } });
        updates.push({ id: f.id, patch: f.patch! });
        Object.assign(row, f.patch);
        res({ error: null });
      },
    };
    return q;
  };
  return { db: { from }, updates };
}

let rows: Row[];
beforeEach(() => {
  rows = [
    { id: "L1", customer_name: "Jitender Kumar", status: "contacted", notes: "old", assigned_to: ME, created_by: ME, next_follow_up_date: "2026-10-17", next_follow_up_time: "09:15:00" },
    { id: "L2", customer_name: "Other Rep Lead", status: "contacted", notes: "", assigned_to: "someone-else", created_by: "someone-else", next_follow_up_date: null, next_follow_up_time: null },
    { id: "L3", customer_name: "Closed Deal", status: "won", notes: "", assigned_to: ME, created_by: ME, next_follow_up_date: null, next_follow_up_time: null },
    { id: "L4", customer_name: "Late Lead", status: "overdue", notes: "", assigned_to: ME, created_by: ME, next_follow_up_date: "2026-10-01", next_follow_up_time: null },
  ];
});

describe("applyActions — set_follow_up", () => {
  it("saves the date, verifies it, and records the previous date", async () => {
    const { db, updates } = fakeDb(rows);
    const r = await applyActions(db, ME, [{ type: "set_follow_up", lead_id: "L1", date: "2026-10-14" }], TODAY);
    expect(r.rejected).toEqual([]);
    expect(r.applied).toEqual([
      { type: "set_follow_up", ok: true, lead_id: "L1", customer: "Jitender Kumar", date: "2026-10-14", time: "09:15", from: "2026-10-17" },
    ]);
    expect(rows[0].next_follow_up_date).toBe("2026-10-14");
    expect(updates[0].patch).toMatchObject({ next_follow_up_date: "2026-10-14", updated_by: ME });
    expect(updates[0].patch).not.toHaveProperty("next_follow_up_time"); // existing time kept
  });

  it("sets a time when one is given", async () => {
    const { db } = fakeDb(rows);
    const r = await applyActions(db, ME, [{ type: "set_follow_up", lead_id: "L1", date: "2026-10-14", time: "16:30" }], TODAY);
    expect(r.applied[0]).toMatchObject({ date: "2026-10-14", time: "16:30" });
  });

  it("moves an overdue lead back to follow_up, as the app does", async () => {
    const { db, updates } = fakeDb(rows);
    await applyActions(db, ME, [{ type: "set_follow_up", lead_id: "L4", date: "2026-10-15" }], TODAY);
    expect(updates[0].patch).toMatchObject({ status: "follow_up" });
  });

  it("does not touch status on a normal lead", async () => {
    const { db, updates } = fakeDb(rows);
    await applyActions(db, ME, [{ type: "set_follow_up", lead_id: "L1", date: "2026-10-14" }], TODAY);
    expect(updates[0].patch).not.toHaveProperty("status");
  });

  it("rejects another rep's lead without revealing anything about it", async () => {
    const { db, updates } = fakeDb(rows);
    const r = await applyActions(db, ME, [{ type: "set_follow_up", lead_id: "L2", date: "2026-10-14" }], TODAY);
    expect(r.applied).toEqual([]);
    expect(r.rejected[0]).toMatchObject({ ok: false, reason: "that lead isn't one of yours" });
    expect(r.rejected[0].customer).toBeUndefined();
    expect(updates).toEqual([]);
  });

  it("rejects a closed lead, a past date and an unknown lead", async () => {
    const { db, updates } = fakeDb(rows);
    const r = await applyActions(
      db,
      ME,
      [
        { type: "set_follow_up", lead_id: "L3", date: "2026-10-14" },
        { type: "set_follow_up", lead_id: "L1", date: "2026-10-12" },
        { type: "set_follow_up", lead_id: "nope", date: "2026-10-14" },
        { type: "set_follow_up", date: "2026-10-14" },
      ],
      TODAY,
    );
    expect(r.applied).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "that lead is already won",
      "that date has already passed",
      "that lead isn't one of yours",
      "I couldn't tell which lead you meant",
    ]);
    expect(updates).toEqual([]);
  });

  it("reports a failed save instead of claiming success", async () => {
    const { db } = fakeDb(rows, { failUpdate: true });
    const r = await applyActions(db, ME, [{ type: "set_follow_up", lead_id: "L1", date: "2026-10-14" }], TODAY);
    expect(r.applied).toEqual([]);
    expect(r.rejected[0]).toMatchObject({ reason: "saving failed", customer: "Jitender Kumar" });
  });

  it("does not trust an update that didn't actually change the date", async () => {
    const { db } = fakeDb(rows, { ignoreDate: true });
    const r = await applyActions(db, ME, [{ type: "set_follow_up", lead_id: "L1", date: "2026-10-14" }], TODAY);
    expect(r.applied).toEqual([]);
    expect(r.rejected[0].reason).toBe("saving failed");
  });
});

describe("applyActions — add_note and housekeeping", () => {
  it("appends a dated coach note", async () => {
    const { db } = fakeDb(rows);
    const r = await applyActions(db, ME, [{ type: "add_note", lead_id: "L1", text: "  Wants a callback  " }], TODAY);
    expect(r.applied[0]).toMatchObject({ type: "add_note", ok: true, text: "Wants a callback", customer: "Jitender Kumar" });
    expect(rows[0].notes).toBe("old\n[2026-10-13 coach] Wants a callback");
  });

  it("rejects an empty note", async () => {
    const { db } = fakeDb(rows);
    const r = await applyActions(db, ME, [{ type: "add_note", lead_id: "L1", text: "   " }], TODAY);
    expect(r.rejected[0].reason).toBe("the note was empty");
  });

  it("ignores unknown action types and caps the batch at 6", async () => {
    const { db, updates } = fakeDb(rows);
    const many = Array.from({ length: 10 }, () => ({ type: "add_note", lead_id: "L1", text: "x" }));
    const r = await applyActions(db, ME, [{ type: "change_stage", lead_id: "L1" }, ...many], TODAY);
    expect(r.applied.length + r.rejected.length).toBeLessThanOrEqual(6);
    expect(updates.every((u) => !("status" in u.patch))).toBe(true);
  });
});
