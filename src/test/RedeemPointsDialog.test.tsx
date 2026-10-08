/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed mocks */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/redemption", async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    startRedemption: vi.fn(), verifyRedemption: vi.fn(), cancelRedemption: vi.fn(),
    fetchSession: vi.fn(), notifyCustomer: vi.fn(),
  };
});

import RedeemPointsDialog from "@/components/RedeemPointsDialog";
import * as api from "@/lib/redemption";

// jsdom lacks these; input-otp and radix touch them
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
(document as any).elementFromPoint ??= () => null;

const m = api as any;
const ENTRY = { id: "bill-1", customer_id: "c1", customer_name: "Alice Verma", gross_bill_amount: 66932 };

const startInfo = (over: any = {}) => ({
  session_id: "s1", status: "awaiting_choice", resumed: false, customer_name: "Alice Verma", customer_id: "c1",
  cap: 3346.6, headroom: 3346.6, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), ...over,
});
const row = (over: any = {}) => ({
  status: "awaiting_choice", chosen_points: null, chosen_rupees: null, failed_attempts: 0,
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), ...over,
});
const chosenRow = () => row({ status: "awaiting_otp", chosen_points: 100, chosen_rupees: 750 });

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

function mount(over: any = {}) {
  const onClose = vi.fn(); const onChanged = vi.fn();
  render(<RedeemPointsDialog entry={ENTRY} open onClose={onClose} onChanged={onChanged} {...over} />);
  return { onClose, onChanged };
}
const typeCode = (v: string) =>
  fireEvent.change(screen.getByLabelText("4-digit customer code"), { target: { value: v } });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.values(m).forEach((f: any) => f?.mockReset?.());
  m.startRedemption.mockResolvedValue(startInfo());
  m.fetchSession.mockResolvedValue(row());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("starting", () => {
  it("shows the limit in rupees, tells the customer, and waits", async () => {
    mount(); await flush();
    expect(m.startRedemption).toHaveBeenCalledWith("bill-1");
    expect(screen.getByTestId("phase-waiting")).toBeInTheDocument();
    const reminder = screen.getByTestId("cap-reminder").textContent!;
    expect(reminder).toContain("5% of ₹66,932");
    expect(reminder).toContain("₹3,346.60");
    expect(reminder).toContain("₹0 ");              // nothing redeemed yet
    expect(reminder).toContain("₹3,346.60 left");
    expect(m.notifyCustomer).toHaveBeenCalledTimes(1);
    expect(m.notifyCustomer).toHaveBeenCalledWith("c1", "redemption_started");
  });

  it("explains a refusal with the server's numbers and stops", async () => {
    m.startRedemption.mockRejectedValue({ message: "BILL_BELOW_MINIMUM: redemption needs a bill of at least Rs 30000, this bill is Rs 20000" });
    mount(); await flush();
    const box = screen.getByTestId("phase-blocked");
    expect(box).toHaveTextContent("This bill is too small to redeem on");
    expect(box).toHaveTextContent("Rs 30000");
    expect(screen.queryByTestId("cap-reminder")).toBeNull();
    await flush(10_000);
    expect(m.fetchSession).not.toHaveBeenCalled();        // no polling after a refusal
    expect(m.notifyCustomer).not.toHaveBeenCalled();      // and nobody is pinged
  });

  it("resumes a session the customer has already answered, without pinging them again", async () => {
    m.startRedemption.mockResolvedValue(startInfo({ resumed: true, status: "awaiting_otp" }));
    m.fetchSession.mockResolvedValue(chosenRow());
    mount(); await flush();
    expect(screen.getByTestId("phase-code")).toHaveTextContent("100 pts → ₹750");
    expect(m.notifyCustomer).not.toHaveBeenCalled();
  });

  it("does not start twice for one opening", async () => {
    mount(); await flush(5000);
    expect(m.startRedemption).toHaveBeenCalledTimes(1);
  });
});

describe("the counter flow", () => {
  it("customer chooses, staff types the code, points are redeemed", async () => {
    const { onChanged } = mount(); await flush();
    expect(screen.getByTestId("phase-waiting")).toBeInTheDocument();

    m.fetchSession.mockResolvedValue(chosenRow());
    await flush(2600);                                     // next poll sees the customer's choice
    expect(screen.getByTestId("phase-code")).toHaveTextContent("100 pts → ₹750");

    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    typeCode("482");
    expect(confirm).toBeDisabled();                        // a short code cannot be submitted
    typeCode("4821");
    expect(confirm).toBeEnabled();

    m.verifyRedemption.mockResolvedValue({ ok: true, redemption_id: "r1", points: 100, rupees: 750, headroom_left: 2596.6, customer_id: "c1" });
    fireEvent.click(confirm); await flush();

    expect(m.verifyRedemption).toHaveBeenCalledWith("s1", "4821");
    expect(screen.getByTestId("phase-done")).toHaveTextContent("₹750 redeemed (100 points)");
    expect(screen.getByTestId("cap-reminder")).toHaveTextContent("₹2,596.60 left");
    expect(screen.getByTestId("cap-reminder")).toHaveTextContent("Already redeemed ₹750");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(m.notifyCustomer).toHaveBeenLastCalledWith("c1", "redemption_used", { rupees: 750, points: 100 });
  });

  it("a wrong code says how many tries are left and clears the boxes", async () => {
    m.fetchSession.mockResolvedValue(chosenRow());
    mount(); await flush(2600);
    typeCode("1111");
    m.verifyRedemption.mockResolvedValue({ ok: false, reason: "WRONG_CODE", attempts_left: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" })); await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong code. 2 tries left.");
    expect((screen.getByLabelText("4-digit customer code") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();

    typeCode("2222");
    m.verifyRedemption.mockResolvedValue({ ok: false, reason: "WRONG_CODE", attempts_left: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" })); await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong code. 1 try left.");   // singular
  });

  it("the third wrong code closes the redemption and offers a fresh start", async () => {
    m.fetchSession.mockResolvedValue(chosenRow());
    mount(); await flush(2600);
    typeCode("9999");
    m.verifyRedemption.mockResolvedValue({ ok: false, reason: "TOO_MANY_ATTEMPTS", attempts_left: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" })); await flush();
    expect(screen.getByTestId("phase-closed")).toHaveTextContent("Too many wrong codes");
    expect(m.verifyRedemption).toHaveBeenCalledTimes(1);

    m.startRedemption.mockResolvedValue(startInfo({ session_id: "s2" }));
    m.fetchSession.mockResolvedValue(row());
    fireEvent.click(screen.getByRole("button", { name: "Start again" })); await flush();
    expect(m.startRedemption).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("phase-waiting")).toBeInTheDocument();
  });

  it.each([
    ["SESSION_EXPIRED", "code expired"],
    ["BILL_CHANGED", "bill changed"],
    ["EXCEEDS_CAP", "over its redemption limit"],
  ])("%s closes with a clear reason", async (reason, text) => {
    m.fetchSession.mockResolvedValue(chosenRow());
    mount(); await flush(2600);
    typeCode("4821");
    m.verifyRedemption.mockResolvedValue({ ok: false, reason });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" })); await flush();
    expect(screen.getByTestId("phase-closed")).toHaveTextContent(text);
  });

  it("a network error keeps the code screen open so staff can retry", async () => {
    m.fetchSession.mockResolvedValue(chosenRow());
    mount(); await flush(2600);
    typeCode("4821");
    m.verifyRedemption.mockRejectedValue({ message: "Failed to fetch" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" })); await flush();
    expect(screen.getByTestId("phase-code")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("'Redeem another' starts a new session for the same bill", async () => {
    m.fetchSession.mockResolvedValue(chosenRow());
    mount(); await flush(2600);
    typeCode("4821");
    m.verifyRedemption.mockResolvedValue({ ok: true, redemption_id: "r1", points: 100, rupees: 750, headroom_left: 2596.6, customer_id: "c1" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" })); await flush();
    m.startRedemption.mockResolvedValue(startInfo({ session_id: "s2", headroom: 2596.6 }));
    m.fetchSession.mockResolvedValue(row());
    fireEvent.click(screen.getByRole("button", { name: "Redeem another" })); await flush();
    expect(m.startRedemption).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("phase-waiting")).toBeInTheDocument();
  });
});

describe("waiting, expiry and cancelling", () => {
  it("closes by itself when the time runs out", async () => {
    m.startRedemption.mockResolvedValue(startInfo({ expires_at: new Date(Date.now() + 5000).toISOString() }));
    mount(); await flush();
    expect(screen.getByTestId("phase-waiting")).toBeInTheDocument();
    await flush(6500);
    expect(screen.getByTestId("phase-closed")).toHaveTextContent("code expired");
  });

  it("follows the server when the redemption is closed elsewhere", async () => {
    mount(); await flush();
    m.fetchSession.mockResolvedValue(row({ status: "cancelled" }));
    await flush(2600);
    expect(screen.getByTestId("phase-closed")).toHaveTextContent("cancelled");
  });

  it("goes back to waiting if the customer re-opens the choice", async () => {
    m.fetchSession.mockResolvedValue(chosenRow());
    mount(); await flush(2600);
    expect(screen.getByTestId("phase-code")).toBeInTheDocument();
    m.fetchSession.mockResolvedValue(row());
    await flush(2600);
    expect(screen.getByTestId("phase-waiting")).toBeInTheDocument();
  });

  it("Cancel ends the redemption on the server and closes", async () => {
    m.cancelRedemption.mockResolvedValue(undefined);
    const { onClose } = mount(); await flush();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); await flush();
    expect(m.cancelRedemption).toHaveBeenCalledWith("s1");
    expect(onClose).toHaveBeenCalled();
  });

  it("closing the window does NOT cancel, so the customer's code stays valid", async () => {
    const { onClose } = mount(); await flush();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); await flush();
    expect(onClose).toHaveBeenCalled();
    expect(m.cancelRedemption).not.toHaveBeenCalled();
  });

  it("'Remind customer' re-sends the notification", async () => {
    mount(); await flush();
    fireEvent.click(screen.getByRole("button", { name: "Remind customer" })); await flush();
    expect(m.notifyCustomer).toHaveBeenCalledTimes(2);
  });
});

describe("staff can never type a discount", () => {
  it("the only input anywhere in the flow is the 4-digit code", async () => {
    m.fetchSession.mockResolvedValue(chosenRow());
    mount(); await flush(2600);
    const inputs = Array.from(document.querySelectorAll("input"));
    expect(inputs).toHaveLength(1);
    expect(inputs[0].getAttribute("aria-label")).toBe("4-digit customer code");
    expect(inputs[0].getAttribute("maxlength")).toBe("4");
    expect(screen.queryByLabelText(/amount|discount|rupee/i)).toBeNull();
  });

  it("letters cannot be entered into the code", async () => {
    m.fetchSession.mockResolvedValue(chosenRow());
    mount(); await flush(2600);
    typeCode("ab12");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });
});
