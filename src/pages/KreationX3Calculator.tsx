import { useEffect, useMemo, useState } from "react";
import { Calculator, ChevronRight, Minus, Plus, Search, ShoppingCart, Trash2, ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import QuoteDrawer from "@/components/product-library/QuoteDrawer";
import { useQuote } from "@/contexts/QuoteContext";
import { toast } from "@/lib/toast";
import {
  X3_TABS,
  isX3QuoteLine,
  x3Finish,
  x3LineAmount,
  x3QuoteLines,
  x3SelectedLines,
  x3Totals,
  type X3Item,
  type X3Quantities,
} from "@/lib/kreationX3";

const STORAGE_KEY = "hde_kreation_x3_calc_v1";
const MAX_QTY = 999;

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const inr2 = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function loadSaved(): { qty: X3Quantities; discount: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const qty: X3Quantities = {};
    for (const [k, v] of Object.entries(raw.qty || {})) if (Number(v) > 0) qty[k] = Math.min(MAX_QTY, Math.floor(Number(v)));
    return { qty, discount: typeof raw.discount === "string" ? raw.discount : "" };
  } catch {
    return { qty: {}, discount: "" };
  }
}

/** Splits text on the search words so matches can be highlighted. */
function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-warning/40 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Stepper({ value, label, onChange }: { value: number; label: string; onChange: (n: number) => void }) {
  return (
    <div className="flex h-11 w-full items-stretch overflow-hidden rounded-lg border bg-background sm:h-9 sm:w-[112px]">
      <button
        type="button"
        aria-label={`Decrease quantity of ${label}`}
        className="grid w-11 place-items-center text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-8"
        onClick={() => onChange(value - 1)}
        disabled={value <= 0}
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_QTY}
        aria-label={`Quantity of ${label}`}
        value={value || ""}
        placeholder="0"
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 border-x bg-transparent text-center font-mono text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={`Increase quantity of ${label}`}
        className="grid w-11 place-items-center text-primary transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-8"
        onClick={() => onChange(value + 1)}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function ItemRow({
  item,
  qty,
  words,
  onQty,
}: {
  item: X3Item;
  qty: number;
  words: string[];
  onQty: (n: number) => void;
}) {
  const finish = x3Finish(item.longDescription);
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t px-4 py-3 sm:grid-cols-[minmax(0,1fr)_112px_112px_100px] ${
        qty ? "bg-primary/5" : ""
      }`}
    >
      <div className="col-span-2 flex min-w-0 gap-3 sm:col-span-1">
        <span
          className="mt-1 h-4 w-4 shrink-0 rounded-full border"
          style={{ background: finish?.color ?? "transparent" }}
          title={finish?.name}
          role="img"
          aria-label={finish ? `Finish: ${finish.name}` : "Finish not listed"}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug [overflow-wrap:anywhere]">
            <Highlight text={item.longDescription} words={words} />
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
            {item.code ? <Highlight text={item.code} words={words} /> : "No item code"} ·{" "}
            <Highlight text={item.description} words={words} />
          </p>
        </div>
      </div>
      <p className="font-mono text-sm tabular-nums sm:text-right">
        {inr2(item.nett)}
        <span className="ml-1 text-[11px] text-muted-foreground sm:hidden">each</span>
      </p>
      <Stepper value={qty} label={item.description} onChange={onQty} />
      <p
        className={`hidden text-right font-mono text-sm tabular-nums sm:block ${
          qty ? "font-semibold" : "text-muted-foreground"
        }`}
      >
        {qty ? inr(x3LineAmount(item.nett, qty)) : "–"}
      </p>
      {qty > 0 && (
        <p className="col-span-2 text-right font-mono text-sm font-semibold tabular-nums sm:hidden">
          {qty} × {inr2(item.nett)} = {inr(x3LineAmount(item.nett, qty))}
        </p>
      )}
    </div>
  );
}

const KreationX3Calculator = () => {
  const { items: cart, addItem, removeItem, setOpen } = useQuote();
  const [qty, setQty] = useState<X3Quantities>(() => loadSaved().qty);
  const [discount, setDiscount] = useState<string>(() => loadSaved().discount);
  const [tabId, setTabId] = useState(X3_TABS[0].id);
  const [search, setSearch] = useState("");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [review, setReview] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ qty, discount }));
    } catch {
      /* storage unavailable: the calculator still works */
    }
  }, [qty, discount]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const discountNum = Number(discount);
  const totals = useMemo(() => x3Totals(qty, discountNum), [qty, discountNum]);
  const selected = useMemo(() => x3SelectedLines(qty), [qty]);
  const tab = X3_TABS.find((t) => t.id === tabId) ?? X3_TABS[0];
  const words = useMemo(() => search.trim().toLowerCase().split(/\s+/).filter(Boolean), [search]);
  const searching = words.length > 0;

  const tabUnits = useMemo(() => {
    const out: Record<string, number> = {};
    for (const l of selected) out[l.tab.id] = (out[l.tab.id] || 0) + l.qty;
    return out;
  }, [selected]);

  const setItemQty = (key: string, n: number) =>
    setQty((prev) => {
      const v = Math.max(0, Math.min(MAX_QTY, Math.floor(n) || 0));
      const next = { ...prev };
      if (v) next[key] = v;
      else delete next[key];
      return next;
    });

  const matches = (i: X3Item) => {
    if (!searching) return true;
    const hay = `${i.longDescription} ${i.description} ${i.code}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };

  const sections = tab.sections
    .map((sec, idx) => ({ sec, idx, items: sec.items.filter(matches) }))
    .filter((s) => s.items.length);

  const isOpen = (secName: string, idx: number) => searching || (openMap[`${tab.id}|${secName}`] ?? idx === 0);
  const toggle = (secName: string, idx: number) =>
    setOpenMap((m) => ({ ...m, [`${tab.id}|${secName}`]: !isOpen(secName, idx) }));

  const clearAll = () => {
    if (!confirmClear) return setConfirmClear(true);
    setQty({});
    setDiscount("");
    setConfirmClear(false);
    toast.success("Calculator cleared");
  };

  /** Puts the selected items on the quotation. Items sent earlier are replaced, not added twice. */
  const sendToQuote = () => {
    if (!selected.length) return;
    cart.filter(isX3QuoteLine).forEach((l) => removeItem(l.id));
    x3QuoteLines(qty, discountNum).forEach((l) => addItem(l));
    setReview(false);
    setOpen(true);
    toast.success(`${selected.length} item${selected.length > 1 ? "s" : ""} added to the quotation`);
  };

  return (
    <div className="space-y-4 pb-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Calculator className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight">Kreation X3 Calculator</h1>
          <p className="text-sm text-muted-foreground">
            Next-gen modular wardrobe · 2026 nett price list · prices include GST
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm">
        <div role="tablist" aria-label="Price list" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
          {X3_TABS.map((t) => {
            const active = t.id === tab.id;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTabId(t.id)}
                className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                {tabUnits[t.id] ? (
                  <Badge className="h-5 min-w-5 justify-center rounded-full px-1.5 font-mono text-[11px]">
                    {tabUnits[t.id]}
                  </Badge>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="x3-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${tab.label}: size, finish or code, e.g. 900W Walnut`}
            aria-label={`Search ${tab.label}`}
            className="h-11 pl-9"
          />
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-12 text-center">
          <p className="font-medium">No items match “{search}” in {tab.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a size such as 600W, or a finish such as Magnolia.</p>
          <Button variant="outline" className="mt-4" onClick={() => setSearch("")}>
            Clear search
          </Button>
        </div>
      ) : (
        sections.map(({ sec, idx, items }) => {
          const open = isOpen(sec.name, idx);
          const secUnits = items.reduce((n, i) => n + (qty[i.key] || 0), 0);
          const secAmount = items.reduce((n, i) => n + (qty[i.key] ? x3LineAmount(i.nett, qty[i.key]) : 0), 0);
          return (
            <section key={sec.name} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(sec.name, idx)}
                className="flex min-h-12 w-full items-center gap-2 px-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
                <span className="min-w-0 flex-1 font-semibold">{sec.name}</span>
                {secUnits > 0 ? (
                  <span className="font-mono text-xs font-medium tabular-nums text-primary">
                    {secUnits} pc · {inr(secAmount)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{items.length} items</span>
                )}
              </button>
              {open && (
                <div>
                  <div className="hidden grid-cols-[minmax(0,1fr)_112px_112px_100px] gap-x-4 border-t bg-muted/50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
                    <span>Item</span>
                    <span className="text-right">Nett price</span>
                    <span className="text-center">Qty</span>
                    <span className="text-right">Amount</span>
                  </div>
                  {items.map((i) => (
                    <ItemRow key={i.key} item={i} qty={qty[i.key] || 0} words={words} onQty={(n) => setItemQty(i.key, n)} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      {/* Quote bar: one total and one discount for every tab */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t-2 border-primary bg-card/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)] backdrop-blur sm:mx-0 sm:rounded-xl sm:border-2">
        <div className="grid grid-cols-2 items-end gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.1fr)_minmax(0,1.7fr)_minmax(0,1.3fr)_auto]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Units</p>
            <p className="font-mono text-lg font-medium tabular-nums">{totals.units.toLocaleString("en-IN")}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="font-mono text-lg font-medium tabular-nums">{inr(totals.total)}</p>
          </div>
          <div>
            <label htmlFor="x3-discount" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Discount %
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="x3-discount"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.5"
                value={discount}
                placeholder="0"
                onChange={(e) => setDiscount(e.target.value)}
                className="h-10 w-24 font-mono tabular-nums"
              />
              {totals.discount > 0 && (
                <span className="whitespace-nowrap font-mono text-xs tabular-nums text-destructive">−{inr(totals.discount)}</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Amount</p>
            <p className="font-mono text-2xl font-bold tabular-nums text-primary">{inr(totals.amount)}</p>
          </div>
          <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 sm:col-span-1">
            <Button variant="outline" className="h-11 min-w-11" onClick={() => setReview(true)} disabled={!selected.length}>
              <ListChecks className="mr-1.5 h-4 w-4" /> Review
            </Button>
            <Button className="h-11 flex-1 sm:flex-none" onClick={sendToQuote} disabled={!selected.length}>
              <ShoppingCart className="mr-1.5 h-4 w-4" /> Add to quotation
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          One discount applies to all tabs. Each line and every total is rounded to the rupee.
        </p>
      </div>

      <Sheet open={review} onOpenChange={setReview}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b p-4">
            <SheetTitle>Selected items ({selected.length})</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {selected.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nothing selected yet. Add quantities in any tab.
              </p>
            ) : (
              selected.map(({ tab: t, item, qty: q }) => (
                <div key={item.key} className="flex items-start gap-3 border-b px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug [overflow-wrap:anywhere]">{item.longDescription}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {t.label} · {item.code || "No item code"}
                    </p>
                    <p className="mt-1 font-mono text-xs tabular-nums">
                      {q} × {inr2(item.nett)} = <b>{inr(x3LineAmount(item.nett, q))}</b>
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${item.description}`} onClick={() => setItemQty(item.key, 0)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="space-y-2 border-t p-4">
            <div className="flex justify-between font-mono text-sm tabular-nums">
              <span>Total</span>
              <span>{inr(totals.total)}</span>
            </div>
            {totals.discount > 0 && (
              <div className="flex justify-between font-mono text-sm tabular-nums text-destructive">
                <span>Discount {totals.discountPercent}%</span>
                <span>−{inr(totals.discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-mono text-lg font-bold tabular-nums text-primary">
              <span>Amount</span>
              <span>{inr(totals.amount)}</span>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="h-11" onClick={clearAll}>
                <Trash2 className="mr-1.5 h-4 w-4" /> {confirmClear ? "Tap again to clear" : "Clear all"}
              </Button>
              <Button className="h-11 flex-1" onClick={sendToQuote} disabled={!selected.length}>
                <ShoppingCart className="mr-1.5 h-4 w-4" /> Add to quotation
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuoteDrawer />
    </div>
  );
};

export default KreationX3Calculator;
