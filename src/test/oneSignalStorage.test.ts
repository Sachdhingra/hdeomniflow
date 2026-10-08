import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureOneSignalStorage } from "@/lib/oneSignalStorage";

type Outcome = { version: number } | { error: string } | { missing: true };

let openOutcomes: Outcome[] = [];
const deleteDatabase = vi.fn();

function fakeOpen() {
  const outcome = openOutcomes.shift() ?? { version: 7 };
  const request: Record<string, unknown> = {};
  queueMicrotask(() => {
    if ("version" in outcome) {
      request.result = { version: outcome.version, close: vi.fn() };
      (request.onsuccess as () => void)();
    } else if ("missing" in outcome) {
      const transaction = { abort: vi.fn() };
      request.transaction = transaction;
      (request.onupgradeneeded as (e: { oldVersion: number }) => void)({ oldVersion: 0 });
      expect(transaction.abort).toHaveBeenCalled();
      request.error = { name: "AbortError" };
      (request.onerror as (e: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    } else {
      request.error = { name: outcome.error };
      (request.onerror as (e: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    }
  });
  return request;
}

beforeEach(() => {
  openOutcomes = [];
  deleteDatabase.mockReset().mockImplementation(() => {
    const request: Record<string, unknown> = {};
    queueMicrotask(() => (request.onsuccess as () => void)());
    return request;
  });
  vi.stubGlobal("indexedDB", { open: vi.fn(fakeOpen), deleteDatabase });
});

describe("ensureOneSignalStorage", () => {
  it("leaves a healthy database alone", async () => {
    openOutcomes = [{ version: 7 }];
    expect(await ensureOneSignalStorage()).toBeNull();
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it("does not create the database when it does not exist yet", async () => {
    openOutcomes = [{ missing: true }];
    expect(await ensureOneSignalStorage()).toBeNull();
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it("rebuilds a database that will not open", async () => {
    openOutcomes = [{ error: "UnknownError" }, { missing: true }];
    expect(await ensureOneSignalStorage()).toBeNull();
    expect(deleteDatabase).toHaveBeenCalledWith("ONE_SIGNAL_SDK_DB");
  });

  it("rebuilds a database left at a version the SDK cannot open", async () => {
    openOutcomes = [{ version: 9 }, { missing: true }];
    expect(await ensureOneSignalStorage()).toBeNull();
    expect(deleteDatabase).toHaveBeenCalledTimes(1);
  });

  it("says what to do when the browser storage stays broken", async () => {
    openOutcomes = [{ error: "UnknownError" }, { error: "UnknownError" }];
    const message = await ensureOneSignalStorage();
    expect(message).toContain("UnknownError");
    expect(message).toContain("Clear & reset");
  });
});
