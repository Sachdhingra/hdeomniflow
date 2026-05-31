import { useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle, Upload, FileUp, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const CLAIM_CSV_FIELDS = [
  { key: "customer_name", label: "Customer Name", required: true },
  { key: "customer_phone", label: "Phone", required: true },
  { key: "claim_part_no", label: "Part No.", required: true },
  { key: "claim_reason", label: "Reason", required: false },
  { key: "claim_due_date", label: "Due Date (YYYY-MM-DD)", required: false },
  { key: "address", label: "Address", required: false },
];

const ServiceClaims = () => {
  const { user } = useAuth();
  const { serviceJobs } = useData();
  const isAdmin = user?.role === "admin";

  const [importOpen, setImportOpen] = useState(false);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const claims = serviceJobs.filter(j => j.claim_part_no);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast.error("CSV must have a header row and at least one data row"); return; }
      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
      setCsvHeaders(headers);
      setCsvRows(rows);
      const autoMap: Record<string, number> = {};
      CLAIM_CSV_FIELDS.forEach(f => {
        const idx = headers.findIndex(h =>
          h.toLowerCase().includes(f.key.replace(/_/g, " ")) ||
          h.toLowerCase().includes(f.label.toLowerCase().split(" ")[0])
        );
        if (idx >= 0) autoMap[f.key] = idx;
      });
      setMapping(autoMap);
      setStep("preview");
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (mapping.customer_name === undefined || mapping.customer_phone === undefined || mapping.claim_part_no === undefined) {
      toast.error("Customer Name, Phone and Part No. are required columns");
      return;
    }
    setImporting(true);
    let imported = 0, skipped = 0;
    for (const row of csvRows) {
      const name = row[mapping.customer_name]?.trim();
      const phone = row[mapping.customer_phone]?.trim().replace(/\D/g, "").slice(0, 10);
      const partNo = row[mapping.claim_part_no]?.trim();
      if (!name || !phone || !partNo) { skipped++; continue; }
      try {
        await supabase.from("service_jobs").insert({
          customer_name: name,
          customer_phone: phone,
          claim_part_no: partNo,
          claim_reason: mapping.claim_reason !== undefined ? row[mapping.claim_reason]?.trim() || null : null,
          claim_due_date: mapping.claim_due_date !== undefined ? row[mapping.claim_due_date]?.trim() || null : null,
          address: mapping.address !== undefined ? row[mapping.address]?.trim() || null : null,
          type: "service",
          status: "pending",
          is_foc: true,
          value: 0,
          category: "others",
        });
        imported++;
      } catch { skipped++; }
    }
    toast.success(`Imported ${imported} claims.${skipped > 0 ? ` Skipped ${skipped}.` : ""}`);
    setStep("done");
    setImporting(false);
  };

  const resetImport = () => {
    setCsvHeaders([]);
    setCsvRows([]);
    setMapping({});
    setStep("upload");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Claims</h1>
          <p className="text-sm text-muted-foreground">Parts claims & warranty tracking</p>
        </div>
        {isAdmin && (
          <Button variant="outline" className="gap-2" onClick={() => { resetImport(); setImportOpen(true); }}>
            <Upload className="w-4 h-4" />Import Claims CSV
          </Button>
        )}
      </div>

      {claims.length === 0 ? (
        <p className="text-muted-foreground">No claims raised yet.</p>
      ) : (
        <div className="space-y-3">
          {claims.map(job => {
            const isOverdue = job.claim_due_date && new Date(job.claim_due_date) < new Date();
            return (
              <Card key={job.id} className={`shadow-card ${isOverdue ? "border-destructive/30" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{job.customer_name}</h3>
                        {isOverdue && <Badge className="bg-destructive/10 text-destructive gap-1"><AlertCircle className="w-3 h-3" />Overdue</Badge>}
                      </div>
                      <p className="text-sm mt-1">Part No: <span className="font-mono font-semibold">{job.claim_part_no}</span></p>
                      <p className="text-sm text-muted-foreground">Reason: {job.claim_reason}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-muted-foreground">Due: {job.claim_due_date}</p>
                      <Badge className="mt-1">{job.status.replace("_", " ")}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* CSV Import Dialog (admin only) */}
      <Dialog open={importOpen} onOpenChange={o => { setImportOpen(o); if (!o) resetImport(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Import Claims from CSV</DialogTitle></DialogHeader>

          {step === "upload" && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-muted rounded-lg p-8 text-center">
                <FileUp className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-1">Upload a CSV file with claim data</p>
                <p className="text-xs text-muted-foreground mb-3">Required columns: Customer Name, Phone, Part No.</p>
                <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
                <Button onClick={() => fileRef.current?.click()} variant="outline">Choose File</Button>
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Found {csvRows.length} rows. Column mapping detected:</p>
              <div className="space-y-2">
                {CLAIM_CSV_FIELDS.map(f => (
                  <div key={f.key} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{f.label}{f.required ? " *" : ""}:</span>
                    <span className="font-medium">
                      {mapping[f.key] !== undefined ? csvHeaders[mapping[f.key]] : <span className="text-muted-foreground italic">not mapped</span>}
                    </span>
                  </div>
                ))}
              </div>
              {csvRows[0] && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs font-medium mb-1">Preview (first row):</p>
                  {csvHeaders.map((h, i) => (
                    <p key={h} className="text-xs text-muted-foreground">{h}: {csvRows[0][i]}</p>
                  ))}
                </div>
              )}
              <Button onClick={handleImport} disabled={importing} className="w-full gradient-primary">
                {importing ? "Importing…" : `Import ${csvRows.length} Claims`}
              </Button>
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-6 space-y-3">
              <CheckCircle className="w-12 h-12 text-success mx-auto" />
              <p className="font-medium">Import Complete!</p>
              <Button onClick={() => { resetImport(); setImportOpen(false); }} variant="outline">Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ServiceClaims;
