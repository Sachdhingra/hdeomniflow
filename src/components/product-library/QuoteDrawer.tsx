import { useState } from "react";
import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Save, Share2, FileText, FileSpreadsheet, FilePlus2, History, Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useQuote } from "@/contexts/QuoteContext";
import { money, lineTotal, priceBreakdown } from "@/lib/productLibrary";
import {
  QUOTE_STATUSES,
  downloadSavedQuoteExcel,
  leadLabel,
  saveQuote as persistQuote,
  setQuoteStatus,
} from "@/lib/savedQuotes";
import QuoteLineImage from "./QuoteLineImage";
import AddFromInventory from "./AddFromInventory";
import LeadPicker from "./LeadPicker";
import { toast } from "@/lib/toast";

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

const QuoteDrawer = () => {
  const {
    items,
    open,
    setOpen,
    updateItem,
    removeItem,
    meta,
    setMeta,
    startNew,
    subtotal,
    gstTotal,
    grandTotal,
  } = useQuote();
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const statusLabel = QUOTE_STATUSES.find((s) => s.value === meta.status)?.label ?? meta.status;

  /** Create or update the saved quote; returns its number. */
  const save = async () => {
    const saved = await persistQuote(items, meta);
    const patch = { quoteId: saved.id, quoteNumber: saved.quote_number };
    setMeta(patch);
    return { ...meta, ...patch };
  };

  const saveQuote = async () => {
    if (!items.length) return;
    setSaving(true);
    try {
      const saved = await save();
      toast.success(`Quote ${saved.quoteNumber} saved`);
    } catch (e) {
      toast.error(errorText(e, "Could not save quote"));
    } finally {
      setSaving(false);
    }
  };

  // Saves first, so every downloaded quotation has a real number and is on record.
  const exportExcel = async () => {
    if (!items.length) return;
    setExporting(true);
    try {
      const saved = await save();
      await downloadSavedQuoteExcel(items, saved);
      toast.success(`Quotation ${saved.quoteNumber} downloaded`);
    } catch (e) {
      toast.error(errorText(e, "Could not generate Excel"));
    } finally {
      setExporting(false);
    }
  };

  const markSent = async () => {
    if (!meta.quoteId) return;
    try {
      await setQuoteStatus(meta.quoteId, "sent");
      setMeta({ status: "sent" });
      toast.success(meta.leadId ? "Marked as sent. Lead moved to “Quote sent”." : "Marked as sent");
    } catch (e) {
      toast.error(errorText(e, "Could not update quote"));
    }
  };

  const newQuote = () => {
    if (items.length && !meta.quoteId && !window.confirm("Discard this unsaved quote?")) return;
    startNew();
  };

  const shareQuote = async () => {
    const text = [
      `Home Decor Enterprises — Quotation${meta.quoteNumber ? ` ${meta.quoteNumber}` : ""}`,
      ...items.map(
        (i) =>
          `• ${i.product_name} (${i.sku || "-"}) x${i.quantity} @ ${money(priceBreakdown(i.unit_price, i.gst_percent, i.discount_percent || 0).unitInclusive)} incl. ${i.gst_percent}% GST = ${money(lineTotal(i.quantity, i.unit_price, i.gst_percent, i.discount_percent || 0))}`,
      ),
      `Taxable value: ${money(subtotal)}`,
      `GST: ${money(gstTotal)}`,
      ...(meta.handlingCharges > 0 ? [`Handling / packaging: ${money(meta.handlingCharges)}`] : []),
      `Total: ${money(grandTotal + (Number(meta.handlingCharges) || 0))}`,
    ].join("\n");
    if (navigator.share) {
      try {
        await navigator.share({ title: "Quotation", text });
        return;
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard.writeText(text);
    toast.success("Quote copied to clipboard");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-6">
            <FileText className="w-4 h-4" /> Quotation
            {meta.quoteId && <Badge variant="secondary">{statusLabel}</Badge>}
            <span className="ml-auto flex gap-1">
              <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs" title="Saved quotes">
                <Link to="/product-library/quotes" onClick={() => setOpen(false)}>
                  <History className="w-3.5 h-3.5 mr-1" /> Saved
                </Link>
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={newQuote}>
                <FilePlus2 className="w-3.5 h-3.5 mr-1" /> New
              </Button>
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-2 py-3">
          <LeadPicker
            leadId={meta.leadId}
            label={meta.leadLabel}
            onChange={(lead) =>
              setMeta(
                lead
                  ? {
                      leadId: lead.id,
                      leadLabel: leadLabel(lead),
                      customerName: meta.customerName || lead.customer_name,
                      customerPhone: meta.customerPhone || lead.customer_phone,
                    }
                  : { leadId: null, leadLabel: null },
              )
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Customer name"
              value={meta.customerName}
              onChange={(e) => setMeta({ customerName: e.target.value })}
            />
            <Input
              placeholder="Phone"
              value={meta.customerPhone}
              onChange={(e) => setMeta({ customerPhone: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea
              placeholder="Billing address"
              rows={2}
              value={meta.billingAddress}
              onChange={(e) => setMeta({ billingAddress: e.target.value })}
              className="text-xs"
            />
            <Textarea
              placeholder="Delivery address"
              rows={2}
              value={meta.deliveryAddress}
              onChange={(e) => setMeta({ deliveryAddress: e.target.value })}
              className="text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 items-center">
            <span className="text-xs text-muted-foreground">Handling / packaging (incl. GST)</span>
            <Input
              type="number"
              value={meta.handlingCharges}
              onChange={(e) => setMeta({ handlingCharges: Number(e.target.value) || 0 })}
              className="h-8 text-xs"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Quote No: {meta.quoteNumber ?? "assigned when you save or download"}
          </p>
          <AddFromInventory />
        </div>

        <ScrollArea className="flex-1 -mx-2 px-2">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground py-10 text-center">
              No products added yet. Search Inventory above, or use “Add to Quote” from the
              Product Library.
            </p>
          )}
          <div className="space-y-3">
            {items.map((i) => (
              <div key={i.id} className="flex gap-3 rounded-lg border p-2">
                <QuoteLineImage line={i} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{i.product_name}</p>
                      <p className="text-xs text-muted-foreground">{i.sku}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeItem(i.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
                    <span>Qty</span>
                    <span>Price incl. GST</span>
                    <span>GST %</span>
                    <span>Disc %</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    <Input
                      type="number"
                      min={1}
                      value={i.quantity}
                      onChange={(e) =>
                        updateItem(i.id, { quantity: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      value={i.unit_price}
                      onChange={(e) => updateItem(i.id, { unit_price: Number(e.target.value) || 0 })}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      value={i.gst_percent}
                      onChange={(e) => updateItem(i.id, { gst_percent: Number(e.target.value) || 0 })}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      placeholder="Disc %"
                      value={i.discount_percent ?? 0}
                      onChange={(e) =>
                        updateItem(i.id, { discount_percent: Number(e.target.value) || 0 })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  {(() => {
                    const b = priceBreakdown(i.unit_price, i.gst_percent, i.discount_percent || 0);
                    return (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          Basic {money(b.specialBasic)} + GST {money(b.unitGst)}
                        </span>
                        <span className="font-semibold">
                          {money(lineTotal(i.quantity, i.unit_price, i.gst_percent, i.discount_percent || 0))}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="pt-3 space-y-1 text-sm">
          <Separator className="mb-2" />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Taxable value (excl. GST)</span>
            <span>{money(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">GST</span>
            <span>{money(gstTotal)}</span>
          </div>
          {meta.handlingCharges > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Handling / packaging</span>
              <span>{money(meta.handlingCharges)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span>{money(grandTotal + (Number(meta.handlingCharges) || 0))}</span>
          </div>
          <div className="flex gap-2 pt-3">
            <Button className="flex-1" onClick={saveQuote} disabled={!items.length || saving}>
              <Save className="w-4 h-4 mr-1" /> {meta.quoteId ? "Update" : "Save"}
            </Button>
            <Button variant="outline" onClick={exportExcel} disabled={!items.length || exporting}>
              <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="icon" onClick={shareQuote} disabled={!items.length}>
              <Share2 className="w-4 h-4" />
            </Button>
          </div>
          {meta.quoteId && meta.status === "draft" && (
            <Button variant="secondary" className="w-full" onClick={markSent}>
              <Send className="w-4 h-4 mr-1" /> Mark as sent to customer
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default QuoteDrawer;
