import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAppWorker } from "@/lib/appWorker";

const register = vi.fn();
const getRegistration = vi.fn();

beforeEach(() => {
  register.mockReset().mockResolvedValue({});
  getRegistration.mockReset();
  Object.defineProperty(navigator, "serviceWorker", {
    value: { register, getRegistration, ready: Promise.resolve({ scope: "/" }) },
    configurable: true,
  });
});

describe("ensureAppWorker", () => {
  it("registers the worker on a fresh install", async () => {
    getRegistration.mockResolvedValue(undefined);
    await ensureAppWorker();
    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("leaves OneSignal's installed copy of the worker alone", async () => {
    getRegistration.mockResolvedValue({
      active: { scriptURL: "https://hdeomniflow.lovable.app/sw.js?appId=x&sdkVersion=160000" },
    });
    await ensureAppWorker();
    expect(register).not.toHaveBeenCalled();
  });
});
