/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed mocks */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

// Who is signed in, and the rows the "database" returns
const AUTH: { user: any } = { user: null };
const ROWS: Record<string, any[]> = {};

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/RedeemPointsDialog", () => ({ default: () => null }));

// a tiny stand-in for the supabase query builder: filters on .eq, resolves to rows
function builder(table: string) {
  let rows = [...(ROWS[table] ?? [])];
  const api: any = {
    select: () => api, order: () => api, limit: () => api, in: () => api, gte: () => api, lte: () => api,
    eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return api; },
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  return api;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => builder(t), functions: { invoke: vi.fn() }, rpc: vi.fn() },
}));

import CardBillEntries from "@/pages/CardBillEntries";

const entry = (over: any = {}) => ({
  id: "e", customer_id: "c", entered_by: "sales-1", bill_reference: null, bill_date: "2026-10-01",
  gross_bill_amount: 50000, base_scheme_discount_pct: 0, card_discount_pct: 0, redemption_amount: 0,
  net_bill_amount: 50000, is_card_sale: false, is_return: false, approval_status: "pending",
  approved_by: null, approved_at: null, notes: null, created_at: "2026-10-01T00:00:00Z",
  elite_customers: { customer_name: "Alice", card_tier: "super_elite", card_number: "SE-1" }, ...over,
});

const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };
const buttons = () => screen.queryAllByRole("button", { name: /Redeem points/i });

beforeEach(() => {
  for (const k of Object.keys(ROWS)) delete ROWS[k];
  ROWS.card_bill_entries = [
    entry({ id: "mine-super", customer_name: "x", elite_customers: { customer_name: "Alice", card_tier: "super_elite", card_number: "SE-1" } }),
    entry({ id: "mine-prestige", elite_customers: { customer_name: "Bina", card_tier: "prestige_elite", card_number: "PE-1" } }),
    entry({ id: "mine-silver", elite_customers: { customer_name: "Chitra", card_tier: "silver", card_number: "S-1" } }),
    entry({ id: "mine-approved", approval_status: "approved", elite_customers: { customer_name: "Dev", card_tier: "super_elite", card_number: "SE-2" } }),
    entry({ id: "others-super", entered_by: "sales-2", elite_customers: { customer_name: "Esha", card_tier: "super_elite", card_number: "SE-3" } }),
  ];
  ROWS.profiles = [{ id: "sales-1", name: "Sales One" }, { id: "sales-2", name: "Sales Two" }];
});
afterEach(() => cleanup());

describe("Redeem points button on the Card Bill Entries page", () => {
  it("a salesperson sees it on their own pending Super/Prestige entries, and only those", async () => {
    AUTH.user = { id: "sales-1", name: "Sales One", role: "sales", email: "s@x" };
    render(<CardBillEntries />); await flush();
    // the page shows sales only their own entries (RLS does the same in production)
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Esha")).toBeNull();
    // 2 buttons: Alice (super) and Bina (prestige). Not Chitra (silver), not Dev (approved).
    expect(buttons()).toHaveLength(2);
  });

  it("a salesperson with only Silver or approved entries correctly sees none", async () => {
    AUTH.user = { id: "sales-1", name: "Sales One", role: "sales", email: "s@x" };
    ROWS.card_bill_entries = [
      entry({ id: "a", elite_customers: { customer_name: "Chitra", card_tier: "silver", card_number: "S-1" } }),
      entry({ id: "b", approval_status: "approved" }),
    ];
    render(<CardBillEntries />); await flush();
    expect(buttons()).toHaveLength(0);
  });

  it("admin sees it too, on every pending Super/Prestige entry", async () => {
    AUTH.user = { id: "boss", name: "Boss", role: "admin", email: "a@x" };
    render(<CardBillEntries />); await flush();
    expect(buttons()).toHaveLength(3);   // Alice, Bina, Esha (the pending tab)
  });
});
