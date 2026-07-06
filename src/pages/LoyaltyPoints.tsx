import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  CheckCircle2, XCircle, IndianRupee, Loader2, Search,
  Star, TrendingUp, Clock, RotateCcw, Gift
} from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

interface CustomerPoints {
  id: string;
  customer_name: string;
  phone_1: string;
  card_tier: string;
  card_number: string | null;
  current_points: number;
  lifetime_points: number;
  app_activated: boolean;
}

interface PointsTransaction {
  id: string;
  points: number;
  transaction_type: string;
  bill_id: string | null;
  expires_at: string | null;
  is_expired: boolean;
  created_at: string;
}

interface RedemptionRequest {
  id: string;
  customer_id: string;
  points_requested: number;
  rupee_value: number;
  status: string;
  approved_by: string | null;
  requested_at: string;
  // joined
  customer_name?: string;
  card_tier?: string | null;
  card_number?: string | null;
  current_points?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

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

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  used: "bg-gray-100 text-gray-600 border-gray-200",
};

const TX_LABEL: Record<string, string> = {
  purchase: "Purchase earned",
  redemption: "Redeemed",
  anniversary_bonus: "Anniversary bonus",
  referral: "Referral bonus",
  reversal: "Return reversal",
  expiry: "Expired",
};

const TX_COLOR: Record<string, string> = {
  purchase: "text-green-600",
  anniversary_bonus: "text-green-600",
  referral: "text-green-600",
  redemption: "text-red-500",
  reversal: "text-red-500",
  expiry: "text-gray-400",
};

const TX_ICON: Record<string, React.ReactNode> = {
  purchase: <TrendingUp className="w-4 h-4 text-green-500" />,
  anniversary_bonus: <Gift className="w-4 h-4 text-green-500" />,
  referral: <Star className="w-4 h-4 text-green-500" />,
  redemption: <IndianRupee className="w-4 h-4 text-red-400" />,
  reversal: <RotateCcw className="w-4 h-4 text-red-400" />,
  expiry: <Clock className="w-4 h-4 text-gray-400" />,
};

// Valid redemption tiers per card type
const REDEMPTION_TIERS: Record<string, { points: number; value: number }[]> = {
  super_elite: [
    { points: 75, value: 500 },
    { points: 100, value: 750 },
  ],
  prestige_elite: [
    { points: 100, value: 600 },
    { points: 250, value: 1500 },
  ],
};

function fmtInr(n: number) {
  return `₹${Math.abs(n).toLocaleString("en-IN")}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LoyaltyPoints() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isAccounts = user?.role === "accounts";

  // Data
  const [customers, setCustomers] = useState<CustomerPoints[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRequest[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingRedemptions, setLoadingRedemptions] = useState(true);

  // Points history dialog
  const [historyCustomer, setHistoryCustomer] = useState<CustomerPoints | null>(null);
  const [historyTx, setHistoryTx] = useState<PointsTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Approval dialog
  const [actionReq, setActionReq] = useState<RedemptionRequest | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject">("approve");
  const [actionNotes, setActionNotes] = useState("");
  const [actionSaving, setActionSaving] = useState(false);

  // Filters
  const [customerSearch, setCustomerSearch] = useState("");
  const [tab, setTab] = useState("queue");

  // ── Load customers (points-earning tiers only for history tab) ────────────

  const loadCustomers = async () => {
    setLoadingCustomers(true);
    const { data, error } = await supabase
      .from("elite_customers")
      .select("id, customer_name, phone_1, card_tier, card_number, current_points, lifetime_points, app_activated")
      .in("card_tier", ["super_elite", "prestige_elite"])
      .eq("status", "active")
      .order("current_points", { ascending: false });
    if (error) toast.error(error.message);
    else setCustomers((data as CustomerPoints[]) ?? []);
    setLoadingCustomers(false);
  };

  // ── Load redemption requests ──────────────────────────────────────────────

  const loadRedemptions = async () => {
    setLoadingRedemptions(true);
    const { data, error } = await supabase
      .from("redemption_requests")
      .select("*, elite_customers(customer_name, card_tier, card_number, current_points)")
      .order("requested_at", { ascending: false })
      .limit(200);
    if (error) { toast.error(error.message); setLoadingRedemptions(false); return; }
    setRedemptions(
      (data ?? []).map((r: any) => ({
        ...r,
        customer_name: r.elite_customers?.customer_name,
        card_tier: r.elite_customers?.card_tier,
        card_number: r.elite_customers?.card_number,
        current_points: r.elite_customers?.current_points ?? 0,
      }))
    );
    setLoadingRedemptions(false);
  };

  useEffect(() => {
    if (user) { loadCustomers(); loadRedemptions(); }
  }, [user?.id]);

  // ── Points history for a customer ─────────────────────────────────────────

  const openHistory = async (c: CustomerPoints) => {
    setHistoryCustomer(c);
    setHistoryTx([]);
    setLoadingHistory(true);
    const { data, error } = await supabase
      .from("card_points")
      .select("id, points, transaction_type, bill_id, expires_at, is_expired, created_at" as any)
      .eq("customer_id", c.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    else setHistoryTx(((data as unknown) as PointsTransaction[]) ?? []);
    setLoadingHistory(false);
  };

  // ── Validation helpers ────────────────────────────────────────────────────

  const isValidRedemptionTier = (tier: string | null | undefined, pts: number): boolean => {
    if (!tier) return false;
    const tiers = REDEMPTION_TIERS[tier];
    return tiers?.some(t => t.points === pts) ?? false;
  };

  const hasEnoughPoints = (req: RedemptionRequest) =>
    (req.current_points ?? 0) >= req.points_requested;

  // ── Approval / rejection ──────────────────────────────────────────────────

  const openAction = (req: RedemptionRequest, type: "approve" | "reject") => {
    setActionReq(req);
    setActionType(type);
    setActionNotes("");
  };

  const submitAction = async () => {
    if (!actionReq || !user) return;
    if (actionType === "reject" && !actionNotes.trim()) {
      toast.error("Enter a rejection reason"); return;
    }
    if (actionType === "approve" && !hasEnoughPoints(actionReq)) {
      toast.error("Customer does not have enough points"); return;
    }
    setActionSaving(true);
    try {
      const { error } = await supabase
        .from("redemption_requests")
        .update({
          status: actionType === "approve" ? "approved" : "rejected",
          approved_by: user.id,
        } as any)
        .eq("id", actionReq.id);
      if (error) throw error;
      toast.success(actionType === "approve" ? "Redemption approved" : "Redemption rejected");

      // Notify customer via push
      if (actionType === "approve") {
        supabase.functions.invoke("send-push", {
          body: {
            customer_id: actionReq.customer_id,
            type: "redemption_approved",
            title: "Redemption approved!",
            message: `Your request to redeem ${actionReq.points_requested} points for ${fmtInr(actionReq.rupee_value)} has been approved. Use it on your next purchase!`,
            data: { points: actionReq.points_requested, value: actionReq.rupee_value },
          },
        }).catch(() => {/* best-effort */});
      } else {
        supabase.functions.invoke("send-push", {
          body: {
            customer_id: actionReq.customer_id,
            type: "redemption_rejected",
            title: "Redemption not approved",
            message: `Your redemption request of ${actionReq.points_requested} points could not be approved at this time. Please contact the store for details.`,
          },
        }).catch(() => {/* best-effort */});
      }

      setActionReq(null);
      loadRedemptions();
      loadCustomers(); // refresh points
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setActionSaving(false);
    }
  };

  // ── Derived lists ─────────────────────────────────────────────────────────

  const pendingRedemptions = useMemo(
    () => redemptions.filter(r => r.status === "pending"),
    [redemptions]
  );

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers;
    const q = customerSearch.toLowerCase();
    return customers.filter(
      c =>
        c.customer_name.toLowerCase().includes(q) ||
        c.phone_1.includes(q) ||
        (c.card_number ?? "").toLowerCase().includes(q)
    );
  }, [customers, customerSearch]);

  // ── Sub-components ────────────────────────────────────────────────────────

  const RedemptionCard = ({ req, showActions }: { req: RedemptionRequest; showActions: boolean }) => {
    const valid = isValidRedemptionTier(req.card_tier, req.points_requested);
    const hasPoints = hasEnoughPoints(req);
    return (
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{req.customer_name}</p>
              <p className="text-xs text-muted-foreground">{req.card_number || "—"}</p>
              {req.card_tier && (
                <Badge variant="outline" className={`text-xs mt-1 ${TIER_COLOR[req.card_tier] ?? ""}`}>
                  {TIER_LABEL[req.card_tier] ?? req.card_tier}
                </Badge>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{fmtDate(req.requested_at)}</p>
              <Badge variant="outline" className={`text-xs mt-1 ${STATUS_COLOR[req.status] ?? ""}`}>
                {req.status.toUpperCase()}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Points requested</p>
              <p className="font-semibold">{req.points_requested} pts</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Rupee value</p>
              <p className="font-semibold">{fmtInr(req.rupee_value)}</p>
            </div>
            <div className="col-span-2 mt-1">
              <p className="text-muted-foreground text-xs">Customer balance</p>
              <p className={`font-semibold ${hasPoints ? "text-green-600" : "text-red-500"}`}>
                {req.current_points ?? 0} pts
              </p>
            </div>
          </div>

          {/* Warnings */}
          {!valid && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              Points amount doesn't match a standard redemption tier for this card type
            </div>
          )}
          {!hasPoints && req.status === "pending" && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
              Insufficient points — balance is {req.current_points ?? 0}, need {req.points_requested}
            </div>
          )}

          {showActions && req.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white gap-1"
                disabled={!hasPoints}
                onClick={() => openAction(req, "approve")}
              >
                <CheckCircle2 className="w-4 h-4" /> Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="gap-1"
                onClick={() => openAction(req, "reject")}
              >
                <XCircle className="w-4 h-4" /> Reject
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const LoadingSpinner = () => (
    <div className="flex justify-center py-14">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold">Loyalty Points</h1>
      <p className="text-sm text-muted-foreground -mt-2">
        Approve customer redemption requests and view points history.
      </p>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="queue">
            Redemption Queue
            {pendingRedemptions.length > 0 && (
              <Badge className="ml-2 h-5 px-1.5 text-xs bg-yellow-500 text-white border-0">
                {pendingRedemptions.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">Points History</TabsTrigger>
          {(isAdmin || isAccounts) && (
            <TabsTrigger value="all-redemptions">All Requests</TabsTrigger>
          )}
        </TabsList>

        {/* ── REDEMPTION QUEUE ────────────────────────────────────────────── */}
        <TabsContent value="queue" className="pt-2">
          {loadingRedemptions ? <LoadingSpinner /> : (
            pendingRedemptions.length === 0 ? (
              <Card>
                <CardContent className="p-10 text-center text-muted-foreground text-sm">
                  No pending redemption requests
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {pendingRedemptions.map(r => (
                  <RedemptionCard key={r.id} req={r} showActions={isAdmin || isAccounts} />
                ))}
              </div>
            )
          )}
        </TabsContent>

        {/* ── POINTS HISTORY ──────────────────────────────────────────────── */}
        <TabsContent value="history" className="pt-2 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, or card number…"
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {loadingCustomers ? <LoadingSpinner /> : (
            filteredCustomers.length === 0 ? (
              <Card>
                <CardContent className="p-10 text-center text-muted-foreground text-sm">
                  No card holders found
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {filteredCustomers.map(c => (
                  <Card
                    key={c.id}
                    className="shadow-sm cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => openHistory(c)}
                  >
                    <CardContent className="p-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-sm">{c.customer_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.phone_1} · {c.card_number || "No card no."}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className={`text-xs ${TIER_COLOR[c.card_tier] ?? ""}`}>
                            {TIER_LABEL[c.card_tier] ?? c.card_tier}
                          </Badge>
                          {!c.app_activated && (
                            <span className="text-xs text-muted-foreground italic">App not activated</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-primary">{c.current_points}</p>
                        <p className="text-xs text-muted-foreground">current pts</p>
                        <p className="text-xs text-muted-foreground">{c.lifetime_points} lifetime</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          )}
        </TabsContent>

        {/* ── ALL REQUESTS (admin/accounts) ───────────────────────────────── */}
        {(isAdmin || isAccounts) && (
          <TabsContent value="all-redemptions" className="pt-2 space-y-3">
            {loadingRedemptions ? <LoadingSpinner /> : (
              redemptions.length === 0 ? (
                <Card>
                  <CardContent className="p-10 text-center text-muted-foreground text-sm">
                    No redemption requests yet
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {redemptions.map(r => (
                    <RedemptionCard key={r.id} req={r} showActions={r.status === "pending"} />
                  ))}
                </div>
              )
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* ── POINTS HISTORY DIALOG ─────────────────────────────────────────── */}
      <Dialog open={!!historyCustomer} onOpenChange={o => { if (!o) setHistoryCustomer(null); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Points History</DialogTitle>
          </DialogHeader>

          {historyCustomer && (
            <div className="space-y-4">
              {/* Customer summary */}
              <div className="rounded-lg border p-3 space-y-1">
                <p className="font-semibold">{historyCustomer.customer_name}</p>
                <p className="text-xs text-muted-foreground">
                  {historyCustomer.phone_1} · {historyCustomer.card_number || "No card no."}
                </p>
                <div className="flex gap-4 pt-1">
                  <div>
                    <p className="text-xs text-muted-foreground">Current</p>
                    <p className="text-xl font-bold text-primary">{historyCustomer.current_points} pts</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Lifetime earned</p>
                    <p className="text-xl font-bold text-muted-foreground">{historyCustomer.lifetime_points} pts</p>
                  </div>
                </div>
                {!historyCustomer.app_activated && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                    App not activated — points will not be credited until customer logs in
                  </p>
                )}
              </div>

              {/* Valid redemption tiers */}
              {REDEMPTION_TIERS[historyCustomer.card_tier] && (
                <div className="rounded-lg bg-muted/40 border p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Available redemptions</p>
                  <div className="flex flex-wrap gap-2">
                    {REDEMPTION_TIERS[historyCustomer.card_tier].map(t => (
                      <div
                        key={t.points}
                        className={`text-xs rounded-full px-3 py-1 border font-medium ${
                          historyCustomer.current_points >= t.points
                            ? "bg-green-50 border-green-200 text-green-700"
                            : "bg-muted text-muted-foreground border-border"
                        }`}
                      >
                        {t.points} pts = {fmtInr(t.value)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transaction list */}
              {loadingHistory ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : historyTx.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-6">No transactions yet</p>
              ) : (
                <div className="space-y-1">
                  {historyTx.map(tx => (
                    <div
                      key={tx.id}
                      className={`flex items-center gap-3 py-2 border-b last:border-0 ${tx.is_expired ? "opacity-50" : ""}`}
                    >
                      <div className="shrink-0">
                        {TX_ICON[tx.transaction_type] ?? <Star className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight">
                          {TX_LABEL[tx.transaction_type] ?? tx.transaction_type}
                        </p>
                        <p className="text-xs text-muted-foreground">{fmtDate(tx.created_at)}</p>
                        {tx.expires_at && !tx.is_expired && (
                          <p className="text-xs text-muted-foreground">
                            Expires {fmtDate(tx.expires_at)}
                          </p>
                        )}
                      </div>
                      <div className={`text-sm font-bold shrink-0 ${TX_COLOR[tx.transaction_type] ?? ""}`}>
                        {tx.points > 0 ? "+" : ""}{tx.points} pts
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── APPROVAL DIALOG ──────────────────────────────────────────────── */}
      <Dialog open={!!actionReq} onOpenChange={o => { if (!o) setActionReq(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "approve" ? "Approve Redemption" : "Reject Redemption"}
            </DialogTitle>
          </DialogHeader>

          {actionReq && (
            <div className="space-y-4">
              <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                <p className="font-semibold">{actionReq.customer_name}</p>
                {actionReq.card_tier && (
                  <Badge variant="outline" className={`text-xs ${TIER_COLOR[actionReq.card_tier] ?? ""}`}>
                    {TIER_LABEL[actionReq.card_tier] ?? actionReq.card_tier}
                  </Badge>
                )}
                <div className="flex justify-between pt-1">
                  <span className="text-muted-foreground">Points requested</span>
                  <span className="font-semibold">{actionReq.points_requested} pts</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rupee value</span>
                  <span className="font-semibold">{fmtInr(actionReq.rupee_value)}</span>
                </div>
                <div className="flex justify-between border-t pt-1.5">
                  <span className="text-muted-foreground">Customer balance</span>
                  <span className={`font-bold ${hasEnoughPoints(actionReq) ? "text-green-600" : "text-red-500"}`}>
                    {actionReq.current_points ?? 0} pts
                  </span>
                </div>
                {!isValidRedemptionTier(actionReq.card_tier, actionReq.points_requested) && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-1.5">
                    Non-standard redemption amount — verify before approving
                  </p>
                )}
              </div>

              {actionType === "reject" && (
                <div className="space-y-1">
                  <Label>Rejection Reason *</Label>
                  <Textarea
                    placeholder="Reason for rejection…"
                    value={actionNotes}
                    onChange={e => setActionNotes(e.target.value)}
                    rows={3}
                  />
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setActionReq(null)}>Cancel</Button>
                <Button
                  variant={actionType === "reject" ? "destructive" : "default"}
                  className={actionType === "approve" ? "bg-green-600 hover:bg-green-700" : ""}
                  onClick={submitAction}
                  disabled={actionSaving || (actionType === "approve" && !hasEnoughPoints(actionReq))}
                >
                  {actionSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  {actionType === "approve" ? "Approve" : "Reject"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
