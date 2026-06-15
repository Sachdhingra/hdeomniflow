import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const RATE_LABELS: Record<string, string> = {
  local_freight_per_km: "Local Freight (₹/km, round trip)",
  outstation_freight_per_km: "Outstation Freight (₹/km, round trip)",
  handling_per_km: "Furniture Handling (₹/km, round trip)",
  floor_labour_rate: "Floor Labour Rate (₹)",
  modular_labour_rate: "Modular Labour Rate (₹)",
  minimum_charge: "Minimum Charge (₹)",
  gst_rate: "GST Rate (%)",
};

export default function LogisticsCalculatorSettings() {
  const { user } = useAuth();
  const [rates, setRates] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [newLoc, setNewLoc] = useState({ name: "", charge: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const [r, l] = await Promise.all([
      supabase.from("logistics_rates" as any).select("*").order("rate_key"),
      supabase.from("kitchen_visit_locations" as any).select("*").order("location_name"),
    ]);
    setRates((r.data as any) || []);
    setLocations((l.data as any) || []);
  }

  if (user && user.role !== "admin") return <Navigate to="/logistics-calculator" replace />;

  async function updateRate(id: string, value: number) {
    setSaving(true);
    const { error } = await supabase.from("logistics_rates" as any).update({ rate_value: value, updated_by: user!.id }).eq("id", id);
    setSaving(false);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else toast({ title: "Rate updated" });
  }

  async function addLocation() {
    if (!newLoc.name || !newLoc.charge) return;
    const { error } = await supabase
      .from("kitchen_visit_locations" as any)
      .insert({ location_name: newLoc.name, charge: Number(newLoc.charge) });
    if (error) toast({ title: "Add failed", description: error.message, variant: "destructive" });
    else {
      setNewLoc({ name: "", charge: "" });
      toast({ title: "Location added" });
      refresh();
    }
  }

  async function updateLocation(id: string, patch: any) {
    const { error } = await supabase.from("kitchen_visit_locations" as any).update(patch).eq("id", id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else refresh();
  }

  async function deleteLocation(id: string) {
    if (!confirm("Delete this location?")) return;
    await supabase.from("kitchen_visit_locations" as any).delete().eq("id", id);
    refresh();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link to="/logistics-calculator">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Logistics rate masters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rates.map((r) => (
            <div key={r.id} className="flex items-center gap-3">
              <Label className="flex-1">{RATE_LABELS[r.rate_key] || r.rate_key}</Label>
              <Input
                type="number"
                className="w-32"
                defaultValue={r.rate_value}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== Number(r.rate_value)) updateRate(r.id, v);
                }}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Values save on blur. Changes apply to new calculations immediately.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kitchen measurement visit locations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-center gap-2">
              <Input
                className="flex-1"
                defaultValue={loc.location_name}
                onBlur={(e) => e.target.value !== loc.location_name && updateLocation(loc.id, { location_name: e.target.value })}
              />
              <Input
                type="number"
                className="w-28"
                defaultValue={loc.charge}
                onBlur={(e) => Number(e.target.value) !== Number(loc.charge) && updateLocation(loc.id, { charge: Number(e.target.value) })}
              />
              <Switch checked={loc.active} onCheckedChange={(v) => updateLocation(loc.id, { active: v })} />
              <Button variant="ghost" size="icon" onClick={() => deleteLocation(loc.id)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-3 border-t">
            <Input
              placeholder="New location name"
              value={newLoc.name}
              onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })}
              className="flex-1"
            />
            <Input
              type="number"
              placeholder="Charge"
              value={newLoc.charge}
              onChange={(e) => setNewLoc({ ...newLoc, charge: e.target.value })}
              className="w-28"
            />
            <Button onClick={addLocation}>
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
