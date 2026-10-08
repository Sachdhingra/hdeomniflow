/**
 * OTP-gated point redemption: client side of the redemption_* database functions
 * (supabase/migrations/20260912030000_otp_redemption.sql).
 *
 * The server owns every rule (minimum bill, 5% cap, waiting period, points,
 * attempts). This module only calls it and turns its stable error codes into
 * words staff can act on. Nothing here computes a discount.
 */
import { supabase } from "@/integrations/supabase/client";

export type SessionStatus =
  | "awaiting_choice" | "awaiting_otp" | "verified" | "expired" | "cancelled" | "failed";

export interface StartInfo {
  session_id: string;
  status: "awaiting_choice" | "awaiting_otp";
  expires_at: string;
  resumed: boolean;
  customer_name?: string;
  customer_id?: string;
  cap: number;
  headroom: number;
}

export interface SessionRow {
  status: SessionStatus;
  chosen_points: number | null;
  chosen_rupees: number | null;
  expires_at: string;
  failed_attempts: number;
}

export type VerifyResult =
  | { ok: true; redemption_id: string; points: number; rupees: number; headroom_left: number; customer_id: string }
  | { ok: false; reason: string; attempts_left?: number; status?: string; headroom?: number };

export const inr = (n: number | string) =>
  "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** "BILL_BELOW_MINIMUM: redemption needs ..." -> "BILL_BELOW_MINIMUM" */
export function errorCode(message?: string | null): string {
  const m = /^([A-Z][A-Z_]+):/.exec(message ?? "");
  return m ? m[1] : "UNKNOWN";
}

/** the human sentence the server appended after the code, if any */
export function errorDetail(message?: string | null): string {
  const i = (message ?? "").indexOf(":");
  return i > 0 && errorCode(message) !== "UNKNOWN" ? (message as string).slice(i + 1).trim() : "";
}

const START_TITLES: Record<string, string> = {
  BILL_BELOW_MINIMUM: "This bill is too small to redeem on",
  WAITING_PERIOD: "Not eligible yet",
  CAP_REACHED: "The redemption limit for this bill is used up",
  INSUFFICIENT_POINTS: "Not enough points",
  CUSTOMER_APP_NOT_ACTIVATED: "The customer has not activated the app",
  CUSTOMER_INACTIVE: "This card is not active",
  TIER_NOT_ELIGIBLE: "This card cannot redeem points",
  BILL_NOT_YOURS: "This is not your bill entry",
  BILL_ALREADY_DECIDED: "This bill has already been decided",
  BILL_IS_RETURN: "Points cannot be redeemed on a return",
  BILL_NOT_FOUND: "Bill entry not found",
  SESSION_IN_PROGRESS: "This customer already has a redemption in progress",
  RATE_LIMITED: "Too many attempts for this customer",
  FORBIDDEN: "You cannot redeem points",
  NOT_AUTHENTICATED: "Please sign in again",
};

/** Title + the server's own detail line (it carries the real numbers). */
export function describeStartError(message?: string | null): { title: string; detail: string } {
  const code = errorCode(message);
  return {
    title: START_TITLES[code] ?? "Could not start the redemption",
    detail: errorDetail(message) || (code === "UNKNOWN" ? (message ?? "") : ""),
  };
}

const CLOSE_TEXT: Record<string, string> = {
  SESSION_EXPIRED: "The code expired. Start again and the customer will get a fresh one.",
  TOO_MANY_ATTEMPTS: "Too many wrong codes, so this redemption is closed. Start again and the customer will get a new code.",
  BILL_CHANGED: "The bill changed after the code was issued, so nothing was redeemed. Start again if it still qualifies.",
  EXCEEDS_CAP: "That amount would take this bill over its redemption limit, so nothing was redeemed.",
  cancelled: "This redemption was cancelled.",
  expired: "The code expired. Start again and the customer will get a fresh one.",
  failed: "Too many wrong codes, so this redemption is closed. Start again and the customer will get a new code.",
  NOT_AWAITING_CODE: "This redemption is no longer waiting for a code.",
};
export const describeClosed = (reason: string) =>
  CLOSE_TEXT[reason] ?? "This redemption is closed. Start again if the customer still wants to redeem.";

/**
 * Who is offered the Redeem button. Sales: only their own pending entries; admin: any.
 * Only tiers that earn points. This is a convenience filter, not the control: the
 * server re-checks all of it plus the minimum bill, the cap and the waiting period.
 */
export function canRedeemOn(
  entry: { approval_status: string; is_return: boolean; card_tier?: string | null; entered_by: string },
  user: { id: string; role: string } | null | undefined,
): boolean {
  if (!user) return false;
  if (entry.approval_status !== "pending" || entry.is_return) return false;
  if (entry.card_tier !== "super_elite" && entry.card_tier !== "prestige_elite") return false;
  return user.role === "admin" || (user.role === "sales" && entry.entered_by === user.id);
}

// ── database calls (the generated types do not know these functions yet) ────

// the generated types do not know these functions or tables yet, so describe the little we use
type DbError = { message: string } | null;
interface Query {
  select: (cols: string) => Query;
  eq: (col: string, value: string) => Query;
  maybeSingle: () => Promise<{ data: unknown; error: DbError }>;
}
const db = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: DbError }>;
  from: (table: string) => Query;
};

export async function startRedemption(billEntryId: string): Promise<StartInfo> {
  const { data, error } = await db.rpc("redemption_start", { p_bill_entry_id: billEntryId });
  if (error) throw error;
  return data as StartInfo;
}

export async function verifyRedemption(sessionId: string, code: string): Promise<VerifyResult> {
  const { data, error } = await db.rpc("redemption_verify", { p_session_id: sessionId, p_code: code });
  if (error) throw error;
  return data as VerifyResult;
}

export async function cancelRedemption(sessionId: string): Promise<void> {
  const { error } = await db.rpc("redemption_cancel", { p_session_id: sessionId });
  if (error) throw error;
}

/** Status, chosen amount and expiry. The code is never in this row. */
export async function fetchSession(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await db
    .from("redemption_sessions")
    .select("status, chosen_points, chosen_rupees, expires_at, failed_attempts")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data as SessionRow) ?? null;
}

/** Best-effort push; a failed notification must never block the counter. */
export function notifyCustomer(
  customerId: string,
  kind: "redemption_started" | "redemption_used",
  extra?: { rupees?: number; points?: number },
): void {
  const started = kind === "redemption_started";
  Promise.resolve(
    supabase.functions.invoke("send-push", {
      body: {
        customer_id: customerId,
        type: kind,
        title: started ? "Redeem your points" : "Points redeemed",
        message: started
          ? "Open the Home Decor Insider app to choose how many points to redeem on this bill."
          : `${extra?.points ?? ""} points redeemed for ${inr(extra?.rupees ?? 0)} off your bill.`,
      },
    }),
  ).catch(() => { /* best effort */ });
}

// ── referral bonus ────────────────────────────────────────────────────────

const REFERRAL_TEXT: Record<string, (code: string) => string> = {
  CODE_NOT_FOUND: (c) => `referral code "${c}" not found (or that member is not active), no bonus credited`,
  ALREADY_AWARDED: () => "a referral bonus was already credited for this member",
  SELF_REFERRAL: () => "a member cannot refer themselves, no bonus credited",
  TOO_LATE: () => "the 24-hour window to credit a referral bonus has passed",
  NO_CODE: () => "no referral code entered",
  CUSTOMER_NOT_FOUND: () => "the new member could not be found, no bonus credited",
};
export const describeReferralFailure = (reason: string | undefined, code: string) =>
  (REFERRAL_TEXT[reason ?? ""] ?? (() => "the referral bonus could not be credited"))(code);

export interface ReferralResult { ok: boolean; points?: number; referrer_name?: string; reason?: string }

export async function awardReferralBonus(newMemberId: string, code: string): Promise<ReferralResult> {
  const { data, error } = await db.rpc("award_referral_bonus", { p_referred_customer: newMemberId, p_code: code });
  if (error) throw error;
  return data as ReferralResult;
}
