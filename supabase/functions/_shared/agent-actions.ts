import { validateFollowUp, type AgentActionInput } from "./agent-text.ts";

// supabase-js client (service role). Typed loosely so the unit tests can pass a fake.
// deno-lint-ignore no-explicit-any
type Db = any;

// ── apply agent actions, limited to the rep's own leads ─────────────────────
// Every action ends up in exactly one of two lists: applied (and verified by
// re-reading the saved row) or rejected with a plain-language reason. Nothing is
// dropped silently — the rep is told about both, so the coach can never claim a
// follow-up that wasn't saved.
export interface AppliedAction {
  type: string;
  ok: boolean;
  lead_id?: string;
  customer?: string;
  date?: string;
  time?: string | null;
  from?: string | null;
  text?: string;
  reason?: string;
}

export async function applyActions(
  admin: Db,
  userId: string,
  actions: AgentActionInput[],
  today: string,
): Promise<{ applied: AppliedAction[]; rejected: AppliedAction[] }> {
  const applied: AppliedAction[] = [];
  const rejected: AppliedAction[] = [];

  for (const a of actions.slice(0, 6)) {
    const type = typeof a?.type === "string" ? a.type : "";
    if (type !== "add_note" && type !== "set_follow_up") continue;
    const reject = (reason: string, customer?: string) =>
      rejected.push({ type, ok: false, lead_id: typeof a.lead_id === "string" ? a.lead_id : undefined, customer, reason });

    if (typeof a.lead_id !== "string") {
      reject("I couldn't tell which lead you meant");
      continue;
    }
    const { data: lead } = await admin
      .from("leads")
      .select("id,customer_name,status,notes,assigned_to,created_by,next_follow_up_date,next_follow_up_time")
      .eq("id", a.lead_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lead || (lead.assigned_to !== userId && lead.created_by !== userId)) {
      reject("that lead isn't one of yours");
      continue;
    }

    if (type === "add_note") {
      const text = typeof a.text === "string" ? a.text.trim().slice(0, 300) : "";
      if (!text) {
        reject("the note was empty", lead.customer_name);
        continue;
      }
      const stamp = `[${today} coach] ${text}`;
      const notes = lead.notes ? `${lead.notes}\n${stamp}` : stamp;
      const { error } = await admin.from("leads").update({ notes, updated_by: userId }).eq("id", lead.id);
      if (error) reject("saving failed", lead.customer_name);
      else applied.push({ type, ok: true, lead_id: lead.id, customer: lead.customer_name, text });
      continue;
    }

    // set_follow_up
    if (["won", "lost"].includes(String(lead.status))) {
      reject(`that lead is already ${lead.status}`, lead.customer_name);
      continue;
    }
    const check = validateFollowUp(a.date, a.time, today);
    if (!check.ok || !check.date) {
      reject(check.reason ?? "the date wasn't clear", lead.customer_name);
      continue;
    }
    const update: Record<string, unknown> = { next_follow_up_date: check.date, updated_by: userId };
    if (check.time) update.next_follow_up_time = check.time;
    // Same recovery the app applies when a date is moved to today or later.
    if (lead.status === "overdue") update.status = "follow_up";
    const { data: saved, error } = await admin
      .from("leads")
      .update(update)
      .eq("id", lead.id)
      .select("next_follow_up_date,next_follow_up_time")
      .single();
    if (error || saved?.next_follow_up_date !== check.date) {
      reject("saving failed", lead.customer_name);
      continue;
    }
    applied.push({
      type,
      ok: true,
      lead_id: lead.id,
      customer: lead.customer_name,
      date: check.date,
      time: saved.next_follow_up_time ? String(saved.next_follow_up_time).slice(0, 5) : null,
      from: lead.next_follow_up_date ?? null,
    });
  }
  return { applied, rejected };
}
