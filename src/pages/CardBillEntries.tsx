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
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle, CheckCircle2, XCircle, IndianRupee, Loader2, Plus, Search
} from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

interface CustomerLite {
  id: string;
  customer_name: string;
  phone_1: string;
  card_tier: string | null;
  card_number: string | null;
  card_expiry_date: string | null;
  current_points: number;
}

interface BillEntry {
  id: string;
  customer_id: string;
  entered_by: string;
  bill_reference: string | null;
  bill_date: string;
  gross_bill_amount: number;
  base_scheme_discount_pct: number;
  card_discount_pct: number;
  redemption_amount: number;
  net_bill_amount: number;
  is_card_sale: boolean;
  is_return: boolean;
  approval_status: "pending" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  // joined
  customer_name?: string;
  card_tier?: string | null;
  card_number?: string | null;
  salesperson_name?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TIER_LABEL: Record<string, string> = {
  elite: "Elite",
  super_elite: "Super Elite",
  prestige_elite: "Prestige Elite",
};

const TIER_EXTRA_DISCOUNT: Record<string, number> = {
  elite: 5,
  super_elite: 5,
  prestige_elite: 6,
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
};

const COMMISSION_FLAT: Record<string, number> = {
  elite: 100,
  super_elite: 150,
  prestige_elite: 200,
};

function fmtInr(n: number) {
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CardBillEntries() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isAccounts = user?.role === "accounts";
  const isSales = user?.role === "sales";

  // Data
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [entries, setEntries] = useState<BillEntry[]>([]);
  const [discountCeiling, setDiscountCeiling] = useState(15.5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerLite | null>(null);
  const [billRef, setBillRef] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [grossAmount, setGrossAmount] = useState("");
  const [baseSchemePct, setBaseSchemePct] = useState("");
  const [redemptionAmt, setRedemptionAmt] = useState("");
  const [isCardSale, setIsCardSale] = useState(false);
  const [isReturn, setIsReturn] = useState(false);
  const [notes, setNotes] = useState("");

  // Approval dialog
  const [actionEntry, setActionEntry] = useState<BillEntry | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject">("approve");
  const [actionNotes, setActionNotes] = useState("");
  const [actionNetAmount, setActionNetAmount] = useState("");
  const [actionSaving, setActionSaving] = useState(false);

  // Tabs + filter
  const [tab, setTab] = useState(isSales ? "mine" : "pending");
  const [filterSearch, setFilterSearch] = useState("");

  // ── Computed discount values ──────────────────────────────────────────────

  const gross = parseFloat(grossAmount) || 0;
  const basePct = parseFloat(baseSchemePct) || 0;
  const redemption = parseFloat(redemptionAmt) || 0;
  const tierDiscount = selectedCustomer?.card_tier
    ? (TIER_EXTRA_DISCOUNT[selectedCustomer.card_tier] ?? 0)
    : 0;

  const effectiveCardDiscount = isReturn
    ? 0
    : Math.max(0, Math.min(tierDiscount, discountCeiling - basePct));

  const ceilingBreached = !isReturn && basePct >= discountCeiling;
  const discountCapped =
    !isReturn && !ceilingBreached && tierDiscount > 0 &&
    basePct + tierDiscount > discountCeiling;

  const redemptionCap = gross * 0.05;
  const effectiveRedemption = isReturn ? 0 : Math.min(redemption, redemptionCap);
  const redemptionCapped = !isReturn && redemption > redemptionCap && redemption > 0;

  const netAmount = isReturn
    ? -gross
    : parseFloat(
        (gross * (1 - (basePct + effectiveCardDiscount) / 100) - effectiveRedemption).toFixed(2)
      );

  // ── Load settings ─────────────────────────────────────────────────────────

  useEffect(() => {
    (supabase as any)
      .from("card_settings")
      .select("value")
      .eq("key", "discount_ceiling_pct")
      .single()
      .then(({ data }) => {
        if (data) {
          const v = parseFloat(String((data as any).value).replace(/"/g, ""));
          if (!isNaN(v)) setDiscountCeiling(v);
        }
      });
  }, []);

  // ── Load customers (for form picker) ─────────────────────────────────────

  useEffect(() => {
    supabase
      .from("elite_customers")
      .select("id, customer_name, phone_1, card_tier, card_number, card_expiry_date, current_points")
      .eq("status", "active")
      .order("customer_name")
      .then(({ data }) => setCustomers((data as CustomerLite[]) ?? []));
  }, []);

  // ── Load entries ──────────────────────────────────────────────────────────

  const loadEntries = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("card_bill_entries" as any)
        .select("*, elite_customers(customer_name, card_tier, card_number)")
        .order("created_at", { ascending: false })
        .limit(400);

      if (isSales) q = (q as any).eq("entered_by", user!.id);

      const { data: raw, error } = await q;
      if (error) throw error;

      // Fetch salesperson names separately
      const staffIds = [...new Set((raw ?? []).map((e: any) => e.entered_by as string))];
      let profileMap: Record<string, string> = {};
      if (staffIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", staffIds);
        profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.name]));
      }

      setEntries(
        (raw ?? []).map((r: any) => ({
          ...r,
          customer_name: r.elite_customers?.customer_name,
          card_tier: r.elite_customers?.card_tier,
          card_number: r.elite_customers?.card_number,
          salesperson_name: profileMap[r.entered_by] ?? "—",
        }))
      );
    } catch (e: any) {
      toast.error(e.message || "Failed to load entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) loadEntries(); }, [user?.id]);

  // ── Form helpers ──────────────────────────────────────────────────────────

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers.slice(0, 15);
    const q = customerSearch.toLowerCase();
    return customers
      .filter(c =>
        c.customer_name.toLowerCase().includes(q) || c.phone_1.includes(q)
      )
      .slice(0, 15);
  }, [customers, customerSearch]);

  const resetForm = () => {
    setSelectedCustomer(null);
    setCustomerSearch("");
    setBillRef("");
    setBillDate(todayISO());
    setGrossAmount("");
    setBaseSchemePct("");
    setRedemptionAmt("");
    setIsCardSale(false);
    setIsReturn(false);
    setNotes("");
  };

  const handleSave = async () => {
    if (!user || !selectedCustomer) { toast.error("Select a customer"); return; }
    if (gross <= 0) { toast.error("Enter a valid gross amount"); return; }
    if (!billDate) { toast.error("Enter a bill date"); return; }

    setSaving(true);
    try {
      const { error: entryErr } = await supabase.from("card_bill_entries" as any).insert({
        customer_id: selectedCustomer.id,
        entered_by: user.id,
        bill_reference: billRef.trim() || null,
        bill_date: billDate,
        gross_bill_amount: gross,
        base_scheme_discount_pct: basePct,
        card_discount_pct: effectiveCardDiscount,
        redemption_amount: effectiveRedemption,
        net_bill_amount: netAmount,
        is_card_sale: isCardSale,
        is_return: isReturn,
        approval_status: "pending",
        notes: notes.trim() || null,
      });
      if (entryErr) throw entryErr;

      // Commission row for card enrollment sales
      if (isCardSale && selectedCustomer.card_tier) {
        const commAmt = COMMISSION_FLAT[selectedCustomer.card_tier] ?? 0;
        if (commAmt > 0) {
          await supabase.from("card_commissions" as any).insert({
            salesperson_id: user.id,
            customer_id: selectedCustomer.id,
            card_tier: selectedCustomer.card_tier,
            commission_amount: commAmt,
            payment_status: "pending",
          });
        }
      }

      toast.success("Entry saved — awaiting accounts approval");
      resetForm();
      setTab("mine");
      loadEntries();
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ── Approval helpers ──────────────────────────────────────────────────────

  const openAction = (entry: BillEntry, type: "approve" | "reject") => {
    setActionEntry(entry);
    setActionType(type);
    setActionNotes("");
    setActionNetAmount(String(entry.net_bill_amount));
  };

  const submitAction = async () => {
    if (!actionEntry || !user) return;
    if (actionType === "reject" && !actionNotes.trim()) {
      toast.error("Enter a rejection reason");
      return;
    }
    // Accounts confirms the FINAL net value at approval — points credit off this
    const finalNet = actionEntry.is_return
      ? actionEntry.net_bill_amount
      : parseFloat(actionNetAmount);
    if (actionType === "approve" && !actionEntry.is_return && (isNaN(finalNet) || finalNet <= 0)) {
      toast.error("Enter the final net bill amount");
      return;
    }
    setActionSaving(true);
    try {
      const updatePayload: Record<string, any> = {
        approval_status: actionType === "approve" ? "approved" : "rejected",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        notes: actionNotes.trim() || actionEntry.notes || null,
      };
      if (actionType === "approve" && !actionEntry.is_return) {
        updatePayload.net_bill_amount = finalNet;
      }
      const { error } = await supabase
        .from("card_bill_entries" as any)
        .update(updatePayload)
        .eq("id", actionEntry.id);
      if (error) throw error;

      toast.success(actionType === "approve" ? "Entry approved" : "Entry rejected");

      // Fire push notification to customer when a bill is approved
      if (actionType === "approve") {
        const isReturn = actionEntry.is_return;
        const tier = actionEntry.card_tier;
        const earnsTier = tier === "super_elite" || tier === "prestige_elite";

        if (isReturn) {
          // Return: points may have been reversed
          supabase.functions.invoke("send-push", {
            body: {
              customer_id: actionEntry.customer_id,
              type: "points_reversed",
              title: "Return processed",
              message: `Your return of ₹${Math.abs(actionEntry.gross_bill_amount).toLocaleString("en-IN")} has been processed. Any earned points have been adjusted.`,
            },
          }).catch(() => {/* best-effort */});
        } else if (earnsTier) {
          // Regular sale with points-eligible tier
          supabase.functions.invoke("send-push", {
            body: {
              customer_id: actionEntry.customer_id,
              type: "points_credited",
              title: "Points credited!",
              message: `Your purchase of ₹${finalNet.toLocaleString("en-IN")} has been approved. Loyalty points have been added to your wallet.`,
              data: { bill_id: actionEntry.id },
            },
          }).catch(() => {/* best-effort */});
        }
      }

      setActionEntry(null);
      loadEntries();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setActionSaving(false);
    }
  };

  // ── Filtered lists ────────────────────────────────────────────────────────

  const searchFiltered = useMemo(() => {
    if (!filterSearch.trim()) return entries;
    const q = filterSearch.toLowerCase();
    return entries.filter(
      e =>
        e.customer_name?.toLowerCase().includes(q) ||
        e.bill_reference?.toLowerCase().includes(q) ||
        e.salesperson_name?.toLowerCase().includes(q)
    );
  }, [entries, filterSearch]);

  const byStatus = (s: string) => searchFiltered.filter(e => e.approval_status === s);
  const myEntries = searchFiltered.filter(e => e.entered_by === user?.id);

  // ── Sub-components ────────────────────────────────────────────────────────

  const EntryCard = ({
    entry,
    showActions,
  }: {
    entry: BillEntry;
    showActions: boolean;
  }) => (
    <Card className="shadow-sm">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm leading-tight">{entry.customer_name}</p>
            <p className="text-xs text-muted-foreground">{entry.card_number || "No card no."}</p>
            {entry.card_tier && (
              <Badge
                variant="outline"
                className={`text-xs mt-1 ${TIER_COLOR[entry.card_tier] ?? ""}`}
              >
                {TIER_LABEL[entry.card_tier] ?? entry.card_tier}
              </Badge>
            )}
          </div>
          <div className="text-right shrink-0 space-y-1">
            <p className="text-xs text-muted-foreground">
              {entry.bill_date}
              {entry.bill_reference ? ` · ${entry.bill_reference}` : ""}
            </p>
            <p className="font-bold text-sm flex items-center justify-end gap-1">
              {entry.is_return && (
                <span className="text-xs text-red-500 font-normal mr-1">RETURN</span>
              )}
              <IndianRupee className="w-3 h-3" />
              {Math.abs(entry.gross_bill_amount).toLocaleString("en-IN")}
            </p>
            <Badge
              variant="outline"
              className={`text-xs ${STATUS_COLOR[entry.approval_status] ?? ""}`}
            >
              {entry.approval_status.toUpperCase()}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          {!entry.is_return && (
            <>
              <span>
                Base scheme: <strong>{entry.base_scheme_discount_pct}%</strong>
              </span>
              <span>
                Card discount: <strong>{entry.card_discount_pct}%</strong>
              </span>
            </>
          )}
          {entry.redemption_amount > 0 && (
            <span>
              Redemption: <strong>{fmtInr(entry.redemption_amount)}</strong>
            </span>
          )}
          <span>
            Net:{" "}
            <strong className={entry.net_bill_amount < 0 ? "text-red-600" : "text-foreground"}>
              {entry.net_bill_amount < 0 ? "-" : ""}
              {fmtInr(entry.net_bill_amount)}
            </strong>
          </span>
          {entry.is_card_sale && (
            <span className="col-span-2 text-blue-600 font-medium">
              Card enrollment — commission logged
            </span>
          )}
        </div>

        {(isAdmin || isAccounts) && entry.salesperson_name && (
          <p className="text-xs text-muted-foreground">By: {entry.salesperson_name}</p>
        )}

        {entry.notes && (
          <p className="text-xs text-muted-foreground italic border-t pt-1">{entry.notes}</p>
        )}

        {showActions && entry.approval_status === "pending" && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white gap-1"
              onClick={() => openAction(entry, "approve")}
            >
              <CheckCircle2 className="w-4 h-4" /> Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1"
              onClick={() => openAction(entry, "reject")}
            >
              <XCircle className="w-4 h-4" /> Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const EntryList = ({
    list,
    showActions,
  }: {
    list: BillEntry[];
    showActions: boolean;
  }) =>
    list.length === 0 ? (
      <Card>
        <CardContent className="p-10 text-center text-muted-foreground text-sm">
          No entries
        </CardContent>
      </Card>
    ) : (
      <div className="space-y-3">
        {list.map(e => (
          <EntryCard key={e.id} entry={e} showActions={showActions} />
        ))}
      </div>
    );

  const LoadingSpinner = () => (
    <div className="flex justify-center py-14">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold">Card Bill Entries</h1>
      <p className="text-sm text-muted-foreground -mt-2">
        Entries are created automatically when a lead is marked Sold. Accounts confirms the final net value to credit points.
      </p>

      {/* Global search (accounts/admin only) */}
      {(isAdmin || isAccounts) && (
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search customer, bill ref, salesperson…"
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          {isSales && <TabsTrigger value="mine">My Entries</TabsTrigger>}
          {isAdmin && (
            <TabsTrigger value="new">
              <Plus className="w-4 h-4 mr-1" />
              Manual Entry
            </TabsTrigger>
          )}
          {(isAccounts || isAdmin) && (
            <>
              <TabsTrigger value="pending">
                Pending ({byStatus("pending").length})
              </TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
            </>
          )}
          {isAdmin && <TabsTrigger value="all">All</TabsTrigger>}
        </TabsList>

        {/* ── MANUAL ENTRY FORM (admin only — returns / exceptions) ───────── */}
        {isAdmin && (
          <TabsContent value="new" className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              Admin-only: use for returns and exceptional corrections. Regular sales flow in automatically from won leads.
            </p>
            <Card>
              <CardContent className="p-4 space-y-4">

                {/* Customer picker */}
                <div className="space-y-1">
                  <Label>Customer *</Label>
                  {selectedCustomer ? (
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{selectedCustomer.customer_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {selectedCustomer.phone_1}
                          {selectedCustomer.card_number ? ` · ${selectedCustomer.card_number}` : ""}
                        </p>
                        {selectedCustomer.card_tier && (
                          <Badge
                            variant="outline"
                            className={`text-xs mt-1 ${TIER_COLOR[selectedCustomer.card_tier]}`}
                          >
                            {TIER_LABEL[selectedCustomer.card_tier]} · {selectedCustomer.current_points} pts
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setSelectedCustomer(null); setCustomerSearch(""); }}
                      >
                        Change
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by name or phone…"
                          value={customerSearch}
                          onChange={e => setCustomerSearch(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                      {customerSearch.trim() && (
                        <div className="border rounded-lg divide-y max-h-52 overflow-y-auto shadow-sm">
                          {filteredCustomers.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground">No results</p>
                          ) : (
                            filteredCustomers.map(c => (
                              <button
                                key={c.id}
                                className="w-full text-left p-3 hover:bg-muted text-sm transition-colors"
                                onClick={() => { setSelectedCustomer(c); setCustomerSearch(""); }}
                              >
                                <p className="font-medium">{c.customer_name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {c.phone_1}
                                  {c.card_tier ? ` · ${TIER_LABEL[c.card_tier]}` : " · No tier"}
                                </p>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Bill date + reference */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Bill Date *</Label>
                    <Input
                      type="date"
                      value={billDate}
                      onChange={e => setBillDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Bill / Invoice Ref</Label>
                    <Input
                      placeholder="e.g. INV-001"
                      value={billRef}
                      onChange={e => setBillRef(e.target.value)}
                    />
                  </div>
                </div>

                {/* Gross amount */}
                <div className="space-y-1">
                  <Label>Gross Bill Amount (₹) *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={grossAmount}
                    onChange={e => setGrossAmount(e.target.value)}
                  />
                </div>

                {/* Base scheme (hidden on returns) */}
                {!isReturn && (
                  <div className="space-y-1">
                    <Label>Godrej Base Scheme Discount (%)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder="0.0"
                      value={baseSchemePct}
                      onChange={e => setBaseSchemePct(e.target.value)}
                    />
                  </div>
                )}

                {/* Discount summary panel */}
                {gross > 0 && !isReturn && (
                  <div className="rounded-lg border p-3 space-y-1.5 text-sm bg-muted/40">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Card extra discount</span>
                      <span className="font-medium text-foreground">
                        {effectiveCardDiscount.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Total discount</span>
                      <span className="font-medium text-foreground">
                        {(basePct + effectiveCardDiscount).toFixed(1)}%
                        <span className="text-xs font-normal ml-1">
                          / {discountCeiling}% ceiling
                        </span>
                      </span>
                    </div>
                    {effectiveRedemption > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Redemption</span>
                        <span className="font-medium text-foreground">
                          − {fmtInr(effectiveRedemption)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold border-t pt-1.5">
                      <span>Net Amount</span>
                      <span>{fmtInr(netAmount)}</span>
                    </div>

                    {ceilingBreached && (
                      <div className="flex gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30 text-xs text-destructive">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        Base scheme at/above {discountCeiling}% ceiling — no card discount applied
                      </div>
                    )}
                    {discountCapped && (
                      <div className="flex gap-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        Card discount trimmed to {effectiveCardDiscount.toFixed(1)}% to stay within ceiling
                      </div>
                    )}
                    {redemptionCapped && (
                      <div className="flex gap-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        Redemption capped at 5% of gross ({fmtInr(redemptionCap)})
                      </div>
                    )}
                  </div>
                )}

                {/* Return summary */}
                {gross > 0 && isReturn && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                    <p className="font-semibold text-red-700">
                      Return — credit: {fmtInr(gross)}
                    </p>
                    <p className="text-xs text-red-500 mt-0.5">
                      Points will be reversed after accounts approval
                    </p>
                  </div>
                )}

                {/* Redemption (hidden on returns) */}
                {!isReturn && (
                  <div className="space-y-1">
                    <Label>Redemption Amount Applied (₹)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={redemptionAmt}
                      onChange={e => setRedemptionAmt(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Max 5% of gross ={" "}
                      {gross > 0 ? fmtInr(redemptionCap) : "₹0.00"}
                    </p>
                  </div>
                )}

                {/* Flags */}
                <div className="space-y-3 pt-1">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="isCardSale"
                      checked={isCardSale}
                      onCheckedChange={v => setIsCardSale(!!v)}
                    />
                    <Label htmlFor="isCardSale" className="cursor-pointer font-normal">
                      This is a card enrollment sale — commission will be logged
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="isReturn"
                      checked={isReturn}
                      onCheckedChange={v => {
                        setIsReturn(!!v);
                        if (v) { setRedemptionAmt(""); setBaseSchemePct(""); }
                      }}
                    />
                    <Label htmlFor="isReturn" className="cursor-pointer font-normal text-red-600">
                      This is a return / cancellation
                    </Label>
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Textarea
                    placeholder="Any remarks…"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={handleSave}
                  disabled={saving || !selectedCustomer || gross <= 0}
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Save Entry
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── MY ENTRIES (sales) ──────────────────────────────────────────── */}
        {isSales && (
          <TabsContent value="mine" className="pt-2">
            {loading ? <LoadingSpinner /> : <EntryList list={myEntries} showActions={false} />}
          </TabsContent>
        )}

        {/* ── ACCOUNTS / ADMIN TABS ───────────────────────────────────────── */}
        {(isAccounts || isAdmin) && (
          <>
            <TabsContent value="pending" className="pt-2">
              {loading ? <LoadingSpinner /> : (
                <EntryList list={byStatus("pending")} showActions={true} />
              )}
            </TabsContent>
            <TabsContent value="approved" className="pt-2">
              {loading ? <LoadingSpinner /> : (
                <EntryList list={byStatus("approved")} showActions={false} />
              )}
            </TabsContent>
            <TabsContent value="rejected" className="pt-2">
              {loading ? <LoadingSpinner /> : (
                <EntryList list={byStatus("rejected")} showActions={false} />
              )}
            </TabsContent>
          </>
        )}

        {/* ── ALL (admin only) ────────────────────────────────────────────── */}
        {isAdmin && (
          <TabsContent value="all" className="pt-2">
            {loading ? <LoadingSpinner /> : (
              <EntryList list={searchFiltered} showActions={true} />
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* ── APPROVAL DIALOG ──────────────────────────────────────────────── */}
      <Dialog open={!!actionEntry} onOpenChange={o => { if (!o) setActionEntry(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "approve" ? "Approve Entry" : "Reject Entry"}
            </DialogTitle>
          </DialogHeader>

          {actionEntry && (
            <div className="space-y-4">
              {/* Entry summary */}
              <div className="rounded-lg border p-3 text-sm space-y-1.5">
                <p className="font-semibold">{actionEntry.customer_name}</p>
                <p className="text-muted-foreground text-xs">
                  {actionEntry.bill_date}
                  {actionEntry.bill_reference ? ` · ${actionEntry.bill_reference}` : ""}
                  {actionEntry.salesperson_name
                    ? ` · Entered by ${actionEntry.salesperson_name}`
                    : ""}
                </p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gross</span>
                  <span>{fmtInr(actionEntry.gross_bill_amount)}</span>
                </div>
                {!actionEntry.is_return && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Base scheme</span>
                      <span>{actionEntry.base_scheme_discount_pct}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Card discount</span>
                      <span>{actionEntry.card_discount_pct}%</span>
                    </div>
                  </>
                )}
                {actionEntry.redemption_amount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Redemption</span>
                    <span>− {fmtInr(actionEntry.redemption_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t pt-1.5">
                  <span>Net</span>
                  <span
                    className={actionEntry.net_bill_amount < 0 ? "text-red-600" : ""}
                  >
                    {actionEntry.net_bill_amount < 0 ? "−" : ""}
                    {fmtInr(actionEntry.net_bill_amount)}
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap pt-0.5">
                  {actionEntry.is_return && (
                    <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 text-xs">
                      RETURN
                    </Badge>
                  )}
                  {actionEntry.is_card_sale && (
                    <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200 text-xs">
                      Card Sale
                    </Badge>
                  )}
                </div>
              </div>

              {/* Final net value confirmation (approve, non-return only) */}
              {actionType === "approve" && !actionEntry.is_return && (
                <div className="space-y-1">
                  <Label>Final Net Bill Amount (₹) *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={actionNetAmount}
                    onChange={e => setActionNetAmount(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Confirm the final net value from the actual bill — points are calculated on this amount.
                  </p>
                </div>
              )}

              {/* Notes / reason */}
              <div className="space-y-1">
                <Label>
                  {actionType === "reject" ? "Rejection Reason *" : "Notes (optional)"}
                </Label>
                <Textarea
                  placeholder={
                    actionType === "reject"
                      ? "Reason for rejection…"
                      : "Any notes for salesperson…"
                  }
                  value={actionNotes}
                  onChange={e => setActionNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setActionEntry(null)}>
                  Cancel
                </Button>
                <Button
                  variant={actionType === "reject" ? "destructive" : "default"}
                  className={
                    actionType === "approve" ? "bg-green-600 hover:bg-green-700" : ""
                  }
                  onClick={submitAction}
                  disabled={actionSaving}
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
