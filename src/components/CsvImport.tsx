import { useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Upload, FileUp, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@/contexts/AuthContext";

const APP_FIELDS = [
  { key: "customer_name", label: "Customer Name", required: true },
  { key: "customer_phone", label: "Mobile Number", required: true },
  { key: "category", label: "Category", required: false },
  { key: "value_in_rupees", label: "Lead Value (₹)", required: false },
  { key: "notes", label: "Remarks", required: false },
];

interface CsvImportProps {
  salesProfiles: User[];
}

const CsvImport = ({ salesProfiles }: CsvImportProps) => {
  const { user } = useAuth();
  const { addLead } = useData();
  const [open, setOpen] = useState(false);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [assignTo, setAssignTo] = useState("");
  const [importing, setImporting] = useState(false);
  const [step, setStep] = useState<"upload" | "map" | "done">("upload");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) {
        toast.error("CSV must have a header row and at least one data row");
        return;
      }
      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
      setCsvHeaders(headers);
      setCsvData(rows);
      // Auto-map by fuzzy name match
      const autoMap: Record<string, string> = {};
      APP_FIELDS.forEach(f => {
        const match = headers.find(h =>
          h.toLowerCase().includes(f.key.replace("_", " ").toLowerCase()) ||
          h.toLowerCase().includes(f.label.toLowerCase()) ||
          (f.key === "customer_name" && h.toLowerCase().includes("name")) ||
          (f.key === "customer_phone" && (h.toLowerCase().includes("phone") || h.toLowerCase().includes("mobile"))) ||
          (f.key === "category" && h.toLowerCase().includes("product")) ||
          (f.key === "value_in_rupees" && h.toLowerCase().includes("value")) ||
          (f.key === "notes" && (h.toLowerCase().includes("note") || h.toLowerCase().includes("remark")))
        );
        if (match) autoMap[f.key] = match;
      });
      setMapping(autoMap);
      setStep("map");
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!mapping.customer_name || !mapping.customer_phone) {
      toast.error("Customer Name and Mobile Number mappings are required");
      return;
    }
    if (!assignTo) {
      toast.error("Please select a salesperson to assign leads to");
      return;
    }
    setImporting(true);
    let imported = 0;
    let skipped = 0;
    for (const row of csvData) {
      const nameIdx = csvHeaders.indexOf(mapping.customer_name);
      const phoneIdx = csvHeaders.indexOf(mapping.customer_phone);
      const catIdx = mapping.category ? csvHeaders.indexOf(mapping.category) : -1;
      const valIdx = mapping.value_in_rupees ? csvHeaders.indexOf(mapping.value_in_rupees) : -1;
      const notesIdx = mapping.notes ? csvHeaders.indexOf(mapping.notes) : -1;

      const name = row[nameIdx]?.trim();
      const phone = row[phoneIdx]?.trim();
      if (!name || !phone) { skipped++; continue; }

      let category = "others" as any;
      if (catIdx >= 0) {
        const rawCat = row[catIdx]?.trim().toLowerCase().replace(/\s+/g, "_");
        const match = LEAD_CATEGORIES.find(c => c.value === rawCat || c.label.toLowerCase() === row[catIdx]?.trim().toLowerCase());
        if (match) category = match.value;
      }

      const value = valIdx >= 0 ? Number(row[valIdx]?.replace(/[^0-9.]/g, "")) || 0 : 0;
      const notes = notesIdx >= 0 ? row[notesIdx]?.trim() : "";

      try {
        await addLead({
          customer_name: name,
          customer_phone: phone,
          category,
          value_in_rupees: value,
          notes,
          assigned_to: assignTo,
          created_by: user!.id,
          updated_by: user!.id,
          source: "csv_import",
        });
        imported++;
      } catch {
        skipped++;
      }
    }
    toast.success(`Imported ${imported} leads. ${skipped > 0 ? `Skipped ${skipped}.` : ""}`);
    setStep("done");
    setImporting(false);
  };

  const reset = () => {
    setCsvData([]);
    setCsvHeaders([]);
    setMapping({});
    setAssignTo("");
    setStep("upload");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2"><Upload className="w-4 h-4" />Import CSV</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import Leads from CSV</DialogTitle></DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <div className="border-2 border-dashed border-muted rounded-lg p-8 text-center">
              <FileUp className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-3">Upload a CSV file with customer data</p>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
              <Button onClick={() => fileRef.current?.click()} variant="outline">Choose File</Button>
            </div>
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Found {csvData.length} rows. Map columns below:</p>
            {APP_FIELDS.map(f => (
              <div key={f.key} className="flex items-center gap-3">
                <Label className="w-32 text-sm shrink-0">{f.label} {f.required && "*"}</Label>
                <Select value={mapping[f.key] || ""} onValueChange={v => setMapping(m => ({ ...m, [f.key]: v }))}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Select CSV column" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— Skip —</SelectItem>
                    {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Label className="w-32 text-sm shrink-0">Assign To *</Label>
              <Select value={assignTo} onValueChange={setAssignTo}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Select salesperson" /></SelectTrigger>
                <SelectContent>
                  {salesProfiles.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs font-medium mb-1">Preview (first row):</p>
              {csvData[0] && csvHeaders.map((h, i) => (
                <p key={h} className="text-xs text-muted-foreground">{h}: {csvData[0][i]}</p>
              ))}
            </div>
            <Button onClick={handleImport} disabled={importing} className="w-full gradient-primary">
              {importing ? "Importing..." : `Import ${csvData.length} Leads`}
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="text-center py-6 space-y-3">
            <CheckCircle className="w-12 h-12 text-success mx-auto" />
            <p className="font-medium">Import Complete!</p>
            <Button onClick={() => { reset(); setOpen(false); }} variant="outline">Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CsvImport;
