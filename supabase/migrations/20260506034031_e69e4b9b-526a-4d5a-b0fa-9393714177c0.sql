
-- ============ TABLES ============
CREATE TABLE public.chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  kind text NOT NULL DEFAULT 'group' CHECK (kind IN ('group','dm')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_default boolean NOT NULL DEFAULT false
);

CREATE TABLE public.chat_channel_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, user_id)
);
CREATE INDEX idx_ccm_user ON public.chat_channel_members(user_id);
CREATE INDEX idx_ccm_channel ON public.chat_channel_members(channel_id);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL DEFAULT '',
  file_url text,
  pinned boolean NOT NULL DEFAULT false,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_channel_created ON public.chat_messages(channel_id, created_at DESC);

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- ============ HELPERS ============
CREATE OR REPLACE FUNCTION public.has_chat_access(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin'::app_role,'sales'::app_role,'accounts'::app_role,'service_head'::app_role)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_chat_member(_channel uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channel_members
    WHERE channel_id = _channel AND user_id = _user
  );
$$;

-- ============ POLICIES: channels ============
CREATE POLICY chat_channels_select ON public.chat_channels FOR SELECT TO authenticated
USING (has_chat_access(auth.uid()) AND (is_chat_member(id, auth.uid()) OR has_role(auth.uid(),'admin'::app_role)));

CREATE POLICY chat_channels_insert ON public.chat_channels FOR INSERT TO authenticated
WITH CHECK (has_chat_access(auth.uid()) AND created_by = auth.uid());

CREATE POLICY chat_channels_admin_all ON public.chat_channels FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- ============ POLICIES: members ============
CREATE POLICY ccm_select ON public.chat_channel_members FOR SELECT TO authenticated
USING (has_chat_access(auth.uid()) AND (user_id = auth.uid() OR is_chat_member(channel_id, auth.uid()) OR has_role(auth.uid(),'admin'::app_role)));

CREATE POLICY ccm_insert_self ON public.chat_channel_members FOR INSERT TO authenticated
WITH CHECK (has_chat_access(auth.uid()) AND user_id = auth.uid());

CREATE POLICY ccm_update_self ON public.chat_channel_members FOR UPDATE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY ccm_admin_all ON public.chat_channel_members FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- ============ POLICIES: messages ============
CREATE POLICY msg_select ON public.chat_messages FOR SELECT TO authenticated
USING (has_chat_access(auth.uid()) AND (is_chat_member(channel_id, auth.uid()) OR has_role(auth.uid(),'admin'::app_role)));

CREATE POLICY msg_insert ON public.chat_messages FOR INSERT TO authenticated
WITH CHECK (has_chat_access(auth.uid()) AND sender_id = auth.uid() AND is_chat_member(channel_id, auth.uid()));

CREATE POLICY msg_update_own ON public.chat_messages FOR UPDATE TO authenticated
USING (sender_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role))
WITH CHECK (sender_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY msg_delete_own ON public.chat_messages FOR DELETE TO authenticated
USING (sender_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role));

-- ============ ENSURE DEFAULT CHANNELS ============
CREATE OR REPLACE FUNCTION public.ensure_default_chat_channels(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_role app_role;
  v_general uuid; v_delivery uuid; v_sales uuid; v_ops uuid;
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = _user LIMIT 1;
  IF v_role NOT IN ('admin','sales','accounts','service_head') THEN
    RETURN;
  END IF;

  -- Create channels if not exist
  SELECT id INTO v_general FROM public.chat_channels WHERE name='general' AND is_default=true LIMIT 1;
  IF v_general IS NULL THEN
    INSERT INTO public.chat_channels(name,description,kind,created_by,is_default)
    VALUES ('general','Company announcements','group',_user,true) RETURNING id INTO v_general;
  END IF;

  SELECT id INTO v_delivery FROM public.chat_channels WHERE name='delivery' AND is_default=true LIMIT 1;
  IF v_delivery IS NULL THEN
    INSERT INTO public.chat_channels(name,description,kind,created_by,is_default)
    VALUES ('delivery','Coordinate deliveries','group',_user,true) RETURNING id INTO v_delivery;
  END IF;

  SELECT id INTO v_sales FROM public.chat_channels WHERE name='sales' AND is_default=true LIMIT 1;
  IF v_sales IS NULL THEN
    INSERT INTO public.chat_channels(name,description,kind,created_by,is_default)
    VALUES ('sales','Lead and order discussions','group',_user,true) RETURNING id INTO v_sales;
  END IF;

  SELECT id INTO v_ops FROM public.chat_channels WHERE name='operations' AND is_default=true LIMIT 1;
  IF v_ops IS NULL THEN
    INSERT INTO public.chat_channels(name,description,kind,created_by,is_default)
    VALUES ('operations','Operations updates','group',_user,true) RETURNING id INTO v_ops;
  END IF;

  -- Add user to channels they belong to
  INSERT INTO public.chat_channel_members(channel_id,user_id) VALUES (v_general,_user) ON CONFLICT DO NOTHING;

  IF v_role IN ('admin','accounts','service_head') THEN
    INSERT INTO public.chat_channel_members(channel_id,user_id) VALUES (v_delivery,_user) ON CONFLICT DO NOTHING;
  END IF;

  IF v_role IN ('admin','sales','accounts') THEN
    INSERT INTO public.chat_channel_members(channel_id,user_id) VALUES (v_sales,_user) ON CONFLICT DO NOTHING;
  END IF;

  IF v_role IN ('admin','accounts','service_head') THEN
    INSERT INTO public.chat_channel_members(channel_id,user_id) VALUES (v_ops,_user) ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- ============ DM HELPER ============
CREATE OR REPLACE FUNCTION public.get_or_create_dm_channel(_other uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_self uuid := auth.uid();
  v_channel uuid;
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT has_chat_access(v_self) OR NOT has_chat_access(_other) THEN
    RAISE EXCEPTION 'chat access denied';
  END IF;

  SELECT c.id INTO v_channel
  FROM public.chat_channels c
  WHERE c.kind='dm'
    AND EXISTS (SELECT 1 FROM public.chat_channel_members m WHERE m.channel_id=c.id AND m.user_id=v_self)
    AND EXISTS (SELECT 1 FROM public.chat_channel_members m WHERE m.channel_id=c.id AND m.user_id=_other)
    AND (SELECT COUNT(*) FROM public.chat_channel_members m WHERE m.channel_id=c.id) = 2
  LIMIT 1;

  IF v_channel IS NOT NULL THEN RETURN v_channel; END IF;

  INSERT INTO public.chat_channels(name,kind,created_by) VALUES ('dm','dm',v_self) RETURNING id INTO v_channel;
  INSERT INTO public.chat_channel_members(channel_id,user_id) VALUES (v_channel,v_self),(v_channel,_other);
  RETURN v_channel;
END;
$$;

-- ============ REALTIME ============
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_channels REPLICA IDENTITY FULL;
ALTER TABLE public.chat_channel_members REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_channels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_channel_members;
