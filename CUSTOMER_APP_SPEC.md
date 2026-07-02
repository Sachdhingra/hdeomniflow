# Elite Card Customer App — Build Spec

**Project type:** Separate Lovable PWA (mobile-first)
**Supabase project:** Same project as OmniFlow (hdeomniflow)
**Auth method:** Phone + OTP (Supabase built-in SMS / WhatsApp OTP)
**Target users:** Elite card holders — customers, NOT staff

---

## 1. Background

Home Decor Enterprises runs a loyalty card program (Elite / Super Elite / Prestige Elite)
managed by staff in OmniFlow. This customer-facing app lets card holders:
- View their virtual card and current points balance
- Track their points transaction history
- Submit a redemption request (staff approve in OmniFlow)
- Register their device for push notifications
- Request a service job
- Refer a friend and earn bonus points

All data lives in the existing Supabase project. The app reads/writes only rows
belonging to the authenticated customer (enforced by RLS).

---

## 2. Existing Database (do NOT recreate)

All tables already exist. The app only reads/writes them.

### Key tables

```
elite_customers          — card holder profile (1 row per customer)
  id UUID PK
  customer_name TEXT
  phone_1 TEXT           — canonical +91XXXXXXXXXX
  card_tier TEXT         — 'elite' | 'super_elite' | 'prestige_elite'
  card_number TEXT
  card_enrollment_date TIMESTAMPTZ
  card_expiry_date TIMESTAMPTZ
  current_points INT
  lifetime_points INT
  app_activated BOOLEAN  — set TRUE when customer first logs in
  status TEXT            — 'active' | 'opted_out'
  date_of_birth DATE
  referral_code TEXT     — generated on first app login (see §8)

app_users                — links Supabase auth user → elite_customers row
  id UUID PK
  user_id UUID REFERENCES auth.users(id) UNIQUE
  customer_id UUID REFERENCES elite_customers(id) UNIQUE
  onesignal_player_id TEXT   — written by app on first launch
  push_enabled BOOLEAN DEFAULT true
  created_at TIMESTAMPTZ

card_points              — immutable ledger rows
  id UUID PK
  customer_id UUID
  points INT             — positive = earn, negative = spend/expire
  transaction_type TEXT  — 'purchase'|'redemption'|'anniversary_bonus'
                           |'referral'|'reversal'|'expiry'
  bill_id UUID           — source bill or source card_points row (for expiry)
  expires_at TIMESTAMPTZ — only purchase rows have this
  is_expired BOOLEAN
  created_at TIMESTAMPTZ

redemption_requests      — customer submits; accounts approves
  id UUID PK
  customer_id UUID
  points_requested INT
  rupee_value DECIMAL
  status TEXT            — 'pending'|'approved'|'rejected'|'used'
  approved_by UUID
  requested_at TIMESTAMPTZ

push_notifications_log   — written by send-push edge function (read-only for app)
```

### Helper functions (already exist, callable by app user)

```sql
-- Returns customer_id for the logged-in auth user (NULL if not linked)
public.get_loyalty_customer_id(_uid UUID) RETURNS UUID

-- Returns TRUE if auth user is in app_users
public.is_loyalty_app_user(_uid UUID) RETURNS BOOLEAN
```

### RLS summary

The customer can:
- SELECT their own `elite_customers` row (via `get_loyalty_customer_id`)
- SELECT their own `card_points` rows
- SELECT their own `redemption_requests` rows
- INSERT a `redemption_requests` row (status must be `'pending'`)
- UPDATE their own `app_users` row (to write `onesignal_player_id`, `push_enabled`)
- UPDATE their own `elite_customers` row for: `app_activated`, `date_of_birth`, `referral_code`

The customer CANNOT:
- See other customers' data
- Modify bill entries, commissions, or approval statuses
- Access staff tables

---

## 3. Auth Flow

1. **Landing screen** — logo + "Enter your mobile number"
2. Customer enters their 10-digit number (same as `elite_customers.phone_1`)
3. App sends OTP via Supabase `signInWithOtp({ phone: '+91XXXXXXXXXX' })`
4. Customer enters 6-digit OTP → Supabase verifies → session created
5. **Link check**: query `app_users` for `user_id = auth.uid()`
   - If no row → look up `elite_customers` where `phone_1 = canonical(phone)` and `status = 'active'`
     - Found → insert `app_users(user_id, customer_id)` + set `elite_customers.app_activated = true`
     - Not found → show "Your number is not registered as an Elite Card holder. Visit our store."
   - If row exists → proceed
6. **First login extras** (run once if `app_activated` was false):
   - Generate `referral_code` = `EC` + last 4 digits of phone + 4 random uppercase chars
     (e.g. `EC4521KRTM`); write to `elite_customers.referral_code`
   - Request push notification permission → register OneSignal player ID (§9)

---

## 4. App Shell & Navigation

Mobile-first PWA. Bottom tab bar with 4 tabs:

| Tab | Icon | Screen |
|---|---|---|
| Home | card | Virtual Card + quick stats |
| Points | coins | Wallet / history |
| Redeem | gift | Redemption request |
| More | menu | Profile, Service, Refer, Settings |

No sidebar. No desktop layout needed (still works on desktop, just centered max-w-sm).

Brand colours: match the OmniFlow amber/gold palette.
- Primary accent: `#B8860B` (dark goldenrod) or amber-600
- Tier badge colours:
  - Elite: blue
  - Super Elite: purple
  - Prestige Elite: gold/amber

---

## 5. Screen: Home (Virtual Card)

Shows the customer's loyalty card as a styled card widget, then quick stats below.

### Card widget
```
┌─────────────────────────────────────────┐
│  🏠 Home Decor Enterprises              │
│                                         │
│  PRESTIGE ELITE                         │
│                                         │
│  Ravi Kumar                             │
│  Card No:  HDE-PE-0042                  │
│                                         │
│  Valid till: Dec 2027                   │
└─────────────────────────────────────────┘
```
- Gradient background per tier:
  - elite: blue gradient
  - super_elite: purple gradient
  - prestige_elite: amber/gold gradient
- Tap card → full-screen card view (for showing at store)

### Quick stats below card
- Current Points (large number, prominent)
- Lifetime Points earned
- Points expiring next (nearest `expires_at` date from `card_points` where `transaction_type='purchase' AND is_expired=false AND expires_at > now()`)

### Benefits strip (collapsed accordion)
Per-tier benefit summary (hardcoded in app, matches spec):

| Benefit | Elite | Super Elite | Prestige Elite |
|---|---|---|---|
| Extra discount | 5% | 5% | 6% |
| Extended warranty | — | +6 months | +1 year |
| Service charge discount | — | 10% | 20% |
| Points on purchases | — | ✓ | ✓ |

---

## 6. Screen: Points Wallet

### Top summary
- Current balance (big number)
- Lifetime earned
- Redeemable tiers (green chips if affordable):
  - super_elite: 75 pts = ₹500 · 100 pts = ₹750
  - prestige_elite: 100 pts = ₹600 · 250 pts = ₹1,500
  - elite: Points not applicable

### Transaction list
Load from `card_points` where `customer_id = <mine>`, ordered by `created_at DESC`.

Each row:
```
[icon] Purchase earned        +12 pts    15 Jun 2026
       Expires 15 Jun 2027
```

Transaction type labels and icons:
| type | label | icon | colour |
|---|---|---|---|
| purchase | Purchase earned | trending-up | green |
| anniversary_bonus | Anniversary bonus | gift | green |
| referral | Referral bonus | users | green |
| redemption | Redeemed | rupee | red |
| reversal | Return reversal | rotate-ccw | red |
| expiry | Expired | clock | grey |

Expired or `is_expired = true` rows shown at 50% opacity.

---

## 7. Screen: Redeem

Only visible for `super_elite` and `prestige_elite` tiers. Elite tier sees a
"Points not available on Elite card" placeholder.

### Step 1 — Select tier
Show available redemption chips per tier.  
Green = affordable (current_points ≥ points), greyed = not enough.

```
  [ 75 pts → ₹500 ]    [ 100 pts → ₹750 ]
    (affordable)          (need 25 more)
```

Tap a chip → go to Step 2.

### Step 2 — Confirm
Show:
- Points to redeem: 75
- Rupee value: ₹500
- Remaining balance after: X pts
- "You will receive a voucher code at the store counter when you make your next purchase."

Confirm button → INSERT into `redemption_requests`:
```json
{
  "customer_id": "<mine>",
  "points_requested": 75,
  "rupee_value": 500.00,
  "status": "pending"
}
```

### Step 3 — Pending state
After submission, show "Request submitted!" screen with:
- Voucher status: Pending approval
- "Our team will approve it within 24 hours. Show your card at the store to use."
- Existing pending/approved requests listed below

Block new requests while one is in `status = 'pending'` or `'approved'`
(check before showing Step 1).

---

## 8. Screen: More → Refer a Friend

Show the customer's `referral_code` (generated on first login, §3).

```
Your referral code:
  ┌─────────────────┐
  │  EC4521KRTM     │  [Copy]
  └─────────────────┘

Share with friends who plan to buy from Home Decor Enterprises.
When they enroll in an Elite Card, you earn bonus points.

You've referred: 2 friends
Points earned via referrals: 40 pts
```

How referral bonus works (backend):
- When **sales staff** enroll a new card, they enter the referrer's code in
  the card enrollment form (to be added to OmniFlow CardBillEntries or
  EliteCustomers Add Member dialog)
- OmniFlow inserts a `card_points` row:
  `(customer_id = referrer, points = 20, transaction_type = 'referral')`
- The `fn_sync_current_points` trigger updates the referrer's balance automatically

The customer app only reads the referral code and shows their referral earnings
from `card_points WHERE transaction_type = 'referral'`.

> **OmniFlow TODO (separate task):** Add "Referral Code" field to the
> Add Member form in EliteCustomers.tsx; on submit, look up `elite_customers`
> by `referral_code`, insert bonus `card_points` row for the referrer.

---

## 9. Push Notifications (OneSignal)

On first launch after login:
1. Import OneSignal React Native / Web SDK
2. Call `OneSignal.setAppId(VITE_ONESIGNAL_APP_ID)`
3. Request permission: `OneSignal.promptForPushNotificationsWithUserResponse()`
4. On permission granted, get player ID:
   ```js
   const playerId = await OneSignal.getDeviceState().then(s => s.userId);
   ```
5. Upsert into `app_users`:
   ```js
   supabase.from('app_users').update({ onesignal_player_id: playerId, push_enabled: true })
     .eq('user_id', supabase.auth.getUser().id)
   ```

Push toggle in More → Settings:
- ON/OFF toggle → updates `app_users.push_enabled`
- When OFF, `send-push` edge function skips this customer (already checks `push_enabled = true`)

---

## 10. Screen: More → Service Request

Simple form for the customer to log a service/warranty issue.

Fields:
- Product / Item description (text)
- Issue description (textarea)
- Preferred contact number (pre-filled from phone_1)
- Preferred callback time (morning / afternoon / evening select)

On submit → INSERT into a new `app_service_requests` table:
```sql
CREATE TABLE public.app_service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.elite_customers(id),
  product_description TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  preferred_callback TEXT,
  status TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'in_progress' | 'resolved'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

RLS: customer can INSERT + SELECT own rows; service_head + admin can SELECT + UPDATE all.

> **OmniFlow TODO:** Add a "App Service Requests" tab to ServiceDashboard showing
> `status = 'open'` entries, with a button to convert to a full service job.

After submit:
- Show "Request received! Our service team will call you within 1 business day."
- List customer's past requests with status badges.

---

## 11. Screen: More → Profile

Read-only view of card details:
- Name (from `elite_customers.customer_name`)
- Phone (from `phone_1`, masked: 98765 XXXXX)
- Card Tier badge
- Card Number
- Enrollment Date
- Expiry Date

Editable fields:
- Date of birth (for birthday push) → UPDATE `elite_customers.date_of_birth`
- Push notifications toggle → UPDATE `app_users.push_enabled`

Logout button → `supabase.auth.signOut()`

---

## 12. Environment Variables (Vite)

```
VITE_SUPABASE_URL          = (same as OmniFlow)
VITE_SUPABASE_ANON_KEY     = (same as OmniFlow — anon key, not service role)
VITE_ONESIGNAL_APP_ID      = (from OneSignal dashboard)
```

> Do NOT embed `SUPABASE_SERVICE_ROLE_KEY` in the app. All writes go through
> the anon client, gated by RLS. Only edge functions use the service role.

---

## 13. Build Order

| Step | What | Notes |
|---|---|---|
| 1 | Auth flow + app_users link | Phone OTP → link → app_activated flag |
| 2 | Home screen (virtual card) | Read elite_customers |
| 3 | Points wallet | Read card_points |
| 4 | Redeem flow | Write redemption_requests |
| 5 | Push registration | OneSignal SDK + app_users update |
| 6 | Refer a friend | Read referral_code + card_points referral rows |
| 7 | Service request | Write app_service_requests |
| 8 | Profile + settings | DOB + push toggle |

---

## 14. Out of Scope for This App

- Bill creation (done by staff in OmniFlow only)
- Redemption approval (done by accounts in OmniFlow)
- Commission tracking (staff-only, OmniFlow)
- Admin / staff login (use OmniFlow)
- Chat / AI assistant

---

## 15. OmniFlow TODOs Triggered by This App

These are small additions needed in the existing OmniFlow codebase once the
customer app is live:

1. **Referral code field** in EliteCustomers Add Member form → inserts
   `card_points` referral bonus row for the referrer
2. **App Service Requests tab** in ServiceDashboard → shows open `app_service_requests`
   with option to convert to full service job
3. **`app_service_requests` migration** — SQL file in
   `supabase/migrations/` (create table + RLS for customer INSERT/SELECT,
   service_head/admin SELECT/UPDATE)
