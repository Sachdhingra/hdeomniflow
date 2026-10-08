# OTP-Gated Point Redemption

Replaces the accounts pre-approval flow with an OTP verified at the counter.
Status: ledger fix, customer write hardening, points rules and the OTP BACKEND are LIVE
(see the last sections). The STAFF screen and the referral bonus are built (referral
migration pending on production). The customer screen is not built yet.

## Why this exists

The current flow is broken in three ways, all traced to the same root cause:
no code path ever sets `redemption_request_id` on a bill entry.

1. **Points are never deducted.** The `-points` ledger insert lives inside
   `IF NEW.redemption_request_id IS NOT NULL` in `fn_credit_or_reverse_points`.
   That branch is unreachable from the UI, so a customer gets the rupee
   discount and keeps the points.
2. **Requests never reach `used`.** Same dead branch. Every approved request
   sits at `approved` forever, and because an active request blocks new ones,
   each customer is permanently locked out after their first redemption.
3. **The discount is free text.** `CardBillEntries.tsx` writes a typed
   `redemption_amount` with nothing tying it to an approved request.

Pre-approval was meant to be the control, but it gates the wrong moment: it
happens at a desk hours before the customer is at the counter, and it cannot
verify the person standing there. An OTP verified at the till does both jobs —
it proves consent *and* it is the event that consumes the voucher.

## Decisions taken

| Question | Decision |
|---|---|
| Accounts pre-approval | **Removed.** Oversight moves to a post-hoc daily report. |
| Who starts a redemption | **Staff**, from a saved bill entry. |
| Who picks the amount | **Customer**, in their app, during the OTP step. |
| Minimum bill | **Rs 30,000 gross.** Bill-level eligibility gate. |
| Cap | **5% of gross**, applied to the *total* of all redemptions on the bill. |
| Stacking | **Allowed** while the running total stays within the cap. |
| OTP length | **4 digits.** Safety comes from the attempt limit, not the digits. |
| Returns | **Reverse automatically**, subject to the rules below. |

### Why staff-initiated

Any design where the customer arms a voucher in advance recreates the exact
state machine that produced bug 2 above: a persistent "active request" that
gets stuck. Staff-initiated has no such state. If the customer walks away
mid-flow, the OTP expires and nothing is locked.

## Counter flow

1. Staff fills and **saves** the bill entry. The bill row must exist before
   redemption starts — see *Save before redeem* below.
2. On the saved entry, staff taps **Redeem points**. This creates a redemption
   session recording the bill's gross and the remaining headroom, and pushes a
   notification to the customer.
3. The customer opens the app and sees only the options that fit both their
   balance and this bill's headroom:

   > This bill allows up to **Rs 1,500**
   > 75 pts -> Rs 500 &nbsp;&nbsp; 100 pts -> Rs 750

4. Tapping an option sets the amount on the session and reveals a 4-digit code.
   Choice and consent are one action.
5. The customer reads the code out. Staff types it. On success the bill's
   redemption amount fills in read-only, points are deducted, and a REDEEMED
   stamp appears in the customer's app.

Staff never type a rupee figure and never choose the amount. That alone closes
the largest hole in the current system; the OTP is the second layer.

### Save before redeem

Redemption must validate against a **persisted** gross, not a number sitting in
a form field. If the OTP were verified against a typed Rs 30,000 that staff
then edited to Rs 10,000 before saving, the cap would be bypassed entirely.

Consequence: if gross is edited on an entry that already carries a redemption,
re-validate the cap. If the edit breaks it, block the save and require the
redemption be reversed first.

## Cap arithmetic

- **Eligibility:** `gross_bill_amount >= 30000`. Below that, the Redeem button
  is disabled with the reason shown.
- **Cap:** `cap = gross * 0.05`, on gross, matching today's behaviour.
- **Headroom:** `cap - SUM(rupee_value)` of redemptions already `used` on this
  bill. Options exceeding headroom are hidden from the customer, not merely
  warned about.

The existing tiers all fit at the Rs 30,000 floor — the largest, Prestige
250 pts -> Rs 1,500, equals exactly 5% of Rs 30,000. Stacking two Rs 750
vouchers also lands exactly on the cap.

Staff-facing copy should always be rupees, never percentages:

> Bill Rs 30,000 -> cap **Rs 1,500**, used Rs 750, **Rs 750 left**

## Points ledger: a prerequisite bug

**`fn_expire_points` will double-deduct once redemption starts working.**

It expires the full `points` of every `purchase` lot whose `expires_at` has
passed, with no knowledge of whether those points were already spent:

```
1 Jan  +100 purchase (expires 1 Jul)   balance 100
1 Mar  -100 redemption                 balance 0
1 Jul  -100 expiry (full lot)          balance -100
```

This is latent today only because the redemption row is never written. Fixing
redemption activates it. It must be fixed in the same change.

### Fix: track lot consumption

Add `consumed_points INTEGER NOT NULL DEFAULT 0` to `card_points`, meaningful
on `purchase` lots only.

- **On redemption:** consume FIFO from the oldest non-expired lots with
  headroom, incrementing `consumed_points`. Record each `(lot_id, points)` pair
  in a `redemption_lots` table. Still write the single negative `redemption`
  row so `SUM(points)` remains the balance — the ledger model is unchanged.
- **On expiry:** expire `points - consumed_points` instead of `points`.
- **On reversal:** decrement `consumed_points` on the recorded lots. Points
  return to their original lot, so they keep their original expiry for free —
  no expiry date needs copying anywhere.

This is what makes the agreed return rule ("returned points keep their original
expiry") fall out of the data model instead of needing special-case logic.

## Returns and reversal

- **Full return** -> always reverse.
- **Partial return** -> reverse only if the remaining bill value can no longer
  support the redemption, i.e. remaining gross drops below Rs 30,000 or the
  redemption total exceeds 5% of the remaining gross. Furniture returns are
  usually partial; a customer who keeps a Rs 28,000 sofa and returns a
  Rs 12,000 table should keep the Rs 750 they earned on the sale they kept.
- **Bill rejected by accounts** -> always reverse.
- Reversal is **automatic** on the return/rejection entry, never manual, and
  always appears in the daily report.
- Reversal credits back only the portion whose lots have not since expired.
  Expired points return dead, with the reason shown in the app. This is the
  honest reading of "original expiry" and it cannot be farmed by timing a
  return.

## Data model

`redemption_requests` becomes a ledger of events rather than a queue of
requests. Keep the table name to avoid churn; the meaning of `status` changes.

New columns:

| Column | Purpose |
|---|---|
| `otp_hash` | Hashed code. Never stored in plaintext. |
| `otp_expires_at` | 10 minutes from issue. |
| `otp_attempts` | Dies at 3. |
| `initiated_by` | Staff user who started the session. |
| `bill_entry_id` | Reuse the existing `used_in_bill_id`. |
| `reversed_at`, `reversal_reason` | Return/rejection audit. |
| `override_by`, `override_reason` | Manager override audit. |

New statuses: `awaiting_otp`, `used`, `expired`, `reversed`. The existing
`pending` / `approved` / `rejected` values stay in the check constraint for
historical rows but are never written again.

New table `redemption_lots (redemption_id, card_point_id, points)`.

## Security

- **The staff app must never be able to read the code.** RLS denies `select` on
  the OTP columns to `authenticated`; only a `service_role` edge function ever
  compares it. If verification happens client-side, any staff member can read
  the code straight out of the database and self-serve.
- Two edge functions, following the existing `whatsapp-otp` pattern:
  `redemption-start` and `redemption-verify`. Verify returns yes/no and the
  amount — never the code.
- **Verify + deduct + link + stamp is one transaction.** A flaky showroom
  connection plus an impatient second tap must not deduct twice.
- Rate limit: 3 wrong attempts kills the code; max 5 sessions per customer per
  hour. Failed attempts are logged.
- One live code per customer at a time.

### What OTP does and does not stop

| Threat | Stopped? |
|---|---|
| Staff redeeming a customer's points without them knowing | Yes |
| Someone impersonating the customer | Yes |
| A screenshot of an old approval reused as proof | Yes — the app screen is never the authority, the server is |
| Staff colluding with a customer to over-redeem | **No** — only the cap and the daily report catch this |
| Miscalculated balance becoming an instant discount | **No** — see below |

## Replacing accounts oversight

Pre-approval was incidentally a safety net against our own code being wrong: a
human looked at the points before anything moved. Removing it means a bad
balance becomes a discount with nobody in the loop. These two are therefore
part of the same change, not follow-ups.

**Daily redemption report**, flagging:
- unusual redemption count for one staff member
- redemptions on bills later returned or rejected
- repeated failed OTP attempts on one customer
- every manager override

**Manager override** for the dead-phone case. This is now the *only* path where
points move without customer consent, so: `admin` role required, mandatory
reason, always flagged in the report. Build it deliberately — without it, staff
will invent their own workaround at the counter and it will be invisible.

## App changes

**Customer app** (`redeem.tsx`) stops being a request form. It becomes: balance,
how redemption works, and history. New OTP screen showing eligible options for
the active session, then the code. REDEEMED stamp on used entries — diagonal,
scale-and-rotate in, with amount, bill number and date beneath. The bill number
is the point: it makes a stale screenshot obviously stale.

**Staff app** (`CardBillEntries.tsx`) loses the free-text redemption field. The
saved entry gains a Redeem points action and shows live cap arithmetic.

## Migration

- Existing `approved` rows: mark `expired`. No points were ever deducted, so
  customers lose nothing they actually held.
- Separately, list bills carrying a `redemption_amount > 0` with no linked
  request. These are discounts already given away for free. Accounts decides
  whether to claw the points back; do not automate this.
- The stop-gap copy fix on the approved state in `redeem.tsx` becomes obsolete
  when that screen is rebuilt.

## Build order

1. Lot consumption + expiry fix. Nothing else is safe until `SUM(points)` is
   trustworthy.
2. Schema: new columns, statuses, `redemption_lots`, RLS.
3. Edge functions `redemption-start` / `redemption-verify`.
4. Staff UI: save-then-redeem, cap display, OTP entry.
5. Customer UI: option picker, code, stamp.
6. Reversal on return/rejection.
7. Daily report + manager override.

## Open items

- Cap is on gross, matching current behaviour. Post-discount would be stricter;
  flagged, not changed.
- SMS/WhatsApp fallback if push fails — `whatsapp-otp` already exists and could
  carry the code. Decide whether that is in scope for v1 or whether the manager
  override covers it.

## Live database findings (8 Oct 2026)

Read directly from production through Lovable. Where this section disagrees with
anything above, this section wins.

### Already applied to production

| Migration | What it does |
|---|---|
| `20260912010000_lock_customer_self_writes.sql` | Restores `status = 'pending'` on the customer INSERT policy for `redemption_requests`, and adds a guard trigger limiting direct customer sessions to `date_of_birth` / `anniversary_date` on `elite_customers`. |
| `20260912000000_point_lot_consumption.sql` | `consumed_points` on `card_points`, `redemption_lots`, `fn_consume_points`, `fn_release_points`, and an expiry function that writes off only the unconsumed remainder. Purely additive: `consumed_points` defaults to 0, so expiry behaves exactly as before. |

Both are idempotent, so re-running them from the repo is safe. Rollback text is
in each file's header. Verified three ways: 49 + 34 assertions on a local
Postgres 16, a concurrent double-tap test, and probes against production that
run inside a `DO` block ending in `RAISE EXCEPTION` so nothing persists.

Why the guard exists: the live INSERT policy had no status check, so a customer
could file an already-approved request for any amount, and the UPDATE policy
allowed every column of `elite_customers` (only `card_tier` was locked), so a
customer could set their own points, status, or card issue date (the
cooling-window anchor). Before the fix these were reproduced locally; no sign
of past use in production (every balance matches its ledger).

### Corrections to the design above

- **The repo does not match production.** `card_points` has no `bill_id` and no
  `transaction_type` check; live `fn_expire_points` expires `purchase`,
  `anniversary_bonus` and `referral`, not just `purchase`; `card_expiry_date` is
  a generated column. Treat the live schema as the source of truth and verify
  against it before every migration. A first draft of the lot migration copied
  the repo's expiry function and would have stopped anniversary and referral
  points expiring.
- **`fn_consume_points` / `fn_release_points` write their own ledger rows**
  (`redemption` and `redemption_reversal`). Callers do not insert them. The
  reversal credit is excluded from spendable lots; otherwise a customer could
  spend more than their balance after a return.
- **Bill entries are not created by staff.** All 105 existing entries came from
  the won-lead trigger; none from the manual form. Sales have no INSERT or
  UPDATE right on `card_bill_entries`. So "save the bill, then redeem" means
  redemption attaches to the auto-created entry and its gross, and must be
  re-validated if accounts edits the amount at approval. Redeem therefore runs
  through a `SECURITY DEFINER` function, as planned.
- **OTP storage:** a separate table with RLS on and no client privileges at all,
  rather than columns on `redemption_requests`. Reachable only through
  `SECURITY DEFINER` functions, so no policy mistake can expose the code.
- **Customer INSERT on `redemption_requests`** is kept (pending-only) so today's
  screen keeps working. Drop it when the staff-initiated flow ships; customers
  never need to insert in the new design.
- **The old redemption branch in `fn_credit_or_reverse_points`** writes a
  `-points` row without consuming lots. Unreachable today, but it must be
  removed in step 6 or it will double-deduct alongside the new path.
- **The earlier claim that discounts were leaking was wrong.** No bill carries a
  redemption amount; the single request is a test. Nothing to reconcile.

### Open decisions

- **`welcome_bonus` points never expire** (35 rows) although they carry an
  `expires_at`; the live expiry function does not list that type. Preserved as
  is. Lapsed ones are not spendable by `fn_consume_points` but still count in
  the displayed balance. Decide whether they should expire.
- **Staff can still edit `current_points` directly** (sales included). Tightening
  that is separate from this work.
- The ledger clamps the displayed balance at 0 (`GREATEST(0, ...)`), which is
  what would have hidden the double-expiry bug on screen.

### Points rules (live, 8 Oct 2026)

`20260912020000_points_rules.sql`. Welcome points now expire 6 months after issue
(the expiry date was already stamped; the expiry function just ignored the type;
nothing is past expiry today). Staff, admin included, can no longer set
`current_points` / `lifetime_points` directly; points change only through ledger
rows, which the sync trigger reflects. An admin adjusts points by inserting a
`card_points` row.

## OTP backend (live, 8 Oct 2026)

`20260912030000_otp_redemption.sql`. Three tables (`redemption_options`,
`redemption_sessions`, `redemption_otps`) and six functions. No screen calls them
yet.

| Function | Caller | Purpose |
|---|---|---|
| `redemption_start(bill_entry_id)` | sales (own bills) / admin | Open a session on a PENDING bill entry |
| `redemption_customer_session()` | customer | The open session and which options fit |
| `redemption_choose(session_id, points)` | customer | Pick an option; the ONLY call that returns the code |
| `redemption_verify(session_id, code)` | the staff member who started it / admin | Check the code and move everything in one transaction |
| `redemption_cancel(session_id)` | initiator, admin, or the customer | Close a session |
| `redemption_expire_stale()` | service_role (cron) | Close abandoned sessions |

Refusals from `redemption_start` raise with a stable code before the first colon
(`BILL_BELOW_MINIMUM`, `WAITING_PERIOD`, `CAP_REACHED`, `INSUFFICIENT_POINTS`,
`CUSTOMER_APP_NOT_ACTIVATED`, `TIER_NOT_ELIGIBLE`, `BILL_NOT_YOURS`,
`BILL_ALREADY_DECIDED`, `BILL_IS_RETURN`, `SESSION_IN_PROGRESS`, `RATE_LIMITED`).
`choose` and `verify` return `{ok:false, reason}` instead of raising, because an
exception would roll back the attempt counter and allow unlimited guesses
(`WRONG_CODE` with `attempts_left`, `TOO_MANY_ATTEMPTS`, `SESSION_EXPIRED`,
`BAD_FORMAT`, `BILL_CHANGED`, `EXCEEDS_CAP`, `NOT_AWAITING_CODE`).

Rules, all read from `card_settings` so they change without a deploy:
`redemption_min_bill` 30000, `redemption_cap_pct_of_bill` 5, `redemption_otp_minutes`
10, `redemption_otp_max_attempts` 3, `redemption_sessions_per_hour` 5. The menu of
options per tier lives in `redemption_options`.

What `redemption_verify` does on success, atomically: inserts a `redemption_requests`
row as `used` linked to the bill, spends the points FIFO from the soonest-expiring
lots, adds the rupees to the bill's `redemption_amount` AND subtracts them from
`net_bill_amount` (accounts' approval screen pre-fills net, and points are earned
on it), and deletes the code. `redemption_request_id` on the bill is left NULL on
purpose so the legacy branch in `fn_credit_or_reverse_points` cannot deduct again.

Security notes. The code is stored as a salted SHA-256 hash, but with only 10,000
possible codes that hash would not stand up to offline guessing; the protection is
access control (no client privilege on `redemption_otps`, one function that ever
reveals the code, three attempts per code). Anyone with direct database access
could still read it. `redemption_choose` can be called again to issue a fresh code
(which resets the attempt counter); only the customer can do that, never staff.

### Still to build

1. **Staff screen** (`CardBillEntries.tsx`): Redeem button on a pending entry that
   shows rupees-not-percentages ("cap Rs 3,347, Rs 750 used, Rs 2,597 left"), the
   four-box code entry, and calls `send-push` after start so the customer is told.
2. **Customer screen** (`redeem.tsx`): replace the request form with the option
   picker and code display, plus the REDEEMED stamp on used entries.
3. **Reversal** on a rejected or returned bill: `fn_release_points` plus restoring
   the bill's net, and mark the request `reversed`.
4. **Remove** the legacy redemption branch in `fn_credit_or_reverse_points`, and
   drop the customer INSERT policy on `redemption_requests`.
5. **Daily report** and the **admin override** for a customer who cannot show a code.
6. **Referral bonus**: the staff app inserts +20 straight into `card_points`, which
   RLS refuses for sales while still showing "20 bonus pts credited". It needs a
   server-side function.

## Staff screen and referral bonus (built, 8 Oct 2026)

**Staff screen** (`src/components/RedeemPointsDialog.tsx`, `src/lib/redemption.ts`,
wired into `CardBillEntries.tsx`). A Redeem points button appears on pending
entries for points-earning cards: sales on their own entries, admin on any. The
dialog runs start, wait for the customer's choice, 4-digit code, done. The limit is
shown in rupees throughout. The manual form's free-text "Redemption Amount Applied"
field is removed; redemption happens after saving. Closing the dialog does not
cancel (the customer's code stays valid); Cancel does. Not yet exercised in a real
browser against production.

**Referral bonus** (`20260912040000_referral_bonus.sql`). `award_referral_bonus`
replaces the browser-side insert that RLS refused for sales. Once per new member,
only for a member the caller added in the last 24 hours (admin: anyone), active
referrer only, no self-referral. Points expire after 6 months, unlike the old
client insert which set no expiry. Amount from `card_settings.referral_bonus_points`.

### Pending on production (the Lovable connection dropped)

`20260912040000_referral_bonus.sql` is written and tested (26 assertions plus a
concurrent double-submit) but NOT applied. Until it is, the staff app reports
honestly that the referral bonus could not be credited, instead of the old false
"20 bonus pts credited". Apply it, then verify with a rolled-back probe.

Open question: is there a limit on how many referrals one member can earn per
month? Every award is recorded in `referral_awards` so it can be reported on.
