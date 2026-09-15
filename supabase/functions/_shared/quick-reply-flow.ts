// ─────────────────────────────────────────────────────────────────────────────
// Deterministic WhatsApp quick-reply conversation flow.
//
// Why this exists: customers do not call back and rarely type. A tap is the
// cheapest possible reply, so every automated lead message is a WhatsApp
// quick-reply template with 2-3 buttons. When the customer taps, WhatsApp
// sends us back the *exact* button payload — so the lead board reacts to a
// known value instead of guessing intent from free text.
//
// This module is PURE (no imports, no Deno/browser APIs) because it is the
// single source of truth for both sides of the app:
//   - edge functions  : `../_shared/quick-reply-flow.ts` (Deno)
//   - React front-end : `src/lib/quickReplyFlow.ts` re-exports this file
//
// WhatsApp limits we must respect (enforced by src/test/quickReplyFlow.test.ts):
//   - at most 3 quick-reply buttons per message
//   - button labels are at most 20 characters
//   - button payloads must be globally unique so an answer is never ambiguous
// ─────────────────────────────────────────────────────────────────────────────

export type JourneyStage =
  | "problem"
  | "exploration"
  | "evaluation"
  | "reassurance"
  | "decision"
  | "cold";

export type QuickReplyIntent =
  | "interested"
  | "objection"
  | "question"
  | "ready_to_buy"
  | "not_interested"
  | "neutral";

export type QuickReplySentiment = "positive" | "negative" | "neutral";

export type QuickReplyConcern =
  | "price"
  | "delivery"
  | "quality"
  | "design"
  | "customization"
  | "comparison"
  | "timeline";

/** What happens the moment a customer taps a button. Fully declarative. */
export interface QuickReplyEffect {
  /** Move the lead to this journey stage on the board. */
  journeyStage?: JourneyStage;
  /** Recorded verbatim — the customer told us, we did not infer it. */
  intent?: QuickReplyIntent;
  sentiment?: QuickReplySentiment;
  concern?: QuickReplyConcern;
  /** Step to send back immediately — the conversation continues like a chat. */
  next?: string;
  /** Stop automating and put a named job in front of a human. */
  handoff?: {
    /** Short instruction shown to the salesperson on the lead card. */
    task: string;
    severity: "info" | "warning" | "critical";
    /** true → this is a "pick up the phone now" moment. */
    call?: boolean;
  };
  /** Customer asked us to stop messaging. Nothing automated goes out again. */
  optOut?: boolean;
  /** Pause automated follow-ups for this many days. */
  snoozeDays?: number;
  /** Close the flow. "lost" also closes the lead. */
  close?: "done" | "lost";
}

export interface QuickReplyButton {
  /** Exact Twilio ButtonPayload. Never parsed, never guessed. */
  payload: string;
  /** What the customer sees on the button (max 20 chars). */
  label: string;
  effect: QuickReplyEffect;
}

/** Ordered meaning of the template's {{1}}, {{2}}, ... variables. */
export type QuickReplyVariable = "first_name" | "interest" | "showroom";

/**
 * Meta's template category. It decides throttling, not just paperwork: a
 * MARKETING template to many recipients gets rate-limited (Twilio 63049), which
 * is why the account's notification template was moved to UTILITY.
 */
export type MetaCategory = "MARKETING" | "UTILITY";

export interface QuickReplyStep {
  key: string;
  /**
   * Template name as registered with Twilio/Meta. Meta only allows lowercase
   * letters, digits and underscores.
   */
  templateName: string;
  /** Category submitted to Meta. Only meaningful when approval is required. */
  metaCategory: MetaCategory;
  /** Internal name shown to staff in the admin flow view. */
  title: string;
  /** Preview of the rendered question, for staff and for template submission. */
  question: string;
  variables: QuickReplyVariable[];
  /**
   * true  → business-initiated, so Twilio needs an APPROVED WhatsApp template.
   * false → only ever sent right after a customer tap, i.e. inside the 24h
   *         customer-service window, where a non-approved Content SID is fine.
   */
  requiresApprovedTemplate: boolean;
  buttons: QuickReplyButton[];
}

/** Payload accepted at any step: the customer wants out. */
export const STOP_PAYLOAD = "QR_STOP_MESSAGES";

const STOP_BUTTON: QuickReplyButton = {
  payload: STOP_PAYLOAD,
  label: "Stop messages",
  effect: {
    optOut: true,
    intent: "not_interested",
    sentiment: "negative",
    journeyStage: "cold",
    close: "done",
  },
};

export const QUICK_REPLY_STEPS: QuickReplyStep[] = [
  {
    key: "qr_reengage",
    templateName: "hde_qr_still_looking",
    metaCategory: "MARKETING",
    title: "Re-engage — still looking?",
    question:
      "Hi {{1}}! Home Decor Enterprises here (authorised Godrej Interio, {{3}}). " +
      "Are you still looking for {{2}}? Just tap below — no need to call.",
    variables: ["first_name", "interest", "showroom"],
    requiresApprovedTemplate: true,
    buttons: [
      {
        payload: "QR_STILL_LOOKING",
        label: "Yes, still looking",
        effect: {
          journeyStage: "exploration",
          intent: "interested",
          sentiment: "positive",
          next: "qr_what_helps",
        },
      },
      {
        payload: "QR_JUST_BROWSING",
        label: "Just browsing",
        effect: {
          journeyStage: "exploration",
          intent: "neutral",
          sentiment: "neutral",
          next: "qr_offer_catalogue",
        },
      },
      {
        payload: "QR_ALREADY_BOUGHT",
        label: "Already bought",
        effect: {
          intent: "not_interested",
          sentiment: "neutral",
          journeyStage: "cold",
          close: "lost",
        },
      },
    ],
  },
  {
    key: "qr_what_helps",
    templateName: "hde_qr_what_helps",
    metaCategory: "UTILITY",
    title: "What helps most?",
    question: "Great! What would help you most right now, {{1}}?",
    variables: ["first_name"],
    requiresApprovedTemplate: false,
    buttons: [
      {
        payload: "QR_WANT_PRICE",
        label: "Send price & offers",
        effect: {
          journeyStage: "evaluation",
          intent: "question",
          sentiment: "positive",
          concern: "price",
          handoff: {
            task: "Send the price list and running offers on WhatsApp",
            severity: "warning",
          },
        },
      },
      {
        payload: "QR_WANT_VISIT",
        label: "Visit showroom",
        effect: {
          journeyStage: "reassurance",
          intent: "interested",
          sentiment: "positive",
          next: "qr_visit_when",
        },
      },
      {
        payload: "QR_WANT_CALL",
        label: "Call me",
        effect: {
          journeyStage: "reassurance",
          intent: "interested",
          sentiment: "positive",
          handoff: {
            task: "Customer asked for a call — ring them back today",
            severity: "critical",
            call: true,
          },
        },
      },
    ],
  },
  {
    key: "qr_offer_catalogue",
    templateName: "hde_qr_offer_catalogue",
    metaCategory: "MARKETING",
    title: "Offer catalogue",
    question:
      "No problem, {{1}}. Would you like our latest catalogue and this month's offers on {{2}}?",
    variables: ["first_name", "interest"],
    requiresApprovedTemplate: false,
    buttons: [
      {
        payload: "QR_CATALOGUE_YES",
        label: "Yes, send it",
        effect: {
          journeyStage: "exploration",
          intent: "interested",
          sentiment: "positive",
          handoff: {
            task: "Send the product catalogue and current offers",
            severity: "info",
          },
        },
      },
      {
        payload: "QR_REMIND_LATER",
        label: "Remind me later",
        effect: {
          journeyStage: "evaluation",
          intent: "neutral",
          sentiment: "neutral",
          snoozeDays: 14,
        },
      },
      STOP_BUTTON,
    ],
  },
  {
    key: "qr_visit_when",
    templateName: "hde_qr_visit_when",
    metaCategory: "UTILITY",
    title: "Showroom visit timing",
    question: "Lovely — when would you like to visit our {{1}} showroom?",
    variables: ["showroom"],
    requiresApprovedTemplate: false,
    buttons: [
      {
        payload: "QR_VISIT_TODAY",
        label: "Today / tomorrow",
        effect: {
          journeyStage: "decision",
          intent: "ready_to_buy",
          sentiment: "positive",
          handoff: {
            task: "Visit within 24h — confirm the slot and keep the piece ready",
            severity: "critical",
            call: true,
          },
        },
      },
      {
        payload: "QR_VISIT_WEEKEND",
        label: "This weekend",
        effect: {
          journeyStage: "decision",
          intent: "interested",
          sentiment: "positive",
          handoff: {
            task: "Weekend visit — confirm the day and block a sales person",
            severity: "warning",
          },
        },
      },
      {
        payload: "QR_VISIT_UNSURE",
        label: "Not sure yet",
        effect: {
          journeyStage: "evaluation",
          intent: "neutral",
          sentiment: "neutral",
          next: "qr_offer_catalogue",
        },
      },
    ],
  },
  {
    key: "qr_price_feedback",
    templateName: "hde_qr_price_feedback",
    metaCategory: "UTILITY",
    title: "Price feedback",
    question: "Hi {{1}}, did the price we shared for {{2}} work for you?",
    variables: ["first_name", "interest"],
    requiresApprovedTemplate: true,
    buttons: [
      {
        payload: "QR_PRICE_OK",
        label: "Yes, let's proceed",
        effect: {
          journeyStage: "decision",
          intent: "ready_to_buy",
          sentiment: "positive",
          handoff: {
            task: "Customer accepted the price — close the order today",
            severity: "critical",
            call: true,
          },
        },
      },
      {
        payload: "QR_PRICE_HIGH",
        label: "Above my budget",
        effect: {
          journeyStage: "reassurance",
          intent: "objection",
          sentiment: "negative",
          concern: "price",
          next: "qr_emi_offer",
        },
      },
      {
        payload: "QR_PRICE_THINKING",
        label: "Need some time",
        effect: {
          journeyStage: "evaluation",
          intent: "neutral",
          sentiment: "neutral",
          snoozeDays: 5,
        },
      },
    ],
  },
  {
    key: "qr_emi_offer",
    templateName: "hde_qr_emi_offer",
    metaCategory: "MARKETING",
    title: "EMI / offer rescue",
    question:
      "Understood, {{1}}. We have easy EMI and seasonal offers on {{2}}. Should I check the best option for you?",
    variables: ["first_name", "interest"],
    requiresApprovedTemplate: false,
    buttons: [
      {
        payload: "QR_EMI_YES",
        label: "Yes, check for me",
        effect: {
          journeyStage: "decision",
          intent: "interested",
          sentiment: "positive",
          concern: "price",
          handoff: {
            task: "Work out the best EMI / discount option and share it",
            severity: "warning",
          },
        },
      },
      {
        payload: "QR_EMI_NO",
        label: "Not right now",
        effect: {
          journeyStage: "evaluation",
          intent: "neutral",
          sentiment: "neutral",
          snoozeDays: 10,
        },
      },
      STOP_BUTTON,
    ],
  },
  {
    key: "qr_post_visit",
    templateName: "hde_qr_post_visit",
    metaCategory: "UTILITY",
    title: "After showroom visit",
    question: "Thanks for visiting us, {{1}}! Did you find what you were looking for?",
    variables: ["first_name"],
    requiresApprovedTemplate: true,
    buttons: [
      {
        payload: "QR_VISIT_LIKED",
        label: "Yes, liked it",
        effect: {
          journeyStage: "decision",
          intent: "ready_to_buy",
          sentiment: "positive",
          handoff: {
            task: "Liked it in the showroom — follow up with a quote and close",
            severity: "critical",
          },
        },
      },
      {
        payload: "QR_VISIT_DECIDING",
        label: "Still deciding",
        effect: {
          journeyStage: "reassurance",
          intent: "neutral",
          sentiment: "neutral",
          next: "qr_emi_offer",
        },
      },
      {
        payload: "QR_VISIT_NOT_FOUND",
        label: "Didn't find it",
        effect: {
          journeyStage: "exploration",
          intent: "objection",
          sentiment: "negative",
          concern: "design",
          handoff: {
            task: "Nothing matched in the showroom — suggest alternatives",
            severity: "warning",
          },
        },
      },
    ],
  },
  {
    key: "qr_nudge",
    templateName: "hde_qr_keep_enquiry_open",
    metaCategory: "MARKETING",
    title: "Silent lead nudge",
    question:
      "Hi {{1}}, one tap is all we need — should we keep your enquiry for {{2}} open?",
    variables: ["first_name", "interest"],
    requiresApprovedTemplate: true,
    buttons: [
      {
        payload: "QR_KEEP_OPEN",
        label: "Yes, keep it open",
        effect: {
          journeyStage: "exploration",
          intent: "interested",
          sentiment: "positive",
          next: "qr_what_helps",
        },
      },
      {
        payload: "QR_NOT_NOW",
        label: "Not right now",
        effect: {
          journeyStage: "cold",
          intent: "neutral",
          sentiment: "neutral",
          snoozeDays: 21,
        },
      },
      STOP_BUTTON,
    ],
  },
];

const STEP_BY_KEY: Record<string, QuickReplyStep> = {};
for (const step of QUICK_REPLY_STEPS) STEP_BY_KEY[step.key] = step;

export function getQuickReplyStep(key: string | null | undefined): QuickReplyStep | null {
  if (!key) return null;
  return STEP_BY_KEY[key] ?? null;
}

export function quickReplyStepKeys(): string[] {
  return QUICK_REPLY_STEPS.map((s) => s.key);
}

/** Free-text words that mean the same thing as tapping "Stop messages". */
const STOP_WORDS = ["stop", "unsubscribe", "band karo", "band kro", "mat bhejo", "do not message"];

export interface ResolvedQuickReply {
  step: QuickReplyStep | null;
  button: QuickReplyButton;
  /** How we matched: exact payload is the only fully trustworthy source. */
  matchedBy: "payload" | "label" | "stop_word";
}

/**
 * Turn an inbound WhatsApp message into a known flow answer, or null when the
 * customer typed something we should not pretend to understand.
 *
 * `stepKey` is the step the customer was actually replying to — resolve it from
 * the replied-to message SID, not from the lead's newest question.
 */
export function resolveQuickReply(opts: {
  stepKey?: string | null;
  payload?: string | null;
  buttonText?: string | null;
  body?: string | null;
}): ResolvedQuickReply | null {
  const payload = (opts.payload || "").trim();
  const step = getQuickReplyStep(opts.stepKey);

  // 1. Exact payload match — the only path that needs no interpretation.
  if (payload) {
    if (step) {
      const hit = step.buttons.find((b) => b.payload === payload);
      if (hit) return { step, button: hit, matchedBy: "payload" };
    }
    for (const s of QUICK_REPLY_STEPS) {
      const hit = s.buttons.find((b) => b.payload === payload);
      if (hit) return { step: s, button: hit, matchedBy: "payload" };
    }
  }

  // 2. Button text match, scoped to the step the customer was answering.
  //    Older WhatsApp clients echo the label without a payload.
  const label = (opts.buttonText || opts.body || "").trim().toLowerCase();
  if (label && step) {
    const hit = step.buttons.find((b) => b.label.toLowerCase() === label);
    if (hit) return { step, button: hit, matchedBy: "label" };
  }

  // 3. Typed opt-out. Honoured everywhere, flow or no flow.
  const typed = (opts.body || "").trim().toLowerCase();
  if (typed && STOP_WORDS.some((w) => typed === w || typed.startsWith(w + " "))) {
    return { step, button: STOP_BUTTON, matchedBy: "stop_word" };
  }

  return null;
}

/** The step to open a conversation with, or null when we should stay quiet. */
export function pickEntryStep(opts: {
  journeyStage: string | null;
  unansweredCount: number;
  daysSinceLastInbound: number;
  hasEverAnswered: boolean;
  lastVisitDaysAgo?: number | null;
  awaitingQuoteFeedback?: boolean;
}): string | null {
  const {
    journeyStage,
    unansweredCount,
    daysSinceLastInbound,
    hasEverAnswered,
    lastVisitDaysAgo,
    awaitingQuoteFeedback,
  } = opts;

  // Someone walked into the showroom — ask how it went while it is fresh.
  if (lastVisitDaysAgo != null && lastVisitDaysAgo >= 1 && lastVisitDaysAgo <= 3) {
    return "qr_post_visit";
  }
  // A quote went out and nobody replied to it.
  if (awaitingQuoteFeedback && daysSinceLastInbound >= 2) return "qr_price_feedback";
  // Going quiet on us: ask the one question that only needs a tap.
  if (unansweredCount >= 1 && daysSinceLastInbound >= 3) return "qr_nudge";
  // Never engaged, or cold: start at the top of the flow.
  if (!hasEverAnswered || journeyStage === "cold" || journeyStage === "problem") {
    return "qr_reengage";
  }
  if (journeyStage === "exploration" && daysSinceLastInbound >= 2) return "qr_what_helps";
  return null;
}

/** Fill a step's {{1}}, {{2}}, ... in the order the template declares them. */
export function buildContentVariables(
  step: QuickReplyStep,
  values: { first_name: string; interest: string; showroom: string },
): Record<string, string> {
  const out: Record<string, string> = {};
  step.variables.forEach((name, i) => {
    out[String(i + 1)] = values[name] ?? "";
  });
  return out;
}

/** Human-readable summary of an answer, for the lead card and the timeline. */
export function describeAnswer(payload: string | null | undefined): string | null {
  if (!payload) return null;
  for (const s of QUICK_REPLY_STEPS) {
    const b = s.buttons.find((x) => x.payload === payload);
    if (b) return b.label;
  }
  return null;
}

/**
 * Sample values submitted to Meta with each template. Meta requires a realistic
 * example for every placeholder, and rejects samples that look like markup.
 */
export const TEMPLATE_SAMPLE: Record<QuickReplyVariable, string> = {
  first_name: "Rahul",
  interest: "a 3-seater fabric sofa",
  showroom: "Dehradun",
};

export interface ContentApiPayload {
  friendly_name: string;
  language: string;
  variables: Record<string, string>;
  types: {
    "twilio/quick-reply": {
      body: string;
      actions: { title: string; id: string }[];
    };
  };
}

/**
 * Request body for POST https://content.twilio.com/v1/Content.
 *
 * Generating this from the flow is the point: the button `id` sent to Meta is
 * the same string the webhook matches on, so a template can never be approved
 * with payloads the lead board does not recognise.
 */
export function buildContentApiPayload(step: QuickReplyStep): ContentApiPayload {
  return {
    friendly_name: step.templateName,
    language: "en",
    variables: buildContentVariables(step, TEMPLATE_SAMPLE),
    types: {
      "twilio/quick-reply": {
        body: step.question,
        actions: step.buttons.map((b) => ({ title: b.label, id: b.payload })),
      },
    },
  };
}

/** Steps that must be approved by Meta before they can open a conversation. */
export function stepsNeedingApproval(): QuickReplyStep[] {
  return QUICK_REPLY_STEPS.filter((s) => s.requiresApprovedTemplate);
}
