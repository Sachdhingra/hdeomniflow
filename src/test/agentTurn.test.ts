import { describe, expect, it, vi } from "vitest";
import { runTurn } from "../../supabase/functions/_shared/agent-turn";
import type { AppliedAction } from "../../supabase/functions/_shared/agent-actions";

const ACTION = { type: "set_follow_up", lead_id: "L1", date: "2026-10-14" };
const ok = (a: Record<string, unknown>): AppliedAction => ({ type: String(a.type), ok: true, lead_id: String(a.lead_id), date: String(a.date ?? "") });
const env = (reply: string, actions: unknown[] = []) => JSON.stringify({ actions, reply, quick_replies: [] });

// apply: saves whatever actions it is given
const applyAll = async (actions: Record<string, unknown>[]) => ({ applied: actions.map(ok), rejected: [] as AppliedAction[] });
const MSGS = [{ role: "system", content: "s" }, { role: "user", content: "ok" }];

describe("runTurn", () => {
  it("makes one model call when the reply does not claim a save", async () => {
    const llm = vi.fn().mockResolvedValue(env("Pehle Bipendra ko call karo.", []));
    const r = await runTurn({ llm, apply: applyAll }, MSGS);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(r.retried).toBe(false);
    expect(r.parsed.reply).toBe("Pehle Bipendra ko call karo.");
    expect(r.applied).toEqual([]);
  });

  it("makes one model call when the claim is backed by an action", async () => {
    const llm = vi.fn().mockResolvedValue(env("Follow-up kal ke liye set kar diya hai.", [ACTION]));
    const r = await runTurn({ llm, apply: applyAll }, MSGS);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(r.applied).toHaveLength(1);
  });

  it("retries once when the reply claims a save with no action, and uses the corrected answer", async () => {
    const llm = vi
      .fn()
      .mockResolvedValueOnce(env("Follow-up kal ke liye set kar diya hai.", []))
      .mockResolvedValueOnce(env("Follow-up kal ke liye set kar diya hai.", [ACTION]));
    const r = await runTurn({ llm, apply: applyAll }, MSGS);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(r.retried).toBe(true);
    expect(r.applied).toHaveLength(1);
    // the retry sees the model's own bad answer and a correction
    const retryMessages = llm.mock.calls[1][0];
    expect(retryMessages.at(-2)).toMatchObject({ role: "assistant" });
    expect(retryMessages.at(-1).content).toMatch(/NOTHING was saved/);
    expect(retryMessages.at(-1).content).toMatch(/a follow-up date/);
  });

  it("accepts a retry that simply stops claiming", async () => {
    const llm = vi
      .fn()
      .mockResolvedValueOnce(env("Maine note add kar diya hai.", []))
      .mockResolvedValueOnce(env("Chalo, aage badhte hain — Gagan ko call karo.", []));
    const r = await runTurn({ llm, apply: applyAll }, MSGS);
    expect(r.parsed.reply).toBe("Chalo, aage badhte hain — Gagan ko call karo.");
    expect(r.applied).toEqual([]);
  });

  it("keeps the first answer when the retry fails or still claims without acting", async () => {
    const claim = env("Maine note add kar diya hai.", []);
    const failing = vi.fn().mockResolvedValueOnce(claim).mockRejectedValueOnce(new Error("boom"));
    expect((await runTurn({ llm: failing, apply: applyAll }, MSGS)).parsed.reply).toBe("Maine note add kar diya hai.");

    const stubborn = vi.fn().mockResolvedValue(claim);
    const r = await runTurn({ llm: stubborn, apply: applyAll }, MSGS);
    expect(stubborn).toHaveBeenCalledTimes(2);
    expect(r.parsed.reply).toBe("Maine note add kar diya hai.");
    expect(r.applied).toEqual([]); // the caller then shows the "not saved" warning
  });

  it("does not retry when an action was refused — the rep is told why instead", async () => {
    const llm = vi.fn().mockResolvedValue(env("Follow-up kal ke liye set kar diya hai.", [ACTION]));
    const refuse = async () => ({ applied: [] as AppliedAction[], rejected: [{ type: "set_follow_up", ok: false, reason: "that date has already passed" }] });
    const r = await runTurn({ llm, apply: refuse }, MSGS);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(r.rejected).toHaveLength(1);
  });

  it("propagates a failure of the first model call", async () => {
    const llm = vi.fn().mockRejectedValue(new Error("rate_limited"));
    await expect(runTurn({ llm, apply: applyAll }, MSGS)).rejects.toThrow("rate_limited");
  });

  it("recovers actions from a double-wrapped first answer without retrying", async () => {
    const inner = env("Follow-up set kar diya hai.", [ACTION]);
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ reply: inner, actions: [] }));
    const r = await runTurn({ llm, apply: applyAll }, MSGS);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(r.applied).toHaveLength(1);
    expect(r.parsed.reply).toBe("Follow-up set kar diya hai.");
  });
});
