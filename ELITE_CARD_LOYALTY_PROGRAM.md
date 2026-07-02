# Elite Card Loyalty Program — Build Spec

> Project: OmniFlow (hdeomniflow.lovable.app) — React + Supabase (Lovable-built)
> Business: Home Decor Enterprises, Godrej Interio dealership, Dehradun
> Use the Supabase MCP connector for all database work. Inspect existing schema before creating anything — customers, leads, bills/sales, and service tables already exist.

## 1. FINALIZED CARD STRUCTURE (do not change without asking)

| Feature | Elite | Super Elite | Prestige Elite |
|---|---|---|---|
| Price (incl 18% GST) | Rs 1,200 | Rs 2,100 | Rs 4,100 |
| Eligibility | Any purchase | Any purchase | Minimum Rs 2,00,000 bill |
| Validity | 3 years | 3 years | 3 years |
| Extra discount | 5% | 5% | 6% |
| Extended warranty | None | 6 months | 1 year |
| Service charge discount | None | 10% | 20% |
| Points system | None | Yes | Yes |
| Sales commission (flat) | Rs 100 | Rs 150 | Rs 200 |

## 2. POINTS RULES

- Points earned ONLY on 2nd purchase onwards (first purchase earns zero points)
- Super Elite: 1 point per Rs 250 spent
- Prestige Elite: 1 point per Rs 200 spent
- Redemption (rupee discounts only, no service redemptions):
  - Super Elite: 75 pts = Rs 500 | 100 pts = Rs 750
  - Prestige Elite: 100 pts = Rs 600 | 250 pts = Rs 1,500
- Anniversary bonus: Super Elite 25 pts/year, Prestige Elite 50 pts/year
- Points expire 12 months after earning
- Per-bill redemption cap: max 5% of bill value
- Points post ONLY after accounts approval of the sale
- Points auto-reverse on returns/cancellations
- Points activate only after customer installs app and logs in (app_activated = true gate)

## 3. MARGIN PROTECTION (critical business rules)

- Cost base = 64.5% of MRP (margin 35.5% on MRP for home furniture)
- Hard margin floor: 20%
- TOTAL discount ceiling = 15.5% (Godrej base scheme discount + card extra discount combined)
- If base scheme discount + card % exceeds 15.5%, card bonus auto-reduces to fill only up to ceiling
- Ceiling must be admin-editable (settings table), enforced at bill creation, not salesperson discretion
- Exclude clearance / max-scheme items from card discounts
- Commission calculated on net-of-GST card revenue

## 4. DATABASE SCHEMA (add to existing Supabase)

```sql
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS card_tier TEXT CHECK (card_tier IN ('elite','super_elite','prestige_elite')),
  ADD COLUMN IF NOT EXISTS card_number TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS card_enrollment_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS card_expiry_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_points INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_points INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS app_activated BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS card_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  points INTEGER NOT NULL,
  transaction_type TEXT CHECK (transaction_type IN ('purchase','redemption','anniversary_bonus','referral','reversal','expiry')),
  bill_id UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id UUID,
  customer_id UUID REFERENCES customers(id),
  card_tier TEXT,
  commission_amount DECIMAL NOT NULL,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','paid')),
  payout_month DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redemption_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  points_requested INTEGER NOT NULL,
  rupee_value DECIMAL NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','used')),
  approved_by UUID,
  used_in_bill_id UUID,
  requested_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) UNIQUE,
  phone TEXT NOT NULL,
  onesignal_player_id TEXT,
  app_installed_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS push_notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  notification_type TEXT,
  title TEXT,
  message TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  opened BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS card_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 5. RLS POLICIES

- Customers (app role): SELECT only own customer row, own card_points, own redemption_requests; INSERT only own redemption_requests
- All point writes / card data writes: staff roles only
- Respect existing approval patterns

## 6. BILL ENTRY LOGIC

> Bills are NOT generated inside OmniFlow. The salesperson enters figures manually
> after the actual bill is raised (Tally/manual). OmniFlow is the record-keeper,
> not the billing system.

### card_bill_entries table (Step 2 schema)
| Column | Notes |
|---|---|
| id | UUID PK |
| customer_id | → elite_customers |
| entered_by | → auth.users (salesperson) |
| bill_reference | Free-text bill / invoice number |
| bill_date | DATE |
| gross_bill_amount | DECIMAL — MRP total before any discount |
| base_scheme_discount_pct | DECIMAL — Godrej scheme discount already given |
| card_discount_pct | DECIMAL — effective card discount (auto-capped, read-only after save) |
| redemption_amount | DECIMAL — rupee value of approved redemption applied (0 if none) |
| redemption_request_id | → redemption_requests (optional) |
| net_bill_amount | DECIMAL — gross after all discounts |
| is_card_sale | BOOLEAN — true if this entry is for the card purchase itself |
| is_return | BOOLEAN — triggers points reversal |
| approval_status | pending / approved / rejected |
| approved_by | → auth.users (accounts) |
| approved_at | TIMESTAMPTZ |
| notes | TEXT |
| created_at | TIMESTAMPTZ |

### Entry flow (salesperson)
1. Select card-holder customer → system shows tier, expiry, current points, any approved redemption
2. Enter: bill_reference, bill_date, gross_bill_amount, base_scheme_discount_pct
3. OmniFlow auto-computes card_discount_pct = min(tier_extra_discount, ceiling − base_scheme_discount_pct); shows warning if base alone already hits ceiling
4. If an approved redemption_request exists for this customer, salesperson can attach it (cap displayed: 5% of gross)
5. Save → row created with approval_status = 'pending'; commission row inserted immediately (flat by tier) if is_card_sale = true
6. Accounts approves → approval_status = 'approved'; points credited if 2nd+ purchase and app_activated = true; expires_at = now() + 12 months
7. If is_return = true → negative card_points reversal row inserted on approval

### RLS for card_bill_entries
- Sales: INSERT own rows; SELECT own rows
- Accounts: SELECT all; UPDATE approval_status / approved_by / approved_at
- Admin: full access (see all)
- Customer app: no access

## 7. ONESIGNAL PUSH (customer app)

- App ID and REST API key in Supabase Edge Function secrets (ONESIGNAL_API_KEY)
- Edge function `send-push`: customer_id, type, title, message -> lookup onesignal_player_id -> call OneSignal REST API -> log to push_notifications_log
- Triggers:
  - Points credited
  - Points expiring in 30/7 days
  - Card expiry in 60/30 days
  - Dormant 180 days
  - Redemption approved
  - Birthday

## 8. CUSTOMER APP (separate Lovable PWA, same Supabase)

- Phone + OTP auth, match to customers.phone to link card
- Screens:
  - Home (virtual card by tier + QR of card_number)
  - Points wallet
  - Redeem
  - Offers
  - Service request
  - Refer
- PWA installable; later Play Store TWA
- Points activate after app login

## 9. OMNIFLOW DASHBOARD

- Card holders list with tier filter, expiry countdown, points
- Redemption approval queue
- Commission leaderboard
- Push campaign log

## 10. BUILD ORDER

1. Schema + RLS (Supabase MCP)
2. Bill creation discount ceiling + commission logic
3. Points engine (earn/redeem/expire/reverse)
4. Edge function send-push + cron jobs
5. Dashboard widgets
6. Customer app built in Lovable separately
