
## Feature 1 — Lead Assignment

**Database (migration)**
- `leads` already has `assigned_to`. Add: `assigned_at timestamptz`, `assignment_notes text`.
- New `lead_assignment_history` table: `lead_id`, `from_user`, `to_user`, `assigned_by`, `reason`, `created_at`. RLS: admin full; sales can view rows for leads they own/are assigned.
- Trigger on `leads` UPDATE: when `assigned_to` changes, insert history row + set `assigned_at = now()`.

**Frontend**
- `LeadAssignmentModal.tsx` — admin picks a sales user (from `profiles` joined with `user_roles` where role='sales'), optional reason, writes update.
- `UnassignedLeadsCard.tsx` — admin dashboard card showing count + list of leads where `assigned_to IS NULL`, click → opens assignment modal.
- `WorkloadDistributionCard.tsx` — bar list: per-sales-user active lead count (status not in won/lost/converted).
- `LeadAssignmentHistoryDrawer.tsx` — timeline of reassignments, opened from lead details.
- Hook into existing `LeadForm` post-create: if creator is admin, auto-open assignment modal.
- Add small "Assigned to: X" line on `LeadCard`/`LeadDetailsDrawer`.
- Mount the new admin cards on `AdminDashboard.tsx`.

## Feature 2 — Attendance

**Policy (defaults, IST)**
- Work window 11:00–20:00 IST.
- On-time clock-in: 11:00–11:10 → `on_time`.
- After 11:10 → `late` (store `minutes_late`).
- No clock-in for the day → `absent`.
- `working_hours = clock_out - clock_in` (decimal hours, null until clock-out).

**Database (migration)**
- `attendance` table: `id`, `user_id`, `date` (date, IST), `clock_in timestamptz`, `clock_out timestamptz`, `status text` (`on_time|late|absent`), `minutes_late int`, `working_hours numeric`, `clock_in_lat/lng numeric`, created/updated timestamps. Unique `(user_id, date)`.
- RLS: user can view + insert/update own row; admin & accounts can view all.
- Trigger to compute `status`, `minutes_late`, `working_hours` on insert/update.
- RPC `attendance_today_summary()` → returns per-user today rows joined with profiles for all active employees (including absent).
- RPC `attendance_monthly_report(p_month text)` → rows for export.

**Frontend**
- `AttendanceClockButton.tsx` — visible on AppLayout topbar for any logged-in employee; shows "Clock In" or "Clock Out (worked Xh Ym)"; uses today's row.
- `DailyAttendanceCard.tsx` — admin/accounts dashboard tile: Present / Late / Absent counts.
- `AttendanceTodaySummary.tsx` — color-coded employee list for today.
- `AttendanceCalendar.tsx` — month grid for one user (self by default; admin can pick).
- `MonthlyAttendanceReport.tsx` page at `/attendance` — month picker, table, PDF (jspdf + autotable) and CSV export buttons. Admin/accounts see all; others see only own.
- Sidebar nav entry "Attendance" for everyone; admin/accounts get the full report view.

## Technical notes
- IST date computed client + server with `(now() AT TIME ZONE 'Asia/Kolkata')::date`.
- PDF: reuse `jspdf` + `jspdf-autotable` (add deps if missing).
- All UI uses existing semantic tokens (`bg-success`, `bg-destructive`, `text-muted-foreground`, etc.).
- Reuse `StatCard`, `Dialog`, `Select`, `Calendar` shadcn components.

## Files (created/edited)
- Migrations: 1 for lead assignment, 1 for attendance.
- New: `LeadAssignmentModal`, `UnassignedLeadsCard`, `WorkloadDistributionCard`, `LeadAssignmentHistoryDrawer`, `AttendanceClockButton`, `DailyAttendanceCard`, `AttendanceTodaySummary`, `AttendanceCalendar`, `MonthlyAttendanceReport` (page), route added in `App.tsx`, nav entry in `AppLayout.tsx`.
- Edited: `AdminDashboard.tsx`, `LeadForm.tsx`, `LeadDetailsDrawer.tsx`, `DataContext.tsx` (assignment helpers).

Reply "go" to proceed and I'll run the migrations first (you'll approve), then ship the code.
