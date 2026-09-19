import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { analyzeInbound, detectBinaryReply } from "./conversation-analysis.ts";

Deno.test("detects exact positive follow-up replies", () => {
  for (const reply of ["YES", "Yes, interested", "haan", "HDE_INTEREST_YES"]) {
    assertEquals(detectBinaryReply(reply), "yes");
    assertEquals(analyzeInbound(reply).intent, "interested");
  }
});

Deno.test("detects exact negative follow-up replies", () => {
  for (const reply of ["NO", "No, not now", "nahi", "not interested", "HDE_INTEREST_NO"]) {
    assertEquals(detectBinaryReply(reply), "no");
    assertEquals(analyzeInbound(reply).intent, "not_interested");
  }
});

Deno.test("does not treat words containing no as a negative button reply", () => {
  assertEquals(detectBinaryReply("Can you send another option?"), null);
  assertEquals(detectBinaryReply("I know the model"), null);
});