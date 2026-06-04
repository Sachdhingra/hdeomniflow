import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Download, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { parseTallyStockCsv, buildOmniStockTemplate, type TallyStockRow } from "@/lib/tallyImport";
import { downloadCsv } from "@/lib/tallyExport";

interface InvProduct {
  id: string;
  name: string;
  item_code: string | null;
}

interface MatchedRow {
  parsed: TallyStockRow;
  product: InvProduct | null;   // null = no match found (will create)
  skip: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

export default function TallyStockImport({ open, onClose, onDone }: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "preview" | "applying">("upload");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [matched, setMatched] = useState<MatchedRow[]>([]);
  const [applyLog, setApplyLog] = useState<string[]>([]);

  function reset() {
    setStep("upload");
    setParseErrors([]);
    setMatched([]);
    setApplyLog([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() { reset(); onClose(); }

  // ── Step 1: parse file + match against existing products ──────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const { rows, errors } = parseTallyStockCsv(text);
    setParseErrors(errors);

    if (!rows.length) return;

    // Load all inventory products for matching
    const { data: products } = await supabase
      .from("inventory_products" as any)
      .select("id, name, item_code");

    const prodList: InvProduct[] = (products as any) || [];

    const matchRows: MatchedRow[] = rows.map(row => {
      // 1. Match by item_code if provided
      let product: InvProduct | null = null;
      if (row.itemCode) {
        product = prodList.find(
          p => p.item_code?.toLowerCase() === row.itemCode.toLowerCase()
        ) ?? null;
      }
      // 2. Fallback: normalised name match
      if (!product) {
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
        product = prodList.find(p => norm(p.name) === norm(row.itemName)) ?? null;
      }
      return { parsed: row, product, skip: false };
    });

    setMatched(matchRows);
    setStep("preview");
  }

  function toggleSkip(i: number) {
    setMatched(prev => prev.map((m, idx) => idx === i ? { ...m, skip: !m.skip } : m));
  }

  // ── Step 2: apply changes ─────────────────────────────────────────────────
  async function applyChanges() {
    setStep("applying");
    const log: string[] = [];
    const now = new Date().toISOString();

    for (const row of matched) {
      if (row.skip) { log.push(`⤼ Skipped: ${row.parsed.itemName}`); continue; }

      let productId: string;

      if (row.product) {
        productId = row.product.id;

        // Update item_code if we now have one and it wasn't set before
        if (row.parsed.itemCode && !row.product.item_code) {
          await supabase
            .from("inventory_products" as any)
            .update({ item_code: row.parsed.itemCode, tally_last_synced: now })
            .eq("id", productId);
        } else {
          await supabase
            .from("inventory_products" as any)
            .update({ tally_last_synced: now })
            .eq("id", productId);
        }
      } else {
        // Create new product
        const { data: newProd, error: cErr } = await supabase
          .from("inventory_products" as any)
          .insert({
            name: row.parsed.itemName,
            item_code: row.parsed.itemCode || null,
            category: "other",
            reorder_threshold: 5,
            tally_last_synced: now,
            created_by: user?.id,
          })
          .select("id")
          .single();

        if (cErr || !newProd) {
          log.push(`✗ Failed to create product: ${row.parsed.itemName} — ${cErr?.message}`);
          continue;
        }
        productId = (newProd as any).id;

        // Seed pending_display row so upsert below works
        await supabase
          .from("pending_display" as any)
          .insert({ product_id: productId, quantity_pending: 0 });
      }

      // Upsert display_inventory with closing qty from Tally
      const { error: dErr } = await supabase
        .from("display_inventory" as any)
        .upsert(
          { product_id: productId, quantity_on_display: row.parsed.closingQty, last_updated: now },
          { onConflict: "product_id" }
        );

      if (dErr) {
        log.push(`✗ Failed to update stock for ${row.parsed.itemName}: ${dErr.message}`);
        continue;
      }

      // Audit log
      await supabase.from("inventory_audit_log" as any).insert({
        product_id: productId,
        action: "tally_import",
        quantity_change: row.parsed.closingQty,
        created_by: user?.id,
        notes: `Tally import — closing qty ${row.parsed.closingQty} ${row.parsed.unit}`,
      });

      log.push(`✓ ${row.product ? "Updated" : "Created"}: ${row.parsed.itemName} → qty ${row.parsed.closingQty}`);
    }

    setApplyLog(log);
    toast.success("Tally stock import complete");
    onDone();
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  const matched_count = matched.filter(m => m.product && !m.skip).length;
  const new_count     = matched.filter(m => !m.product && !m.skip).length;
  const skip_count    = matched.filter(m => m.skip).length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Stock from Tally Prime</DialogTitle>
        </DialogHeader>

        {/* ── UPLOAD STEP ─────────────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-dashed p-6 text-center space-y-3">
              <Upload className="mx-auto w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Upload a CSV exported from Tally Prime — Stock Summary or OMNI format
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={handleFile}
              />
              <Button onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4 mr-1" /> Choose CSV File
              </Button>
            </div>

            <div className="rounded-md bg-muted/50 p-4 space-y-2 text-sm">
              <p className="font-semibold">Accepted formats</p>
              <div className="space-y-1 text-muted-foreground">
                <p><span className="font-medium text-foreground">Format A — OMNI Stock Import</span> (recommended)</p>
                <code className="block text-xs bg-background rounded p-2 font-mono">
                  Item Name, Item Code, Closing Qty, Unit{"\n"}
                  GODREJ SAFE S-350E, GS-350E, 5, NOS
                </code>
                <p className="pt-1"><span className="font-medium text-foreground">Format B — Tally Stock Summary export</span></p>
                <code className="block text-xs bg-background rounded p-2 font-mono">
                  Particulars, Opening Qty, Inward Qty, Outward Qty, Closing Qty, Unit{"\n"}
                  GODREJ SAFE S-350E, 2, 5, 0, 7, NOS
                </code>
              </div>
            </div>

            {parseErrors.length > 0 && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 space-y-1">
                {parseErrors.map((e, i) => (
                  <p key={i} className="text-xs text-destructive flex gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{e}
                  </p>
                ))}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv("omni_stock_import_template.csv", buildOmniStockTemplate())}
            >
              <Download className="w-4 h-4 mr-1" /> Download CSV Template
            </Button>
          </div>
        )}

        {/* ── PREVIEW STEP ────────────────────────────────────────────────── */}
        {step === "preview" && (
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex gap-3 text-sm flex-wrap">
              <Badge variant="secondary">{matched_count} will update</Badge>
              <Badge variant="outline">{new_count} will be created</Badge>
              {skip_count > 0 && <Badge variant="destructive">{skip_count} skipped</Badge>}
            </div>

            {parseErrors.length > 0 && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2">
                {parseErrors.map((e, i) => (
                  <p key={i} className="text-xs text-destructive">{e}</p>
                ))}
              </div>
            )}

            <div className="overflow-auto flex-1 border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Item Name</th>
                    <th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-right">Closing Qty</th>
                    <th className="px-3 py-2 text-left">Unit</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-center">Skip?</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.map((m, i) => (
                    <tr key={i} className={m.skip ? "opacity-40" : ""}>
                      <td className="px-3 py-1.5">{m.parsed.itemName}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{m.parsed.itemCode || "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{m.parsed.closingQty}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{m.parsed.unit || "—"}</td>
                      <td className="px-3 py-1.5">
                        {m.product ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="w-3 h-3" /> Matched
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600">
                            <AlertTriangle className="w-3 h-3" /> New product
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={m.skip}
                          onChange={() => toggleSkip(i)}
                          className="cursor-pointer"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              "New product" items will be created in Inventory with category "other" — edit after import as needed.
              Tick "Skip" to exclude a row.
            </p>
          </div>
        )}

        {/* ── APPLYING STEP ────────────────────────────────────────────────── */}
        {step === "applying" && (
          <div className="space-y-2 py-2">
            {applyLog.length === 0 ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Applying changes…
              </div>
            ) : (
              <div className="overflow-auto max-h-64 rounded border bg-muted/30 p-3 space-y-0.5">
                {applyLog.map((l, i) => (
                  <p key={i} className={`text-xs font-mono ${l.startsWith("✗") ? "text-destructive" : l.startsWith("⤼") ? "text-muted-foreground" : "text-green-700"}`}>{l}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── FOOTER ──────────────────────────────────────────────────────── */}
        <DialogFooter>
          {step === "upload" && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button
                onClick={applyChanges}
                disabled={matched.filter(m => !m.skip).length === 0}
              >
                Apply {matched.filter(m => !m.skip).length} Changes
              </Button>
            </>
          )}
          {step === "applying" && applyLog.length > 0 && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
