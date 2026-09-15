// Front-end view of the WhatsApp quick-reply flow.
//
// The flow itself lives with the edge functions so the engine, the webhook and
// this screen can never disagree about what a button means. This module only
// re-exports it and adds presentation helpers.
export * from "../../supabase/functions/_shared/quick-reply-flow";

import {
  QUICK_REPLY_STEPS,
  type QuickReplyButton,
  type QuickReplyStep,
} from "../../supabase/functions/_shared/quick-reply-flow";

export interface QuickReplyAnswer {
  step: QuickReplyStep;
  button: QuickReplyButton;
}

/** Look up a tapped payload so the board can show what the customer chose. */
export function findAnswer(payload: string | null | undefined): QuickReplyAnswer | null {
  if (!payload) return null;
  for (const step of QUICK_REPLY_STEPS) {
    const button = step.buttons.find((b) => b.payload === payload);
    if (button) return { step, button };
  }
  return null;
}

export type AnswerTone = "positive" | "negative" | "neutral" | "action";

/** Colour for the answer chip on a lead card. */
export function answerTone(payload: string | null | undefined): AnswerTone {
  const answer = findAnswer(payload);
  if (!answer) return "neutral";
  const { effect } = answer.button;
  if (effect.handoff) return "action";
  if (effect.optOut || effect.close === "lost") return "negative";
  return effect.sentiment === "positive"
    ? "positive"
    : effect.sentiment === "negative"
      ? "negative"
      : "neutral";
}

export const ANSWER_TONE_CLASS: Record<AnswerTone, string> = {
  positive: "bg-success/15 text-success border-success/30",
  negative: "bg-destructive/15 text-destructive border-destructive/30",
  action: "bg-warning/15 text-warning border-warning/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

/** The job a salesperson picked up from this tap, if any. */
export function handoffTask(payload: string | null | undefined): string | null {
  return findAnswer(payload)?.button.effect.handoff?.task ?? null;
}

export function stepTitle(stepKey: string | null | undefined): string | null {
  if (!stepKey) return null;
  return QUICK_REPLY_STEPS.find((s) => s.key === stepKey)?.title ?? stepKey;
}
