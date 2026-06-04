-- 1. Deduplicate existing DM channels.
--    For each user pair that has more than one DM channel, keep the one with the
--    most messages (oldest created_at as tiebreaker) and hard-delete the rest.
--    CASCADE on chat_channel_members and chat_messages handles child rows.

WITH ranked AS (
  SELECT
    c.id                                                        AS channel_id,
    LEAST(m1.user_id::text, m2.user_id::text)                   AS user_a,
    GREATEST(m1.user_id::text, m2.user_id::text)                AS user_b,
    ROW_NUMBER() OVER (
      PARTITION BY
        LEAST(m1.user_id::text, m2.user_id::text),
        GREATEST(m1.user_id::text, m2.user_id::text)
      ORDER BY
        (SELECT COUNT(*) FROM public.chat_messages WHERE channel_id = c.id) DESC,
        c.created_at ASC
    )                                                           AS rn
  FROM public.chat_channels c
  JOIN public.chat_channel_members m1 ON m1.channel_id = c.id
  JOIN public.chat_channel_members m2
    ON m2.channel_id = c.id AND m2.user_id > m1.user_id
  WHERE c.kind = 'dm'
    AND (SELECT COUNT(*) FROM public.chat_channel_members WHERE channel_id = c.id) = 2
)
DELETE FROM public.chat_channels
WHERE id IN (SELECT channel_id FROM ranked WHERE rn > 1);

-- 2. Allow any DM member to delete the DM channel they belong to.
--    (Admins already have full access via the existing admin-all policy.)
CREATE POLICY chat_dm_delete_by_member
  ON public.chat_channels
  FOR DELETE TO authenticated
  USING (
    kind = 'dm'
    AND EXISTS (
      SELECT 1 FROM public.chat_channel_members
      WHERE channel_id = id AND user_id = auth.uid()
    )
  );
