import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Trash2,
  Save,
  Share2,
  FileText,
  FileSpreadsheet,
  FilePlus2,
  History,
  Send,
  FileDown,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useQuote } from "@/contexts/QuoteContext";
import { loadWebsiteCatalog } from "@/lib/websiteCatalog";
import { money, lineTotal, priceBreakdown, quoteTotals } from "@/lib/productLibrary";
import {
  customerCopyLines,
  internalCopyLines,
  isX3CustomerLine,
  isX3QuoteLine,
  x3UnitNo,
  x3UnitNumbers,
  x3UnitsMissingLayout,
} from "@/lib/kreationX3Quote";
import {
  QUOTE_STATUSES,
  downloadSavedQuoteExcel,
  downloadSavedQuotePdf,
  leadLabel,
  saveQuote as persistQuote,
  setQuoteStatus,
} from "@/lib/savedQuotes";
import QuoteLineImage from "./QuoteLineImage";
import AddFromInventory from "./AddFromInventory";
import LeadPicker from "./LeadPicker";
import KreationLayoutCard, { type CopyType } from "./KreationLayoutCard";
import { toast } from "@/lib/toast";
import {
  QUOTE_PRICE_FORMATS,
  rememberPriceFormat,
  rememberedPriceFormat,
  type QuotePriceFormat,
} from "@/lib/quoteFormat";
import { cn } from "@/lib/utils";

// Panel width on tablets/desktops: dragged by its left edge, remembered per device.
const WIDTH_KEY = "hde_quote_drawer_width";
const DEFAULT_WIDTH = 512;
const MIN_WIDTH = 420;
const maxWidth = () => Math.round(window.innerWidth * 0.9);
const clampWidth = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));
const isDesktop = () => typeof window !== "undefined" && window.innerWidth >= 640;

function storedWidth(): number {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return w > 0 ? w : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

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
    refreshWebsiteImages,
    subtotal,
    gstTotal,
    grandTotal,
  } = useQuote();
  const [saving, setSaving] = useState(false);
  const [websiteDown, setWebsiteDown] = useState(false);
  const [copyType, setCopyType] = useState<CopyType>("internal");
  const [priceFormat, setPriceFormatState] = useState<QuotePriceFormat>(rememberedPriceFormat);
  const setPriceFormat = (f: QuotePriceFormat) => {
    setPriceFormatState(f);
    rememberPriceFormat(f);
  };
  const [width, setWidth] = useState(storedWidth);
  const [desktop, setDesktop] = useState(isDesktop);
  const dragging = useRef(false);

  useEffect(() => {
    const onResize = () => setDesktop(isDesktop());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const saveWidth = (w: number) => {
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      /* storage unavailable: width just isn't remembered */
    }
  };

  /** Drag the panel's left edge to make it wider or narrower. */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let last = width;
    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return;
      last = clampWidth(window.innerWidth - ev.clientX);
      setWidth(last);
    };
    const onUp = () => {
      dragging.current = false;
      saveWidth(last);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const wide = width > DEFAULT_WIDTH + 40;
  const toggleWide = () => {
    const next = wide ? DEFAULT_WIDTH : maxWidth();
    setWidth(next);
    saveWidth(next);
  };

  // Each time the drawer opens: make sure the website catalogue is reachable and give
  // lines without a website photo another try.
  useEffect(() => {
    if (!open) return;
    loadWebsiteCatalog()
      .then(() => {
        setWebsiteDown(false);
        refreshWebsiteImages();
      })
      .catch(() => setWebsiteDown(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [exporting, setExporting] = useState(false);
  const hasX3 = items.some(isX3QuoteLine);
  const customerCopy = hasX3 && copyType === "customer";
  // Quote type applies to furniture quotes only; Kreation X3 quotes keep their own layout.
  const effectiveFormat: QuotePriceFormat = hasX3 ? "breakup" : priceFormat;

  /** What leaves the app: the lines as they are, or the Kreation customer copy. */
  const outputLines = (): typeof items | null => {
    if (!customerCopy) return internalCopyLines(items);
    const missing = x3UnitsMissingLayout(items, meta.x3Units);
    if (missing.length) {
      const many = x3UnitNumbers(items).length > 1;
      toast.error(
        `Choose the Kreation layout${many ? ` for unit ${missing.join(", ")}` : ""} (Straight, L-Shape, U-Shape or Parallel) first`,
      );
      return null;
    }
    return customerCopyLines(items, meta.x3Units);
  };
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
  const exportQuote = async (format: "pdf" | "excel") => {
    if (!items.length) return;
    const lines = outputLines();
    if (!lines) return;
    setExporting(true);
    try {
      const saved = await save();
      if (format === "pdf") await downloadSavedQuotePdf(lines, saved, new Date(), effectiveFormat);
      else await downloadSavedQuoteExcel(lines, saved, new Date(), effectiveFormat);
      toast.success(`${customerCopy ? "Customer copy of quotation" : "Quotation"} ${saved.quoteNumber} downloaded`);
    } catch (e) {
      toast.error(errorText(e, format === "pdf" ? "Could not generate PDF" : "Could not generate Excel"));
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
    const lines = outputLines();
    if (!lines) return;
    const totals = quoteTotals(lines);
    const handling = Number(meta.handlingCharges) || 0;
    const text = (effectiveFormat === "inclusive"
      ? [
          `Home Decor Enterprises — Quotation${meta.quoteNumber ? ` ${meta.quoteNumber}` : ""}`,
          ...lines.map((i) => {
            const disc = i.discount_percent || 0;
            const rate = priceBreakdown(i.unit_price, i.gst_percent, disc).unitInclusive;
            return `• ${i.product_name} (${i.sku || "-"}) x${i.quantity} — MRP ${money(i.unit_price)}${disc ? `, ${disc}% off, final rate ${money(rate)}` : ""} = ${money(lineTotal(i.quantity, i.unit_price, i.gst_percent, disc))}`;
          }),
          ...(handling > 0 ? [`Handling / packaging: ${money(handling)}`] : []),
          `Total (inclusive of all taxes): ${money(totals.grandTotal + handling)}`,
        ]
      : [
      `Home Decor Enterprises — Quotation${meta.quoteNumber ? ` ${meta.quoteNumber}` : ""}`,
      ...lines.map((i) =>
        isX3CustomerLine(i)
          ? `• ${i.product_name}${i.details ? ` — ${i.details}` : ""} = ${money(lineTotal(i.quantity, i.unit_price, i.gst_percent, i.discount_percent || 0))}`
          : `• ${i.product_name} (${i.details || i.sku || "-"}) x${i.quantity} @ ${money(priceBreakdown(i.unit_price, i.gst_percent, i.discount_percent || 0).unitInclusive)} incl. ${i.gst_percent}% GST = ${money(lineTotal(i.quantity, i.unit_price, i.gst_percent, i.discount_percent || 0))}`,
      ),
      `Taxable value: ${money(totals.subtotal)}`,
      `GST: ${money(totals.gstTotal)}`,
      ...(meta.handlingCharges > 0 ? [`Handling / packaging: ${money(meta.handlingCharges)}`] : []),
      `Total: ${money(totals.grandTotal + (Number(meta.handlingCharges) || 0))}`,
        ]
    ).join("\n");
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
      <SheetContent
        side="right"
        className="w-full sm:max-w-none flex flex-col"
        style={desktop ? { width: clampWidth(width) } : undefined}
      >
        {desktop && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Drag to resize the quotation panel"
            title="Drag to resize"
            onPointerDown={startResize}
            className="group absolute inset-y-0 left-0 z-10 flex w-3 -translate-x-1/2 cursor-col-resize items-center justify-center touch-none"
          >
            <span className="h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-primary" />
          </div>
        )}
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
              {desktop && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={toggleWide}
                  title={wide ? "Normal width" : "Widen panel"}
                >
                  {wide ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </Button>
              )}
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
          {websiteDown && (
            <p className="rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-900">
              Website photos can't be reached right now, so inventory photos are used. They'll be
              swapped in automatically next time.
            </p>
          )}
        </div>

        <ScrollArea className="flex-1 -mx-2 px-2 [&_[data-radix-scroll-area-viewport]>div]:!block">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground py-10 text-center">
              No products added yet. Search Inventory above, or use “Add to Quote” from the
              Product Library.
            </p>
          )}
          <div className="space-y-3">
            <KreationLayoutCard copyType={copyType} onCopyType={setCopyType} />
            {items.map((i) => (
              <div key={i.id} className="flex gap-3 rounded-lg border p-2">
                <QuoteLineImage line={i} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{i.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.sku}
                        {isX3QuoteLine(i) && x3UnitNumbers(items).length > 1 ? ` · Unit ${x3UnitNo(i)}` : ""}
                      </p>
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
          {!hasX3 && (
            <div className="pt-2">
              <p className="mb-1 text-xs text-muted-foreground">Quote type for PDF / Excel / Share</p>
              <div className="grid grid-cols-2 gap-1 rounded-md border p-1" role="radiogroup" aria-label="Quote type">
                {QUOTE_PRICE_FORMATS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    role="radio"
                    aria-checked={priceFormat === f.value}
                    title={f.hint}
                    onClick={() => setPriceFormat(f.value)}
                    className={cn(
                      "rounded px-2 py-1.5 text-xs font-medium transition-colors",
                      priceFormat === f.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-3">
            <Button className="flex-1" onClick={saveQuote} disabled={!items.length || saving}>
              <Save className="w-4 h-4 mr-1" /> {meta.quoteId ? "Update" : "Save"}
            </Button>
            <Button variant="outline" onClick={() => exportQuote("pdf")} disabled={!items.length || exporting}>
              <FileDown className="w-4 h-4 mr-1" /> PDF
            </Button>
            <Button
              variant="outline"
              size="icon"
              title="Excel"
              onClick={() => exportQuote("excel")}
              disabled={!items.length || exporting}
            >
              <FileSpreadsheet className="w-4 h-4" />
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
