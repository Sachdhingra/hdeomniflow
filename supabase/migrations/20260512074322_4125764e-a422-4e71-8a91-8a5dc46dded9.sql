-- Deduplicate DM channels: keep the oldest channel for each pair, remove duplicates
WITH dm_pairs AS (
  SELECT
    c.id,
    LEAST(m1.user_id, m2.user_id) AS u1,
    GREATEST(m1.user_id, m2.user_id) AS u2,
    c.created_at
  FROM public.chat_channels c
  JOIN public.chat_channel_members m1 ON m1.channel_id = c.id
  JOIN public.chat_channel_members m2 ON m2.channel_id = c.id
  WHERE c.kind = 'dm'
    AND m1.user_id < m2.user_id
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY u1, u2 ORDER BY created_at) AS rn
  FROM dm_pairs
)
DELETE FROM public.chat_messages
WHERE channel_id IN (
  SELECT id FROM ranked WHERE rn > 1
);

WITH dm_pairs AS (
  SELECT
    c.id,
    LEAST(m1.user_id, m2.user_id) AS u1,
    GREATEST(m1.user_id, m2.user_id) AS u2,
    c.created_at
  FROM public.chat_channels c
  JOIN public.chat_channel_members m1 ON m1.channel_id = c.id
  JOIN public.chat_channel_members m2 ON m2.channel_id = c.id
  WHERE c.kind = 'dm'
    AND m1.user_id < m2.user_id
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY u1, u2 ORDER BY created_at) AS rn
  FROM dm_pairs
)
DELETE FROM public.chat_channel_members
WHERE channel_id IN (
  SELECT id FROM ranked WHERE rn > 1
);

WITH dm_pairs AS (
  SELECT
    c.id,
    LEAST(m1.user_id, m2.user_id) AS u1,
    GREATEST(m1.user_id, m2.user_id) AS u2,
    c.created_at
  FROM public.chat_channels c
  JOIN public.chat_channel_members m1 ON m1.channel_id = c.id
  JOIN public.chat_channel_members m2 ON m2.channel_id = c.id
  WHERE c.kind = 'dm'
    AND m1.user_id < m2.user_id
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY u1, u2 ORDER BY created_at) AS rn
  FROM dm_pairs
)
DELETE FROM public.chat_channels
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- Enable delete policy for chat messages: users can delete their own messages
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can delete their own messages"
ON public.chat_messages
FOR DELETE
TO authenticated
USING (sender_id = auth.uid());