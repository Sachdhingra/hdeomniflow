// What counts as a person's own CRM activity. Pure, shared by the coach (so it
// doesn't praise phantom work) and the admin dashboard (so numbers are fair).

// The app flips a lead's status automatically when its follow-up date passes
// (-> overdue) and back (overdue -> follow_up) once the date moves forward, and it
// does so from whichever rep's phone has the app open, stamping that rep as the
// updater. Those flips are not something the rep did.
export const isAutoStatusFlip = (oldStage: string | null | undefined, newStage: string | null | undefined): boolean =>
  newStage === "overdue" || (oldStage === "overdue" && newStage === "follow_up");

const AUTO_WINDOW_MS = 5_000;

// Was this lead's latest update (updated_at) just an automatic flip? `autoFlipTimes`
// maps lead id -> times (ms) of automatic status changes recorded for it.
export function isAutoTouch(leadId: string, updatedAtMs: number, autoFlipTimes: Map<string, number[]>): boolean {
  return (autoFlipTimes.get(leadId) ?? []).some((t) => Math.abs(t - updatedAtMs) <= AUTO_WINDOW_MS);
}

export function autoFlipTimesByLead(
  rows: { lead_id: string; old_stage: string | null; new_stage: string | null; changed_at: string }[],
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    if (!isAutoStatusFlip(r.old_stage, r.new_stage)) continue;
    map.set(r.lead_id, [...(map.get(r.lead_id) ?? []), Date.parse(r.changed_at)]);
  }
  return map;
}
