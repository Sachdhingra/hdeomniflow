import { supabase } from "@/integrations/supabase/client";

export type CalculatorType =
  | "local_freight"
  | "outstation_freight"
  | "handling"
  | "floor_labour"
  | "modular_labour"
  | "kitchen_visit"
  | "safe_handling";

export const CALCULATOR_LABELS: Record<CalculatorType, string> = {
  local_freight: "Local Freight",
  outstation_freight: "Outstation Freight",
  handling: "Furniture Handling",
  floor_labour: "Floor Labour (Sofa/Almirah)",
  modular_labour: "Modular Furniture Labour",
  kitchen_visit: "Kitchen Measurement Visit",
  safe_handling: "Safe Handling Charges (>100 kg)",
};

export type Rates = {
  local_freight_per_km: number;
  outstation_freight_per_km: number;
  handling_per_km: number;
  floor_labour_rate: number;
  modular_labour_rate: number;
  minimum_charge: number;
  gst_rate: number;
};

export const DEFAULT_RATES: Rates = {
  local_freight_per_km: 32,
  outstation_freight_per_km: 25,
  handling_per_km: 15,
  floor_labour_rate: 400,
  modular_labour_rate: 75,
  minimum_charge: 400,
  gst_rate: 18,
};

export async function fetchRates(): Promise<Rates> {
  const { data, error } = await supabase.from("logistics_rates" as any).select("rate_key, rate_value");
  if (error || !data) return DEFAULT_RATES;
  const map = { ...DEFAULT_RATES };
  for (const row of data as any[]) {
    (map as any)[row.rate_key] = Number(row.rate_value);
  }
  return map;
}

export function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export type CalcResult = {
  subtotal: number;
  gstAmount: number;
  finalAmount: number;
  breakdown: Record<string, number | string>;
};

function applyGst(base: number, gstOn: boolean, gstRate: number): CalcResult {
  const gstAmount = gstOn ? Math.round((base * gstRate) / 100) : 0;
  return {
    subtotal: base,
    gstAmount,
    finalAmount: base + gstAmount,
    breakdown: {},
  };
}

export function calcLocalFreight(distance: number, gst: boolean, r: Rates): CalcResult {
  const roundTrip = distance * 2;
  const raw = roundTrip * r.local_freight_per_km;
  const base = Math.max(raw, r.minimum_charge);
  const res = applyGst(base, gst, r.gst_rate);
  res.breakdown = {
    "Distance (one side)": `${distance} km`,
    "Round trip": `${roundTrip} km`,
    Rate: `₹${r.local_freight_per_km}/km`,
    "Computed freight": raw,
    "Minimum charge": r.minimum_charge,
    "Freight applied": base,
  };
  return res;
}

export function calcOutstationFreight(distance: number, gst: boolean, r: Rates): CalcResult {
  const roundTrip = distance * 2;
  const base = roundTrip * r.outstation_freight_per_km;
  const res = applyGst(base, gst, r.gst_rate);
  res.breakdown = {
    "Distance (one side)": `${distance} km`,
    "Round trip": `${roundTrip} km`,
    Rate: `₹${r.outstation_freight_per_km}/km`,
    Freight: base,
  };
  return res;
}

export function calcHandling(distance: number, gst: boolean, r: Rates): CalcResult {
  const roundTrip = distance * 2;
  const base = roundTrip * r.handling_per_km;
  const res = applyGst(base, gst, r.gst_rate);
  res.breakdown = {
    "Distance (one side)": `${distance} km`,
    "Round trip": `${roundTrip} km`,
    Rate: `₹${r.handling_per_km}/km`,
    "Handling charge": base,
  };
  return res;
}

export function calcFloorLabour(productType: string, qty: number, floor: number, gst: boolean, r: Rates): CalcResult {
  const raw = qty * floor * r.floor_labour_rate;
  const base = Math.max(raw, r.minimum_charge);
  const res = applyGst(base, gst, r.gst_rate);
  res.breakdown = {
    "Product type": productType,
    Quantity: qty,
    Floor: floor,
    Rate: `₹${r.floor_labour_rate}`,
    "Computed labour": raw,
    "Minimum charge": r.minimum_charge,
    "Labour applied": base,
  };
  return res;
}

export function calcModularLabour(cartons: number, floor: number, gst: boolean, r: Rates): CalcResult {
  const raw = cartons * floor * r.modular_labour_rate;
  const base = Math.max(raw, r.minimum_charge);
  const res = applyGst(base, gst, r.gst_rate);
  res.breakdown = {
    Cartons: cartons,
    Floor: floor,
    Rate: `₹${r.modular_labour_rate}`,
    "Computed labour": raw,
    "Minimum charge": r.minimum_charge,
    "Labour applied": base,
  };
  return res;
}

export function calcKitchenVisit(location: string, charge: number, gst: boolean, r: Rates): CalcResult {
  const res = applyGst(charge, gst, r.gst_rate);
  res.breakdown = { Location: location, "Visit charge": charge };
  return res;
}

export const SAFE_HANDLING_BASE = 2500;
export const SAFE_HANDLING_PER_FLOOR = 1000;

export function calcSafeHandling(floor: number, gst: boolean, r: Rates): CalcResult {
  const floorSurcharge = floor * SAFE_HANDLING_PER_FLOOR;
  const base = SAFE_HANDLING_BASE + floorSurcharge;
  const res = applyGst(base, gst, r.gst_rate);
  res.breakdown = {
    "Floor": floor === 0 ? "Ground (0)" : String(floor),
    "Base charge": SAFE_HANDLING_BASE,
    "Floor surcharge": floorSurcharge,
    "Handling charge": base,
  };
  return res;
}

export function formatBreakdownText(
  type: CalculatorType,
  inputs: any,
  result: CalcResult,
  gstOn: boolean,
  r: Rates,
  customer?: { name?: string; phone?: string }
) {
  const lines: string[] = [];
  lines.push(`${CALCULATOR_LABELS[type]}`);
  if (customer?.name) lines.push(`Customer: ${customer.name}${customer.phone ? ` (${customer.phone})` : ""}`);
  lines.push("");
  for (const [k, v] of Object.entries(result.breakdown)) {
    lines.push(`${k}: ${typeof v === "number" ? inr(v) : v}`);
  }
  lines.push("");
  lines.push(`Subtotal: ${inr(result.subtotal)}`);
  lines.push(`GST (${gstOn ? r.gst_rate + "%" : "excluded"}): ${inr(result.gstAmount)}`);
  lines.push(`Final amount: ${inr(result.finalAmount)}`);
  return lines.join("\n");
}
