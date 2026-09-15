import { describe, it, expect } from "vitest";
import {
  QUICK_REPLY_STEPS,
  STOP_PAYLOAD,
  buildContentVariables,
  describeAnswer,
  getQuickReplyStep,
  pickEntryStep,
  resolveQuickReply,
} from "@/lib/quickReplyFlow";
import { findAnswer, answerTone, handoffTask, stepTitle } from "@/lib/quickReplyFlow";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ALL_BUTTONS = QUICK_REPLY_STEPS.flatMap((s) => s.buttons.map((b) => ({ step: s, button: b })));

describe("quick-reply flow shape", () => {
  it("never exceeds WhatsApp's 3 quick-reply buttons per message", () => {
    for (const step of QUICK_REPLY_STEPS) {
      expect(step.buttons.length, step.key).toBeGreaterThanOrEqual(2);
      expect(step.buttons.length, step.key).toBeLessThanOrEqual(3);
    }
  });

  it("keeps every button label within WhatsApp's 20-character limit", () => {
    for (const { step, button } of ALL_BUTTONS) {
      expect(button.label.length, `${step.key}/${button.payload}`).toBeGreaterThan(0);
      expect(button.label.length, `${step.key}/${button.payload}`).toBeLessThanOrEqual(20);
    }
  });

  it("gives every payload one single meaning across the whole flow", () => {
    const byPayload = new Map<string, string>();
    for (const { button } of ALL_BUTTONS) {
      const seen = byPayload.get(button.payload);
      if (seen) {
        // The shared stop button is intentionally reused; it must stay identical.
        expect(seen, button.payload).toBe(JSON.stringify(button.effect));
      }
      byPayload.set(button.payload, JSON.stringify(button.effect));
    }
  });

  it("uses unique step keys", () => {
    const keys = QUICK_REPLY_STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only ever points at a step that exists", () => {
    for (const { step, button } of ALL_BUTTONS) {
      if (!button.effect.next) continue;
      expect(getQuickReplyStep(button.effect.next), `${step.key} → ${button.effect.next}`).not.toBeNull();
    }
  });

  it("never sends a follow-up step as a business-initiated template", () => {
    // Steps reached by tapping are always inside the 24h service window, so
    // they must not be marked as needing Meta approval.
    const reachedByTap = new Set(
      ALL_BUTTONS.map(({ button }) => button.effect.next).filter(Boolean) as string[],
    );
    for (const key of reachedByTap) {
      expect(getQuickReplyStep(key)!.requiresApprovedTemplate, key).toBe(false);
    }
  });

  it("declares exactly the variables its question uses", () => {
    // Twilio rejects ContentVariables the template does not reference, and a
    // referenced-but-undeclared placeholder renders as literal "{{2}}".
    for (const step of QUICK_REPLY_STEPS) {
      const used = new Set(
        [...step.question.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])),
      );
      const declared = step.variables.map((_, i) => i + 1);
      expect([...used].sort(), `${step.key} placeholders`).toEqual(declared);
    }
  });

  it("always leaves the customer a way out", () => {
    const stopSteps = QUICK_REPLY_STEPS.filter((s) =>
      s.buttons.some((b) => b.payload === STOP_PAYLOAD),
    );
    expect(stopSteps.length).toBeGreaterThan(0);
    for (const step of stopSteps) {
      const stop = step.buttons.find((b) => b.payload === STOP_PAYLOAD)!;
      expect(stop.effect.optOut).toBe(true);
    }
  });

  it("hands every dead end to a human or closes it deliberately", () => {
    for (const { step, button } of ALL_BUTTONS) {
      const e = button.effect;
      const resolved =
        !!e.next || !!e.handoff || !!e.optOut || !!e.close || typeof e.snoozeDays === "number";
      expect(resolved, `${step.key}/${button.payload} does nothing`).toBe(true);
    }
  });
});

describe("resolveQuickReply", () => {
  it("matches the exact button payload", () => {
    const r = resolveQuickReply({ stepKey: "qr_reengage", payload: "QR_STILL_LOOKING" });
    expect(r?.matchedBy).toBe("payload");
    expect(r?.button.label).toBe("Yes, still looking");
    expect(r?.step?.key).toBe("qr_reengage");
  });

  it("still resolves a payload when we do not know which step was answered", () => {
    const r = resolveQuickReply({ stepKey: null, payload: "QR_WANT_CALL" });
    expect(r?.matchedBy).toBe("payload");
    expect(r?.step?.key).toBe("qr_what_helps");
    expect(r?.button.effect.handoff?.call).toBe(true);
  });

  it("falls back to the button label, scoped to the answered step", () => {
    const r = resolveQuickReply({ stepKey: "qr_what_helps", buttonText: "visit showroom" });
    expect(r?.matchedBy).toBe("label");
    expect(r?.button.payload).toBe("QR_WANT_VISIT");
  });

  it("does not let a label from another step leak in", () => {
    // "Yes, still looking" belongs to qr_reengage, not qr_visit_when.
    expect(resolveQuickReply({ stepKey: "qr_visit_when", buttonText: "Yes, still looking" })).toBeNull();
  });

  it("honours a typed stop anywhere", () => {
    const r = resolveQuickReply({ stepKey: null, body: "STOP" });
    expect(r?.matchedBy).toBe("stop_word");
    expect(r?.button.effect.optOut).toBe(true);
  });

  it("refuses to interpret ordinary free text", () => {
    expect(resolveQuickReply({ stepKey: "qr_reengage", body: "kitna hai iska price?" })).toBeNull();
    expect(resolveQuickReply({ stepKey: "qr_reengage", body: "maybe" })).toBeNull();
  });

  it("does not treat a word merely containing 'stop' as an opt-out", () => {
    expect(resolveQuickReply({ stepKey: null, body: "stopper for the door" })).toBeNull();
  });
});

describe("pickEntryStep", () => {
  const base = {
    journeyStage: "exploration",
    unansweredCount: 0,
    daysSinceLastInbound: 0,
    hasEverAnswered: true,
  };

  it("opens with the re-engagement question for a lead who never replied", () => {
    expect(pickEntryStep({ ...base, hasEverAnswered: false })).toBe("qr_reengage");
  });

  it("nudges a lead who has gone quiet after an outbound message", () => {
    expect(pickEntryStep({ ...base, unansweredCount: 2, daysSinceLastInbound: 4 })).toBe("qr_nudge");
  });

  it("stays quiet on an active lead a salesperson is already working", () => {
    expect(pickEntryStep({ ...base, journeyStage: "decision" })).toBeNull();
  });

  it("does not nudge a lead who has only just been messaged", () => {
    expect(pickEntryStep({ ...base, unansweredCount: 1, daysSinceLastInbound: 1 })).toBeNull();
  });

  it("asks for price feedback once a quote has been sitting unanswered", () => {
    expect(
      pickEntryStep({ ...base, awaitingQuoteFeedback: true, daysSinceLastInbound: 3 }),
    ).toBe("qr_price_feedback");
  });

  it("checks in after a showroom visit", () => {
    expect(pickEntryStep({ ...base, lastVisitDaysAgo: 1 })).toBe("qr_post_visit");
  });

  it("restarts the flow for a cold lead", () => {
    expect(pickEntryStep({ ...base, journeyStage: "cold" })).toBe("qr_reengage");
  });
});

describe("buildContentVariables", () => {
  it("numbers variables in the order the template declares them", () => {
    const step = getQuickReplyStep("qr_reengage")!;
    expect(
      buildContentVariables(step, { first_name: "Rahul", interest: "a sofa", showroom: "Dehradun" }),
    ).toEqual({ "1": "Rahul", "2": "a sofa", "3": "Dehradun" });
  });

  it("only emits the variables a step actually uses", () => {
    const step = getQuickReplyStep("qr_what_helps")!;
    expect(
      buildContentVariables(step, { first_name: "Rahul", interest: "a sofa", showroom: "Dehradun" }),
    ).toEqual({ "1": "Rahul" });
  });
});

describe("board presentation helpers", () => {
  it("describes a tap in the customer's own words", () => {
    expect(describeAnswer("QR_WANT_PRICE")).toBe("Send price & offers");
    expect(describeAnswer("NOT_A_PAYLOAD")).toBeNull();
    expect(describeAnswer(null)).toBeNull();
  });

  it("flags taps that need a salesperson", () => {
    expect(handoffTask("QR_WANT_CALL")).toContain("call");
    expect(answerTone("QR_WANT_CALL")).toBe("action");
    expect(answerTone("QR_ALREADY_BOUGHT")).toBe("negative");
    expect(answerTone("QR_STILL_LOOKING")).toBe("positive");
    expect(answerTone(null)).toBe("neutral");
  });

  it("resolves a payload back to its step", () => {
    expect(findAnswer("QR_EMI_YES")?.step.key).toBe("qr_emi_offer");
    expect(stepTitle("qr_nudge")).toBe("Silent lead nudge");
  });
});

describe("database seed matches the flow", () => {
  // The admin screen shows the seeded question text so staff can paste it into
  // the Twilio console. If the code and the seed drift, they paste the wrong
  // body and every variable lands in the wrong place.
  const sql = readFileSync(
    resolve(__dirname, "../../supabase/migrations/20260915071500_whatsapp_quick_reply_flow.sql"),
    "utf8",
  );

  const seeded = [
    ...sql.matchAll(
      /\(\s*'([^']+)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*(true|false),\s*\d+\)/g,
    ),
  ].map((m) => ({
    step_key: m[1],
    title: m[2].replace(/''/g, "'"),
    question: m[3].replace(/''/g, "'"),
    requiresApprovedTemplate: m[4] === "true",
  }));

  it("seeds every step exactly once", () => {
    expect(seeded.map((r) => r.step_key).sort()).toEqual(QUICK_REPLY_STEPS.map((s) => s.key).sort());
  });

  it("seeds the same title, question and approval requirement as the code", () => {
    for (const row of seeded) {
      const step = getQuickReplyStep(row.step_key)!;
      expect(row.title, `${row.step_key} title`).toBe(step.title);
      expect(row.question, `${row.step_key} question`).toBe(step.question);
      expect(row.requiresApprovedTemplate, `${row.step_key} approval`).toBe(
        step.requiresApprovedTemplate,
      );
    }
  });
});
