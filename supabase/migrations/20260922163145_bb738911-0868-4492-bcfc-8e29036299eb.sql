WITH missed(provider_message_id, phone, message_body, received_at) AS (
  VALUES
    ('SM7ebc4f2648624265383e42f0862d1ff9', '7417538391', 'NO, not now',       '2026-09-20 10:06:02+00'::timestamptz),
    ('SMbccf33f928499a30c2faa9902d19ddef', '9917233664', 'NO, not now',       '2026-09-20 07:08:34+00'::timestamptz),
    ('SM103131c34a24e0e8e58b5e25cfcaeebe', '9837036262', 'YES, interested',   '2026-09-20 06:53:51+00'::timestamptz),
    ('SMf6980e4c6af429c5608c1e0dc5b4c7d5', '8410675866', 'YES, interested',   '2026-09-20 06:29:44+00'::timestamptz),
    ('SM9e6afc0da4df6fb973f6bdfe1f249bd8', '9917233664', 'NO, not now',       '2026-09-20 06:24:13+00'::timestamptz),
    ('SM3c6587a4fb466012b1b982098eb80cfb', '9917233664', 'YES, interested',   '2026-09-20 06:24:06+00'::timestamptz),
    ('SMbbef1f66517c2d8a68a0a3fdba07e059', '9084687772', 'YES, interested',   '2026-09-20 06:16:54+00'::timestamptz)
), matched AS (
  SELECT m.*, l.id AS lead_id,
    row_number() OVER (PARTITION BY l.id ORDER BY m.received_at, m.provider_message_id)
      + coalesce(l.conversation_message_count, 0) AS sequence_number
  FROM missed m
  JOIN LATERAL public.find_latest_lead_by_phone(m.phone) l ON true
)
INSERT INTO public.lead_messages (
  lead_id, message_type, message_body, status, sent_at, response_received,
  sentiment, intent, length_category, sequence_number, provider_message_id,
  outreach_source, created_at
)
SELECT
  lead_id, 'inbound', message_body, 'delivered', received_at, true,
  CASE WHEN message_body ILIKE 'YES%' THEN 'positive' ELSE 'negative' END,
  CASE WHEN message_body ILIKE 'YES%' THEN 'interested' ELSE 'not_interested' END,
  'short', sequence_number, provider_message_id, 'inbound', received_at
FROM matched
ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING;

WITH missed(phone, message_body, received_at) AS (
  VALUES
    ('7417538391', 'NO, not now',       '2026-09-20 10:06:02+00'::timestamptz),
    ('9917233664', 'NO, not now',       '2026-09-20 07:08:34+00'::timestamptz),
    ('9837036262', 'YES, interested',   '2026-09-20 06:53:51+00'::timestamptz),
    ('8410675866', 'YES, interested',   '2026-09-20 06:29:44+00'::timestamptz),
    ('9917233664', 'NO, not now',       '2026-09-20 06:24:13+00'::timestamptz),
    ('9917233664', 'YES, interested',   '2026-09-20 06:24:06+00'::timestamptz),
    ('9084687772', 'YES, interested',   '2026-09-20 06:16:54+00'::timestamptz)
), latest AS (
  SELECT DISTINCT ON (l.id) l.id AS lead_id, m.message_body, m.received_at
  FROM missed m
  JOIN LATERAL public.find_latest_lead_by_phone(m.phone) l ON true
  ORDER BY l.id, m.received_at DESC
)
UPDATE public.leads l
SET
  follow_up_reply_state = CASE WHEN latest.message_body ILIKE 'YES%' THEN 'interested' ELSE 'reason_requested' END,
  follow_up_reply_at = latest.received_at,
  last_inbound_sentiment = CASE WHEN latest.message_body ILIKE 'YES%' THEN 'positive' ELSE 'negative' END,
  last_inbound_intent = CASE WHEN latest.message_body ILIKE 'YES%' THEN 'interested' ELSE 'not_interested' END,
  unanswered_outbound_count = 0,
  automation_paused = latest.message_body NOT ILIKE 'YES%',
  needs_personal_call = CASE WHEN latest.message_body ILIKE 'YES%' THEN false ELSE l.needs_personal_call END,
  dead_lead = CASE WHEN latest.message_body ILIKE 'YES%' THEN false ELSE l.dead_lead END,
  conversation_message_count = (SELECT count(*)::integer FROM public.lead_messages lm WHERE lm.lead_id = l.id)
FROM latest
WHERE l.id = latest.lead_id;

WITH recovered AS (
  SELECT lm.lead_id, lm.message_body, lm.created_at,
    l.customer_name, coalesce(l.assigned_to, l.created_by) AS notify_user,
    CASE WHEN lm.message_body ILIKE 'YES%' THEN 'whatsapp_interested' ELSE 'whatsapp_reason_requested' END AS alert_type
  FROM public.lead_messages lm
  JOIN public.leads l ON l.id = lm.lead_id
  WHERE lm.provider_message_id IN (
    'SM7ebc4f2648624265383e42f0862d1ff9', 'SMbccf33f928499a30c2faa9902d19ddef',
    'SM103131c34a24e0e8e58b5e25cfcaeebe', 'SMf6980e4c6af429c5608c1e0dc5b4c7d5',
    'SM9e6afc0da4df6fb973f6bdfe1f249bd8', 'SM3c6587a4fb466012b1b982098eb80cfb',
    'SMbbef1f66517c2d8a68a0a3fdba07e059'
  )
)
INSERT INTO public.notifications (user_id, type, message, link, created_at)
SELECT notify_user, alert_type,
  CASE WHEN alert_type = 'whatsapp_interested'
    THEN '🔥 ' || customer_name || ' is interested — reply now'
    ELSE customer_name || ' said no — reason requested for salesperson review'
  END,
  '/leads', created_at
FROM recovered r
WHERE notify_user IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = r.notify_user AND n.type = r.alert_type
      AND n.message = CASE WHEN r.alert_type = 'whatsapp_interested'
        THEN '🔥 ' || r.customer_name || ' is interested — reply now'
        ELSE r.customer_name || ' said no — reason requested for salesperson review'
      END
      AND n.created_at = r.created_at
  );

WITH recovered AS (
  SELECT DISTINCT ON (lm.lead_id, CASE WHEN lm.message_body ILIKE 'YES%' THEN 'whatsapp_interested' ELSE 'whatsapp_reason_requested' END)
    lm.lead_id, lm.message_body,
    CASE WHEN lm.message_body ILIKE 'YES%' THEN 'whatsapp_interested' ELSE 'whatsapp_reason_requested' END AS alert_type
  FROM public.lead_messages lm
  WHERE lm.provider_message_id IN (
    'SM7ebc4f2648624265383e42f0862d1ff9', 'SMbccf33f928499a30c2faa9902d19ddef',
    'SM103131c34a24e0e8e58b5e25cfcaeebe', 'SMf6980e4c6af429c5608c1e0dc5b4c7d5',
    'SM9e6afc0da4df6fb973f6bdfe1f249bd8', 'SM3c6587a4fb466012b1b982098eb80cfb',
    'SMbbef1f66517c2d8a68a0a3fdba07e059'
  )
  ORDER BY lm.lead_id, alert_type, lm.created_at DESC
)
INSERT INTO public.lead_alerts (lead_id, alert_type, severity, message)
SELECT lead_id, alert_type,
  CASE WHEN alert_type = 'whatsapp_interested' THEN 'critical' ELSE 'warning' END,
  CASE WHEN alert_type = 'whatsapp_interested'
    THEN 'Interested — reply now: ' || left(message_body, 120)
    ELSE 'Customer said no — reason requested'
  END
FROM recovered r
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_alerts a
  WHERE a.lead_id = r.lead_id AND a.alert_type = r.alert_type AND a.resolved = false
);