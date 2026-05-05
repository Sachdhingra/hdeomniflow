import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ShoppingBag, Repeat, TrendingUp, Trophy, Search } from "lucide-react";
import RepeatBadge from "@/components/RepeatBadge";

type LeadRow = {
  id: string;
  customer_name: string;
  customer_phone: string;
  orders: any[] | null;
  repeat_count: number | null;
  total_sales: number | null;
  repeat_customer: boolean | null;
  first_purchase_date: string | null;
  last_purchase_date: string | null;
  created_by: string | null;
  assigned_to: string | null;
};

type FlatOrder = {
  lead_id: string;
  customer_name: string;
  customer_phone: string;
  order_id: string;
  date: string;
  product: string;
  amount: number;
  status: string;
  salesperson: string | null;
};

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const AdminOrdersDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data: leadData } = await supabase
        .from("leads")
        .select("id, customer_name, customer_phone, orders, repeat_count, total_sales, repeat_customer, first_purchase_date, last_purchase_date, created_by, assigned_to")
        .is("deleted_at", null)
        .order("last_purchase_date", { ascending: false, nullsFirst: false });

      const rows = (leadData ?? []) as any as LeadRow[];
      const userIds = Array.from(new Set(rows.flatMap(r => [r.created_by, r.assigned_to]).filter(Boolean))) as string[];
      let profileMap: Record<string, string> = {};
      if (userIds.length) {
        const { data: pData } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", userIds);
        profileMap = Object.fromEntries((pData ?? []).map((p: any) => [p.id, p.name]));
      }
      if (!mounted) return;
      setLeads(rows);
      setProfiles(profileMap);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const flatOrders: FlatOrder[] = useMemo(() => {
    const out: FlatOrder[] = [];
    for (const l of leads) {
      const arr = Array.isArray(l.orders) ? l.orders : [];
      for (const o of arr) {
        out.push({
          lead_id: l.id,
          customer_name: l.customer_name,
          customer_phone: l.customer_phone,
          order_id: o.order_id || "",
          date: o.date || "",
          product: o.product || "",
          amount: Number(o.amount || 0),
          status: o.status || "",
          salesperson: profiles[l.assigned_to || l.created_by || ""] || null,
        });
      }
    }
    return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [leads, profiles]);

  const metrics = useMemo(() => {
    const totalOrders = flatOrders.length;
    const totalRevenue = flatOrders.reduce((s, o) => s + o.amount, 0);
    const repeatLeads = leads.filter(l => (l.repeat_count ?? 0) > 0);
    const repeatRevenue = repeatLeads.reduce((s, l) => s + Number(l.total_sales || 0), 0);
    return {
      totalOrders,
      totalRevenue,
      repeatCustomers: repeatLeads.length,
      repeatRevenue,
      repeatPct: totalRevenue ? Math.round((repeatRevenue / totalRevenue) * 100) : 0,
    };
  }, [flatOrders, leads]);

  const topRepeat = useMemo(
    () =>
      [...leads]
        .filter(l => (l.repeat_count ?? 0) > 0)
        .sort((a, b) => Number(b.total_sales || 0) - Number(a.total_sales || 0))
        .slice(0, 10),
    [leads]
  );

  const bySalesperson = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; revenue: number; repeatRevenue: number }>();
    for (const l of leads) {
      const uid = l.assigned_to || l.created_by;
      if (!uid) continue;
      const name = profiles[uid] || "Unassigned";
      const cur = map.get(uid) || { name, orders: 0, revenue: 0, repeatRevenue: 0 };
      const ords = Array.isArray(l.orders) ? l.orders : [];
      cur.orders += ords.length;
      cur.revenue += Number(l.total_sales || 0);
      if ((l.repeat_count ?? 0) > 0) cur.repeatRevenue += Number(l.total_sales || 0);
      map.set(uid, cur);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }, [leads, profiles]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flatOrders;
    return flatOrders.filter(
      o =>
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_phone.includes(q) ||
        o.product.toLowerCase().includes(q) ||
        o.order_id.toLowerCase().includes(q)
    );
  }, [flatOrders, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Orders Dashboard</h1>
        <p className="text-sm text-muted-foreground">All orders, repeat-customer insights, and salesperson rankings.</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Total Orders</span>
              <ShoppingBag className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-1">{metrics.totalOrders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Total Revenue</span>
              <TrendingUp className="w-4 h-4 text-success" />
            </div>
            <p className="text-2xl font-bold mt-1">{fmt(metrics.totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Repeat Customers</span>
              <Repeat className="w-4 h-4 text-warning" />
            </div>
            <p className="text-2xl font-bold mt-1">{metrics.repeatCustomers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Repeat Revenue</span>
              <Badge variant="secondary" className="text-[10px]">{metrics.repeatPct}%</Badge>
            </div>
            <p className="text-2xl font-bold mt-1">{fmt(metrics.repeatRevenue)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Top repeat customers */}
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Trophy className="w-4 h-4" />Top Repeat Customers</CardTitle></CardHeader>
        <CardContent>
          {topRepeat.length === 0 ? (
            <p className="text-sm text-muted-foreground">No repeat customers yet.</p>
          ) : (
            <div className="space-y-2">
              {topRepeat.map(l => (
                <div key={l.id} className="flex items-center justify-between border rounded p-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{l.customer_name}</span>
                      <RepeatBadge repeatCount={l.repeat_count ?? 0} />
                    </div>
                    <p className="text-xs text-muted-foreground">{l.customer_phone}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">{fmt(Number(l.total_sales || 0))}</p>
                    <p className="text-[11px] text-muted-foreground">{(l.orders?.length ?? 0)} orders</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Salesperson ranking */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Repeat Sales by Salesperson</CardTitle></CardHeader>
        <CardContent>
          {bySalesperson.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Repeat Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySalesperson.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-right">{s.orders}</TableCell>
                    <TableCell className="text-right">{fmt(s.revenue)}</TableCell>
                    <TableCell className="text-right">{fmt(s.repeatRevenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* All orders */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-lg">All Orders</CardTitle>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                className="pl-8 w-64"
                placeholder="Search name, phone, product…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Salesperson</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.slice(0, 200).map((o, i) => (
                  <TableRow key={`${o.lead_id}-${i}`}>
                    <TableCell className="whitespace-nowrap">{o.date || "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{o.customer_name}</div>
                      <div className="text-xs text-muted-foreground">{o.customer_phone}</div>
                    </TableCell>
                    <TableCell>{o.product}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(o.amount)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{o.status}</Badge></TableCell>
                    <TableCell className="text-xs">{o.salesperson || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminOrdersDashboard;
