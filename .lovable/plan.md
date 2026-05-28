# Staff Profile System + Monthly Leaderboard

## Scope
Build a complete staff profile system in OmniFlow:
1. Staff profile data (DOB, joining date, address, designation, bio, picture)
2. First-login profile setup modal (non-dismissible until complete)
3. Profile view + edit screens
4. Staff directory (grid of all team members)
5. Monthly sales leaderboard with winner card + ranked table
6. Profile picture storage in a public Supabase Storage bucket

## Database (single migration)
- Create `public.staff_profiles` table: `user_id`, `full_name`, `email`, `phone`, `date_of_birth`, `joining_date`, `address`, `city`, `state`, `pincode`, `profile_picture_url`, `department`, `designation`, `bio`, `is_profile_complete`, timestamps
- GRANTs for `authenticated` + `service_role`; enable RLS
- RLS:
  - Anyone authenticated can SELECT (so directory + leaderboard work for all logged-in users)
  - Users INSERT/UPDATE their own row (`user_id = auth.uid()`)
  - Admins can UPDATE/DELETE any row (via `has_role(...,'admin')`)
- Create `public.staff_profiles` storage bucket: `staff-profiles` (public read, authenticated write to own folder)
- Create `monthly_sales_leaderboard` view based on existing `leads` table, joining `staff_profiles` by `user_id = leads.assigned_to` (the prompt's SQL joined by name, but our schema uses uuid — use uuid). Uses `status = 'won'` for closed deals (matches existing `lead_status` enum).
- Storage RLS: public read on `staff-profiles`; users can upload/update files under `staff/{user_id}/...`

## Frontend
New files:
- `src/components/staff/ProfileSetupModal.tsx` — non-dismissible Dialog shown when `is_profile_complete = false`; full form with picture upload preview + progress; saves and closes
- `src/components/staff/ProfileEditScreen.tsx` — same form, editable, mounted at `/profile/edit`
- `src/components/staff/ProfileViewScreen.tsx` — read-only profile card at `/profile`
- `src/components/staff/MonthlyLeaderboard.tsx` — winner card (gold gradient) + ranked table with month selector at `/dashboard/leaderboard`
- `src/components/staff/StaffDirectory.tsx` — search + grid of staff cards at `/directory`
- `src/components/staff/ProfileGate.tsx` — wraps `AppLayout` children, fetches profile, shows `ProfileSetupModal` when missing/incomplete
- `src/hooks/useStaffProfile.ts` — fetch/cache current user's profile
- `src/lib/staffStorage.ts` — upload helper (validates size/type, uploads to `staff-profiles/{user_id}/...`, returns public URL)

Edits:
- `src/App.tsx` — register 5 new routes (`/profile`, `/profile/edit`, `/profile/setup`, `/directory`, `/dashboard/leaderboard`) for all authenticated roles; mount `ProfileGate` inside `AppLayout`
- `src/components/AppLayout.tsx` — sidebar links (Directory, Leaderboard, My Profile) + show current user's avatar + name in topbar

## Leaderboard logic
View aggregates by `assigned_to` user from `public.leads` filtered to non-deleted, grouped by `date_trunc('month', created_at)`:
- `leads_count` (total assigned)
- `qualified_leads` (status in negotiation/follow_up)
- `closed_deals` (status = 'won')
- `avg_feedback_score` from `leads.feedback_score`
- `rank_position` via `ROW_NUMBER() OVER (PARTITION BY month ORDER BY leads_count DESC)`
Joined to `staff_profiles` for picture/designation/name.

## Technical notes
- Uses existing auth (`AuthContext`) — no auth changes
- Reuses shadcn `Dialog`, `Card`, `Avatar`, `Table`, `Select`, `Input` components
- Image upload: 5MB max, JPG/PNG only, generates `staff/{userId}/profile-{timestamp}.{ext}`
- All HSL semantic tokens — gold/silver/bronze via Tailwind `amber`/`slate`/`orange` utility classes are avoided; use existing tokens + small inline gradient using `primary`/`accent`
- Picture pre-fill in `ProfileSetupModal` skips fields already saved
- The schema in the user's prompt joined `assigned_to` (uuid) with `full_name` (text) — that's a bug. We join by uuid (`user_id`) which is correct for this codebase.

## Steps
1. Run migration (schema + storage bucket + RLS + view) — wait for approval
2. Build hook + storage helper
3. Build setup modal + gate
4. Build view/edit/directory/leaderboard pages
5. Wire routes + sidebar
6. Verify build
