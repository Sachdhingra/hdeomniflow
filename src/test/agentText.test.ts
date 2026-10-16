import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  calendarContext,
  claimsFollowUpSaved,
  extractJsonObjects,
  parseAgentOutput,
  savedClaims,
  validateFollowUp,
} from "../../supabase/functions/_shared/agent-text";

const ACTION = { type: "set_follow_up", lead_id: "867574e7-5cae-4ddf-b3d1-5e04a01cb458", date: "2026-10-14" };

describe("parseAgentOutput", () => {
  it("recovers the action from the exact message that leaked JSON into the chat", () => {
    const raw =
      `Got it, Saurabh! Jitender Kumar ka follow-up tomorrow morning ke liye set kar diya hai. 👍\n` +
      `{"actions":[{"type":"set_follow_up","lead_id":"867574e7-5cae-4ddf-b3d1-5e04a01cb458","date":"2026-10-14"}]}\n` +
      `Aaj ka din toh shaandaar raha, Sunil Gupta ki nayi lead banayi!\nAbhi next, kis lead pe focus karna chahte ho?`;
    const r = parseAgentOutput(raw);
    expect(r.actions).toEqual([ACTION]);
    expect(r.reply).not.toContain("{");
    expect(r.reply).not.toContain("lead_id");
    expect(r.reply).toContain("Got it, Saurabh!");
    expect(r.reply).toContain("kis lead pe focus karna chahte ho?");
  });

  it("reads a clean envelope", () => {
    const r = parseAgentOutput(JSON.stringify({ reply: "Done!", quick_replies: ["Haan", "Nahi"], actions: [ACTION] }));
    expect(r).toEqual({ reply: "Done!", quick_replies: ["Haan", "Nahi"], actions: [ACTION] });
  });

  it("reads an envelope inside a code fence", () => {
    const r = parseAgentOutput("```json\n" + JSON.stringify({ reply: "Hi", actions: [] }) + "\n```");
    expect(r.reply).toBe("Hi");
  });

  it("keeps braces inside strings from confusing the scanner", () => {
    const r = parseAgentOutput(JSON.stringify({ reply: "Use {name} and } carefully", actions: [ACTION] }));
    expect(r.reply).toBe("Use {name} and } carefully");
    expect(r.actions).toHaveLength(1);
  });

  it("handles a bare action object with no envelope", () => {
    const r = parseAgentOutput(`Ho gaya.\n${JSON.stringify(ACTION)}\nAur kuch?`);
    expect(r.actions).toEqual([ACTION]);
    expect(r.reply).toBe("Ho gaya.\n\nAur kuch?");
  });

  it("recovers a malformed envelope with unescaped quotes", () => {
    const r = parseAgentOutput('{"reply":"Shaam, "a lead" lost.","quick_replies":["Haan"],"actions":[]}');
    expect(r.reply).toBe('Shaam, "a lead" lost.');
    expect(r.quick_replies).toEqual(["Haan"]);
  });

  it("finds action objects nested in a broken outer object", () => {
    const raw = `Done {"note": "x" "oops", "actions":[${JSON.stringify(ACTION)}]} bye`;
    expect(parseAgentOutput(raw).actions).toEqual([ACTION]);
  });

  it("returns plain prose unchanged and never shows raw JSON", () => {
    expect(parseAgentOutput("Bas ek call aur, phir chai!").reply).toBe("Bas ek call aur, phir chai!");
    expect(parseAgentOutput("{broken").reply).toMatch(/lost my train of thought/);
  });

  it("collects actions from several blobs and drops them all from the reply", () => {
    const a2 = { type: "add_note", lead_id: "x", text: "called" };
    const r = parseAgentOutput(`One.\n{"actions":[${JSON.stringify(ACTION)}]}\nTwo.\n{"actions":[${JSON.stringify(a2)}]}\nThree.`);
    expect(r.actions).toEqual([ACTION, a2]);
    expect(r.reply).toBe("One.\n\nTwo.\n\nThree.");
  });
});

describe("extractJsonObjects", () => {
  it("returns nothing for text without JSON", () => {
    expect(extractJsonObjects("no braces here")).toEqual([]);
  });
});

describe("validateFollowUp", () => {
  const today = "2026-10-13";
  it("accepts today, the future, and a valid time", () => {
    expect(validateFollowUp("2026-10-13", undefined, today)).toEqual({ ok: true, date: "2026-10-13", time: null });
    expect(validateFollowUp("2026-10-14", "09:30", today)).toEqual({ ok: true, date: "2026-10-14", time: "09:30" });
  });
  it("rejects past, impossible, malformed and far-future dates", () => {
    expect(validateFollowUp("2026-10-12", null, today)).toMatchObject({ ok: false });
    expect(validateFollowUp("2026-02-31", null, today)).toMatchObject({ ok: false });
    expect(validateFollowUp("14/10/2026", null, today)).toMatchObject({ ok: false });
    expect(validateFollowUp(undefined, null, today)).toMatchObject({ ok: false });
    expect(validateFollowUp("2028-01-01", null, today)).toMatchObject({ ok: false });
  });
  it("rejects a bad time", () => {
    expect(validateFollowUp("2026-10-14", "25:00", today)).toMatchObject({ ok: false });
    expect(validateFollowUp("2026-10-14", "9am", today)).toMatchObject({ ok: false });
  });
});

describe("calendarContext", () => {
  it("labels today/tomorrow and names weekdays", () => {
    const c = calendarContext("2026-10-13", 3);
    expect(c[0]).toEqual({ date: "2026-10-13", weekday: "Tuesday", label: "today" });
    expect(c[1]).toEqual({ date: "2026-10-14", weekday: "Wednesday", label: "tomorrow" });
    expect(c[2].label).toBe("in 2 days");
  });
  it("rolls over month ends", () => {
    expect(addDaysISO("2026-10-31", 1)).toBe("2026-11-01");
    expect(calendarContext("2026-12-31", 2)[1].date).toBe("2027-01-01");
  });
});

describe("claimsFollowUpSaved", () => {
  it("catches Hinglish and English claims that a follow-up was set", () => {
    expect(claimsFollowUpSaved("Jitender Kumar ka follow-up kal subah ke liye set kar diya hai")).toBe(true);
    expect(claimsFollowUpSaved("I've set a follow-up for tomorrow.")).toBe(true);
    expect(claimsFollowUpSaved("Follow-up rescheduled to Friday")).toBe(true);
  });
  it("does not fire on ordinary coaching or on a question about setting one", () => {
    expect(claimsFollowUpSaved("Great work today! Kal subah Gagan ko call karna.")).toBe(false);
    expect(claimsFollowUpSaved("Kya main Jitender ka follow-up kal ke liye lagaun?")).toBe(false);
  });
});

describe("parseAgentOutput — double-wrapped replies (seen live)", () => {
  const inner = { reply: "Awesome! Go get 'em, Nisha! 🚀 I'll put a follow-up for tomorrow.", quick_replies: ["JOYITA", "SEEMA"], actions: [ACTION] };

  it("unwraps a reply that is itself a JSON envelope and keeps the actions once", () => {
    const raw = JSON.stringify({ reply: JSON.stringify(inner), actions: [ACTION] });
    const r = parseAgentOutput(raw);
    expect(r.reply).toBe("Awesome! Go get 'em, Nisha! 🚀 I'll put a follow-up for tomorrow.");
    expect(r.actions).toEqual([ACTION]);
    expect(r.quick_replies).toEqual(["JOYITA", "SEEMA"]);
  });

  it("unwraps when the outer layer has no actions of its own", () => {
    const r = parseAgentOutput(JSON.stringify({ reply: JSON.stringify(inner) }));
    expect(r.reply).toMatch(/^Awesome!/);
    expect(r.actions).toEqual([ACTION]);
  });

  it("unwraps a fenced inner envelope", () => {
    const r = parseAgentOutput(JSON.stringify({ reply: "```json\n" + JSON.stringify(inner) + "\n```", actions: [] }));
    expect(r.reply).toMatch(/^Awesome!/);
  });

  it("leaves an ordinary reply that merely contains a brace alone", () => {
    const r = parseAgentOutput(JSON.stringify({ reply: "Use the {name} field", actions: [] }));
    expect(r.reply).toBe("Use the {name} field");
  });
});

describe("savedClaims — real coach messages from production", () => {
  it("does not flag the false alarms", () => {
    // 'Clear ho gaya' + 'make a note' + a question about a follow-up
    expect(
      savedClaims("Achha, Shivam! Theek hai. Clear ho gaya. 👍 Let's make a note of this. Ab, kya Ritu mam ko try karein? Unka follow-up 20 Oct ka hai, toh unko ek quick call karke dekho."),
    ).toEqual({ followUp: false, note: false });
    expect(savedClaims("Ek kaam karte hain, Ritu mam ke liye follow-up tomorrow, October 15th ko set kar dein? 🤔")).toEqual({ followUp: false, note: false });
    expect(savedClaims("Ritu mam ko message kar diya, ekdum perfect!")).toEqual({ followUp: false, note: false });
  });

  it("catches a claimed follow-up and a claimed note", () => {
    expect(savedClaims("Ritu mam ka follow-up 20 Oct ko set ho gaya hai.").followUp).toBe(true);
    expect(savedClaims("Maine unki lead mein note add kar diya hai ki call nahi lagi.").note).toBe(true);
    expect(savedClaims("Mai yahan note kar deta hu ki 'sanjay ji is not picking'.").note).toBe(true);
    expect(savedClaims("I've noted that down and set a follow-up for Friday.")).toEqual({ followUp: true, note: true });
  });

  it("handles empty text", () => {
    expect(savedClaims("")).toEqual({ followUp: false, note: false });
  });
});
