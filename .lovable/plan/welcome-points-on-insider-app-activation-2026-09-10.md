# Welcome points on Insider app activation

Give new Insider app users a one-time welcome bonus when they activate the app:

- Super Elite: 50 points
- Prestige Elite: 75 points
- Elite / Silver: no welcome points

## Rules

1. **Once per customer, ever.** The bonus is credited only the first time an app account is activated for that customer. Re-installing, logging out and back in, password login, or a fresh invite never credits again — the system checks whether a welcome bonus row already exists for that customer before adding one.
2. **Usable only from the 2nd purchase, after the cooling period.** Welcome points sit in the customer's balance but can only be redeemed once the customer has at least one approved purchase after their card was issued and the existing cooling window (currently 30 days, admin-editable) has passed. This is the same gate already used for earned points, applied to redemption requests as well so the app cannot bypass it.
3. **Same expiry as other points** — the existing points validity setting applies (currently 6 months).
4. **Customer is told immediately.** On credit, the customer gets an app notification and the same message on WhatsApp (via the existing mirror), e.g. "50 welcome points added — use them on your next purchase."

## Technical notes

- New `card_points` transaction type `welcome_bonus`; credit happens in a security-definer database function `fn_award_welcome_points(customer_id)` that is a no-op when a `welcome_bonus` row already exists for that customer or when the tier is not Super/Prestige Elite. Points value read from `card_settings` keys `welcome_points_super_elite` (50) and `welcome_points_prestige_elite` (75) so admin can change them later.
- Call the function from `supabase/functions/redeem-invite/index.ts` at first activation (where `app_activated` is set), and also whenever `app_activated` flips to true from anywhere else — a trigger on `elite_customers` is the safest single place, with the edge function relying on it.
- Redemption guard: trigger on `redemption_requests` insert that rejects the request when the customer has no approved, non-return bill entry after `card_issue_date`, or when the cooling window (`points_cooling_days`) has not elapsed. Returns a clear message the Insider app can show.
- Notification: after credit, invoke `send-push` with type `welcome_points`; WhatsApp mirroring is automatic through the existing `hde_insider_notification` template.
- Admin visibility: welcome bonus rows appear in the existing points history views with a "Welcome bonus" label.
- No backfill for customers who already activated the app, unless you want it.

## Open item

Existing activated Super/Prestige Elite customers get nothing by default. Say the word if you want them credited too.
