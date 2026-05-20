## Customer Feedback System for OmniFlow

A public kiosk feedback flow + admin analytics dashboard, integrated into the existing app and sharing the same backend.

### 1. Database (migration)

New table `customer_feedback`:
- `customer_name`, `customer_phone`, `comments`
- `overall_rating` (1–5), `staff_rating` (1–5)
- `needs_attention` (bool, true when overall ≤ 2)
- `qualified_for_review` (bool, true when overall ≥ 4)
- `lead_created` (bool), `lead_id` (uuid, nullable)
- `created_at`

New setting `google_review_url` stored in a small `app_settings` table (key/value) so admin can edit later; seeded with a placeholder.

RLS:
- Public (anon) INSERT allowed (kiosk has no auth)
- SELECT only for `admin` role via `has_role`
- `app_settings`: public SELECT for the review URL row, admin-only UPDATE

When `overall_rating >= 4`, a trigger inserts a row into `leads` (source `feedback_kiosk`, category default) and stores the new `lead_id` back on the feedback row — uses existing schema, created_by/updated_by set to a system admin (NULL not allowed → use first admin via `user_roles`).

### 2. Public kiosk route `/feedback`

`FeedbackExitModal.tsx` (full-page, not modal — kiosk style), 4 steps:
1. Overall rating — 5 emoji buttons (😢😕😐😊🤩), auto-advance
2. Staff rating — same scale (😢😕😐😊⭐), auto-advance
3. Name + 10-digit WhatsApp + optional comments; helper "✨ You might get a special offer!" if overall ≥ 4
4. Result screen — conditional:
   - **≥4**: animated `GoogleReviewQRCode` (pulsing + glowing border), thank-you with name, "Open Review Link" button, auto-reset after 4s
   - **=3**: simple thanks, auto-reset after 3s
   - **≤2**: empathetic message, optional contact phone, tagged `needs_attention`, auto-reset after 3s

Mobile-first, gradient purple→blue, large touch targets, step indicator. Route is public (no auth wrapper).

### 3. `GoogleReviewQRCode.tsx`

Uses `qrcode` npm package to render a 300×300 QR. CSS pulse + glowing green border animation. Fallback "Open Review Link" button.

### 4. Admin analytics: `FeedbackAnalyticsDashboard.tsx`

New admin page `/admin/feedback` (admin-only via existing role guard), linked from admin nav.

- 4 KPI cards: total this month, avg overall, avg staff, positive %
- Rating distribution bar chart (Recharts, already in project)
- Recent feedback table (last 20) with emoji ratings, color rows, ✅ when lead was created
- Insights block: week-over-week trend, count needing attention
- Auto-refresh every 30s with "Last updated" timestamp

### Technical notes

- New dependency: `qrcode` (+ types)
- Public INSERT policy uses `WITH CHECK (true)` scoped to the `anon` role
- Phone validated client-side (10 digits) and server-side via CHECK constraint
- The `/feedback` route is registered outside the authenticated layout in `App.tsx`
- Google review URL is read from `app_settings` so it's editable without redeploy