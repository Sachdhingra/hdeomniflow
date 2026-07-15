/**
 * loyalty-cron — Daily batch job for Elite Card Loyalty.
 *
 * Triggered by pg_cron at 02:30 UTC (08:00 IST) every day.
 * Also callable manually via POST with x-internal-secret header.
 *
 * Steps:
 *   1. Expire overdue points (fn_expire_points)
 *   2. Award anniversary bonuses (fn_award_anniversary_bonus)
 *   3. Push: points expiring in 30 / 7 days
 *   4. Push: card expiring in 60 / 30 days
 *   5. Push: dormant customers (last_purchase_date > 180 days ago)
 *   6. Push: today's birthdays
 *   7. Push: redemption reminder for customers with unredeemed points
 *
 * Each push step can be switched on/off by admin via the
 * push_automation_settings table (Admin → Push Notifications page).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("LOYALTY_CRON_SECRET") ?? "";
// send-push lives in the same project; call it via internal URL
const SEND_PUSH_URL   = `${SUPABASE_URL}/functions/v1/send-push`;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendPush(
  customerId: string,
  type: string,
  title: string,
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const resp = await fetch(SEND_PUSH_URL, {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ customer_id: customerId, type, title, message, data }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.warn(`send-push failed for ${customerId}: ${resp.status} ${t}`);
    }
  } catch (e) {
    console.error(`send-push fetch error for ${customerId}:`, e);
  }
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Admin on/off switches for each automated reminder.
 * Missing table or missing rows default to enabled so the cron keeps
 * working even before the settings migration has run.
 */
async function loadAutomationSettings(): Promise<Record<string, boolean>> {
  const settings: Record<string, boolean> = {};
  try {
    const { data, error } = await supabase
      .from("push_automation_settings")
      .select("key, enabled");
    if (error) {
      console.warn("push_automation_settings load failed (defaulting to enabled):", error.message);
      return settings;
    }
    for (const row of data ?? []) {
      settings[row.key as string] = row.enabled as boolean;
    }
  } catch (e) {
    console.warn("push_automation_settings load error:", e);
  }
  return settings;
}

function isEnabled(settings: Record<string, boolean>, key: string): boolean {
  return settings[key] !== false;
}

// ---------------------------------------------------------------------------
// Step 1: Expire overdue points
// ---------------------------------------------------------------------------
async function expirePoints(): Promise<number> {
  const { data, error } = await supabase.rpc("fn_expire_points");
  if (error) {
    console.error("fn_expire_points error:", error.message);
    return 0;
  }
  return (data as number) ?? 0;
}

// ---------------------------------------------------------------------------
// Step 2: Award anniversary bonuses + push for each winner
// ---------------------------------------------------------------------------
async function awardAnniversaryBonuses(pushEnabled: boolean): Promise<number> {
  // Run the DB function first (idempotent) — points are always credited;
  // only the push notification is subject to the admin toggle.
  const { data, error } = await supabase.rpc("fn_award_anniversary_bonus");
  if (error) {
    console.error("fn_award_anniversary_bonus error:", error.message);
    return 0;
  }

  if (!pushEnabled) return (data as number) ?? 0;

  // Identify who received it today and push them
  const today = isoDate(new Date());
  const { data: rows } = await supabase
    .from("card_points")
    .select("customer_id, points, elite_customers!inner(customer_name)")
    .eq("transaction_type", "anniversary_bonus")
    .gte("created_at", `${today}T00:00:00Z`)
    .lt("created_at",  `${today}T23:59:59Z`);

  for (const row of rows ?? []) {
    const name   = (row.elite_customers as { customer_name: string }).customer_name;
    const points = row.points as number;
    await sendPush(
      row.customer_id as string,
      "anniversary_bonus",
      "Happy Anniversary! 🎉",
      `Congratulations ${name}! You've earned ${points} bonus loyalty points on your card anniversary.`,
      { points },
    );
  }

  return (data as number) ?? 0;
}

// ---------------------------------------------------------------------------
// Step 3: Points expiring in 30 / 7 days
// ---------------------------------------------------------------------------
async function notifyExpiringPoints(): Promise<void> {
  const today = new Date();

  for (const daysAhead of [30, 7]) {
    const targetDate = isoDate(addDays(today, daysAhead));

    // Sum points per customer that expire on exactly targetDate
    const { data: rows, error } = await supabase
      .from("card_points")
      .select("customer_id, points, elite_customers!inner(customer_name)")
      .eq("transaction_type", "purchase")
      .eq("is_expired", false)
      .gte("expires_at", `${targetDate}T00:00:00Z`)
      .lt( "expires_at", `${targetDate}T23:59:59Z`);

    if (error) {
      console.error(`Points expiry ${daysAhead}d error:`, error.message);
      continue;
    }

    // Aggregate by customer_id
    const byCustomer: Record<string, { name: string; points: number }> = {};
    for (const row of rows ?? []) {
      const cid = row.customer_id as string;
      const nm  = (row.elite_customers as { customer_name: string }).customer_name;
      if (!byCustomer[cid]) byCustomer[cid] = { name: nm, points: 0 };
      byCustomer[cid].points += row.points as number;
    }

    for (const [cid, { name, points }] of Object.entries(byCustomer)) {
      await sendPush(
        cid,
        "points_expiring",
        `Points expiring in ${daysAhead} days`,
        `Hi ${name}, ${points} loyalty point${points !== 1 ? "s" : ""} will expire in ${daysAhead} days. Redeem them before they lapse!`,
        { days_until_expiry: daysAhead, expiring_points: points },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Step 4: Card expiring in 60 / 30 days
// ---------------------------------------------------------------------------
async function notifyCardExpiry(): Promise<void> {
  const today = new Date();

  for (const daysAhead of [60, 30]) {
    const targetDate = isoDate(addDays(today, daysAhead));

    const { data: rows, error } = await supabase
      .from("elite_customers")
      .select("id, customer_name, card_tier")
      .eq("status", "active")
      .gte("card_expiry_date", `${targetDate}T00:00:00Z`)
      .lt( "card_expiry_date", `${targetDate}T23:59:59Z`);

    if (error) {
      console.error(`Card expiry ${daysAhead}d error:`, error.message);
      continue;
    }

    for (const row of rows ?? []) {
      const tier = (row.card_tier as string)
        .replace("_", " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      await sendPush(
        row.id as string,
        "card_expiring",
        `Your ${tier} card expires in ${daysAhead} days`,
        `Hi ${row.customer_name}, your Elite Card expires in ${daysAhead} days. Visit the store to renew and continue enjoying exclusive benefits!`,
        { days_until_expiry: daysAhead, card_tier: row.card_tier },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Step 5: Dormant customers (no purchase in 180 days)
// ---------------------------------------------------------------------------
async function notifyDormantCustomers(): Promise<void> {
  const cutoff = isoDate(addDays(new Date(), -180));

  const { data: rows, error } = await supabase
    .from("elite_customers")
    .select("id, customer_name")
    .eq("status", "active")
    .eq("app_activated", true)
    .or(`last_purchase_date.lt.${cutoff},last_purchase_date.is.null`);

  if (error) {
    console.error("Dormant customers error:", error.message);
    return;
  }

  // Avoid spamming: only push once per 30 days by checking push log
  const today = isoDate(new Date());
  const thirtyDaysAgo = isoDate(addDays(new Date(), -30));

  for (const row of rows ?? []) {
    // Check if we already sent a dormancy push in the last 30 days
    const { count } = await supabase
      .from("push_notifications_log")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", row.id)
      .eq("notification_type", "dormant")
      .gte("sent_at", `${thirtyDaysAgo}T00:00:00Z`);

    if ((count ?? 0) > 0) continue;

    await sendPush(
      row.id as string,
      "dormant",
      "We miss you! 🛋️",
      `Hi ${row.customer_name}, it's been a while! Visit our store and use your Elite Card for exclusive discounts on your next purchase.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Step 6: Birthday notifications
// ---------------------------------------------------------------------------
async function notifyBirthdays(): Promise<void> {
  const today = new Date();
  const month = today.getUTCMonth() + 1;
  const day   = today.getUTCDate();

  // PostgreSQL EXTRACT — use raw filter via RPC to avoid exposing month/day
  // Alternative: fetch active customers with app_activated and filter in-process.
  // We use Supabase filter with cast-free approach: compare formatted strings.
  const { data: rows, error } = await supabase
    .from("elite_customers")
    .select("id, customer_name, date_of_birth")
    .eq("status", "active")
    .eq("app_activated", true)
    .not("date_of_birth", "is", null);

  if (error) {
    console.error("Birthday query error:", error.message);
    return;
  }

  for (const row of rows ?? []) {
    const dob = new Date(row.date_of_birth as string);
    if (dob.getUTCMonth() + 1 !== month || dob.getUTCDate() !== day) continue;

    // Idempotency: skip if already pushed today
    const todayStr = isoDate(today);
    const { count } = await supabase
      .from("push_notifications_log")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", row.id)
      .eq("notification_type", "birthday")
      .gte("sent_at", `${todayStr}T00:00:00Z`);

    if ((count ?? 0) > 0) continue;

    await sendPush(
      row.id as string,
      "birthday",
      "Happy Birthday! 🎂",
      `Many happy returns of the day, ${row.customer_name}! As our valued Elite Card member, enjoy a special birthday surprise in-store today.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Step 7: Redemption reminder — customers holding unredeemed points
// ---------------------------------------------------------------------------
async function notifyPointsBalance(): Promise<void> {
  const { data: rows, error } = await supabase
    .from("elite_customers")
    .select("id, customer_name, current_points")
    .eq("status", "active")
    .eq("app_activated", true)
    .gt("current_points", 0);

  if (error) {
    console.error("Points balance query error:", error.message);
    return;
  }

  // Only remind once per 30 days per customer
  const thirtyDaysAgo = isoDate(addDays(new Date(), -30));

  for (const row of rows ?? []) {
    const { count } = await supabase
      .from("push_notifications_log")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", row.id)
      .eq("notification_type", "points_balance")
      .gte("sent_at", `${thirtyDaysAgo}T00:00:00Z`);

    if ((count ?? 0) > 0) continue;

    const points = row.current_points as number;
    await sendPush(
      row.id as string,
      "points_balance",
      "You have points waiting! 💰",
      `Hi ${row.customer_name}, you have ${points} loyalty point${points !== 1 ? "s" : ""} ready to redeem. Visit the store and turn them into savings on your next purchase!`,
      { current_points: points },
    );
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "x-internal-secret, Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Only cron (internal secret) may invoke this
  const incomingSecret = req.headers.get("x-internal-secret");
  if (!INTERNAL_SECRET || incomingSecret !== INTERNAL_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  console.log("[loyalty-cron] Starting daily run:", new Date().toISOString());

  const results: Record<string, unknown> = {};

  // Admin toggles from Admin → Push Notifications (default: all enabled)
  const settings = await loadAutomationSettings();

  // 1. Expire points
  results.expired_rows = await expirePoints();
  console.log("[loyalty-cron] Expired rows:", results.expired_rows);

  // 2. Anniversary bonuses (points always credited; push obeys toggle)
  results.anniversary_bonuses = await awardAnniversaryBonuses(
    isEnabled(settings, "anniversary_bonus"),
  );
  console.log("[loyalty-cron] Anniversary bonuses:", results.anniversary_bonuses);

  // 3–7. Push notifications (failures are logged but don't abort the run)
  if (isEnabled(settings, "points_expiring")) await notifyExpiringPoints();
  if (isEnabled(settings, "card_expiring"))   await notifyCardExpiry();
  if (isEnabled(settings, "dormant"))         await notifyDormantCustomers();
  if (isEnabled(settings, "birthday"))        await notifyBirthdays();
  if (isEnabled(settings, "points_balance"))  await notifyPointsBalance();

  console.log("[loyalty-cron] Completed:", new Date().toISOString(), results);

  return json({ ok: true, ...results });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
