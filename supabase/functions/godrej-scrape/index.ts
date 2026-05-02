// Godrej product scraper using Firecrawl.
// Mode "map": cheap URL discovery only — uses Firecrawl /v2/map per category.
// Mode "scrape": full per-product scrape (JSON extraction). Use after validating map output.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2';

const CATEGORIES: Record<string, string> = {
  Beds: 'https://www.godrejinterio.com/furniture/beds',
  Sofas: 'https://www.godrejinterio.com/furniture/sofas',
  Dining: 'https://www.godrejinterio.com/furniture/dining',
  Wardrobes: 'https://www.godrejinterio.com/furniture/wardrobes',
  Storage: 'https://www.godrejinterio.com/furniture/storage',
  Kitchen: 'https://www.godrejinterio.com/furniture/kitchen',
  Office: 'https://www.godrejinterio.com/furniture/office',
  'Living Room': 'https://www.godrejinterio.com/furniture/living-room',
};

function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    return last
      .replace(/[-_]+/g, ' ')
      .replace(/\.[a-z]+$/i, '')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  } catch {
    return url;
  }
}

async function firecrawlMap(apiKey: string, url: string, limit = 200) {
  const res = await fetch(`${FIRECRAWL_V2}/map`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, limit, includeSubdomains: false }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Firecrawl /map failed [${res.status}]: ${JSON.stringify(data)}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Auth: only admins can trigger
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Admin role required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const mode: 'map' | 'scrape' = body.mode === 'scrape' ? 'scrape' : 'map';
    const categoryFilter: string | undefined = body.category;
    const limitPerCategory: number = Math.min(Number(body.limit) || 100, 500);

    const targets = Object.entries(CATEGORIES).filter(
      ([cat]) => !categoryFilter || cat === categoryFilter,
    );

    // Create run row
    const { data: run, error: runErr } = await admin
      .from('godrej_scrape_runs')
      .insert({ mode, status: 'running', details: { categories: targets.map(([c]) => c) } })
      .select('id')
      .single();
    if (runErr) throw runErr;
    const runId = run.id;

    let categoriesProcessed = 0;
    let urlsDiscovered = 0;
    let upserted = 0;
    let skipped = 0;
    const perCategory: Record<string, { urls: number; upserted: number; error?: string }> = {};

    for (const [category, catUrl] of targets) {
      try {
        const mapResult = await firecrawlMap(apiKey, catUrl, limitPerCategory);
        // Firecrawl /v2/map returns { success, links: [{url,title?}] | string[] }
        const rawLinks: any[] = mapResult.links || mapResult.data?.links || [];
        const links: { url: string; title?: string }[] = rawLinks
          .map((l) => (typeof l === 'string' ? { url: l } : { url: l.url, title: l.title }))
          .filter((l) => !!l.url);

        // Heuristic: only keep URLs that look like product pages (deeper than category root)
        const catPath = new URL(catUrl).pathname.replace(/\/$/, '');
        const productLinks = links.filter((l) => {
          try {
            const p = new URL(l.url).pathname;
            return p.startsWith(catPath + '/') && p.length > catPath.length + 1;
          } catch {
            return false;
          }
        });

        perCategory[category] = { urls: productLinks.length, upserted: 0 };
        urlsDiscovered += productLinks.length;

        if (mode === 'map') {
          // Upsert URL-only stubs
          for (const l of productLinks) {
            const name = (l.title && l.title.trim()) || nameFromUrl(l.url);
            if (!name) {
              skipped++;
              continue;
            }
            const { error: upErr } = await admin
              .from('godrej_products')
              .upsert(
                {
                  category,
                  name,
                  product_url: l.url,
                  scraped_at: new Date().toISOString(),
                  active: true,
                },
                { onConflict: 'product_url' },
              );
            if (upErr) {
              skipped++;
              console.error('upsert error', upErr.message);
            } else {
              upserted++;
              perCategory[category].upserted++;
            }
          }
        }
        // mode 'scrape' intentionally not implemented in this pilot pass.

        categoriesProcessed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        perCategory[category] = { urls: 0, upserted: 0, error: msg };
        console.error(`Category ${category} failed:`, msg);
      }
    }

    await admin
      .from('godrej_scrape_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'completed',
        categories_processed: categoriesProcessed,
        urls_discovered: urlsDiscovered,
        products_upserted: upserted,
        products_skipped: skipped,
        details: { per_category: perCategory },
      })
      .eq('id', runId);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        mode,
        categories_processed: categoriesProcessed,
        urls_discovered: urlsDiscovered,
        products_upserted: upserted,
        products_skipped: skipped,
        per_category: perCategory,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('godrej-scrape error', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
