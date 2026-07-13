import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Calculator, X, Minus, Copy, Trash2, History, GripVertical, ArrowDown } from "lucide-react";
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
const POS_KEY = "omniflow_calc_pos_v1";
const PANEL_W = 320; // 20rem
const MIN_VISIBLE = 80;

const clampPos = (x: number, y: number) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxX = vw - MIN_VISIBLE;
  const minX = -(PANEL_W - MIN_VISIBLE);
  const maxY = vh - 48; // keep header visible
  const minY = 0;
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };
};

const formatINR = (n: number) =>
  `₹${(isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: n % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;

const DiscountCalculator = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(true);

  // discount state
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

  // basic calc state
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(true);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 20)));
  }, [history]);

  // draggable position
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p?.x === "number" && typeof p?.y === "number") return p;
    } catch {}
    return null;
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number; pointerId: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  }, [pos]);

  useEffect(() => {
    const onResize = () => {
      setPos((p) => (p ? clampPos(p.x, p.y) : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return; // don't drag when tapping buttons
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      pointerId: e.pointerId,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);

  const onHeaderPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    e.preventDefault();
    const nx = e.clientX - dragRef.current.dx;
    const ny = e.clientY - dragRef.current.dy;
    setPos(clampPos(nx, ny));
  }, []);

  const onHeaderPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(dragRef.current.pointerId);
    } catch {}
    dragRef.current = null;
    setDragging(false);
  }, []);

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

  if (!user || !ALLOWED_ROLES.includes(user.role)) return null;

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

  // ---------- Basic calculator logic ----------
  const compute = (a: number, b: number, o: string) => {
    switch (o) {
      case "+": return a + b;
      case "−": return a - b;
      case "×": return a * b;
      case "/": return b === 0 ? NaN : a / b;
      default: return b;
    }
  };

  const inputDigit = (d: string) => {
    if (overwrite) {
      setDisplay(d);
      setOverwrite(false);
    } else {
      setDisplay(display.length >= 14 ? display : display === "0" ? d : display + d);
    }
  };

  const inputDot = () => {
    if (overwrite) { setDisplay("0."); setOverwrite(false); return; }
    if (!display.includes(".")) setDisplay(display + ".");
  };

  const clearAll = () => { setDisplay("0"); setPrev(null); setOp(null); setOverwrite(true); };

  const backspace = () => {
    if (overwrite) return;
    const next = display.length <= 1 || (display.length === 2 && display.startsWith("-")) ? "0" : display.slice(0, -1);
    setDisplay(next);
    if (next === "0") setOverwrite(true);
  };

  const setOperator = (next: string) => {
    const cur = parseFloat(display);
    if (prev === null) {
      setPrev(cur);
    } else if (op && !overwrite) {
      const r = compute(prev, cur, op);
      setPrev(r);
      setDisplay(String(+r.toFixed(10)));
    }
    setOp(next);
    setOverwrite(true);
  };

  const equals = () => {
    if (op === null || prev === null) return;
    const cur = parseFloat(display);
    const r = compute(prev, cur, op);
    setDisplay(String(+r.toFixed(10)));
    setPrev(null);
    setOp(null);
    setOverwrite(true);
  };

  const copyBasic = async () => {
    try {
      await navigator.clipboard.writeText(display);
      toast({ title: "Copied", description: `${display} copied to clipboard` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const useAsMrp = () => {
    const n = parseFloat(display);
    if (!isFinite(n) || n <= 0) return;
    setMrp(String(+n.toFixed(2)));
    setOverwrite(true);
  };

  // Floating launcher (closed state)
  if (!open) {
    return createPortal(
      <button
        onClick={() => { setOpen(true); setMinimized(false); }}
        className="fixed bottom-20 right-4 z-50 h-12 w-12 rounded-full gradient-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        title="Calculator"
        aria-label="Open calculator"
      >
        <Calculator className="w-5 h-5" />
      </button>,
      document.body
    );
  }

  // Minimized pill
  if (minimized) {
    const pillText = parseFloat(mrp) > 0 ? formatINR(result.finalPrice) : display;
    return createPortal(
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-20 right-4 z-50 px-3 h-10 rounded-full bg-card border border-border shadow-lg flex items-center gap-2 text-sm font-medium hover:bg-accent"
      >
        <Calculator className="w-4 h-4 text-primary" />
        <span>{pillText}</span>
        <X
          className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
        />
      </button>,
      document.body
    );
  }

  const KeyBtn = ({ label, onClick, variant = "outline", className = "" }: { label: React.ReactNode; onClick: () => void; variant?: "outline" | "default" | "secondary" | "destructive"; className?: string }) => (
    <Button type="button" variant={variant} size="sm" onClick={onClick} className={`h-9 text-sm font-semibold ${className}`}>
      {label}
    </Button>
  );

  return createPortal(
    <div
      ref={panelRef}
      style={
        pos
          ? { position: "fixed", left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
          : undefined
      }
      className={`fixed bottom-20 right-4 z-50 w-[20rem] max-w-[calc(100vw-2rem)] rounded-xl bg-card border border-border transition-shadow flex flex-col max-h-[min(85vh,44rem)] ${
        dragging ? "shadow-[0_25px_60px_-10px_rgba(0,0,0,0.45)] opacity-95" : "shadow-2xl"
      }`}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        style={{ touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
        className="flex items-center gap-2 px-3 py-2 border-b border-border select-none shrink-0"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
        <Calculator className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold flex-1">Calculator</span>
        <button
          onClick={() => setShowHistory((s) => !s)}
          className={`p-1 ${showHistory ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
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

      <div className="p-3 overflow-y-auto">
        {showHistory ? (
          <div className="space-y-2">
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
          <div className="space-y-3">
            {/* ---- Basic calculator ---- */}
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-right">
              <div className="text-[11px] text-muted-foreground h-4">
                {prev !== null ? `${prev} ${op ?? ""}` : ""}
              </div>
              <div className="text-2xl font-bold tabular-nums truncate">{display}</div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <KeyBtn label="C" variant="destructive" onClick={clearAll} />
              <KeyBtn label="⌫" variant="secondary" onClick={backspace} />
              <KeyBtn label="/" variant="secondary" onClick={() => setOperator("/")} />
              <KeyBtn label="×" variant="secondary" onClick={() => setOperator("×")} />

              <KeyBtn label="7" onClick={() => inputDigit("7")} />
              <KeyBtn label="8" onClick={() => inputDigit("8")} />
              <KeyBtn label="9" onClick={() => inputDigit("9")} />
              <KeyBtn label="−" variant="secondary" onClick={() => setOperator("−")} />

              <KeyBtn label="4" onClick={() => inputDigit("4")} />
              <KeyBtn label="5" onClick={() => inputDigit("5")} />
              <KeyBtn label="6" onClick={() => inputDigit("6")} />
              <KeyBtn label="+" variant="secondary" onClick={() => setOperator("+")} />

              <KeyBtn label="1" onClick={() => inputDigit("1")} />
              <KeyBtn label="2" onClick={() => inputDigit("2")} />
              <KeyBtn label="3" onClick={() => inputDigit("3")} />
              <KeyBtn label="=" variant="default" onClick={equals} className="row-span-2 h-auto" />

              <KeyBtn label="0" onClick={() => inputDigit("0")} className="col-span-2" />
              <KeyBtn label="." onClick={inputDot} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={copyBasic}>
                <Copy className="w-3.5 h-3.5" /> Copy
              </Button>
              <Button size="sm" variant="secondary" className="flex-1" onClick={useAsMrp} title="Use result as MRP below">
                <ArrowDown className="w-3.5 h-3.5" /> Use as MRP
              </Button>
            </div>

            {/* ---- Discount section (same window) ---- */}
            <div className="flex items-center gap-2 pt-1">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">💰 Discount</span>
              <div className="h-px flex-1 bg-border" />
            </div>

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
              <TabsList className="grid grid-cols-3 h-8 w-full">
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
    </div>,
    document.body
  );
};

export default DiscountCalculator;
