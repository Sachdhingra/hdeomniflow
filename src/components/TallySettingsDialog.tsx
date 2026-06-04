import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Info } from "lucide-react";
import {
  DEFAULT_TALLY_SETTINGS, loadTallySettings, saveTallySettings,
  type TallySettings,
} from "@/lib/tallyExport";

interface Props {
  open: boolean;
  onClose: () => void;
}

function preview(pattern: string, rate: number) {
  return pattern
    .replace(/\{rate\}/g, String(rate))
    .replace(/\{half\}/g, String(rate / 2));
}

export default function TallySettingsDialog({ open, onClose }: Props) {
  const [s, setS] = useState<TallySettings>(DEFAULT_TALLY_SETTINGS);

  useEffect(() => {
    if (open) setS(loadTallySettings());
  }, [open]);

  function handleSave() {
    saveTallySettings(s);
    toast.success("Tally settings saved");
    onClose();
  }

  const f = (key: keyof TallySettings, val: string) => setS(prev => ({ ...prev, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tally Prime Ledger Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 flex gap-2 text-blue-800 text-xs">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Ledger names must <strong>exactly match</strong> what is set in your Tally company's
              Chart of Accounts. Use <code className="bg-blue-100 px-1 rounded">{"{rate}"}</code> for
              the GST % and <code className="bg-blue-100 px-1 rounded">{"{half}"}</code> for CGST/SGST
              half-rate in any pattern.
            </span>
          </div>

          <div className="space-y-1">
            <Label>Supply Type</Label>
            <Select value={s.supplyType} onValueChange={v => f("supplyType", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="intra">Intra-state (CGST + SGST)</SelectItem>
                <SelectItem value="inter">Inter-state (IGST only)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Purchase Ledger Name</Label>
            <Input
              value={s.purchaseLedger}
              onChange={e => f("purchaseLedger", e.target.value)}
              placeholder="Purchase @{rate}%"
            />
            <p className="text-xs text-muted-foreground">
              Preview (18%): <span className="font-medium">{preview(s.purchaseLedger, 18)}</span>
            </p>
          </div>

          {s.supplyType === "intra" ? (
            <>
              <div className="space-y-1">
                <Label>CGST Ledger Name</Label>
                <Input
                  value={s.cgstLedger}
                  onChange={e => f("cgstLedger", e.target.value)}
                  placeholder="Input CGST @{half}%"
                />
                <p className="text-xs text-muted-foreground">
                  Preview (18%): <span className="font-medium">{preview(s.cgstLedger, 18)}</span>
                </p>
              </div>
              <div className="space-y-1">
                <Label>SGST Ledger Name</Label>
                <Input
                  value={s.sgstLedger}
                  onChange={e => f("sgstLedger", e.target.value)}
                  placeholder="Input SGST @{half}%"
                />
                <p className="text-xs text-muted-foreground">
                  Preview (18%): <span className="font-medium">{preview(s.sgstLedger, 18)}</span>
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <Label>IGST Ledger Name</Label>
              <Input
                value={s.igstLedger}
                onChange={e => f("igstLedger", e.target.value)}
                placeholder="Input IGST @{rate}%"
              />
              <p className="text-xs text-muted-foreground">
                Preview (18%): <span className="font-medium">{preview(s.igstLedger, 18)}</span>
              </p>
            </div>
          )}

          <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
            <p className="font-semibold">Common Tally setups</p>
            <p className="text-muted-foreground">Rate-specific (most GST-compliant setups):</p>
            <p className="font-mono">Purchase @18%, Input CGST @9%, Input SGST @9%</p>
            <p className="text-muted-foreground mt-1">Single ledger (simpler chart of accounts):</p>
            <p className="font-mono">Purchases, CGST, SGST</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save Settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
