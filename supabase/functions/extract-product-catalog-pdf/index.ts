import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SYSTEM_PROMPT = `You are a precise data-extraction agent specialised in furniture/home-storage product catalogues and spec sheets.
Your ONLY job is to read the document carefully and return exactly what is printed — no guessing, no inventing prices or specs that aren't stated.
Always use the tool call to return data. Never return plain text.`;

const USER_PROMPT = `Extract a product catalogue from this document. It may describe a single product or many products belonging to one category.

━━━ CATEGORY ━━━
- category_name: The overall product category/collection this document represents (e.g. "Home Storage", "Modular Wardrobes"). If the document is about a single product line, use that line's name.
- category_description: A short 1-2 sentence description of the category, if inferable. Null if not clear.

━━━ PRODUCTS ━━━
For EVERY distinct product/model in the document (skip section headers, cover pages, terms & conditions):
- sku: Model/article/SKU code if printed. Null if absent — do not invent one.
- name: Product name / model name.
- description: Short description or summary text for the product. Null if absent.
- features: Array of bullet-point features/highlights as printed. Empty array if none.
- dimensions: Dimensions as printed (e.g. "180cm x 60cm x 210cm (LxWxH)"). Null if absent.
- warranty: Warranty text as printed (e.g. "5 years on hardware"). Null if absent.
- mrp: Maximum retail / list price as a plain number (no currency symbol, no commas). Null if not printed.
- offer_price: Discounted/offer/selling price as a plain number, if different from MRP. Null if not printed.
- gst_percent: GST rate as a plain number if printed (5/12/18/28). Null if not printed.
- specifications: Array of {spec_group, label, value} for any spec table rows (e.g. material, finish, capacity). spec_group is the section heading the spec falls under (e.g. "Build", "Capacity"), null if ungrouped.
- variants: Array of {colour, size, finish, mrp, offer_price} for any colour/size/finish variants of the SAME product listed with their own price. Empty array if the product has no variants.

If a document lists totally unrelated product lines under different categories, still return ONE category (the most prominent / first one) and only the products that belong to it — do not mix categories.

Return data via the extract_catalog tool.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { pdf_base64, pdf_url, mime_type } = await req.json();
    if (!pdf_base64 && !pdf_url) {
      return new Response(JSON.stringify({ error: 'pdf_base64 or pdf_url is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not set' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userContent: any[] = [
      { type: 'text', text: USER_PROMPT },
    ];

    if (pdf_base64) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${mime_type || 'application/pdf'};base64,${pdf_base64}` },
      });
    } else {
      userContent.push({ type: 'image_url', image_url: { url: pdf_url } });
    }

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'extract_catalog',
            description: 'Return structured category + product data extracted from the catalogue document',
            parameters: {
              type: 'object',
              properties: {
                category_name: { type: 'string', description: 'The product category this document represents' },
                category_description: { type: 'string', description: 'Short category description; null if not inferable' },
                products: {
                  type: 'array',
                  description: 'One entry per distinct product/model',
                  items: {
                    type: 'object',
                    properties: {
                      sku: { type: 'string', description: 'Model/article/SKU code; null if not printed' },
                      name: { type: 'string', description: 'Product name / model name' },
                      description: { type: 'string', description: 'Short product description; null if absent' },
                      features: { type: 'array', items: { type: 'string' }, description: 'Bullet-point features/highlights' },
                      dimensions: { type: 'string', description: 'Dimensions as printed; null if absent' },
                      warranty: { type: 'string', description: 'Warranty text as printed; null if absent' },
                      mrp: { type: 'number', description: 'MRP / list price as a plain number; null if not printed' },
                      offer_price: { type: 'number', description: 'Offer/selling price as a plain number; null if not printed' },
                      gst_percent: { type: 'number', description: 'GST rate as a plain number; null if not printed' },
                      specifications: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            spec_group: { type: 'string', description: 'Section heading for this spec; null if ungrouped' },
                            label: { type: 'string' },
                            value: { type: 'string' },
                          },
                          required: ['label', 'value'],
                        },
                      },
                      variants: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            colour: { type: 'string' },
                            size: { type: 'string' },
                            finish: { type: 'string' },
                            mrp: { type: 'number' },
                            offer_price: { type: 'number' },
                          },
                        },
                      },
                    },
                    required: ['name'],
                  },
                },
              },
              required: ['category_name', 'products'],
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'extract_catalog' } },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error('AI error', aiRes.status, t);
      if (aiRes.status === 429) return new Response(JSON.stringify({ error: 'Rate limit exceeded, please retry shortly.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (aiRes.status === 402) return new Response(JSON.stringify({ error: 'AI credits exhausted. Please top up Lovable AI workspace.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: 'AI extraction failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data = await aiRes.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall ? JSON.parse(toolCall.function.arguments) : null;
    if (!args) {
      return new Response(JSON.stringify({ error: 'No extraction returned' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(args), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
