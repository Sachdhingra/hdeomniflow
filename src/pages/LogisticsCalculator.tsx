import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Copy, Printer, Save, Paperclip, History, Settings, Calculator } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  CALCULATOR_LABELS,
  CalcResult,
  CalculatorType,
  DEFAULT_RATES,
  Rates,
  calcFloorLabour,
  calcHandling,
  calcKitchenVisit,
  calcLocalFreight,
  calcModularLabour,
  calcOutstationFreight,
  calcSafeHandling,
  fetchRates,
  formatBreakdownText,
  inr,
} from "@/lib/logistics";

type KitchenLocation = { id: string; location_name: string; charge: number; active: boolean };

function ResultCard({
  result,
  gstOn,
  rates,
  onSave,
  onAttach,
  saving,
  textSnapshot,
  canAttach,
}: {
  result: CalcResult;
  gstOn: boolean;
  rates: Rates;
  onSave: () => void;
  onAttach: () => void;
  saving: boolean;
  textSnapshot: string;
  canAttach: boolean;
}) {
  return (
    <Card className="border-primary/30 print:shadow-none">
      <CardContent className="p-6 space-y-4">
        <div>
          <div className="text-sm text-muted-foreground">Final amount {gstOn ? "(incl. GST)" : "(excl. GST)"}</div>
          <div className="text-4xl md:text-5xl font-bold text-primary tracking-tight">{inr(result.finalAmount)}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Subtotal {inr(result.subtotal)} · GST {inr(result.gstAmount)}
          </div>
        </div>
        <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
          {Object.entries(result.breakdown).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-medium">{typeof v === "number" ? inr(v) : v}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(String(result.finalAmount));
              toast({ title: "Amount copied" });
            }}
          >
            <Copy className="w-4 h-4 mr-1" /> Copy amount
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(textSnapshot);
              toast({ title: "Full calculation copied" });
            }}
          >
            <Copy className="w-4 h-4 mr-1" /> Copy full
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            <Save className="w-4 h-4 mr-1" /> Save to history
          </Button>
          {canAttach && (
            <Button variant="secondary" size="sm" onClick={onAttach} disabled={saving}>
              <Paperclip className="w-4 h-4 mr-1" /> Attach to quote
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AttachDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (leadId: string | null, name: string, phone: string) => void;
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  useEffect(() => {
    if (!open) return;
    let q = supabase
      .from("leads")
      .select("id, customer_name, customer_phone, assigned_to, created_by")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    if (search) q = q.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`);
    q.then(({ data }) => setLeads(data || []));
  }, [open, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Attach calculation to a lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Search lead by name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-56 overflow-auto rounded border">
            {leads.length === 0 && <div className="p-3 text-sm text-muted-foreground">No leads found.</div>}
            {leads.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setSelected(l);
                  setManualName(l.customer_name || "");
                  setManualPhone(l.customer_phone || "");
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${selected?.id === l.id ? "bg-muted" : ""}`}
              >
                <div className="font-medium">{l.customer_name}</div>
                <div className="text-xs text-muted-foreground">{l.customer_phone}</div>
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">Or use without a lead — just record the customer:</div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Customer name" value={manualName} onChange={(e) => setManualName(e.target.value)} />
            <Input placeholder="Phone" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(selected?.id || null, manualName, manualPhone)}
            disabled={!manualName && !selected}
          >
            Attach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LogisticsCalculator() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canAttach = user?.role === "admin" || user?.role === "sales" || user?.role === "service_head";
  const canSeeSafeHandling = user?.role !== "field_agent" && user?.role !== "site_agent";
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [locations, setLocations] = useState<KitchenLocation[]>([]);
  const [tab, setTab] = useState<CalculatorType>("local_freight");
  const [saving, setSaving] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);

  // shared
  const [gst, setGst] = useState(true);

  // local freight
  const [localKm, setLocalKm] = useState(0);
  // outstation
  const [outKm, setOutKm] = useState(0);
  // handling
  const [handlingKm, setHandlingKm] = useState(0);
  // floor labour
  const [floorProduct, setFloorProduct] = useState("Sofa");
  const [floorQty, setFloorQty] = useState(1);
  const [floorNum, setFloorNum] = useState(1);
  // modular
  const [cartons, setCartons] = useState(1);
  const [modFloor, setModFloor] = useState(1);
  // kitchen
  const [kitchenLocId, setKitchenLocId] = useState<string>("");
  // safe handling
  const [safeHandlingFloor, setSafeHandlingFloor] = useState(0);

  useEffect(() => {
    fetchRates().then(setRates);
    supabase
      .from("kitchen_visit_locations" as any)
      .select("*")
      .eq("active", true)
      .order("location_name")
      .then(({ data }) => setLocations((data as any) || []));
  }, []);

  const kitchenLoc = locations.find((l) => l.id === kitchenLocId);

  const result: CalcResult = useMemo(() => {
    switch (tab) {
      case "local_freight":
        return calcLocalFreight(localKm, gst, rates);
      case "outstation_freight":
        return calcOutstationFreight(outKm, gst, rates);
      case "handling":
        return calcHandling(handlingKm, gst, rates);
      case "floor_labour":
        return calcFloorLabour(floorProduct, floorQty, floorNum, gst, rates);
      case "modular_labour":
        return calcModularLabour(cartons, modFloor, gst, rates);
      case "kitchen_visit":
        return calcKitchenVisit(kitchenLoc?.location_name || "—", kitchenLoc?.charge || 0, gst, rates);
      case "safe_handling":
        return calcSafeHandling(safeHandlingFloor, gst, rates);
    }
  }, [tab, gst, rates, localKm, outKm, handlingKm, floorProduct, floorQty, floorNum, cartons, modFloor, kitchenLoc, safeHandlingFloor]);

  const inputs = useMemo<any>(() => {
    switch (tab) {
      case "local_freight":
        return { distance_km: localKm };
      case "outstation_freight":
        return { distance_km: outKm };
      case "handling":
        return { distance_km: handlingKm };
      case "floor_labour":
        return { product_type: floorProduct, quantity: floorQty, floor: floorNum };
      case "modular_labour":
        return { cartons, floor: modFloor };
      case "kitchen_visit":
        return { location_id: kitchenLocId, location: kitchenLoc?.location_name };
      case "safe_handling":
        return { floor: safeHandlingFloor };
    }
  }, [tab, localKm, outKm, handlingKm, floorProduct, floorQty, floorNum, cartons, modFloor, kitchenLocId, kitchenLoc, safeHandlingFloor]);

  const textSnapshot = formatBreakdownText(tab, inputs, result, gst, rates);

  async function saveCalculation(opts: {
    leadId?: string | null;
    customerName?: string;
    customerPhone?: string;
    attached: boolean;
  }) {
    if (!user) return null;
    setSaving(true);
    try {
      const payload = {
        calculator_type: tab,
        customer_name: opts.customerName || null,
        customer_phone: opts.customerPhone || null,
        lead_id: opts.leadId || null,
        inputs,
        breakdown: result.breakdown,
        subtotal: result.subtotal,
        gst_amount: result.gstAmount,
        final_amount: result.finalAmount,
        gst_included: gst,
        attached_to_lead: opts.attached,
        created_by: user.id,
      };
      const { data, error } = await supabase.from("logistics_calculations" as any).insert(payload).select().single();
      if (error) throw error;
      if (opts.attached && opts.leadId) {
        // append note line on the lead
        const { data: lead } = await supabase.from("leads").select("notes").eq("id", opts.leadId).maybeSingle();
        const stamp = new Date().toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
        const noteLine = `\n[${stamp}] ${CALCULATOR_LABELS[tab]} quote: ${inr(result.finalAmount)} ${gst ? "(incl. GST)" : "(excl. GST)"}`;
        await supabase
          .from("leads")
          .update({ notes: ((lead as any)?.notes || "") + noteLine })
          .eq("id", opts.leadId);
      }
      toast({ title: opts.attached ? "Attached to quote" : "Saved to history" });
      return data;
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
      return null;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calculator className="w-6 h-6 text-primary" /> Logistics & Service Calculator
          </h1>
          <p className="text-sm text-muted-foreground">Freight, handling, labour and kitchen visit charges with GST.</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button asChild variant="outline" size="sm">
            <Link to="/logistics-calculator/history">
              <History className="w-4 h-4 mr-1" /> History
            </Link>
          </Button>
          {isAdmin && (
            <Button asChild variant="outline" size="sm">
              <Link to="/logistics-calculator/settings">
                <Settings className="w-4 h-4 mr-1" /> Settings
              </Link>
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as CalculatorType)}>
        <TabsList className="flex flex-wrap h-auto print:hidden">
          {(Object.keys(CALCULATOR_LABELS) as CalculatorType[])
            .filter((k) => k !== "safe_handling" || canSeeSafeHandling)
            .map((k) => (
              <TabsTrigger key={k} value={k}>
                {CALCULATOR_LABELS[k]}
              </TabsTrigger>
            ))}
        </TabsList>

        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Inputs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TabsContent value="local_freight" className="space-y-3 mt-0">
                <div>
                  <Label>Distance one side (km)</Label>
                  <Input type="number" min={0} value={localKm} onChange={(e) => setLocalKm(Number(e.target.value) || 0)} />
                </div>
              </TabsContent>
              <TabsContent value="outstation_freight" className="space-y-3 mt-0">
                <div>
                  <Label>Distance one side (km)</Label>
                  <Input type="number" min={0} value={outKm} onChange={(e) => setOutKm(Number(e.target.value) || 0)} />
                </div>
              </TabsContent>
              <TabsContent value="handling" className="space-y-3 mt-0">
                <div>
                  <Label>Distance one side (km)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={handlingKm}
                    onChange={(e) => setHandlingKm(Number(e.target.value) || 0)}
                  />
                </div>
              </TabsContent>
              <TabsContent value="floor_labour" className="space-y-3 mt-0">
                <div>
                  <Label>Product type</Label>
                  <Select value={floorProduct} onValueChange={setFloorProduct}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Sofa">Sofa</SelectItem>
                      <SelectItem value="Almirah">Almirah</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      min={1}
                      value={floorQty}
                      onChange={(e) => setFloorQty(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                  <div>
                    <Label>Floor number</Label>
                    <Input
                      type="number"
                      min={0}
                      value={floorNum}
                      onChange={(e) => setFloorNum(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="modular_labour" className="space-y-3 mt-0">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Number of cartons</Label>
                    <Input
                      type="number"
                      min={1}
                      value={cartons}
                      onChange={(e) => setCartons(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                  <div>
                    <Label>Floor number</Label>
                    <Input
                      type="number"
                      min={0}
                      value={modFloor}
                      onChange={(e) => setModFloor(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="kitchen_visit" className="space-y-3 mt-0">
                <div>
                  <Label>Location</Label>
                  <Select value={kitchenLocId} onValueChange={setKitchenLocId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose location" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.location_name} — {inr(l.charge)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>
              <TabsContent value="safe_handling" className="space-y-3 mt-0">
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  Applicable only for heavy items exceeding 100 kg requiring special manpower and handling.
                </div>
                <div>
                  <Label>Floor number (0 = Ground floor)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={safeHandlingFloor}
                    onChange={(e) => setSafeHandlingFloor(Math.max(0, Number(e.target.value) || 0))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    ₹2,500 base + ₹1,000 per floor above ground
                  </p>
                </div>
              </TabsContent>

              <div className="flex items-center justify-between pt-2 border-t">
                <Label htmlFor="gst-toggle" className="cursor-pointer">
                  Include GST ({rates.gst_rate}%)
                </Label>
                <Switch id="gst-toggle" checked={gst} onCheckedChange={setGst} />
              </div>
            </CardContent>
          </Card>

          <ResultCard
            result={result}
            gstOn={gst}
            rates={rates}
            saving={saving}
            textSnapshot={textSnapshot}
            canAttach={canAttach}
            onSave={() => saveCalculation({ attached: false })}
            onAttach={() => setAttachOpen(true)}
          />
        </div>
      </Tabs>

      <AttachDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        onConfirm={async (leadId, name, phone) => {
          const r = await saveCalculation({ leadId, customerName: name, customerPhone: phone, attached: true });
          if (r) setAttachOpen(false);
        }}
      />
    </div>
  );
}
