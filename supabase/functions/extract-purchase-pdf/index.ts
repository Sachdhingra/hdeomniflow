import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

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

    const content: any[] = [
      {
        type: 'text',
        text: `You are extracting data from a supplier purchase invoice (typically Godrej or similar Indian supplier).
Return ONLY structured data via the tool call.

CRITICAL — Godrej invoices have SEPARATE columns for packings and quantity. Do NOT confuse them:
- no_of_packings = "No. of Pkg" / "No. of Pkgs" / "No. of Packages" / "Packages" / "Cartons" column.
  This is the number of physical boxes/cartons. A safe may ship in 39 cartons (no_of_packings=39).
- quantity       = "Qty" / "Quantity" / "Billed Qty" column — the actual billing unit count (e.g. 1 EA).
  DO NOT put the packing count here. If Qty column says 1, quantity = 1 even if Pkgs = 39.

Field rules:
- supplier_name        : full legal company name from invoice header
- supplier_invoice_no  : tax invoice / invoice number
- purchase_date        : invoice date as YYYY-MM-DD
- line_items           : one object per product row (skip totals, tax summary, blank rows)
  - item_name       : full product description/name (e.g. "FORTE FILING CABINET - 4 DRAWER")
  - item_code       : product model / article / item code (e.g. "WFM-41-DD-ST")
  - no_of_packings  : carton/package count (integer) from "No. of Pkg" column, null if absent
  - quantity        : billing quantity (number) from "Qty" column — NOT from the Pkgs column
  - unit            : unit of measure (EA, NOS, PCS, etc.)
  - rate            : rate PER UNIT from "Rate" column — NOT "Taxable Value" / "Amount" / "Total"
  - discount_percent: discount % as a plain number (0 if blank)
  - hsn_code        : HSN/SAC code
  - gst_percent     : GST rate as a plain number (5, 12, 18, 28)

If any field is missing from the invoice, use null.`,
      },
    ];

    if (pdf_base64) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mime_type || 'application/pdf'};base64,${pdf_base64}` },
      });
    } else {
      content.push({ type: 'image_url', image_url: { url: pdf_url } });
    }

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content }],
        tools: [{
          type: 'function',
          function: {
            name: 'extract_purchase',
            description: 'Return extracted purchase invoice',
            parameters: {
              type: 'object',
              properties: {
                supplier_name: { type: 'string' },
                supplier_invoice_no: { type: 'string' },
                purchase_date: { type: 'string' },
                line_items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      item_name: { type: 'string' },
                      item_code: { type: 'string' },
                      no_of_packings: { type: 'number' },
                      quantity: { type: 'number' },
                      unit: { type: 'string' },
                      rate: { type: 'number' },
                      discount_percent: { type: 'number' },
                      hsn_code: { type: 'string' },
                      gst_percent: { type: 'number' },
                    },
                    required: ['item_name', 'quantity', 'rate'],
                  },
                },
              },
              required: ['supplier_name', 'supplier_invoice_no', 'purchase_date', 'line_items'],
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'extract_purchase' } },
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
