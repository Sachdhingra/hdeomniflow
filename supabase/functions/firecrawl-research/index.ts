import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Resolve API key: env var first, then app_settings table
    let apiKey = Deno.env.get('FIRECRAWL_API_KEY') ?? '';
    if (!apiKey) {
      const { data: setting } = await admin
        .from('app_settings').select('value').eq('key', 'FIRECRAWL_API_KEY').maybeSingle();
      apiKey = setting?.value ?? '';
    }
    if (!apiKey) return ok({ success: false, error: 'FIRECRAWL_API_KEY not configured' });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer '))
      return ok({ success: false, error: 'Unauthorized' });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return ok({ success: false, error: 'Unauthorized' });

    const userId = userData.user.id;
    const { data: roleRow } = await admin
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleRow) return ok({ success: false, error: 'Admin role required' });

    const body = await req.json().catch(() => ({}));
    const url: string = (body.url ?? '').trim();
    if (!url) return ok({ success: false, error: 'url is required' });
    try { new URL(url); } catch { return ok({ success: false, error: 'Invalid URL' }); }

    const fcRes = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown', 'links'], onlyMainContent: true, waitFor: 2000 }),
    });

    // Safe JSON parse — Firecrawl can return plain-text errors
    const rawText = await fcRes.text();
    let fcData: any = {};
    try { fcData = JSON.parse(rawText); } catch { /* leave as {} */ }

    if (!fcRes.ok) {
      const errMsg = fcData?.error || fcData?.message || rawText || `Firecrawl error [${fcRes.status}]`;
      return ok({ success: false, error: errMsg });
    }

    const markdown: string = (fcData.markdown || fcData.data?.markdown || '').slice(0, 50000);
    const meta = fcData.metadata || fcData.data?.metadata || {};
    const title: string = (meta.title || '').slice(0, 500);
    const description: string = (meta.description || '').slice(0, 1000);
    const links: string[] = (fcData.links || fcData.data?.links || []).slice(0, 100);

    const { data: row, error: insertErr } = await admin
      .from('firecrawl_research')
      .insert({ url, title, description, markdown, links, created_by: userId })
      .select('id, scraped_at')
      .single();
    if (insertErr) console.error('insert error:', insertErr.message);

    return ok({ success: true, id: row?.id, url, title, description, markdown, links, scraped_at: row?.scraped_at ?? new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('firecrawl-research error:', msg);
    return ok({ success: false, error: msg });
  }
});

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
