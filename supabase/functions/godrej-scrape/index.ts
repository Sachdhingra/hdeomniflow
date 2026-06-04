// Godrej product scraper using Firecrawl.
// Modes:
//   "map":      cheap URL discovery via /v2/map per category (sitemap-style).
//   "discover": JS-rendered category page scrape via /v2/scrape with waitFor,
//               extracts product links from the rendered page.
//   "scrape":   per-product detail scrape via /v2/scrape with JSON extraction.
//               Reads pending product_urls from godrej_products and fills in
//               name/price/image/description/product_code.

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
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, limit, includeSubdomains: false }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Firecrawl /map failed [${res.status}]: ${JSON.stringify(data)}`);
  return data;
}

async function firecrawlScrape(apiKey: string, url: string, opts: any = {}) {
  const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, ...opts }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Firecrawl /scrape failed [${res.status}]: ${JSON.stringify(data)}`);
  return data;
}

function looksLikeProductUrl(productPath: string, catPath: string): boolean {
  if (!productPath.startsWith(catPath + '/')) return false;
  const tail = productPath.slice(catPath.length + 1);
  if (!tail || tail.includes('/')) return false; // direct child only
  // Filter out obvious non-product slugs
  if (/^(page|filter|sort|all|category|categories)$/i.test(tail)) return false;
  return true;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await admin
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));

    // research mode: general-purpose URL scrape, returns markdown content
    if (body.mode === 'research') {
      const url: string = (body.url ?? '').trim();
      if (!url) return new Response(JSON.stringify({ success: false, error: 'url is required' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      new URL(url); // validate — throws on bad URL

      const fcRes = await fetch(`${FIRECRAWL_V2}/scrape`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown', 'links'], onlyMainContent: true, waitFor: 2000 }),
      });
      const fcData = await fcRes.json();
      if (!fcRes.ok) {
        const errMsg = fcData?.error || fcData?.message || `Firecrawl error [${fcRes.status}]`;
        return new Response(JSON.stringify({ success: false, error: errMsg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const markdown: string = (fcData.markdown || fcData.data?.markdown || '').slice(0, 50000);
      const meta = fcData.metadata || fcData.data?.metadata || {};
      const title: string = meta.title || '';
      const description: string = meta.description || '';
      const links: string[] = (fcData.links || fcData.data?.links || []).slice(0, 100);

      // Best-effort persist to firecrawl_research table
      const { data: row, error: insertErr } = await admin
        .from('firecrawl_research')
        .insert({ url, title, description, markdown, links, created_by: userId })
        .select('id, scraped_at')
        .single();
      if (insertErr) console.error('research insert error:', insertErr.message);

      return new Response(
        JSON.stringify({ success: true, id: row?.id, url, title, description, markdown, links, scraped_at: row?.scraped_at ?? new Date().toISOString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const mode: 'map' | 'discover' | 'scrape' =
      body.mode === 'scrape' ? 'scrape' : body.mode === 'discover' ? 'discover' : 'map';
    const categoryFilter: string | undefined = body.category;
    const limitPerCategory: number = Math.min(Number(body.limit) || 100, 500);
    const productLimit: number = Math.min(Number(body.product_limit) || 25, 200);

    const { data: run, error: runErr } = await admin
      .from('godrej_scrape_runs')
      .insert({ mode, status: 'running', details: { categories: Object.keys(CATEGORIES) } })
      .select('id').single();
    if (runErr) throw runErr;
    const runId = run.id;

    let categoriesProcessed = 0;
    let urlsDiscovered = 0;
    let upserted = 0;
    let skipped = 0;
    const perCategory: Record<string, { urls: number; upserted: number; error?: string }> = {};

    if (mode === 'map' || mode === 'discover') {
      const targets = Object.entries(CATEGORIES).filter(
        ([cat]) => !categoryFilter || cat === categoryFilter,
      );

      for (const [category, catUrl] of targets) {
        try {
          const catPath = new URL(catUrl).pathname.replace(/\/$/, '');
          let productLinks: { url: string; title?: string }[] = [];

          if (mode === 'map') {
            const mapResult = await firecrawlMap(apiKey, catUrl, limitPerCategory);
            const rawLinks: any[] = mapResult.links || mapResult.data?.links || [];
            productLinks = rawLinks
              .map((l) => (typeof l === 'string' ? { url: l } : { url: l.url, title: l.title }))
              .filter((l) => !!l.url)
              .filter((l) => {
                try { return looksLikeProductUrl(new URL(l.url).pathname, catPath); }
                catch { return false; }
              });
          } else {
            // discover: JS-rendered scrape, then parse links
            const scr = await firecrawlScrape(apiKey, catUrl, {
              formats: ['links', 'html'],
              onlyMainContent: false,
              waitFor: 5000,
            });
            const linksRaw: string[] =
              scr.links || scr.data?.links || [];
            const seen = new Set<string>();
            for (const u of linksRaw) {
              try {
                const abs = new URL(u, catUrl).toString().split('#')[0];
                const p = new URL(abs).pathname;
                if (!looksLikeProductUrl(p, catPath)) continue;
                if (seen.has(abs)) continue;
                seen.add(abs);
                productLinks.push({ url: abs });
              } catch { /* skip */ }
            }
            console.log(`${category}: Found ${productLinks.length} product links`);
          }

          perCategory[category] = { urls: productLinks.length, upserted: 0 };
          urlsDiscovered += productLinks.length;

          for (const l of productLinks) {
            const name = (l.title && l.title.trim()) || nameFromUrl(l.url);
            if (!name) { skipped++; continue; }
            const { error: upErr } = await admin
              .from('godrej_products')
              .upsert({
                category,
                name,
                product_url: l.url,
                scraped_at: new Date().toISOString(),
                active: true,
              }, { onConflict: 'product_url' });
            if (upErr) { skipped++; console.error('upsert error', upErr.message); }
            else { upserted++; perCategory[category].upserted++; }
          }

          categoriesProcessed++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          perCategory[category] = { urls: 0, upserted: 0, error: msg };
          console.error(`Category ${category} failed:`, msg);
        }
      }
    } else {
      // mode === 'scrape': fetch per-product details
      let q = admin
        .from('godrej_products')
        .select('id, category, product_url, name, price, image_url, description')
        .eq('active', true)
        .order('scraped_at', { ascending: true })
        .limit(productLimit);
      if (categoryFilter) q = q.eq('category', categoryFilter);
      // Only re-scrape rows missing price OR image
      const { data: rows, error: rowsErr } = await q;
      if (rowsErr) throw rowsErr;

      const pending = (rows || []).filter((r: any) => !r.price || !r.image_url);
      console.log(`Scraping ${pending.length}/${rows?.length ?? 0} products...`);

      const extractSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'string' },
          image_url: { type: 'string' },
          description: { type: 'string' },
          product_code: { type: 'string' },
        },
      };

      let i = 0;
      for (const row of pending as any[]) {
        i++;
        try {
          const scr = await firecrawlScrape(apiKey, row.product_url, {
            formats: [{ type: 'json', schema: extractSchema, prompt:
              'Extract the product name (h1/title), price (with currency symbol), main product image URL, short description, and product code/SKU if shown.' }],
            onlyMainContent: true,
            waitFor: 3000,
          });
          const j = scr.json || scr.data?.json || {};
          const price = (j.price || '').toString().trim() || null;
          const priceNumeric = price ? Number((price.match(/[\d,]+/g)?.join('') || '').replace(/,/g, '')) || null : null;
          const update: any = {
            name: (j.name || '').toString().trim() || row.name,
            price,
            price_numeric: priceNumeric,
            image_url: (j.image_url || '').toString().trim() || null,
            description: (j.description || '').toString().trim() || null,
            product_code: (j.product_code || '').toString().trim() || null,
            scraped_at: new Date().toISOString(),
          };
          const { error: uErr } = await admin
            .from('godrej_products').update(update).eq('id', row.id);
          if (uErr) { skipped++; console.error('update error', uErr.message); }
          else {
            upserted++;
            console.log(`Scraped ${i}/${pending.length}: ${update.name} - ${update.price ?? 'n/a'}`);
          }
        } catch (e) {
          skipped++;
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`Product ${row.product_url} failed:`, msg);
        }
        await sleep(1000);
      }
      categoriesProcessed = 1;
      urlsDiscovered = pending.length;
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
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
