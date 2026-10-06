import { plDb, lineTotal, quoteTotals } from "@/lib/productLibrary";
import { downloadQuoteExcel, type QuoteExcelLine, type QuoteExcelMeta } from "@/lib/quoteExcel";
import { downloadQuotePdf } from "@/lib/quotePdf";
import type { QuoteLine } from "@/contexts/QuoteContext";

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected";

export const QUOTE_STATUSES: { value: QuoteStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
];

export const CONTACT_LINE = "CONTACT: 9917233664 / SACHIN DHINGRA / EMAIL: SACHDHINGRA@GMAIL.COM";

/** Everything about a quote except its product lines. */
export interface QuoteMeta {
  quoteId: string | null;
  quoteNumber: string | null;
  status: QuoteStatus;
  customerName: string;
  customerPhone: string;
  billingAddress: string;
  deliveryAddress: string;
  handlingCharges: number;
  leadId: string | null;
  leadLabel: string | null;
}

export const EMPTY_META: QuoteMeta = {
  quoteId: null,
  quoteNumber: null,
  status: "draft",
  customerName: "",
  customerPhone: "",
  billingAddress: "",
  deliveryAddress: "",
  handlingCharges: 0,
  leadId: null,
  leadLabel: null,
};

export interface SavedQuoteRow {
  id: string;
  quote_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  handling_charges: number;
  subtotal: number;
  gst_total: number;
  grand_total: number;
  status: QuoteStatus;
  lead_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export interface LeadOption {
  id: string;
  customer_name: string;
  customer_phone: string;
}

export const leadLabel = (l: Pick<LeadOption, "customer_name" | "customer_phone">) =>
  `${l.customer_name}${l.customer_phone ? ` · ${l.customer_phone}` : ""}`;

/** Leads the user can see (RLS), matched on name or phone. */
export async function searchLeads(term: string): Promise<LeadOption[]> {
  let q = plDb
    .from("leads")
    .select("id, customer_name, customer_phone")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  const t = term.trim().replace(/[%,()]/g, " ");
  if (t) q = q.or(`customer_name.ilike.%${t}%,customer_phone.ilike.%${t}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as LeadOption[];
}

/**
 * Save the quote: creates it (the database assigns the quote number) or updates the
 * existing one and replaces its lines. Returns the saved id and number.
 */
export async function saveQuote(
  lines: QuoteLine[],
  meta: QuoteMeta,
): Promise<{ id: string; quote_number: string }> {
  const totals = quoteTotals(lines);
  const handling = Number(meta.handlingCharges) || 0;
  const header = {
    customer_name: meta.customerName.trim() || null,
    customer_phone: meta.customerPhone.trim() || null,
    billing_address: meta.billingAddress.trim() || null,
    delivery_address: meta.deliveryAddress.trim() || null,
    handling_charges: handling,
    subtotal: totals.subtotal,
    gst_total: totals.gstTotal,
    grand_total: Math.round((totals.grandTotal + handling) * 100) / 100,
    lead_id: meta.leadId,
  };

  let saved: { id: string; quote_number: string };
  if (meta.quoteId) {
    const { data, error } = await plDb
      .from("quotes")
      .update(header)
      .eq("id", meta.quoteId)
      .select("id, quote_number")
      .single();
    if (error) throw error;
    saved = data;
    const { error: delErr } = await plDb.from("quote_items").delete().eq("quote_id", saved.id);
    if (delErr) throw delErr;
  } else {
    const { data, error } = await plDb
      .from("quotes")
      .insert({ ...header, status: "draft" })
      .select("id, quote_number")
      .single();
    if (error) throw error;
    saved = data;
  }

  if (lines.length) {
    const rows = lines.map((i, idx) => ({
      quote_id: saved.id,
      product_id: i.product_id,
      variant_id: i.variant_id,
      image_url: i.image_url,
      image_source: i.image_source ?? null,
      product_name: i.product_name,
      sku: i.sku,
      description: i.description,
      quantity: i.quantity,
      unit_price: i.unit_price,
      gst_percent: i.gst_percent,
      discount_percent: i.discount_percent || 0,
      total: lineTotal(i.quantity, i.unit_price, i.gst_percent, i.discount_percent || 0),
      sort_order: idx,
    }));
    const { error } = await plDb.from("quote_items").insert(rows);
    if (error) throw error;
  }
  return saved;
}

export async function listQuotes(): Promise<SavedQuoteRow[]> {
  const { data, error } = await plDb
    .from("quotes")
    .select(
      "id, quote_number, customer_name, customer_phone, billing_address, delivery_address, handling_charges, subtotal, gst_total, grand_total, status, lead_id, created_by, created_at, updated_at, sent_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as SavedQuoteRow[];
}

export async function listQuotesForLead(leadId: string): Promise<SavedQuoteRow[]> {
  const { data, error } = await plDb
    .from("quotes")
    .select("id, quote_number, customer_name, grand_total, status, created_at, sent_at, created_by, lead_id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as SavedQuoteRow[];
}

/** A saved quote as cart lines + meta, ready to edit or re-export. */
export async function loadQuote(id: string): Promise<{ meta: QuoteMeta; lines: QuoteLine[] }> {
  const [{ data: q, error }, { data: items, error: itemErr }] = await Promise.all([
    plDb.from("quotes").select("*").eq("id", id).single(),
    plDb.from("quote_items").select("*").eq("quote_id", id).order("sort_order"),
  ]);
  if (error) throw error;
  if (itemErr) throw itemErr;

  let label: string | null = null;
  if (q.lead_id) {
    const { data: lead } = await plDb
      .from("leads")
      .select("customer_name, customer_phone")
      .eq("id", q.lead_id)
      .maybeSingle();
    label = lead ? leadLabel(lead) : "Linked lead";
  }

  return {
    meta: {
      quoteId: q.id,
      quoteNumber: q.quote_number,
      status: q.status,
      customerName: q.customer_name || "",
      customerPhone: q.customer_phone || "",
      billingAddress: q.billing_address || "",
      deliveryAddress: q.delivery_address || "",
      handlingCharges: Number(q.handling_charges) || 0,
      leadId: q.lead_id,
      leadLabel: label,
    },
    lines: (items || []).map((i: Record<string, unknown>) => ({
      id: crypto.randomUUID(),
      product_id: (i.product_id as string) ?? null,
      variant_id: (i.variant_id as string) ?? null,
      image_url: (i.image_url as string) ?? null,
      image_source: ((i.image_source as QuoteLine["image_source"]) ?? null),
      product_name: i.product_name as string,
      sku: (i.sku as string) ?? null,
      description: (i.description as string) ?? null,
      quantity: Number(i.quantity) || 1,
      unit_price: Number(i.unit_price) || 0,
      gst_percent: Number(i.gst_percent) || 0,
      discount_percent: Number(i.discount_percent) || 0,
    })),
  };
}

/** Status change; "sent" also stamps when it was first sent. The database moves the linked deal. */
export async function setQuoteStatus(id: string, status: QuoteStatus, alreadySentAt?: string | null) {
  const patch: Record<string, unknown> = { status };
  if (status !== "draft" && !alreadySentAt) patch.sent_at = new Date().toISOString();
  const { error } = await plDb.from("quotes").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteQuote(id: string) {
  const { error } = await plDb.from("quotes").delete().eq("id", id);
  if (error) throw error;
}

function exportArgs(lines: QuoteLine[], meta: QuoteMeta, quoteDate: Date): [QuoteExcelLine[], QuoteExcelMeta] {
  return [
    lines.map((i) => ({
      image_url: i.image_url,
      product_name: i.product_name,
      sku: i.sku,
      unit_price: i.unit_price,
      discount_percent: i.discount_percent || 0,
      gst_percent: i.gst_percent,
      quantity: i.quantity,
    })),
    {
      customerName: meta.customerName,
      billingAddress: meta.billingAddress,
      deliveryAddress: meta.deliveryAddress,
      quoteNumber: meta.quoteNumber || "Quotation",
      quoteDate: quoteDate.toLocaleDateString("en-GB"),
      handlingCharges: Number(meta.handlingCharges) || 0,
      contactLine: CONTACT_LINE,
    },
  ];
}

export function downloadSavedQuoteExcel(lines: QuoteLine[], meta: QuoteMeta, quoteDate = new Date()) {
  return downloadQuoteExcel(...exportArgs(lines, meta, quoteDate));
}

/** Quotation PDF on the HDE letterhead. */
export function downloadSavedQuotePdf(lines: QuoteLine[], meta: QuoteMeta, quoteDate = new Date()) {
  return downloadQuotePdf(...exportArgs(lines, meta, quoteDate));
}
