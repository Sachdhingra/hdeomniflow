import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { STAGE_META, extractVariables, type JourneyStage } from "@/lib/messageTemplates";

interface MessageTemplate {
  id: string;
  stage: JourneyStage;
  title: string;
  body: string;
  variables: string[];
  sort_order: number;
  is_active: boolean;
}

const blank = (): Partial<MessageTemplate> => ({
  stage: "exploration", title: "", body: "", variables: [], sort_order: 0, is_active: true,
});

const AdminMessageTemplates = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<MessageTemplate> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("message_templates")
      .select("*")
      .order("stage").order("sort_order");
    if (error) toast.error(error.message);
    setItems((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (user?.role !== "admin") {
    return <p className="text-sm text-muted-foreground p-4">Admin only.</p>;
  }

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.title?.trim() || !editing.body?.trim()) {
      toast.error("Title and body are required");
      return;
    }
    setSaving(true);
    try {
      const variables = extractVariables(editing.body || "");
      const payload: any = {
        stage: editing.stage,
        title: editing.title.trim(),
        body: editing.body,
        variables,
        sort_order: editing.sort_order ?? 0,
        is_active: editing.is_active ?? true,
      };
      if (editing.id) {
        const { error } = await supabase.from("message_templates").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Template updated");
      } else {
        payload.created_by = user?.id;
        const { error } = await supabase.from("message_templates").insert(payload);
        if (error) throw error;
        toast.success("Template created");
      }
      setEditing(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    const { error } = await supabase.from("message_templates").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  const grouped = STAGE_META.map(s => ({ meta: s, list: items.filter(i => i.stage === s.value) }));
  const detected = extractVariables(editing?.body || "");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">WhatsApp Templates</h1>
          <p className="text-sm text-muted-foreground">Psychology-driven messages by customer journey stage. Auto-fills lead variables.</p>
        </div>
        <Button onClick={() => setEditing(blank())} className="gap-2">
          <Plus className="w-4 h-4" />New Template
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-6">
          {grouped.map(g => (
            <div key={g.meta.value} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold">{g.meta.label}</h2>
                <span className="text-xs text-muted-foreground">{g.meta.days}</span>
                <Badge variant="secondary" className="ml-1">{g.list.length}</Badge>
              </div>
              {g.list.length === 0 && <p className="text-xs text-muted-foreground italic">No templates yet</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {g.list.map(t => (
                  <Card key={t.id} className={!t.is_active ? "opacity-60" : ""}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm">{t.title}</p>
                          {!t.is_active && <Badge variant="outline" className="text-[10px] mt-0.5">Disabled</Badge>}
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(t)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(t.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-4">{t.body}</p>
                      {t.variables.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {t.variables.map(v => (
                            <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{`{{${v}}}`}</span>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit Template" : "New Template"}</DialogTitle>
            <DialogDescription>Use {`{{variable}}`} placeholders. Variables are auto-detected from the body.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Stage</Label>
                  <Select value={editing.stage} onValueChange={(v) => setEditing({ ...editing, stage: v as JourneyStage })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STAGE_META.map(s => <SelectItem key={s.value} value={s.value}>{s.label} — {s.days}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sort order</Label>
                  <Input type="number" value={editing.sort_order ?? 0}
                    onChange={e => setEditing({ ...editing, sort_order: Number(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Title</Label>
                <Input value={editing.title || ""} onChange={e => setEditing({ ...editing, title: e.target.value })} maxLength={120} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Body</Label>
                <Textarea rows={9} value={editing.body || ""}
                  onChange={e => setEditing({ ...editing, body: e.target.value })}
                  maxLength={2000}
                  placeholder="Hi {{name}}, ..." />
                <p className="text-[11px] text-muted-foreground">
                  Detected variables:{" "}
                  {detected.length === 0 ? <em>none</em> : detected.map(v => (
                    <span key={v} className="inline-block mr-1 px-1.5 py-0.5 rounded bg-muted">{`{{${v}}}`}</span>
                  ))}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.is_active ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
                <Label className="text-xs">Active (visible to sales)</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminMessageTemplates;
