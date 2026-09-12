import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Shield, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, Download, Search, PackageSearch,
} from "lucide-react";
import { toast } from "@/lib/toast";
import {
  MANUAL_RECEIPT_ACTION, MOVEMENT_MONTHS, aggregateMovement, buildMonthKeys,
  isSafesCategory, shortMonth, toCsv, windowStart,
  type AuditRow, type ModelMovementRow, type OrderRow, type ProductRef,
} from "@/lib/safesMovement";

const ALLOWED_ROLES = ["admin", "sales", "accounts", "service_head"];

const LINE_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899"];

const PAGE = 1000;

interface CategoryRow { id: string; name: string }

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function TrendBadge({ row }: { row: ModelMovementRow }) {
  const Icon = row.direction === "up" ? TrendingUp : row.direction === "down" ? TrendingDown : Minus;
  const tone =
    row.direction === "up" ? "bg-green-100 text-green-800 border-green-300"
      : row.direction === "down" ? "bg-red-100 text-red-800 border-red-300"
        : "bg-gray-100 text-gray-700 border-gray-300";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${tone}`}>
      <Icon className="w-3 h-3" />
      {row.direction === "flat" ? "flat" : `${row.trendPct > 0 ? "+" : ""}${row.trendPct}%`}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Model-wise movement trend for safes over the last three months. Sales are
 * read from hde_orders, the book of record — the inventory audit log only
 * carries a deduction when the order has a location_id, so it undercounts.
 */
const SafesMovementTrend = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("safes");
  const [products, setProducts] = useState<ProductRef[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [showIdle, setShowIdle] = useState(false);

  const monthKeys = useMemo(() => buildMonthKeys(MOVEMENT_MONTHS), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: cats, error: catErr } = await supabase
        .from("categories")
        .select("id, name")
        .is("deleted_at", null);
      if (catErr) throw catErr;

      const catRows = (cats ?? []) as CategoryRow[];
      setCategories(catRows);

      const safesIds = catRows.filter(c => isSafesCategory(c.name)).map(c => c.id);
      const wantedIds = categoryFilter === "safes"
        ? safesIds
        : categoryFilter === "all"
          ? catRows.map(c => c.id)
          : [categoryFilter];

      if (wantedIds.length === 0) {
        setProducts([]); setOrders([]); setAudit([]); setStock({});
        return;
      }

      const catName = new Map(catRows.map(c => [c.id, c.name]));
      const prodRows: ProductRef[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("products")
          .select("id, sku, product_name, net_price, category_id")
          .in("category_id", wantedIds)
          .is("deleted_at", null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as Array<{ id: string; sku: string; product_name: string; net_price: number; category_id: string | null }>;
        prodRows.push(...batch.map(p => ({
          id: p.id,
          sku: p.sku,
          product_name: p.product_name,
          net_price: p.net_price,
          category_name: p.category_id ? catName.get(p.category_id) ?? null : null,
        })));
        if (batch.length < PAGE) break;
      }
      setProducts(prodRows);

      const productIds = new Set(prodRows.map(p => p.id));
      const since = windowStart(MOVEMENT_MONTHS).toISOString();

      // Filter by date server-side and by product client-side: the id list is
      // far too long for a URL filter once the catalogue grows.
      //
      // A company order is dated by completed_at, which can fall in the window
      // while created_at sits before it, so orders are fetched on either date.
      const orderRows: OrderRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("hde_orders")
          .select("product_id, order_type, status, qty_sold, created_at, completed_at")
          .or(`created_at.gte.${since},completed_at.gte.${since}`)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as OrderRow[];
        orderRows.push(...batch.filter(r => productIds.has(r.product_id)));
        if (batch.length < PAGE) break;
      }
      setOrders(orderRows);

      // Only manual Receive Stock entries — every other receipt has an order
      // row behind it and would otherwise be counted twice.
      const auditRows: AuditRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("inventory_audit_log")
          .select("product_id, action, quantity_change, created_at")
          .eq("action", MANUAL_RECEIPT_ACTION)
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as AuditRow[];
        auditRows.push(...batch.filter(r => productIds.has(r.product_id)));
        if (batch.length < PAGE) break;
      }
      setAudit(auditRows);

      const onHand: Record<string, number> = {};
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("hde_inventory")
          .select("product_id, quantity")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as Array<{ product_id: string; quantity: number }>;
        for (const row of batch) {
          if (!productIds.has(row.product_id)) continue;
          onHand[row.product_id] = (onHand[row.product_id] ?? 0) + (row.quantity ?? 0);
        }
        if (batch.length < PAGE) break;
      }
      setStock(onHand);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load safes movement");
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(
    () => aggregateMovement({ orders, audit }, products, monthKeys, { stockByProduct: stock }),
    [orders, audit, products, monthKeys, stock],
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summary.rows.filter(r => {
      if (!showIdle && r.totalSold === 0 && r.totalReceived === 0) return false;
      if (!q) return true;
      return r.model.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q);
    });
  }, [summary.rows, search, showIdle]);

  const exportCsv = () => {
    const blob = new Blob([toCsv(summary)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `safes-movement-${monthKeys[0]}-to-${monthKeys[monthKeys.length - 1]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!user) return null;
  if (!ALLOWED_ROLES.includes(user.role as string)) return <Navigate to="/" replace />;

  const safesCategories = categories.filter(c => isSafesCategory(c.name));
  const { totals } = summary;

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5" /> Safes Movement Trend
          </h1>
          <p className="text-sm text-muted-foreground">
            Model-wise, last {MOVEMENT_MONTHS} months ({shortMonth(monthKeys[0])} – {shortMonth(monthKeys[monthKeys.length - 1])})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="safes">All safes categories</SelectItem>
              <SelectItem value="all">Every category</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading || summary.rows.length === 0}>
            <Download className="w-4 h-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {categoryFilter === "safes" && !loading && safesCategories.length === 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-4 text-sm text-amber-900">
            No category named like “Safes” was found. Pick a category above, or rename the safes
            category under Categories so this report finds it automatically.
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading movement…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Units sold" value={String(totals.sold)} hint={totals.cancelled ? `${totals.cancelled} more cancelled` : "orders raised in the window"} />
            <Stat label="Units received" value={String(totals.received)} />
            <Stat label="Net stock movement" value={`${totals.netMovement > 0 ? "+" : ""}${totals.netMovement}`} hint="received − sold" />
            <Stat label="Sales value" value={inr(totals.value)} hint="net units × net price" />
            <Stat label="Models moved" value={`${totals.modelsMoved}`} hint={`${totals.modelsIdle} with no movement`} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Units sold per month — top models</CardTitle>
            </CardHeader>
            <CardContent>
              {summary.topModels.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No safes movement recorded in this window.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={summary.chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {summary.topModels.map((m, i) => (
                      <Line
                        key={m}
                        type="monotone"
                        dataKey={m}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Model-wise movement</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
                    <Input
                      className="pl-8 h-9 w-52"
                      placeholder="Search model or SKU"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                  <Button variant={showIdle ? "default" : "outline"} size="sm" onClick={() => setShowIdle(v => !v)}>
                    <PackageSearch className="w-4 h-4 mr-1" />
                    {showIdle ? "Hide idle models" : "Show idle models"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {visibleRows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No models to show.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      {monthKeys.map(k => <TableHead key={k} className="text-right">{shortMonth(k)}</TableHead>)}
                      <TableHead className="text-right">Sold</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Net movement</TableHead>
                      <TableHead className="text-right">In stock</TableHead>
                      <TableHead className="text-right">Trend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map(r => (
                      <TableRow key={r.productId}>
                        <TableCell>
                          <div className="font-medium">{r.model}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.sku}{r.category ? ` · ${r.category}` : ""}
                          </div>
                        </TableCell>
                        {monthKeys.map(k => (
                          <TableCell key={k} className="text-right tabular-nums">
                            {r.months[k].sold || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        ))}
                        <TableCell className="text-right tabular-nums font-medium">{r.totalSold}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.totalReceived}</TableCell>
                        <TableCell className={`text-right tabular-nums ${r.netMovement < 0 ? "text-red-600" : ""}`}>
                          {r.netMovement > 0 ? `+${r.netMovement}` : r.netMovement}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.stockOnHand === 0 && r.totalSold > 0
                            ? <Badge variant="outline" className="text-[10px]">out of stock</Badge>
                            : r.stockOnHand}
                        </TableCell>
                        <TableCell className="text-right"><TrendBadge row={r} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                Sold counts sale orders raised in each month, excluding ones later cancelled or
                rejected. Received counts completed company orders plus manual stock receipts.
                Trend compares {shortMonth(monthKeys[monthKeys.length - 1])} with {shortMonth(monthKeys[monthKeys.length - 2])}.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default SafesMovementTrend;
