import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2, Search, Trophy, CreditCard, Coins, Bell,
  CheckCircle2, XCircle, Clock, Star
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TierStats {
  elite: number;
  super_elite: number;
  prestige_elite: number;
  app_activated: number;
  pending_redemptions: number;
  total_points: number;
  pending_commission: number;
}

interface CardHolder {
  id: string;
  customer_name: string;
  phone_1: string;
  card_tier: string;
  card_number: string | null;
  card_expiry_date: string | null;
  current_points: number;
  lifetime_points: number;
  app_activated: boolean;
  status: string;
}

interface CommissionRow {
  salesperson_id: string;
  salesperson_name: string;
  total_earned: number;
  paid: number;
  pending: number;
  cards_sold: number;
}

interface PushLogRow {
  id: string;
  customer_id: string;
  notification_type: string;
  title: string;
  message: string;
  delivery_status: string;
  sent_at: string;
  customer_name?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_LABEL: Record<string, string> = {
  elite: "Elite",
  super_elite: "Super Elite",
  prestige_elite: "Prestige Elite",
};

const TIER_COLOR: Record<string, string> = {
  elite: "bg-blue-100 text-blue-800 border-blue-200",
  super_elite: "bg-purple-100 text-purple-800 border-purple-200",
  prestige_elite: "bg-amber-100 text-amber-800 border-amber-200",
};

const DELIVERY_COLOR: Record<string, string> = {
  sent: "text-green-600",
  failed: "text-red-500",
  no_device: "text-muted-foreground",
};

const DELIVERY_ICON: Record<string, React.ReactNode> = {
  sent: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
  failed: <XCircle className="w-3.5 h-3.5 text-red-400" />,
  no_device: <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function LoyaltyDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";

  const [stats, setStats] = useState<TierStats>({
    elite: 0, super_elite: 0, prestige_elite: 0,
    app_activated: 0, pending_redemptions: 0, total_points: 0,
    pending_commission: 0,
  });
  const [holders, setHolders] = useState<CardHolder[]>([]);
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [pushLog, setPushLog] = useState<PushLogRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingLog, setLoadingLog] = useState(true);

  const [tab, setTab] = useState("holders");
  const [tierFilter, setTierFilter] = useState<"all" | "elite" | "super_elite" | "prestige_elite">("all");
  const [holderSearch, setHolderSearch] = useState("");
  const [pushSearch, setPushSearch] = useState("");

  // ── Fetch main data ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);

      // Card holders
      const { data: holdersData, error: hErr } = await supabase
        .from("elite_customers")
        .select(
          "id, customer_name, phone_1, card_tier, card_number, card_expiry_date, current_points, lifetime_points, app_activated, status"
        )
        .not("card_tier", "is", null)
        .order("card_tier")
        .order("current_points", { ascending: false });

      if (hErr) { toast.error(hErr.message); setLoading(false); return; }
      const holdersRaw = (holdersData as CardHolder[]) ?? [];
      setHolders(holdersRaw);

      // Compute tier stats from holders
      const tierCounts = { elite: 0, super_elite: 0, prestige_elite: 0 };
      let appCount = 0, totalPts = 0;
      holdersRaw.forEach(h => {
        if (h.status === "active") {
          if (h.card_tier in tierCounts) {
            (tierCounts as any)[h.card_tier]++;
          }
          if (h.app_activated) appCount++;
          totalPts += h.current_points;
        }
      });

      // Pending redemptions
      const { count: pendingRed } = await supabase
        .from("redemption_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");

      // Pending commission payout
      const { data: commPending } = await supabase
        .from("card_commissions" as any)
        .select("commission_amount")
        .eq("payment_status", "pending");
      const pendingComm = (commPending ?? []).reduce(
        (s: number, r: any) => s + (r.commission_amount ?? 0), 0
      );

      setStats({
        ...tierCounts,
        app_activated: appCount,
        pending_redemptions: pendingRed ?? 0,
        total_points: totalPts,
        pending_commission: pendingComm,
      });

      // Commission leaderboard
      const { data: commData } = await supabase
        .from("card_commissions" as any)
        .select("salesperson_id, commission_amount, payment_status");

      const staffIds = [...new Set((commData ?? []).map((r: any) => r.salesperson_id as string))];
      let profileMap: Record<string, string> = {};
      if (staffIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", staffIds);
        profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.name]));
      }

      const grouped: Record<string, CommissionRow> = {};
      (commData ?? []).forEach((r: any) => {
        const sid = r.salesperson_id as string;
        if (!grouped[sid]) {
          grouped[sid] = {
            salesperson_id: sid,
            salesperson_name: profileMap[sid] ?? "Unknown",
            total_earned: 0,
            paid: 0,
            pending: 0,
            cards_sold: 0,
          };
        }
        grouped[sid].total_earned += r.commission_amount ?? 0;
        grouped[sid].cards_sold++;
        if (r.payment_status === "paid") grouped[sid].paid += r.commission_amount ?? 0;
        else grouped[sid].pending += r.commission_amount ?? 0;
      });
      setCommissions(
        Object.values(grouped).sort((a, b) => b.total_earned - a.total_earned)
      );

      setLoading(false);
    })();
  }, [user]);

  // ── Push log (lazy load on tab switch) ──────────────────────────────────

  useEffect(() => {
    if (tab !== "push-log") return;
    (async () => {
      setLoadingLog(true);
      const { data, error } = await supabase
        .from("push_notifications_log" as any)
        .select("id, customer_id, notification_type, title, message, delivery_status, sent_at, elite_customers(customer_name)")
        .order("sent_at", { ascending: false })
        .limit(200);
      if (error) { toast.error(error.message); setLoadingLog(false); return; }
      setPushLog(
        (data ?? []).map((r: any) => ({
          ...r,
          customer_name: r.elite_customers?.customer_name ?? "—",
        }))
      );
      setLoadingLog(false);
    })();
  }, [tab]);

  // ── Derived lists ────────────────────────────────────────────────────────

  const filteredHolders = useMemo(() => {
    let list = holders.filter(h => h.status === "active");
    if (tierFilter !== "all") list = list.filter(h => h.card_tier === tierFilter);
    const q = holderSearch.trim().toLowerCase();
    if (q) list = list.filter(h =>
      h.customer_name.toLowerCase().includes(q) ||
      h.phone_1.includes(q) ||
      (h.card_number ?? "").toLowerCase().includes(q)
    );
    return list;
  }, [holders, tierFilter, holderSearch]);

  const filteredLog = useMemo(() => {
    const q = pushSearch.trim().toLowerCase();
    if (!q) return pushLog;
    return pushLog.filter(r =>
      r.customer_name?.toLowerCase().includes(q) ||
      r.notification_type.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q)
    );
  }, [pushLog, pushSearch]);

  // ── Stat card ────────────────────────────────────────────────────────────

  const StatCard = ({
    label, value, sub, icon, color, onClick,
  }: {
    label: string; value: string | number; sub?: string;
    icon: React.ReactNode; color: string; onClick?: () => void;
  }) => (
    <Card className={onClick ? "cursor-pointer hover:bg-muted/40 transition-colors" : ""} onClick={onClick}>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={`rounded-lg p-2 mt-0.5 ${color}`}>{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold leading-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );

  const LoadingSpinner = () => (
    <div className="flex justify-center py-14">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-5xl mx-auto p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Star className="w-5 h-5 text-amber-500 fill-amber-500" /> Loyalty Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">Card tier overview, commissions, and push notifications</p>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      {loading ? <LoadingSpinner /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Super Elite Members"
              value={stats.super_elite}
              sub={`${stats.prestige_elite} Prestige Elite`}
              icon={<CreditCard className="w-4 h-4 text-purple-600" />}
              color="bg-purple-100"
            />
            <StatCard
              label="App Activated"
              value={stats.app_activated}
              sub={`of ${stats.elite + stats.super_elite + stats.prestige_elite} card holders`}
              icon={<CheckCircle2 className="w-4 h-4 text-green-600" />}
              color="bg-green-100"
            />
            <StatCard
              label="Total Points in Circulation"
              value={stats.total_points.toLocaleString("en-IN")}
              icon={<Coins className="w-4 h-4 text-amber-600" />}
              color="bg-amber-100"
              onClick={() => navigate("/loyalty-points")}
            />
            <StatCard
              label="Pending Redemptions"
              value={stats.pending_redemptions}
              sub="awaiting approval"
              icon={<Bell className="w-4 h-4 text-red-500" />}
              color="bg-red-100"
              onClick={() => navigate("/loyalty-points")}
            />
          </div>

          {/* Commission summary strip */}
          {(isAdmin || user?.role === "accounts") && stats.pending_commission > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-amber-800">
                <Trophy className="w-4 h-4 text-amber-600" />
                <span>
                  <strong>₹{stats.pending_commission.toLocaleString("en-IN")}</strong> in sales commissions pending payout
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-300 text-amber-800 hover:bg-amber-100 text-xs"
                onClick={() => setTab("commissions")}
              >
                View Ledger
              </Button>
            </div>
          )}

          {/* ── Tabs ───────────────────────────────────────────────────────── */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="holders">Card Holders</TabsTrigger>
              <TabsTrigger value="commissions">Commissions</TabsTrigger>
              {(isAdmin || user?.role === "accounts") && (
                <TabsTrigger value="push-log">Push Log</TabsTrigger>
              )}
            </TabsList>

            {/* ── CARD HOLDERS ─────────────────────────────────────────────── */}
            <TabsContent value="holders" className="pt-3 space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                {/* Tier pills */}
                <div className="flex gap-1 flex-wrap">
                  {([
                    ["all", "All Tiers"],
                    ["super_elite", "Super Elite"],
                    ["prestige_elite", "Prestige Elite"],
                    ["elite", "Elite"],
                  ] as const).map(([k, lbl]) => (
                    <button
                      key={k}
                      onClick={() => setTierFilter(k)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        tierFilter === k
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Name, phone, card no…"
                    value={holderSearch}
                    onChange={e => setHolderSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {filteredHolders.length} members
              </p>

              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  {filteredHolders.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground py-10">No members</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Tier</TableHead>
                          <TableHead>Card No.</TableHead>
                          <TableHead className="text-right">Pts</TableHead>
                          <TableHead className="text-right">Lifetime</TableHead>
                          <TableHead>App</TableHead>
                          <TableHead>Expiry</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredHolders.map((h, i) => (
                          <TableRow key={h.id}>
                            <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                            <TableCell className="font-medium text-sm">
                              {h.customer_name}
                              <span className="block text-xs text-muted-foreground font-normal">{h.phone_1}</span>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-xs ${TIER_COLOR[h.card_tier] ?? ""}`}>
                                {TIER_LABEL[h.card_tier] ?? h.card_tier}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono">{h.card_number ?? "—"}</TableCell>
                            <TableCell className="text-right font-bold text-sm text-primary">
                              {h.current_points}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {h.lifetime_points}
                            </TableCell>
                            <TableCell>
                              {h.app_activated ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {h.card_expiry_date ? fmtDate(h.card_expiry_date) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── COMMISSIONS ──────────────────────────────────────────────── */}
            <TabsContent value="commissions" className="pt-3">
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  {commissions.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground py-10">No commission data yet</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>Salesperson</TableHead>
                          <TableHead className="text-right">Cards Sold</TableHead>
                          <TableHead className="text-right">Total Earned</TableHead>
                          <TableHead className="text-right text-green-600">Paid</TableHead>
                          <TableHead className="text-right text-amber-600">Pending</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {commissions.map((c, i) => (
                          <TableRow key={c.salesperson_id}>
                            <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                            <TableCell className="font-medium text-sm">
                              <span className="flex items-center gap-1.5">
                                {i === 0 && <Trophy className="w-4 h-4 text-amber-500" />}
                                {i === 1 && <Trophy className="w-4 h-4 text-slate-400" />}
                                {i === 2 && <Trophy className="w-4 h-4 text-amber-700" />}
                                {c.salesperson_name}
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-sm">{c.cards_sold}</TableCell>
                            <TableCell className="text-right font-semibold text-sm">
                              ₹{c.total_earned.toLocaleString("en-IN")}
                            </TableCell>
                            <TableCell className="text-right text-sm text-green-600">
                              ₹{c.paid.toLocaleString("en-IN")}
                            </TableCell>
                            <TableCell className="text-right font-bold text-sm text-amber-700">
                              ₹{c.pending.toLocaleString("en-IN")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
              {isAdmin && (
                <p className="text-xs text-muted-foreground mt-2">
                  To mark commissions as paid, update <code>payment_status</code> on the <code>card_commissions</code> table.
                </p>
              )}
            </TabsContent>

            {/* ── PUSH LOG ─────────────────────────────────────────────────── */}
            {(isAdmin || user?.role === "accounts") && (
              <TabsContent value="push-log" className="pt-3 space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Customer, type, or title…"
                    value={pushSearch}
                    onChange={e => setPushSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    {loadingLog ? (
                      <LoadingSpinner />
                    ) : filteredLog.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-10">No push records</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Sent</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredLog.map(r => (
                            <TableRow key={r.id}>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {fmtDateTime(r.sent_at)}
                              </TableCell>
                              <TableCell className="text-sm">{r.customer_name}</TableCell>
                              <TableCell className="text-xs font-mono text-muted-foreground">
                                {r.notification_type}
                              </TableCell>
                              <TableCell className="text-xs max-w-[180px] truncate">{r.title}</TableCell>
                              <TableCell>
                                <span className={`flex items-center gap-1 text-xs ${DELIVERY_COLOR[r.delivery_status] ?? ""}`}>
                                  {DELIVERY_ICON[r.delivery_status] ?? null}
                                  {r.delivery_status}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
                <p className="text-xs text-muted-foreground">
                  Showing last 200 records. <code>no_device</code> = customer has no app install.
                </p>
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
    </div>
  );
}
