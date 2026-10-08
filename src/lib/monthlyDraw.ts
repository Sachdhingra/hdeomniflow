/**
 * Helpers for the Google-review monthly lucky draw.
 *
 * Months are keyed by their first day ("2026-09-01") in IST, which is what
 * review_draw_entries.draw_month and monthly_draws.draw_month store — the
 * showroom is in Dehradun, so a visit at 11pm on the 31st belongs to that
 * month, not to the next one as UTC would have it.
 */

export const DEFAULT_MIN_DRAW_ENTRIES = 50;

/** Now, shifted into IST, so month boundaries match the database's. */
function nowInIst(): Date {
  const now = new Date();
  return new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
}

function monthKey(year: number, monthIndex: number): string {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** First day of the month we are currently collecting entries for. */
export function currentDrawMonth(reference?: Date): string {
  const d = reference ?? nowInIst();
  return monthKey(d.getFullYear(), d.getMonth());
}

/** First day of the month whose winner is drawn in the first week of this one. */
export function previousDrawMonth(reference?: Date): string {
  const d = reference ?? nowInIst();
  return monthKey(d.getFullYear(), d.getMonth() - 1);
}

/** "2026-09-01" → "September 2026". */
export function monthLabel(month: string): string {
  const d = new Date(`${String(month).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(month);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface DrawEligibility {
  eligible: boolean;
  remaining: number;
  progressPct: number;
}

/** A month is only drawn once it has at least `minEntries` review entries. */
export function drawEligibility(
  entries: number,
  minEntries: number = DEFAULT_MIN_DRAW_ENTRIES,
): DrawEligibility {
  const safeMin = minEntries > 0 ? minEntries : DEFAULT_MIN_DRAW_ENTRIES;
  const count = Math.max(0, entries || 0);
  return {
    eligible: count >= safeMin,
    remaining: Math.max(0, safeMin - count),
    progressPct: Math.min(100, Math.round((count / safeMin) * 100)),
  };
}
