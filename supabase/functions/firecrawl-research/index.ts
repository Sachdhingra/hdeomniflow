import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ success: false, error: 'Unauthorized' });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: 'Unauthorized' });

    const userId = userData.user.id;
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await admin
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleRow) return json({ success: false, error: 'Admin role required' });

    const body = await req.json().catch(() => ({}));
    const url: string = (body.url ?? '').trim();
    if (!url) throw new Error('url is required');
    new URL(url); // validate

    const fcRes = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'links'],
        onlyMainContent: true,
        waitFor: 2000,
      }),
    });
    const fcData = await fcRes.json();
    if (!fcRes.ok) throw new Error(`Firecrawl error [${fcRes.status}]: ${JSON.stringify(fcData)}`);

    const markdown: string = (fcData.markdown || fcData.data?.markdown || '').slice(0, 50000);
    const meta = fcData.metadata || fcData.data?.metadata || {};
    const title: string = meta.title || '';
    const description: string = meta.description || '';
    const links: string[] = (fcData.links || fcData.data?.links || []).slice(0, 100);

    const { data: row, error: insertErr } = await admin
      .from('firecrawl_research')
      .insert({ url, title, description, markdown, links, created_by: userId })
      .select('id, scraped_at')
      .single();
    if (insertErr) console.error('insert error', insertErr.message);

    return json({ success: true, id: row?.id, url, title, description, markdown, links, scraped_at: row?.scraped_at ?? new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('firecrawl-research error', msg);
    // Always return 200 so the client receives the error body
    return json({ success: false, error: msg });
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
