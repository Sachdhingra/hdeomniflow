
DROP VIEW IF EXISTS public.monthly_sales_leaderboard;

CREATE VIEW public.monthly_sales_leaderboard
WITH (security_invoker = on)
AS
WITH months AS (
  SELECT DISTINCT date_trunc('month', l.created_at)::date AS month
  FROM public.leads l
  WHERE l.deleted_at IS NULL
  UNION
  SELECT date_trunc('month', now())::date
),
sales_users AS (
  SELECT ur.user_id
  FROM public.user_roles ur
  WHERE ur.role IN ('sales'::app_role, 'admin'::app_role)
),
base AS (
  SELECT m.month, u.user_id
  FROM months m CROSS JOIN sales_users u
),
won AS (
  SELECT date_trunc('month', COALESCE(stage_changed_at, updated_at))::date AS month,
         assigned_to AS user_id,
         COUNT(*) FILTER (WHERE status::text IN ('won','converted'))::int AS closed_deals,
         COALESCE(SUM(value_in_rupees) FILTER (WHERE status::text = 'won'), 0)::numeric AS won_value
  FROM public.leads
  WHERE deleted_at IS NULL AND status::text IN ('won','converted') AND assigned_to IS NOT NULL
  GROUP BY 1, 2
),
created AS (
  SELECT date_trunc('month', created_at)::date AS month,
         created_by AS user_id,
         COUNT(*)::int AS leads_created,
         COUNT(*) FILTER (WHERE status::text IN ('negotiation','follow_up','qualified','hot'))::int AS qualified_leads,
         COUNT(*)::int AS leads_count,
         ROUND(AVG(feedback_score)::numeric, 1) AS avg_feedback_score
  FROM public.leads
  WHERE deleted_at IS NULL AND created_by IS NOT NULL
  GROUP BY 1, 2
),
followups AS (
  SELECT date_trunc('month', sent_at)::date AS month,
         created_by AS user_id,
         COUNT(*)::int AS followups_sent
  FROM public.lead_messages
  WHERE message_type = 'outbound' AND created_by IS NOT NULL
  GROUP BY 1, 2
),
updates AS (
  SELECT month, user_id, SUM(c)::int AS updates_made FROM (
    SELECT date_trunc('month', changed_at)::date AS month, changed_by_id AS user_id, COUNT(*) AS c
      FROM public.lead_stage_history WHERE changed_by_id IS NOT NULL GROUP BY 1, 2
    UNION ALL
    SELECT date_trunc('month', created_at)::date AS month, assigned_by AS user_id, COUNT(*) AS c
      FROM public.lead_assignment_history WHERE assigned_by IS NOT NULL GROUP BY 1, 2
  ) x GROUP BY month, user_id
),
overdue AS (
  SELECT assigned_to AS user_id, COUNT(*)::int AS overdue_count
  FROM public.leads
  WHERE deleted_at IS NULL AND status::text = 'overdue' AND assigned_to IS NOT NULL
  GROUP BY 1
),
reviews AS (
  SELECT date_trunc('month', cf.created_at)::date AS month,
         p.id AS user_id,
         COUNT(*)::int AS reviews_collected
  FROM public.customer_feedback cf
  JOIN public.profiles p ON lower(p.name) = lower(NULLIF(trim(cf.salesperson_name), ''))
  WHERE cf.salesperson_name IS NOT NULL
  GROUP BY 1, 2
),
inv AS (
  SELECT date_trunc('month', created_at)::date AS month,
         created_by AS user_id,
         COUNT(*)::int AS inventory_actions
  FROM public.inventory_audit_log
  WHERE created_by IS NOT NULL
  GROUP BY 1, 2
),
att AS (
  SELECT date_trunc('month', date)::date AS month,
         user_id,
         COUNT(*) FILTER (WHERE status = 'on_time')::int AS ontime_days,
         COUNT(*) FILTER (WHERE clock_in IS NOT NULL)::int AS present_days
  FROM public.attendance
  GROUP BY 1, 2
),
wdays AS (
  SELECT m.month,
         (SELECT COUNT(*)::int FROM generate_series(m.month,
           LEAST((m.month + INTERVAL '1 month' - INTERVAL '1 day')::date,
                 (now() AT TIME ZONE 'Asia/Kolkata')::date), '1 day') d
          WHERE EXTRACT(DOW FROM d) <> 0) AS working_days
  FROM months m
),
joined AS (
  SELECT b.month, b.user_id,
    COALESCE(c.leads_count, 0) AS leads_count,
    COALESCE(c.qualified_leads, 0) AS qualified_leads,
    COALESCE(w.closed_deals, 0) AS closed_deals,
    COALESCE(w.won_value, 0) AS won_value,
    COALESCE(c.leads_created, 0) AS leads_created,
    COALESCE(f.followups_sent, 0) AS followups_sent,
    COALESCE(u.updates_made, 0) AS updates_made,
    COALESCE(o.overdue_count, 0) AS overdue_count,
    COALESCE(r.reviews_collected, 0) AS reviews_collected,
    COALESCE(i.inventory_actions, 0) AS inventory_actions,
    COALESCE(a.ontime_days, 0) AS ontime_days,
    COALESCE(wd.working_days, 0) AS working_days,
    c.avg_feedback_score
  FROM base b
  LEFT JOIN created c ON c.month = b.month AND c.user_id = b.user_id
  LEFT JOIN won w ON w.month = b.month AND w.user_id = b.user_id
  LEFT JOIN followups f ON f.month = b.month AND f.user_id = b.user_id
  LEFT JOIN updates u ON u.month = b.month AND u.user_id = b.user_id
  LEFT JOIN overdue o ON o.user_id = b.user_id
  LEFT JOIN reviews r ON r.month = b.month AND r.user_id = b.user_id
  LEFT JOIN inv i ON i.month = b.month AND i.user_id = b.user_id
  LEFT JOIN att a ON a.month = b.month AND a.user_id = b.user_id
  LEFT JOIN wdays wd ON wd.month = b.month
),
maxes AS (
  SELECT month,
    NULLIF(MAX(won_value), 0) AS max_won_value,
    NULLIF(MAX(closed_deals), 0) AS max_closed,
    NULLIF(MAX(reviews_collected), 0) AS max_reviews,
    NULLIF(MAX(leads_created), 0) AS max_created,
    NULLIF(MAX(followups_sent), 0) AS max_followups,
    NULLIF(MAX(updates_made), 0) AS max_updates,
    NULLIF(MAX(overdue_count), 0) AS max_overdue,
    NULLIF(MAX(inventory_actions), 0) AS max_inv
  FROM joined GROUP BY month
),
scored AS (
  SELECT j.*,
    ROUND(25 * (j.won_value::numeric / COALESCE(m.max_won_value, 1))) AS s_sales,
    ROUND(10 * (j.closed_deals::numeric / COALESCE(m.max_closed, 1))) AS s_closed,
    ROUND(10 * (j.reviews_collected::numeric / COALESCE(m.max_reviews, 1))) AS s_reviews,
    ROUND(8  * (j.leads_created::numeric / COALESCE(m.max_created, 1))) AS s_entry,
    ROUND(10 * (j.followups_sent::numeric / COALESCE(m.max_followups, 1))) AS s_followups,
    ROUND(7  * (j.updates_made::numeric / COALESCE(m.max_updates, 1))) AS s_updates,
    ROUND(10 * (1 - (j.overdue_count::numeric / COALESCE(m.max_overdue, 1)))) AS s_overdue,
    ROUND(8  * (j.inventory_actions::numeric / COALESCE(m.max_inv, 1))) AS s_inventory,
    ROUND(12 * (j.ontime_days::numeric / NULLIF(j.working_days, 0))) AS s_attendance
  FROM joined j
  JOIN maxes m ON m.month = j.month
),
final AS (
  SELECT s.*,
    (COALESCE(s_sales,0) + COALESCE(s_closed,0) + COALESCE(s_reviews,0) + COALESCE(s_entry,0)
     + COALESCE(s_followups,0) + COALESCE(s_updates,0) + COALESCE(s_overdue,0)
     + COALESCE(s_inventory,0) + COALESCE(s_attendance,0))::int AS total_score
  FROM scored s
)
SELECT
  f.month,
  f.user_id,
  COALESCE(sp.full_name, p.name) AS salesperson_name,
  sp.profile_picture_url,
  sp.designation,
  f.leads_count,
  f.qualified_leads,
  f.closed_deals,
  f.avg_feedback_score,
  f.won_value,
  f.leads_created,
  f.followups_sent,
  f.updates_made,
  f.overdue_count,
  f.reviews_collected,
  f.inventory_actions,
  f.ontime_days,
  f.working_days,
  COALESCE(f.s_sales,0)::int AS score_sales,
  COALESCE(f.s_closed,0)::int AS score_closed,
  COALESCE(f.s_reviews,0)::int AS score_reviews,
  COALESCE(f.s_entry,0)::int AS score_entry,
  COALESCE(f.s_followups,0)::int AS score_followups,
  COALESCE(f.s_updates,0)::int AS score_updates,
  COALESCE(f.s_overdue,0)::int AS score_overdue,
  COALESCE(f.s_inventory,0)::int AS score_inventory,
  COALESCE(f.s_attendance,0)::int AS score_attendance,
  f.total_score,
  ROW_NUMBER() OVER (PARTITION BY f.month ORDER BY f.total_score DESC, f.won_value DESC)::int AS rank_position
FROM final f
LEFT JOIN public.staff_profiles sp ON sp.user_id = f.user_id
LEFT JOIN public.profiles p ON p.id = f.user_id
WHERE (f.leads_count + f.closed_deals + f.leads_created + f.followups_sent + f.updates_made
       + f.reviews_collected + f.inventory_actions + f.ontime_days + f.overdue_count) > 0;

GRANT SELECT ON public.monthly_sales_leaderboard TO authenticated;
GRANT SELECT ON public.monthly_sales_leaderboard TO anon;
