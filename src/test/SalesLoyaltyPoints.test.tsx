/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed mocks */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const AUTH: { user: any } = { user: null };
const ROWS: Record<string, any[]> = {};

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ ...AUTH, logout: vi.fn(), forceLogout: vi.fn() }) }));
vi.mock("@/contexts/DataContext", () => ({ useData: () => ({ notifications: [], error: null, summary: { overdueLeads: 0, pendingJobs: 0 } }) }));
vi.mock("@/contexts/ChatUnreadContext", () => ({ useChatUnread: () => ({ totalUnread: 0 }) }));
vi.mock("@/hooks/useStaffProfile", () => ({ useStaffProfile: () => ({ profile: null }) }));
vi.mock("@/hooks/useFieldAgentDuty", () => ({ useFieldAgentDuty: () => ({ isOnDuty: false, isFieldAgent: false }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
// everything in the shell that is not the menu (vi.mock is hoisted, so these cannot be a loop)
vi.mock("@/components/NotificationPanel", () => ({ default: () => null }));
vi.mock("@/components/NetworkStatusBadge", () => ({ default: () => null }));
vi.mock("@/components/ChatNotifier", () => ({ default: () => null }));
vi.mock("@/components/ChatArrivalFlash", () => ({ default: () => null }));
vi.mock("@/components/LeadNotifier", () => ({ default: () => null }));
vi.mock("@/components/OrderNotifier", () => ({ default: () => null }));
vi.mock("@/components/OrderActionBanner", () => ({ default: () => null }));
vi.mock("@/components/AttendanceClockButton", () => ({ default: () => null }));
vi.mock("@/components/DiscountCalculator", () => ({ default: () => null }));
vi.mock("@/components/FieldAgentGpsGuard", () => ({ default: () => null }));
vi.mock("@/components/JarvisFloatingButton", () => ({ default: () => null }));
vi.mock("@/components/MorningBriefing", () => ({ default: () => null }));
vi.mock("@/components/LoyaltyAlertNotifier", () => ({ default: () => null }));
vi.mock("@/components/StaffPushRegistrar", () => ({ default: () => null }));

function builder(table: string) {
  let rows = [...(ROWS[table] ?? [])];
  const api: any = {
    select: () => api, order: () => api, limit: () => api, in: () => api, eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return api; },
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  return api;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => builder(t), functions: { invoke: vi.fn() }, rpc: vi.fn(),
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: vi.fn(),
  },
}));

import AppLayout from "@/components/AppLayout";
import LoyaltyPoints from "@/pages/LoyaltyPoints";

const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };
const asRole = (role: string) => { AUTH.user = { id: `u-${role}`, name: role, email: `${role}@x`, role }; };
const navLink = () => screen.queryByRole("link", { name: /Loyalty Points/ });

beforeEach(() => { for (const k of Object.keys(ROWS)) delete ROWS[k]; });
afterEach(() => cleanup());

describe("the Loyalty Points menu item", () => {
  const menu = async (role: string) => {
    asRole(role);
    render(<MemoryRouter><AppLayout><div /></AppLayout></MemoryRouter>);
    await flush();
  };

  it("sales can see it, right under Card Bill Entries, and it goes to the page", async () => {
    await menu("sales");
    const link = navLink();
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/loyalty-points");
    const labels = screen.getAllByRole("link").map((a) => a.textContent ?? "");
    const i = labels.findIndex((t) => /Card Bill Entries/.test(t));
    expect(i).toBeGreaterThan(-1);
    expect(labels[i + 1]).toMatch(/Loyalty Points/);
  });

  it("admin still has it", async () => {
    await menu("admin");
    expect(navLink()).toBeInTheDocument();
  });

  it("a role that never had it (service head) still does not", async () => {
    await menu("service_head");
    expect(navLink()).toBeNull();
  });
});

describe("the Loyalty Points page for sales is read-only", () => {
  beforeEach(() => {
    ROWS.redemption_requests = [{
      id: "r1", customer_id: "c1", points_requested: 100, rupee_value: 750, status: "pending",
      requested_at: "2026-10-01T09:00:00Z", processed_at: null,
      elite_customers: { customer_name: "Alice", card_tier: "super_elite", current_points: 150, card_number: "SE-1" },
    }];
    ROWS.elite_customers = [{ id: "c1", customer_name: "Alice", card_tier: "super_elite", current_points: 150, status: "active" }];
  });

  it("sales see the redemptions but get no Approve or Reject buttons", async () => {
    asRole("sales");
    render(<MemoryRouter><LoyaltyPoints /></MemoryRouter>); await flush();
    expect(screen.getByRole("heading", { name: "Loyalty Points" })).toBeInTheDocument();
    expect(screen.getByText("Redemption Queue", { exact: false })).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /approve|reject/i })).toHaveLength(0);
    expect(screen.queryByRole("tab", { name: /All Requests/ })).toBeNull();
  });

  it("admin still gets the Approve and Reject buttons", async () => {
    asRole("admin");
    render(<MemoryRouter><LoyaltyPoints /></MemoryRouter>); await flush();
    expect(screen.queryAllByRole("button", { name: /approve/i }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /reject/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /All Requests/ })).toBeInTheDocument();
  });
});
