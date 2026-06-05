import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SYSTEM_PROMPT = `You are a precise OCR and data-extraction agent specialised in Indian GST tax invoices.
Your ONLY job is to read the invoice image carefully and return exactly what is printed — no guessing, no inferring.
Always use the tool call to return data. Never return plain text.`;

const USER_PROMPT = `Extract all data from this invoice image.

━━━ PHASE 1 — HEADER ━━━
- supplier_name      : Seller / supplier company name (top of invoice)
- supplier_invoice_no: TAX INVOICE number (not PO, not consignment, not vehicle number)
- purchase_date      : Invoice date → format YYYY-MM-DD

━━━ PHASE 2 — LINE ITEMS TABLE ━━━
Find the main goods/items table. Godrej invoices have these columns LEFT TO RIGHT:
  [Sl.No.] | Description of Goods | HSN/SAC | No. of Pkg | Qty | UOM | Rate | Disc% | Taxable Value | GST% | GST Amt | Total

For EVERY product row (skip header rows, subtotal rows, tax rows, blank rows):

┌─ item_name ──────────────────────────────────────────────────────┐
│ Full text from "Description of Goods" column.                    │
│ Could be a product name, or just a model code like "WON037".     │
└──────────────────────────────────────────────────────────────────┘
┌─ item_code ──────────────────────────────────────────────────────┐
│ Model / article / SKU code (e.g. "WON037", "WFM-41-DD-ST").      │
│ If no separate code, extract it from the description.            │
└──────────────────────────────────────────────────────────────────┘
┌─ no_of_packings ─────────────────────────────────────────────────┐
│ Value from "No. of Pkg" column = number of physical cartons/boxes │
│ Example: 1 safe shipped in 39 cartons → no_of_packings = 39      │
│ If the cell is empty, "-", or "0", use null.                     │
└──────────────────────────────────────────────────────────────────┘
┌─ quantity ───────────────────────────────────────────────────────┐
│ Value from "Qty" column = BILLED quantity.                       │
│ ⚠ DIFFERENT from no_of_packings. Do NOT copy no_of_packings here.│
│ Example row: No.of Pkg=39  Qty=1  UOM=EA                        │
│   → no_of_packings=39,  quantity=1                               │
│ Example row: No.of Pkg=1   Qty=39  UOM=KG                       │
│   → no_of_packings=1,   quantity=39                              │
│ VERIFY: quantity × rate × (1 − disc%/100) ≈ Taxable Value       │
└──────────────────────────────────────────────────────────────────┘
┌─ unit ───────────────────────────────────────────────────────────┐
│ Value from "UOM" column (EA, NOS, KG, PCS, SET, etc.)           │
└──────────────────────────────────────────────────────────────────┘
┌─ rate ───────────────────────────────────────────────────────────┐
│ Value from "Rate" column = price per ONE unit.                   │
│ ⚠ NOT "Taxable Value", NOT "Total", NOT "GST Amt".              │
│ VERIFY: quantity × rate ≈ Taxable Value (before GST)             │
└──────────────────────────────────────────────────────────────────┘
┌─ discount_percent ───────────────────────────────────────────────┐
│ Value from "Disc%" column as a plain number. Use 0 if blank.     │
└──────────────────────────────────────────────────────────────────┘
┌─ hsn_code ───────────────────────────────────────────────────────┐
│ Value from "HSN/SAC" column (6–8 digit code).                    │
└──────────────────────────────────────────────────────────────────┘
┌─ gst_percent ────────────────────────────────────────────────────┐
│ Value from "GST%" column as a plain number (5, 12, 18, or 28).  │
│ No "%" symbol.                                                   │
└──────────────────────────────────────────────────────────────────┘

If any field is missing from the invoice, use null.
Include ALL product rows. Return data via the extract_purchase tool.`;

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
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'extract_purchase',
            description: 'Return structured data extracted from the purchase invoice',
            parameters: {
              type: 'object',
              properties: {
                supplier_name: { type: 'string', description: 'Full supplier company name' },
                supplier_invoice_no: { type: 'string', description: 'Tax invoice number' },
                purchase_date: { type: 'string', description: 'Invoice date as YYYY-MM-DD' },
                line_items: {
                  type: 'array',
                  description: 'One entry per product/goods row',
                  items: {
                    type: 'object',
                    properties: {
                      item_name: { type: 'string', description: 'Full description from Description of Goods column' },
                      item_code: { type: 'string', description: 'Model/article/SKU code' },
                      no_of_packings: { type: 'number', description: 'Carton/package count from No. of Pkg column; null if absent' },
                      quantity: { type: 'number', description: 'Billed quantity from Qty column — NOT the packing count' },
                      unit: { type: 'string', description: 'Unit of measure from UOM column' },
                      rate: { type: 'number', description: 'Rate per unit from Rate column — NOT taxable value or total' },
                      discount_percent: { type: 'number', description: 'Discount percentage; 0 if blank' },
                      hsn_code: { type: 'string', description: 'HSN/SAC code' },
                      gst_percent: { type: 'number', description: 'GST rate as plain number (5/12/18/28)' },
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
