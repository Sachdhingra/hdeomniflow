# OTP-Gated Point Redemption

Replaces the accounts pre-approval flow with an OTP verified at the counter.
Status: design agreed, not yet implemented.

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
