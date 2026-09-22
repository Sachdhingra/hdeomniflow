import { describe, expect, it } from "vitest";
import {
  buildDrawWinnerMessage,
  buildKioskWelcomeMessage,
  firstName,
  monthLabel,
  welcomeVariant,
} from "../../supabase/functions/_shared/kiosk-messages";
import {
  currentDrawMonth,
  drawEligibility,
  previousDrawMonth,
} from "@/lib/monthlyDraw";

const REVIEW_URL = "https://g.page/r/CSD4GHiNc4IUEAE/review";

const welcome = (over: Partial<Parameters<typeof buildKioskWelcomeMessage>[0]> = {}) =>
  buildKioskWelcomeMessage({
    customerName: "rahul kumar",
    reviewUrl: REVIEW_URL,
    overallRating: 5,
    drawPrize: "a ₹2,000 gift voucher",
    minDrawEntries: 50,
    ...over,
  });

describe("kiosk welcome message", () => {
  it("greets the customer by first name, capitalised", () => {
    expect(welcome()).toContain("Hi Rahul!");
    expect(firstName("  ")).toBe("there");
  });

  it("thanks them for visiting and promises to improve", () => {
    const msg = welcome();
    expect(msg).toContain("Thank you for visiting Home Decor Enterprises");
    expect(msg).toContain("serve you better each day");
  });

  it("asks a happy customer for a Google review and links it", () => {
    const msg = welcome({ overallRating: 4 });
    expect(msg).toContain("Google review");
    expect(msg).toContain(REVIEW_URL);
  });

  it("explains the monthly draw, its prize and the entry threshold", () => {
    const msg = welcome();
    expect(msg).toContain("monthly lucky draw");
    expect(msg).toContain("a ₹2,000 gift voucher");
    expect(msg).toContain("at least 50 review entries");
    expect(msg).toContain("first week of every month");
  });

  it("does not ask again when the customer already reviewed us", () => {
    const msg = welcome({ alreadyReviewed: true });
    expect(msg).not.toContain(REVIEW_URL);
    expect(msg).toContain("Thank you for the Google review you left us earlier");
    // They are still told about the draw their review entered them into.
    expect(msg).toContain("monthly lucky draw");
  });

  it("never asks an unhappy customer for a public review", () => {
    for (const rating of [1, 2]) {
      const msg = welcome({ overallRating: rating, businessPhone: "0135-2721000" });
      expect(msg).not.toContain(REVIEW_URL);
      expect(msg).not.toContain("lucky draw");
      expect(msg).toContain("sorry");
      expect(msg).toContain("0135-2721000");
    }
  });

  it("thanks a 3-star visitor without a review ask", () => {
    const msg = welcome({ overallRating: 3 });
    expect(msg).not.toContain(REVIEW_URL);
    expect(msg).toContain("Thank you for visiting");
    expect(msg).toContain("anything we could have done better");
  });

  it("skips the review ask entirely when no review URL is configured", () => {
    const msg = welcome({ reviewUrl: "" });
    expect(msg).not.toContain("Google review");
    expect(msg).toContain("Thank you for visiting");
  });

  it("can have the draw switched off without losing the review ask", () => {
    const msg = welcome({ drawEnabled: false });
    expect(msg).toContain(REVIEW_URL);
    expect(msg).not.toContain("lucky draw");
  });
});

describe("welcome variant routing", () => {
  // Each variant maps to its own approved WhatsApp template, so getting this
  // wrong would send "please leave us a Google review" to a one-star visitor.
  const variant = (over: Parameters<typeof welcomeVariant>[0]) => welcomeVariant(over);

  it("routes unhappy visits to service recovery", () => {
    expect(variant({ customerName: "A", overallRating: 1, reviewUrl: REVIEW_URL })).toBe("recovery");
    expect(variant({ customerName: "A", overallRating: 2, reviewUrl: REVIEW_URL })).toBe("recovery");
  });

  it("routes a middling visit to plain thanks", () => {
    expect(variant({ customerName: "A", overallRating: 3, reviewUrl: REVIEW_URL })).toBe("thanks");
  });

  it("routes a happy new reviewer to the review ask", () => {
    expect(variant({ customerName: "A", overallRating: 4, reviewUrl: REVIEW_URL })).toBe("review_ask");
    expect(variant({ customerName: "A", overallRating: 5, reviewUrl: REVIEW_URL })).toBe("review_ask");
  });

  it("routes a happy repeat reviewer away from the ask", () => {
    expect(
      variant({ customerName: "A", overallRating: 5, reviewUrl: REVIEW_URL, alreadyReviewed: true }),
    ).toBe("already_reviewed");
  });

  it("falls back to plain thanks when no review link is configured", () => {
    expect(variant({ customerName: "A", overallRating: 5, reviewUrl: "" })).toBe("thanks");
  });

  it("agrees with the message the builder actually produces", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const msg = welcome({ overallRating: rating });
      const asksForReview = msg.includes(REVIEW_URL);
      expect(asksForReview).toBe(
        variant({ customerName: "rahul", overallRating: rating, reviewUrl: REVIEW_URL }) ===
          "review_ask",
      );
    }
  });
});

describe("draw winner message", () => {
  it("names the winner, the month, the prize and the field size", () => {
    const msg = buildDrawWinnerMessage({
      customerName: "priya sharma",
      drawMonth: "2026-08-01",
      totalEntries: 64,
      prize: "a ₹2,000 gift voucher",
    });
    expect(msg).toContain("Congratulations Priya!");
    expect(msg).toContain("August 2026");
    expect(msg).toContain("a ₹2,000 gift voucher");
    expect(msg).toContain("63 other customers");
  });

  it("does not talk about other customers when there was only one entry", () => {
    const msg = buildDrawWinnerMessage({
      customerName: "Priya",
      drawMonth: "2026-08-01",
      totalEntries: 1,
    });
    expect(msg).not.toContain("other customers");
  });

  it("formats the month key for display", () => {
    expect(monthLabel("2026-01-01")).toBe("January 2026");
  });
});

describe("draw eligibility", () => {
  it("holds the draw back below the entry threshold", () => {
    const e = drawEligibility(49, 50);
    expect(e.eligible).toBe(false);
    expect(e.remaining).toBe(1);
    expect(e.progressPct).toBe(98);
  });

  it("runs at exactly the threshold and above it", () => {
    expect(drawEligibility(50, 50).eligible).toBe(true);
    expect(drawEligibility(120, 50).eligible).toBe(true);
    expect(drawEligibility(120, 50).progressPct).toBe(100);
  });

  it("defaults to 50 entries when the setting is missing or nonsense", () => {
    expect(drawEligibility(49).eligible).toBe(false);
    expect(drawEligibility(50).eligible).toBe(true);
    expect(drawEligibility(50, 0).eligible).toBe(true);
  });
});

describe("draw month keys", () => {
  it("keys months by their first day", () => {
    expect(currentDrawMonth(new Date("2026-09-21T12:00:00Z"))).toBe("2026-09-01");
    expect(previousDrawMonth(new Date("2026-09-03T12:00:00Z"))).toBe("2026-08-01");
  });

  it("rolls back across a year boundary", () => {
    expect(previousDrawMonth(new Date("2026-01-04T12:00:00Z"))).toBe("2025-12-01");
  });
});
