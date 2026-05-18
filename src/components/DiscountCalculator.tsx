import { useEffect, useMemo, useState } from "react";
import { Calculator, X, Minus, Copy, Trash2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

type Mode = "percent" | "fixed" | "final";

interface HistoryItem {
  id: string;
  mode: Mode;
  mrp: number;
  input: number;
  finalPrice: number;
  discountAmt: number;
  discountPct: number;
  at: number;
}

const ALLOWED_ROLES = ["admin", "sales", "service_head"];
const STORAGE_KEY = "omniflow_calc_history_v1";

const formatINR = (n: number) =>
  `₹${(isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: n % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;

const DiscountCalculator = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(true);
  const [mode, setMode] = useState<Mode>("percent");
  const [mrp, setMrp] = useState("");
  const [val, setVal] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 20)));
  }, [history]);

  if (!user || !ALLOWED_ROLES.includes(user.role)) return null;

  const result = useMemo(() => {
    const m = parseFloat(mrp) || 0;
    const v = parseFloat(val) || 0;
    let finalPrice = m;
    let discountAmt = 0;
    let discountPct = 0;
    if (m > 0) {
      if (mode === "percent") {
        discountPct = v;
        discountAmt = (m * v) / 100;
        finalPrice = m - discountAmt;
      } else if (mode === "fixed") {
        discountAmt = v;
        finalPrice = m - v;
        discountPct = (v / m) * 100;
      } else {
        finalPrice = v;
        discountAmt = m - v;
        discountPct = (discountAmt / m) * 100;
      }
    }
    return { finalPrice, discountAmt, discountPct };
  }, [mrp, val, mode]);

  const saveToHistory = () => {
    const m = parseFloat(mrp) || 0;
    const v = parseFloat(val) || 0;
    if (m <= 0) return;
    setHistory((h) => [
      {
        id: Math.random().toString(36).slice(2),
        mode,
        mrp: m,
        input: v,
        finalPrice: result.finalPrice,
        discountAmt: result.discountAmt,
        discountPct: result.discountPct,
        at: Date.now(),
      },
      ...h,
    ].slice(0, 20));
  };

  const copyPrice = async () => {
    try {
      await navigator.clipboard.writeText(result.finalPrice.toFixed(2));
      toast({ title: "Copied", description: `${formatINR(result.finalPrice)} copied to clipboard` });
      saveToHistory();
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  // Floating launcher (closed state)
  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setMinimized(false); }}
        className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full gradient-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        title="Discount Calculator"
        aria-label="Open discount calculator"
      >
        <Calculator className="w-5 h-5" />
      </button>
    );
  }

  // Minimized pill
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 right-4 z-50 px-3 h-10 rounded-full bg-card border border-border shadow-lg flex items-center gap-2 text-sm font-medium hover:bg-accent"
      >
        <Calculator className="w-4 h-4 text-primary" />
        <span>{formatINR(result.finalPrice)}</span>
        <X
          className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
        />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[20rem] max-w-[calc(100vw-2rem)] rounded-xl bg-card border border-border shadow-2xl">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Calculator className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold flex-1">Discount Calculator</span>
        <button
          onClick={() => setShowHistory((s) => !s)}
          className="text-muted-foreground hover:text-foreground p-1"
          title="History"
        >
          <History className="w-4 h-4" />
        </button>
        <button onClick={() => setMinimized(true)} className="text-muted-foreground hover:text-foreground p-1" title="Minimize">
          <Minus className="w-4 h-4" />
        </button>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground p-1" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {showHistory ? (
        <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Recent calculations</span>
            {history.length > 0 && (
              <button
                onClick={() => setHistory([])}
                className="text-xs text-destructive flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No calculations yet</p>
          ) : (
            history.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  setMode(h.mode);
                  setMrp(String(h.mrp));
                  setVal(String(h.input));
                  setShowHistory(false);
                }}
                className="w-full text-left p-2 rounded-md border border-border hover:bg-accent text-xs space-y-0.5"
              >
                <div className="flex justify-between font-medium">
                  <span>{formatINR(h.mrp)} → {formatINR(h.finalPrice)}</span>
                  <span className="text-primary">-{h.discountPct.toFixed(1)}%</span>
                </div>
                <div className="text-muted-foreground">
                  Saved {formatINR(h.discountAmt)} · {new Date(h.at).toLocaleTimeString()}
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="p-3 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">MRP / Original Price (₹)</Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              value={mrp}
              onChange={(e) => setMrp(e.target.value)}
              className="h-9"
            />
          </div>

          <Tabs value={mode} onValueChange={(v) => { setVal(""); setMode(v as Mode); }}>
            <TabsList className="grid grid-cols-3 h-8">
              <TabsTrigger value="percent" className="text-xs">%</TabsTrigger>
              <TabsTrigger value="fixed" className="text-xs">₹ Off</TabsTrigger>
              <TabsTrigger value="final" className="text-xs">Final</TabsTrigger>
            </TabsList>
            <TabsContent value="percent" className="mt-2 space-y-1">
              <Label className="text-xs">Discount %</Label>
              <Input type="number" inputMode="decimal" placeholder="0" value={val} onChange={(e) => setVal(e.target.value)} className="h-9" />
            </TabsContent>
            <TabsContent value="fixed" className="mt-2 space-y-1">
              <Label className="text-xs">Discount Amount (₹)</Label>
              <Input type="number" inputMode="decimal" placeholder="0.00" value={val} onChange={(e) => setVal(e.target.value)} className="h-9" />
            </TabsContent>
            <TabsContent value="final" className="mt-2 space-y-1">
              <Label className="text-xs">Final Price (₹)</Label>
              <Input type="number" inputMode="decimal" placeholder="0.00" value={val} onChange={(e) => setVal(e.target.value)} className="h-9" />
            </TabsContent>
          </Tabs>

          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Discount</span>
              <span>{formatINR(result.discountAmt)} ({result.discountPct.toFixed(2)}%)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Final Price</span>
              <span className="text-lg font-bold text-primary">{formatINR(result.finalPrice)}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => { setMrp(""); setVal(""); }}>
              Reset
            </Button>
            <Button size="sm" className="flex-1" onClick={copyPrice} disabled={!mrp}>
              <Copy className="w-3.5 h-3.5" /> Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiscountCalculator;
