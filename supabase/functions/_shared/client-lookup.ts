// Client lookup for the staff coach: "pull up the details for 98765 43210".
//
// Two halves:
//   - parseLookupRequest(): pure text parsing — pulls phone numbers / names out
//     of what the rep typed or said, and decides whether a lookup is wanted.
//   - runClientLookup(): reads the matching client's whole picture (lead,
//     deal, stage moves, WhatsApp messages, quotes, service jobs, orders, dues,
//     Elite card).
//
// SECURITY: runClientLookup() must be given a Supabase client that carries the
// REP'S OWN JWT (not the service role), so row-level security decides what the
// coach can see — exactly what the rep can already open in the app (their own
// leads and everything hanging off them, all Elite cards, dues, their own card
// bills). A number that only exists on another rep's lead comes back empty.

export interface LookupRequest {
  phones: string[]; // 10-digit numbers (exact) or 5-9 digit fragments (partial)
  names: string[]; // lower-cased name tokens
}

const INTENT = /\b(detail|details|contact|number|phone|mobile|info|information|profile|history|pull up|pull|look ?up|search|find|check|show|record|records|dikha|dikhao|batao|bata|nikalo|nikal|kaun|who)\b/i;
const PHONE_WORDS = /(phone|number|no\.|contact|mobile|digits|ending|starting|nambar|नंबर)/i;

const STOP = new Set([
  "details", "detail", "contact", "number", "phone", "mobile", "info", "information", "please", "pull", "show",
  "give", "tell", "find", "check", "look", "lookup", "search", "about", "client", "customer", "profile", "history",
  "bata", "batao", "dikha", "dikhao", "nikalo", "nikal", "kya", "hai", "mujhe", "aur", "the", "for", "and", "with",
  "his", "her", "record", "records", "full", "total", "all", "from", "this", "that", "what", "who", "kaun", "wala",
  "wali", "customer's", "client's", "sir", "mam", "madam", "ending", "starting", "digits", "kiska", "kiski", "kiske",
  "kaunsa", "konsa", "wale", "number", "numbers", "nambar", "please", "pls", "plz", "karo", "kijiye", "dena", "chahiye",
]);

export function parseLookupRequest(text: string): LookupRequest | null {
  const phones = new Set<string>();
  for (const m of text.matchAll(/(?:\+?\s?91[\s-]?)?\d[\d\s-]{3,}\d/g)) {
    let d = m[0].replace(/\D/g, "");
    if (d.length >= 12 && d.startsWith("91")) d = d.slice(-10);
    else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
    else if (d.length > 10) d = d.slice(-10);
    if (d.length === 10) phones.add(d);
    // A short digit run is usually an amount or a quantity; treat it as a
    // phone fragment only when the rep clearly talks about a number.
    else if (d.length >= 5 && PHONE_WORDS.test(text)) phones.add(d);
  }
  if (phones.size > 0) return { phones: [...phones].slice(0, 3), names: [] };

  if (!INTENT.test(text)) return null;
  const names = [...new Set(
    (text.toLowerCase().match(/[\p{L}]{3,}/gu) ?? []).filter((w) => !STOP.has(w) && !INTENT.test(w)),
  )].slice(0, 4);
  return names.length > 0 ? { phones: [], names } : null;
}

// ── data ────────────────────────────────────────────────────────────────────
const trim = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : v ?? null);

const LEAD_COLS =
  "id,customer_name,customer_phone,customer_email,category,value_in_rupees,status,journey_stage,source,source_type," +
  "next_follow_up_date,next_follow_up_time,last_follow_up,created_at,updated_at,notes,visit_date,visit_count," +
  "products_viewed,product_viewed,liked_product,stated_need,budget_range,decision_timeline,preferred_style," +
  "family_situation,price_sensitivity,objection_type,concern_type,conversion_probability,next_action_suggested," +
  "why_lost,messages_sent,last_response_at,needs_personal_call,repeat_customer,repeat_count,total_sales," +
  "first_purchase_date,last_purchase_date,elite_opted_in,elite_card_id,neighborhood";

type Db = any; // supabase-js client carrying the rep's JWT

async function safe<T>(label: string, errors: string[], q: PromiseLike<{ data: T | null; error: any }>): Promise<T | null> {
  try {
    const { data, error } = await q;
    if (error) {
      console.error("client-lookup", label, error.message);
      errors.push(label);
      return null;
    }
    return data;
  } catch (e) {
    console.error("client-lookup", label, e);
    errors.push(label);
    return null;
  }
}

async function leadPicture(db: Db, lead: any, errors: string[]) {
  const last10 = String(lead.customer_phone ?? "").replace(/\D/g, "").slice(-10);
  const [deal, stages, messages, quotes, jobs, orders] = await Promise.all([
    safe<any[]>("deal", errors, db.from("lead_deals").select("stage,next_step,next_step_due_date,close_reason,stage_started_at").eq("lead_id", lead.id).limit(1)),
    safe<any[]>("stage_history", errors, db.from("lead_stage_history").select("old_stage,new_stage,reason,changed_at").eq("lead_id", lead.id).order("changed_at", { ascending: false }).limit(8)),
    safe<any[]>("messages", errors, db.from("lead_messages").select("message_type,message_kind,status,sent_at,response_received,sentiment,intent,message_body").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(6)),
    safe<any[]>("quotes", errors, db.from("quotes").select("quote_number,status,grand_total,created_at,sent_at").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(5)),
    safe<any[]>("service_jobs", errors, db.from("service_jobs").select("type,category,status,date_to_attend,value,payment_status,amount_pending,invoice_number,description").eq("source_lead_id", lead.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(5)),
    safe<any[]>("orders", errors, db.from("hde_orders").select("order_number,order_type,status,qty_sold,due_date,created_at").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(5)),
  ]);
  const { notes, ...profile } = lead;
  return {
    profile: { ...profile, notes: trim(notes, 500) },
    deal: deal?.[0] ?? null,
    recent_stage_moves: stages ?? [],
    recent_messages: (messages ?? []).map((m) => ({ ...m, message_body: trim(m.message_body, 160) })),
    quotes: quotes ?? [],
    service_jobs: (jobs ?? []).map((j) => ({ ...j, description: trim(j.description, 120) })),
    orders: orders ?? [],
    _last10: last10,
  };
}

export async function runClientLookup(db: Db, req: LookupRequest) {
  const errors: string[] = [];
  const leadsById = new Map<string, any>();

  // 1. leads the rep can see, by phone (exact or fragment) or by name
  for (const p of req.phones) {
    const rows = await safe<any[]>("leads_by_phone", errors, db.from("leads").select(LEAD_COLS).ilike("customer_phone", `%${p}%`).is("deleted_at", null).order("updated_at", { ascending: false }).limit(6));
    (rows ?? []).forEach((r) => leadsById.set(r.id, r));
  }
  if (req.names.length > 0) {
    // All the words together first ("advocate gagan"); only if that finds
    // nothing, any one word.
    let all = db.from("leads").select(LEAD_COLS).is("deleted_at", null);
    for (const n of req.names) all = all.ilike("customer_name", `%${n}%`);
    let rows = await safe<any[]>("leads_by_name", errors, all.order("updated_at", { ascending: false }).limit(6));
    if (!rows?.length && req.names.length > 1) {
      rows = [];
      for (const n of req.names) {
        const r = await safe<any[]>("leads_by_name", errors, db.from("leads").select(LEAD_COLS).ilike("customer_name", `%${n}%`).is("deleted_at", null).order("updated_at", { ascending: false }).limit(4));
        rows.push(...(r ?? []));
      }
    }
    (rows ?? []).forEach((r) => leadsById.set(r.id, r));
  }
  const leads = [...leadsById.values()];

  // 2. full picture for up to 3 matches; the rest are listed briefly
  const detailed = await Promise.all(leads.slice(0, 3).map((l) => leadPicture(db, l, errors)));
  const others = leads.slice(3).map((l) => ({ id: l.id, customer: l.customer_name, phone: l.customer_phone, status: l.status }));

  // 3. records keyed by phone that may not belong to any visible lead
  const phoneKeys = new Set<string>(req.phones);
  detailed.forEach((d) => d._last10 && phoneKeys.add(d._last10));
  const elite: any[] = [];
  const dues: any[] = [];
  for (const p of phoneKeys) {
    const e = await safe<any[]>("elite", errors, db.from("elite_customers").select("customer_name,phone_1,phone_2,card_number,card_tier,status,card_issue_date,card_expiry_date,current_points,lifetime_points,date_of_birth,anniversary_date,notes").or(`phone_1.ilike.%${p}%,phone_2.ilike.%${p}%`).limit(3));
    (e ?? []).forEach((r) => elite.push({ ...r, notes: trim(r.notes, 200) }));
    const d = await safe<any[]>("dues", errors, db.from("customer_dues").select("customer_name,amount,due_type,description,created_at").ilike("customer_phone", `%${p}%`).eq("is_cleared", false).limit(5));
    (d ?? []).forEach((r) => dues.push({ ...r, description: trim(r.description, 120) }));
  }

  // 4. service jobs / orders by phone that aren't tied to a matched lead
  const linkedJobIds = new Set<string>();
  const unlinkedJobs: any[] = [];
  for (const p of phoneKeys) {
    const j = await safe<any[]>("jobs_by_phone", errors, db.from("service_jobs").select("id,type,category,status,date_to_attend,value,payment_status,amount_pending,customer_name").ilike("customer_phone", `%${p}%`).is("deleted_at", null).order("created_at", { ascending: false }).limit(5));
    (j ?? []).forEach((r) => { if (!linkedJobIds.has(r.id)) { linkedJobIds.add(r.id); unlinkedJobs.push(r); } });
  }

  const found = leads.length + elite.length + dues.length + unlinkedJobs.length;
  return {
    searched: req,
    found_anything: found > 0,
    matches: { leads: detailed.map(({ _last10, ...d }) => d), more_leads: others },
    elite_cards: elite,
    open_dues: dues,
    service_jobs_by_phone: unlinkedJobs,
    // Lets the coach say honestly what it couldn't load instead of guessing.
    failed_sections: [...new Set(errors)],
    scope_note: "Only records this rep is allowed to see. Another rep's lead for the same number is NOT visible here.",
  };
}
