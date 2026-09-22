// WhatsApp copy for the feedback kiosk.
//
// Kept free of Deno APIs on purpose: the edge function imports it, and
// src/test/kioskMessages.test.ts imports it straight from vitest so the wording
// and the rules around it (never ask a one-star visitor for a Google review,
// never ask twice) stay covered.

export const DEFAULT_BUSINESS_NAME = "Home Decor Enterprises";
export const DEFAULT_MIN_DRAW_ENTRIES = 50;
/**
 * Only genuinely happy visitors are asked for a public Google review. Below
 * this we say thank you and ask how we can do better instead.
 */
export const REVIEW_ASK_MIN_RATING = 4;

export interface WelcomeMessageInput {
  customerName: string;
  businessName?: string;
  /** Google review link. Omitted/blank = the review ask is skipped. */
  reviewUrl?: string | null;
  /** True when this customer has already left us a review before. */
  alreadyReviewed?: boolean;
  overallRating: number;
  businessPhone?: string | null;
  drawEnabled?: boolean;
  drawPrize?: string | null;
  minDrawEntries?: number;
}

export interface WinnerMessageInput {
  customerName: string;
  businessName?: string;
  /** First day of the month the draw covered, e.g. "2026-08-01". */
  drawMonth: string;
  totalEntries: number;
  prize?: string | null;
  businessPhone?: string | null;
}

/** "rahul kumar" → "Rahul". Falls back to a friendly "there". */
export function firstName(name?: string | null): string {
  const part = (name || "").trim().split(/\s+/)[0] || "";
  if (!part) return "there";
  return part.charAt(0).toUpperCase() + part.slice(1);
}

/** "2026-08-01" → "August 2026". */
export function monthLabel(month: string): string {
  const d = new Date(`${String(month).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(month);
  return d.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const signOff = (businessName: string) =>
  `Warm regards,\n${businessName}\nAuthorised Godrej Interio showroom, Dehradun`;

function drawParagraph(
  prize: string,
  minEntries: number,
  alreadyEntered: boolean,
): string {
  const lead = alreadyEntered
    ? "🎁 That review also puts you into our *monthly lucky draw*."
    : "🎁 Every customer who leaves us a Google review goes into our *monthly lucky draw*.";
  return (
    `${lead} We pick one winner in the first week of every month and announce it right here on WhatsApp. ` +
    `Winner gets ${prize}.\n` +
    `(The draw runs in any month that gets at least ${minEntries} review entries.)`
  );
}

/**
 * The message that goes out the moment a customer enters their name and number
 * at the kiosk. Personalised, and tuned to what they just told us:
 *   • 1–2 stars  → apology and a callback offer, no review ask. Asking an
 *                  unhappy customer for a public review is how you get a
 *                  one-star review.
 *   • 3 stars    → thank you, and an open question about what to improve.
 *   • 4–5 stars  → thank you, review ask (unless they have already reviewed),
 *                  and the lucky-draw explainer.
 */
export function buildKioskWelcomeMessage(input: WelcomeMessageInput): string {
  const name = firstName(input.customerName);
  const business = input.businessName?.trim() || DEFAULT_BUSINESS_NAME;
  const reviewUrl = (input.reviewUrl || "").trim();
  const minEntries = input.minDrawEntries ?? DEFAULT_MIN_DRAW_ENTRIES;
  const prize = (input.drawPrize || "").trim() || `a special gift from ${business}`;
  const drawEnabled = input.drawEnabled !== false;
  const parts: string[] = [];

  if (input.overallRating <= 2) {
    parts.push(`Hi ${name},`);
    parts.push(
      `Thank you for visiting ${business} today, and thank you for being honest with us. ` +
        `We are sorry your visit did not go the way it should have.`,
    );
    parts.push(
      "Your feedback has gone straight to our owner. Please tell us what went wrong — we would like the chance to set it right.",
    );
    if (input.businessPhone) {
      parts.push(`You can reply to this message or call us on ${input.businessPhone}.`);
    } else {
      parts.push("Simply reply to this message and we will call you back.");
    }
    parts.push(signOff(business));
    return parts.join("\n\n");
  }

  parts.push(`Hi ${name}! 🙏`);
  parts.push(
    `Thank you for visiting ${business} today. It was a pleasure having you at our showroom, ` +
      `and thank you for taking a moment to share your feedback.`,
  );
  parts.push("We read every single response, and we promise to serve you better each day. 💙");

  if (input.overallRating < REVIEW_ASK_MIN_RATING) {
    parts.push(
      "Is there anything we could have done better today? Just reply to this message — it goes straight to our team.",
    );
  } else if (input.alreadyReviewed) {
    parts.push("⭐ Thank you for the Google review you left us earlier — it means a lot to our team.");
    if (drawEnabled) parts.push(drawParagraph(prize, minEntries, true));
  } else if (reviewUrl) {
    parts.push(
      `⭐ Could you spare 30 seconds to leave us a Google review? For a family-run showroom like ours ` +
        `it makes a real difference:\n${reviewUrl}`,
    );
    if (drawEnabled) parts.push(drawParagraph(prize, minEntries, false));
  }

  parts.push(
    "Need anything at all — sizes, prices, delivery dates or a fresh quote — just reply to this message and our team will help you right away.",
  );
  parts.push(signOff(business));
  return parts.join("\n\n");
}

/** Sent to the winner as soon as the monthly draw is run. */
export function buildDrawWinnerMessage(input: WinnerMessageInput): string {
  const name = firstName(input.customerName);
  const business = input.businessName?.trim() || DEFAULT_BUSINESS_NAME;
  const prize = (input.prize || "").trim() || `a special gift from ${business}`;
  const others = Math.max(0, (input.totalEntries || 1) - 1);

  return [
    `🎉 Congratulations ${name}!`,
    `You have won the ${business} monthly lucky draw for ${monthLabel(input.drawMonth)}. 🏆`,
    others > 0
      ? `Your Google review entered you into the draw along with ${others} other customers, and your name came out on top.`
      : "Your Google review entered you into the draw, and your name came out on top.",
    `Your prize: ${prize}`,
    input.businessPhone
      ? `Reply to this message or call us on ${input.businessPhone} and our team will arrange for you to collect it.`
      : "Reply to this message and our team will arrange for you to collect it.",
    `Thank you for supporting us 🙏\n${business}`,
  ].join("\n\n");
}
