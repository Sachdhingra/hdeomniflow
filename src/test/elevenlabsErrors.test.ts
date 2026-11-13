import { describe, expect, it } from "vitest";
import { classifyElevenLabsError } from "../../supabase/functions/_shared/elevenlabs-errors";

const detail = (status: string) => JSON.stringify({ detail: { status, message: "x" } });

describe("classifyElevenLabsError", () => {
  it("treats a used-up quota as credits exhausted", () => {
    expect(classifyElevenLabsError(401, detail("quota_exceeded"))).toBe("quota");
    expect(classifyElevenLabsError(401, "This request exceeds your quota of 10000.")).toBe("quota");
  });

  it("treats an unusable voice as a voice problem, so the previous voice is tried", () => {
    expect(classifyElevenLabsError(404, detail("voice_not_found"))).toBe("voice");
    expect(classifyElevenLabsError(402, detail("paid_plan_required"))).toBe("voice");
    expect(classifyElevenLabsError(404, "")).toBe("voice");
    expect(classifyElevenLabsError(402, "")).toBe("voice");
  });

  it("does not mistake a quota error for a voice error when both words appear", () => {
    expect(classifyElevenLabsError(402, `${detail("quota_exceeded")} paid_plan_required`)).toBe("quota");
  });

  it("falls through for rate limits and server errors", () => {
    expect(classifyElevenLabsError(429, detail("too_many_concurrent_requests"))).toBe("other");
    expect(classifyElevenLabsError(500, "oops")).toBe("other");
  });
});
