import { describe, expect, it } from "vitest";
import {
  buildDeliveryReviewMessage,
  buildDrawWinnerMessage,
  buildKioskWelcomeMessage,
  buildWebsiteShareMessage,
  canUseKioskWelcomeTemplate,
  firstName,
  monthLabel,
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

describe("buildDeliveryReviewMessage", () => {
  it("greets by first name, includes the review link and a fix-it offer", () => {
    const msg = buildDeliveryReviewMessage({
      customerName: "priya sharma",
      reviewUrl: REVIEW_URL,
      businessPhone: "98765 43210",
    });
    expect(msg).toMatch(/^Hi Priya!/);
    expect(msg).toContain("delivered");
    expect(msg).toContain(REVIEW_URL);
    expect(msg).toContain("98765 43210");
  });

  it("falls back to reply-here when no phone is configured", () => {
    const msg = buildDeliveryReviewMessage({ customerName: "", reviewUrl: REVIEW_URL });
    expect(msg).toMatch(/^Hi there!/);
    expect(msg).toContain("just reply here and we will fix it");
  });
});

describe("buildWebsiteShareMessage", () => {
  const SITE = "https://hdefurniture.netlify.app";

  it("does not claim a review it cannot know about", () => {
    const msg = buildWebsiteShareMessage({ customerName: "amit", websiteUrl: SITE });
    expect(msg).not.toMatch(/your Google review/);
    expect(msg).toContain(SITE);
  });
});

describe("kiosk welcome website link", () => {
  const SITE = "https://hdefurniture.netlify.app";

  it("is included for happy and neutral visitors", () => {
    for (const overallRating of [3, 4, 5]) {
      expect(welcome({ overallRating, websiteUrl: SITE })).toContain(SITE);
    }
  });

  it("is placed after the review ask", () => {
    const msg = welcome({ websiteUrl: SITE });
    expect(msg.indexOf(SITE)).toBeGreaterThan(msg.indexOf(REVIEW_URL));
  });

  it("is never sent to an unhappy visitor", () => {
    expect(welcome({ overallRating: 1, websiteUrl: SITE })).not.toContain(SITE);
    expect(welcome({ overallRating: 2, websiteUrl: SITE })).not.toContain(SITE);
  });

  it("is left out when no website is configured", () => {
    expect(welcome({ websiteUrl: "" })).not.toContain("Browse our latest collections");
  });
});

describe("canUseKioskWelcomeTemplate", () => {
  const ok = {
    overallRating: 5,
    alreadyReviewed: false,
    reviewUrl: REVIEW_URL,
    websiteUrl: "https://hdefurniture.netlify.app",
    drawEnabled: true,
  };

  it("allows the template for a happy first-time reviewer", () => {
    expect(canUseKioskWelcomeTemplate(ok)).toBe(true);
    expect(canUseKioskWelcomeTemplate({ ...ok, overallRating: 4 })).toBe(true);
  });

  it("never sends the review-ask template to an unhappy or neutral visitor", () => {
    for (const overallRating of [1, 2, 3]) {
      expect(canUseKioskWelcomeTemplate({ ...ok, overallRating })).toBe(false);
    }
  });

  it("does not ask a past reviewer again", () => {
    expect(canUseKioskWelcomeTemplate({ ...ok, alreadyReviewed: true })).toBe(false);
  });

  it("falls back to free text when a link is missing or the draw is off", () => {
    expect(canUseKioskWelcomeTemplate({ ...ok, reviewUrl: "" })).toBe(false);
    expect(canUseKioskWelcomeTemplate({ ...ok, websiteUrl: "" })).toBe(false);
    expect(canUseKioskWelcomeTemplate({ ...ok, drawEnabled: false })).toBe(false);
  });
});
