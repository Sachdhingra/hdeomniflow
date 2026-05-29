import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Star, Plus, Upload, Pencil, Link2, Search, Loader2, Download, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import PhoneInput from "@/components/PhoneInput";
import { extractTenDigits, isValidIndianMobile, toCanonicalPhone, formatPhoneDisplay } from "@/lib/phone";

interface EliteRow {
  id: string;
  customer_name: string;
  phone_1: string;
  phone_2: string | null;
  card_issue_date: string;
  card_expiry_date: string;
  status: string;
  lead_id: string | null;
  notes: string | null;
  created_at: string;
}

interface LeadLite { id: string; customer_name: string; customer_phone: string; elite_card_id: string | null; }

type FilterTab = "all" | "active" | "expiring" | "expired" | "opted_out";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addYearsISO(iso: string, y: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + y);
  return d.toISOString().slice(0, 10);
}

function daysBetween(targetISO: string): number {
  const ms = new Date(targetISO).getTime() - new Date(todayISO()).getTime();
  return Math.floor(ms / 86400000);
}

type ComputedStatus = "active" | "expiring" | "expired" | "opted_out";
function computeStatus(row: EliteRow): ComputedStatus {
  if (row.status === "opted_out") return "opted_out";
  const left = daysBetween(row.card_expiry_date);
  if (left < 0) return "expired";
  if (left <= 60) return "expiring";
  return "active";
}

const STATUS_META: Record<ComputedStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-success/15 text-success border-success/30" },
  expiring: { label: "Expiring Soon", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  expired: { label: "Expired", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  opted_out: { label: "Opted Out", cls: "bg-muted text-muted-foreground border-border" },
};

const EliteCustomers = () => {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "sales" || user?.role === "accounts";

  const [rows, setRows] = useState<EliteRow[]>([]);
  const [leads, setLeads] = useState<Record<string, LeadLite>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");

  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<EliteRow | null>(null);
  const [linkRow, setLinkRow] = useState<EliteRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("elite_customers" as any)
      .select("*")
      .order("card_expiry_date", { ascending: true });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const list = (data || []) as EliteRow[];
    setRows(list);
    const leadIds = list.map(r => r.lead_id).filter(Boolean) as string[];
    if (leadIds.length > 0) {
      const { data: lds } = await supabase
        .from("leads")
        .select("id, customer_name, customer_phone, elite_card_id")
        .in("id", leadIds);
      const map: Record<string, LeadLite> = {};
      (lds || []).forEach((l: any) => { map[l.id] = l; });
      setLeads(map);
    } else {
      setLeads({});
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const onFocus = () => fetchData();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchData]);

  const stats = useMemo(() => {
    let active = 0, expiring = 0, expired = 0;
    rows.forEach(r => {
      const s = computeStatus(r);
      if (s === "active") active++;
      else if (s === "expiring") { expiring++; active++; }
      else if (s === "expired") expired++;
    });
    return { total: rows.length, active, expiring, expired };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      const s = computeStatus(r);
      if (tab === "active" && !(s === "active" || s === "expiring")) return false;
      if (tab === "expiring" && s !== "expiring") return false;
      if (tab === "expired" && s !== "expired") return false;
      if (tab === "opted_out" && s !== "opted_out") return false;
      if (!q) return true;
      return (
        r.customer_name.toLowerCase().includes(q) ||
        (r.phone_1 || "").toLowerCase().includes(q) ||
        (r.phone_2 || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, tab]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Star className="w-6 h-6 text-amber-500 fill-amber-500" /> Elite Customers
          </h1>
          <p className="text-sm text-muted-foreground">Loyalty members and card management</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4" /> Import CSV
            </Button>
            <Button className="gap-2 gradient-primary" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" /> Add Member
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Members" value={stats.total} color="text-foreground" />
        <StatCard label="Active" value={stats.active} color="text-success" />
        <StatCard label="Expiring Soon" value={stats.expiring} color="text-amber-600 dark:text-amber-400" />
        <StatCard label="Expired" value={stats.expired} color="text-destructive" />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search by name or phone…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {([
          ["all", "All"], ["active", "Active"], ["expiring", "Expiring Soon"], ["expired", "Expired"], ["opted_out", "Opted Out"],
        ] as [FilterTab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${tab === k ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:bg-muted"}`}
          >{label}</button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">No elite customers found</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Customer Name</TableHead>
                    <TableHead>Phone 1</TableHead>
                    <TableHead>Phone 2</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead>Expiry Date</TableHead>
                    <TableHead>Days Left</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Linked Lead</TableHead>
                    {canEdit && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r, i) => {
                    const status = computeStatus(r);
                    const meta = STATUS_META[status];
                    const left = daysBetween(r.card_expiry_date);
                    const dayCls = left < 0 ? "text-destructive font-semibold" : left <= 60 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-success";
                    const lead = r.lead_id ? leads[r.lead_id] : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{r.customer_name}</TableCell>
                        <TableCell className="font-mono text-xs">{formatPhoneDisplay(r.phone_1)}</TableCell>
                        <TableCell className="font-mono text-xs">{r.phone_2 ? formatPhoneDisplay(r.phone_2) : "—"}</TableCell>
                        <TableCell>{r.card_issue_date}</TableCell>
                        <TableCell>{r.card_expiry_date}</TableCell>
                        <TableCell className={dayCls}>{left}</TableCell>
                        <TableCell><Badge variant="outline" className={meta.cls}>{meta.label}</Badge></TableCell>
                        <TableCell>{lead ? <span className="text-primary">{lead.customer_name}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                        {canEdit && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setEditRow(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => setLinkRow(r)}><Link2 className="w-3.5 h-3.5" /></Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <MemberFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="add"
        userId={user?.id || null}
        onSaved={() => { setAddOpen(false); fetchData(); }}
      />
      <MemberFormDialog
        open={!!editRow}
        onOpenChange={(v) => !v && setEditRow(null)}
        mode="edit"
        userId={user?.id || null}
        row={editRow}
        onSaved={() => { setEditRow(null); fetchData(); }}
      />
      <LinkLeadDialog
        open={!!linkRow}
        onOpenChange={(v) => !v && setLinkRow(null)}
        row={linkRow}
        onSaved={() => { setLinkRow(null); fetchData(); }}
      />
      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        userId={user?.id || null}
        onDone={() => { setImportOpen(false); fetchData(); }}
      />
    </div>
  );
};

const StatCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <Card>
    <CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </CardContent>
  </Card>
);

/* ---------------- Add / Edit Modal ---------------- */
const MemberFormDialog = ({
  open, onOpenChange, mode, row, userId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "add" | "edit";
  row?: EliteRow | null;
  userId: string | null;
  onSaved: () => void;
}) => {
  const [name, setName] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [issue, setIssue] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"active" | "opted_out">("active");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && row) {
      setName(row.customer_name);
      setP1(extractTenDigits(row.phone_1));
      setP2(extractTenDigits(row.phone_2 || ""));
      setIssue(row.card_issue_date);
      setNotes(row.notes || "");
      setStatus((row.status === "opted_out" ? "opted_out" : "active"));
    } else {
      setName(""); setP1(""); setP2(""); setIssue(todayISO()); setNotes(""); setStatus("active");
    }
  }, [open, mode, row]);

  const expiry = addYearsISO(issue, 3);

  const save = async () => {
    if (!name.trim()) { toast.error("Customer Name required"); return; }
    if (!isValidIndianMobile(p1)) { toast.error("Enter a valid 10-digit mobile number"); return; }
    if (p2 && !isValidIndianMobile(p2)) { toast.error("Phone 2 must be a valid 10-digit mobile"); return; }
    setSaving(true);
    try {
      if (mode === "add") {
        const { error } = await (supabase.from("elite_customers" as any).insert({
          customer_name: name.trim(),
          phone_1: toCanonicalPhone(p1),
          phone_2: p2 ? toCanonicalPhone(p2) : null,
          card_issue_date: issue,
          notes: notes.trim() || null,
          created_by: userId,
        }) as any);
        if (error) throw error;
        toast.success(`⭐ ${name.trim()} added as Elite Member`);
      } else if (row) {
        const { error } = await (supabase.from("elite_customers" as any).update({
          customer_name: name.trim(),
          phone_1: toCanonicalPhone(p1),
          phone_2: p2 ? toCanonicalPhone(p2) : null,
          card_issue_date: issue,
          notes: notes.trim() || null,
          status,
        }).eq("id", row.id) as any);
        if (error) throw error;
        toast.success("Elite member updated");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add Elite Member" : "Edit Elite Member"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Customer Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="space-y-1.5">
            <Label>Phone 1 *</Label>
            <PhoneInput value={p1} onChange={setP1} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone 2 (optional)</Label>
            <PhoneInput value={p2} onChange={setP2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Card Issue Date</Label>
              <Input type="date" value={issue} onChange={e => setIssue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Card Expiry Date</Label>
              <Input value={expiry} readOnly className="italic text-muted-foreground" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">Elite card is valid for 3 years from issue date</p>
          {mode === "edit" && (
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as "active" | "opted_out")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="opted_out">Opted Out</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <Button className="w-full gradient-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : mode === "add" ? "Add Member" : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------- Link Lead Dialog ---------------- */
const LinkLeadDialog = ({
  open, onOpenChange, row, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: EliteRow | null;
  onSaved: () => void;
}) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LeadLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!open) { setQ(""); setResults([]); return; }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, customer_name, customer_phone, elite_card_id")
        .or(`customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%`)
        .is("deleted_at", null)
        .limit(15);
      setResults((data || []) as LeadLite[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const link = async (lead: LeadLite) => {
    if (!row) return;
    setLinking(true);
    try {
      const { error: e1 } = await (supabase.from("elite_customers" as any)
        .update({ lead_id: lead.id })
        .eq("id", row.id) as any);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("leads")
        .update({ elite_card_id: row.id, elite_opted_in: true, elite_opted_date: row.card_issue_date } as any)
        .eq("id", lead.id);
      if (e2) throw e2;
      toast.success(`Linked to ${lead.customer_name}`);
      onSaved();
    } catch (e: any) { toast.error(e.message || "Failed to link"); }
    finally { setLinking(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Link to Lead</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input autoFocus placeholder="Search by name or phone…" value={q} onChange={e => setQ(e.target.value)} />
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {searching && <div className="p-3 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</div>}
            {!searching && results.length === 0 && <div className="p-3 text-sm text-muted-foreground">Type at least 2 characters</div>}
            {results.map(l => (
              <button
                key={l.id}
                disabled={linking}
                onClick={() => link(l)}
                className="w-full text-left p-3 hover:bg-muted/50 border-b border-border last:border-0 disabled:opacity-50"
              >
                <p className="font-medium text-sm">{l.customer_name}</p>
                <p className="text-xs text-muted-foreground font-mono">{formatPhoneDisplay(l.customer_phone)}</p>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------- CSV Import ---------------- */
interface ParsedRow {
  customer_name: string;
  phone_1: string;
  phone_2: string;
  card_issue_date: string;
  errors: string[];
}

const ImportCsvDialog = ({
  open, onOpenChange, userId, onDone,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; userId: string | null; onDone: () => void;
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => { if (!open) setParsed([]); }, [open]);

  const downloadTemplate = () => {
    const csv = "customer_name,phone_1,phone_2,card_issue_date\nRavi Kumar,9876543210,9123456789,2023-05-15\n";
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "elite_members_template.csv";
    a.click();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result || "");
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast.error("CSV needs header + rows"); return; }
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
      const idx = (n: string) => headers.indexOf(n);
      const iName = idx("customer_name"); const iP1 = idx("phone_1");
      const iP2 = idx("phone_2"); const iDate = idx("card_issue_date");
      if (iName < 0 || iP1 < 0) { toast.error("Missing required columns: customer_name, phone_1"); return; }

      const out: ParsedRow[] = lines.slice(1).map(line => {
        const cells = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        const errs: string[] = [];
        const name = cells[iName] || "";
        const p1 = cells[iP1] || "";
        const p2 = iP2 >= 0 ? (cells[iP2] || "") : "";
        const date = iDate >= 0 ? (cells[iDate] || "") : todayISO();
        if (!name) errs.push("Name required");
        if (!isValidIndianMobile(p1)) errs.push("Phone 1 invalid");
        if (p2 && !isValidIndianMobile(p2)) errs.push("Phone 2 invalid");
        if (!date || isNaN(new Date(date).getTime())) errs.push("Date missing");
        return { customer_name: name, phone_1: p1, phone_2: p2, card_issue_date: date, errors: errs };
      });
      setParsed(out);
    };
    reader.readAsText(f);
  };

  const valid = parsed.filter(p => p.errors.length === 0);

  const confirm = async () => {
    if (valid.length === 0) return;
    setImporting(true);
    let added = 0, skipped = parsed.length - valid.length;
    for (const r of valid) {
      const { error } = await (supabase.from("elite_customers" as any).insert({
        customer_name: r.customer_name,
        phone_1: toCanonicalPhone(r.phone_1),
        phone_2: r.phone_2 ? toCanonicalPhone(r.phone_2) : null,
        card_issue_date: r.card_issue_date,
        created_by: userId,
      }) as any);
      if (error) skipped++; else added++;
    }
    setImporting(false);
    toast.success(`Import complete: ${added} members added, ${skipped} rows skipped`);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import Elite Members from CSV</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <button onClick={downloadTemplate} className="text-sm text-primary inline-flex items-center gap-1.5 hover:underline">
            <Download className="w-4 h-4" /> Download Sample CSV
          </button>
          <div>
            <input ref={fileRef} type="file" accept=".csv" onChange={onFile} className="hidden" />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>Choose CSV File</Button>
          </div>
          {parsed.length > 0 && (
            <>
              <div className="rounded-md border border-border max-h-80 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Phone 1</TableHead>
                      <TableHead>Phone 2</TableHead>
                      <TableHead>Issue Date</TableHead>
                      <TableHead>Valid?</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{r.customer_name}</TableCell>
                        <TableCell className="text-xs font-mono">{r.phone_1}</TableCell>
                        <TableCell className="text-xs font-mono">{r.phone_2 || "—"}</TableCell>
                        <TableCell className="text-xs">{r.card_issue_date}</TableCell>
                        <TableCell className="text-xs">
                          {r.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="w-3.5 h-3.5" /> OK</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="w-3.5 h-3.5" /> {r.errors.join(", ")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button onClick={confirm} disabled={valid.length === 0 || importing} className="w-full gradient-primary">
                {importing ? "Importing…" : `Confirm Import (${valid.length} valid rows)`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EliteCustomers;
