## Goal
Replace the lead-count-only leaderboard with a composite score that reflects real salesperson performance across the OmniFlow workflow.

## Scoring model (total = 100 pts/month)

| Factor | Source | Weight | How it's measured |
|---|---|---|---|
| Sales figure (won value) | `leads.status='won'` + `value_in_rupees` in month | 25 | normalized vs top performer |
| Closed deals (count) | `leads.status in ('won','converted')` | 10 | normalized vs top |
| Reviews / feedback collected | `customer_feedback` linked via `salesperson_name`/lead | 10 | count × avg rating bonus |
| Data entry (new leads created) | `leads.created_by` in month | 8 | normalized |
| Follow-ups done | `lead_messages` outbound by user in month | 10 | normalized |
| Lead updations | `lead_stage_history` + `lead_assignment_history` by user | 7 | normalized |
| Low overdue leads | `leads.status='overdue'` assigned to user | 10 | inverse — fewer = higher |
| Inventory maintenance | `inventory_audit_log` actions by user in month | 8 | normalized |
| On-time attendance | `attendance` rows in month with `status='on_time'` ÷ working days | 12 | percentage |

Each sub-score is 0-1 normalized (vs top performer for "more is better", inverse for overdue). Final score = sum of (weight × sub-score), rounded.

## Implementation

1. **DB**: replace the `monthly_sales_leaderboard` view with a new version that:
   - aggregates per `(month, user_id)` across the tables above
   - returns raw counts + each sub-score + `total_score` + `rank_position` (by total_score desc)
   - keeps existing columns (`leads_count`, `qualified_leads`, `closed_deals`, `avg_feedback_score`, `salesperson_name`, `profile_picture_url`, `designation`) so the page keeps working
   - adds: `won_value`, `reviews_collected`, `followups_sent`, `leads_created`, `updates_made`, `overdue_count`, `inventory_actions`, `ontime_days`, `working_days`, `total_score`
   - scopes to users with role `sales` or `admin`

2. **UI** (`src/pages/MonthlyLeaderboard.tsx`):
   - Rank by `total_score`
   - Winner card shows total score + top 3 contributing factors
   - Table adds columns: Score, Won ₹, Reviews, Follow-ups, Overdue, Attendance %
   - Tooltip/expand row showing full breakdown

## Notes
- View is computed live (no cron needed).
- Reviews matched by `customer_feedback.salesperson_name` → `profiles.name` (case-insensitive), same logic the feedback trigger already uses.
- "Working days" excludes Sundays, same convention as `attendance_monthly_user_summary`.
- No schema changes to base tables — only a view replacement, so safe to roll back.

Confirm and I'll ship the migration + UI update. If you want different weights, tell me which to raise/lower.
