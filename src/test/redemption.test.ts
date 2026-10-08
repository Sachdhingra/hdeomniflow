/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed mocks */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const select = vi.fn();
const invoke = vi.fn();
const chain: any = {};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: any[]) => rpc(...a),
    from: (...a: any[]) => { chain.table = a[0]; return chain; },
    functions: { invoke: (...a: any[]) => invoke(...a) },
  },
}));

import {
  awardReferralBonus, canRedeemOn, cancelRedemption, describeClosed, describeReferralFailure, describeStartError,
  errorCode, errorDetail, fetchSession, inr, notifyCustomer, startRedemption, verifyRedemption,
} from "@/lib/redemption";

beforeEach(() => {
  rpc.mockReset(); select.mockReset(); invoke.mockReset();
  chain.select = (cols: string) => { select(cols); return chain; };
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: { status: "awaiting_choice" }, error: null });
});

describe("error codes", () => {
  it("reads the stable code before the colon", () => {
    expect(errorCode("BILL_BELOW_MINIMUM: redemption needs a bill of at least Rs 30000")).toBe("BILL_BELOW_MINIMUM");
    expect(errorCode("CAP_REACHED: this bill allows Rs 1500")).toBe("CAP_REACHED");
  });
  it("treats anything else as UNKNOWN", () => {
    expect(errorCode("permission denied for table x")).toBe("UNKNOWN");
    expect(errorCode(undefined)).toBe("UNKNOWN");
    expect(errorCode("")).toBe("UNKNOWN");
    expect(errorCode("lowercase: nope")).toBe("UNKNOWN");
  });
  it("keeps the server's own sentence, which carries the real numbers", () => {
    const d = describeStartError("BILL_BELOW_MINIMUM: redemption needs a bill of at least Rs 30000, this bill is Rs 29999");
    expect(d.title).toBe("This bill is too small to redeem on");
    expect(d.detail).toContain("Rs 30000");
    expect(d.detail).toContain("Rs 29999");
  });
  it("has a plain title for every refusal the server can raise", () => {
    for (const c of [
      "BILL_BELOW_MINIMUM", "WAITING_PERIOD", "CAP_REACHED", "INSUFFICIENT_POINTS", "CUSTOMER_APP_NOT_ACTIVATED",
      "CUSTOMER_INACTIVE", "TIER_NOT_ELIGIBLE", "BILL_NOT_YOURS", "BILL_ALREADY_DECIDED", "BILL_IS_RETURN",
      "BILL_NOT_FOUND", "SESSION_IN_PROGRESS", "RATE_LIMITED", "FORBIDDEN", "NOT_AUTHENTICATED",
    ]) {
      expect(describeStartError(`${c}: x`).title, c).not.toBe("Could not start the redemption");
    }
  });
  it("shows an unrecognised database error rather than hiding it", () => {
    const d = describeStartError("Could not find the function public.redemption_start");
    expect(d.title).toBe("Could not start the redemption");
    expect(d.detail).toContain("redemption_start");
  });
  it("detail is empty when the server sent only a code", () => {
    expect(errorDetail("CAP_REACHED")).toBe("");
  });
  it("explains every way a session can close", () => {
    for (const r of ["SESSION_EXPIRED", "TOO_MANY_ATTEMPTS", "BILL_CHANGED", "EXCEEDS_CAP", "cancelled", "expired", "failed", "NOT_AWAITING_CODE"]) {
      expect(describeClosed(r).length, r).toBeGreaterThan(20);
    }
    expect(describeClosed("something new")).toContain("closed");
  });
});

describe("formatting", () => {
  it("shows rupees in the Indian grouping, never a percentage", () => {
    expect(inr(3346.6)).toBe("₹3,346.60");
    expect(inr(0.5)).toBe("₹0.50");
    expect(inr(125000)).toBe("₹1,25,000");
    expect(inr("750.00")).toBe("₹750");
  });
});

describe("database calls", () => {
  it("startRedemption passes the bill id and returns the session", async () => {
    rpc.mockResolvedValue({ data: { session_id: "s1", cap: 1500 }, error: null });
    expect(await startRedemption("b1")).toMatchObject({ session_id: "s1" });
    expect(rpc).toHaveBeenCalledWith("redemption_start", { p_bill_entry_id: "b1" });
  });
  it("throws the database error so the dialog can show it", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "WAITING_PERIOD: wait" } });
    await expect(startRedemption("b1")).rejects.toMatchObject({ message: "WAITING_PERIOD: wait" });
  });
  it("verifyRedemption sends exactly the session and the typed code", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "WRONG_CODE", attempts_left: 2 }, error: null });
    expect(await verifyRedemption("s1", "4821")).toMatchObject({ reason: "WRONG_CODE" });
    expect(rpc).toHaveBeenCalledWith("redemption_verify", { p_session_id: "s1", p_code: "4821" });
  });
  it("cancelRedemption calls the cancel function", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await cancelRedemption("s1");
    expect(rpc).toHaveBeenCalledWith("redemption_cancel", { p_session_id: "s1" });
  });
  it("fetchSession reads status and amounts only. The code can never be in this row.", async () => {
    await fetchSession("s1");
    expect(chain.table).toBe("redemption_sessions");
    expect(select).toHaveBeenCalledWith("status, chosen_points, chosen_rupees, expires_at, failed_attempts");
    expect(select.mock.calls[0][0]).not.toMatch(/code|otp|hash/i);
  });
});

describe("customer notifications", () => {
  it("never throws when the push fails, so the counter is never blocked", async () => {
    invoke.mockRejectedValue(new Error("network down"));
    expect(() => notifyCustomer("c1", "redemption_started")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
  it("the started message does not contain the code or any amount", () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    notifyCustomer("c1", "redemption_started");
    const body = invoke.mock.calls[0][1].body;
    expect(invoke.mock.calls[0][0]).toBe("send-push");
    expect(body).toMatchObject({ customer_id: "c1", type: "redemption_started" });
    expect(`${body.title} ${body.message}`).not.toMatch(/\d{4}|₹/);
  });
  it("the used message states the amount", () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    notifyCustomer("c1", "redemption_used", { rupees: 750, points: 100 });
    expect(invoke.mock.calls[0][1].body.message).toBe("100 points redeemed for ₹750 off your bill.");
  });
});

describe("referral bonus", () => {
  it("calls the server function with the new member and the typed code", async () => {
    rpc.mockResolvedValue({ data: { ok: true, points: 20, referrer_name: "Rita" }, error: null });
    expect(await awardReferralBonus("m1", "EC1234ABCD")).toMatchObject({ ok: true, referrer_name: "Rita" });
    expect(rpc).toHaveBeenCalledWith("award_referral_bonus", { p_referred_customer: "m1", p_code: "EC1234ABCD" });
  });
  it("surfaces a database error instead of pretending it worked", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Could not find the function" } });
    await expect(awardReferralBonus("m1", "EC1234ABCD")).rejects.toMatchObject({ message: "Could not find the function" });
  });
  it("says why a bonus was not credited", () => {
    expect(describeReferralFailure("CODE_NOT_FOUND", "EC9")).toContain('"EC9" not found');
    expect(describeReferralFailure("ALREADY_AWARDED", "x")).toContain("already");
    expect(describeReferralFailure("SELF_REFERRAL", "x")).toContain("themselves");
    expect(describeReferralFailure("TOO_LATE", "x")).toContain("24-hour");
    expect(describeReferralFailure("???", "x")).toContain("could not be credited");
    expect(describeReferralFailure(undefined, "x")).toContain("could not be credited");
  });
});

describe("who is offered the Redeem button", () => {
  const entry = { approval_status: "pending", is_return: false, card_tier: "super_elite", entered_by: "u1" };
  const sales = { id: "u1", role: "sales" };
  it("sales on their own pending entry", () => expect(canRedeemOn(entry, sales)).toBe(true));
  it("both points-earning tiers", () => {
    expect(canRedeemOn({ ...entry, card_tier: "prestige_elite" }, sales)).toBe(true);
  });
  it("not another salesperson's entry", () => expect(canRedeemOn(entry, { id: "u2", role: "sales" })).toBe(false));
  it("admin on anyone's entry", () => expect(canRedeemOn(entry, { id: "boss", role: "admin" })).toBe(true));
  it("not accounts, who approve rather than redeem", () => expect(canRedeemOn(entry, { id: "u1", role: "accounts" })).toBe(false));
  it("not a roleless or signed-out user", () => {
    expect(canRedeemOn(entry, null)).toBe(false);
    expect(canRedeemOn(entry, undefined)).toBe(false);
    expect(canRedeemOn(entry, { id: "u1", role: "service_head" })).toBe(false);
  });
  it("not once the bill is decided", () => {
    expect(canRedeemOn({ ...entry, approval_status: "approved" }, sales)).toBe(false);
    expect(canRedeemOn({ ...entry, approval_status: "rejected" }, sales)).toBe(false);
  });
  it("not on a return", () => expect(canRedeemOn({ ...entry, is_return: true }, sales)).toBe(false));
  it("not on a card that cannot redeem", () => {
    expect(canRedeemOn({ ...entry, card_tier: "elite" }, sales)).toBe(false);
    expect(canRedeemOn({ ...entry, card_tier: null }, sales)).toBe(false);
    expect(canRedeemOn({ ...entry, card_tier: undefined }, sales)).toBe(false);
  });
});
