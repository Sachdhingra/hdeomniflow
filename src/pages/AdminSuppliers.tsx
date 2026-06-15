import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Info } from "lucide-react";

interface Supplier {
  id: string;
  name: string;
  gstin: string | null;
  tally_ledger_name: string | null;
  address: string | null;
  is_active: boolean;
}

const blank = (): Omit<Supplier, "id"> => ({
  name: "", gstin: "", tally_ledger_name: "", address: "", is_active: true,
});

export default function AdminSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("suppliers" as any)
      .select("id,name,gstin,tally_ledger_name,address,is_active")
      .order("name");
    if (error) toast.error(error.message);
    setSuppliers((data as any) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setForm(blank());
    setOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({ name: s.name, gstin: s.gstin || "", tally_ledger_name: s.tally_ledger_name || "", address: s.address || "", is_active: s.is_active });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        gstin: form.gstin?.trim().toUpperCase() || null,
        tally_ledger_name: form.tally_ledger_name?.trim() || null,
        address: form.address?.trim() || null,
        is_active: form.is_active,
      };
      if (editing) {
        const { error } = await supabase.from("suppliers" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Supplier updated");
      } else {
        const { error } = await supabase.from("suppliers" as any).insert(payload);
        if (error) throw error;
        toast.success("Supplier added");
      }
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this supplier?")) return;
    const { error } = await supabase.from("suppliers" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  }

  const f = (k: keyof typeof form, v: string | boolean) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <p className="text-sm text-muted-foreground">Manage supplier GSTIN and Tally ledger names for auto-matching</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4" /> Add Supplier</Button>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-2 text-blue-800 text-xs">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">How supplier auto-matching works</p>
          <p>When a PDF invoice is uploaded, the AI extracts the supplier's GSTIN. Omniflow looks up the GSTIN here and uses the <strong>Tally Ledger Name</strong> in the XML export — ensuring it matches exactly what's in your Tally chart of accounts.</p>
          <p className="mt-1">Add each Godrej branch (Mumbai, Pune, etc.) as a separate supplier with its unique GSTIN and the exact ledger name as it appears in Tally.</p>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier Name</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead>Tally Ledger Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : suppliers.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No suppliers yet — add your first one</TableCell></TableRow>
            ) : suppliers.map(s => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="font-mono text-xs">{s.gstin || <span className="text-muted-foreground italic">not set</span>}</TableCell>
                <TableCell>
                  {s.tally_ledger_name
                    ? <span className="text-green-700 font-medium">{s.tally_ledger_name}</span>
                    : <span className="text-amber-600 italic text-xs">not set — will use supplier name</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Edit className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => del(s.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Supplier Name <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={e => f("name", e.target.value)} placeholder="GODREJ AND BOYCE MFG CO LTD" />
              <p className="text-xs text-muted-foreground">Your internal display name for this supplier</p>
            </div>
            <div className="space-y-1">
              <Label>GSTIN</Label>
              <Input value={form.gstin || ""} onChange={e => f("gstin", e.target.value)} placeholder="27AAACG1395D1ZU" className="font-mono" />
              <p className="text-xs text-muted-foreground">From the invoice header — used for auto-matching when PDF is uploaded</p>
            </div>
            <div className="space-y-1">
              <Label>Tally Ledger Name</Label>
              <Input value={form.tally_ledger_name || ""} onChange={e => f("tally_ledger_name", e.target.value)} placeholder="GODREJ AND BOYCE MANUFACTURING CO LTD-27AAACG1395D1ZU" />
              <p className="text-xs text-muted-foreground">Must exactly match the ledger name in your Tally chart of accounts</p>
            </div>
            <div className="space-y-1">
              <Label>Address</Label>
              <Input value={form.address || ""} onChange={e => f("address", e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
