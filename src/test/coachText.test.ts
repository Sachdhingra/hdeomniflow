import { describe, expect, it } from "vitest";
import { displayCoachText } from "@/lib/coachText";

describe("displayCoachText", () => {
  it("leaves normal messages alone", () => {
    expect(displayCoachText("Hey Saurabh! Kya plan hai?")).toBe("Hey Saurabh! Kya plan hai?");
    expect(displayCoachText("Use {name} in the template")).toBe("Use {name} in the template");
  });

  it("shows the reply from a stored raw JSON envelope (the old bug)", () => {
    const stored = JSON.stringify({ reply: "Theek hai, noted! 👍", quick_replies: ["JOYITA"], actions: [] });
    expect(displayCoachText(stored)).toBe("Theek hai, noted! 👍");
  });

  it("unwraps a double-wrapped envelope", () => {
    const inner = JSON.stringify({ reply: "Awesome!", actions: [] });
    expect(displayCoachText(JSON.stringify({ reply: inner }))).toBe("Awesome!");
  });

  it("falls back to the raw text when it is not valid JSON", () => {
    const broken = '{"reply":"Shaam, "a lead" lost.","actions":[]}';
    expect(displayCoachText(broken)).toBe(broken);
  });
});
