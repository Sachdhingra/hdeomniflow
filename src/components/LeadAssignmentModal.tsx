import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES } from "@/contexts/DataContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserCheck, History } from "lucide-react";
import { toast } from "sonner";

interface HistoryRow {
  id: string;
  from_user: string | null;
  to_user: string | null;
  assigned_by: string | null;
  reason: string | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
  customerName?: string;
  currentAssignee?: string | null;
}

const LeadAssignmentModal = ({ open, onOpenChange, leadId, customerName, currentAssignee }: Props) => {
  const { user } = useAuth();
  const { getProfilesByRole, profiles, updateLead } = useData();
  const [assignee, setAssignee] = useState<string>(currentAssignee || "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const sales = getProfilesByRole("sales");
  const nameOf = (id: string | null) => (id ? profiles.find(p => p.id === id)?.name || "—" : "Unassigned");

  useEffect(() => { setAssignee(currentAssignee || ""); setReason(""); }, [leadId, currentAssignee, open]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("lead_assignment_history")
        .select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(20);
      setHistory((data as HistoryRow[]) || []);
    })();
  }, [open, leadId]);

  const submit = async () => {
    if (!assignee) { toast.error("Pick a sales person"); return; }
    if (assignee === currentAssignee) { toast.info("Already assigned to this user"); return; }
    setSaving(true);
    try {
      await updateLead(leadId, { assigned_to: assignee, assignment_notes: reason || null } as any);

      // Fetch lead details for the notification message and chat DM body
      const { data: lead, error: leadFetchErr } = await supabase
        .from("leads")
        .select("customer_name, customer_phone, category, value_in_rupees, next_follow_up_date")
        .eq("id", leadId)
        .single();

      if (leadFetchErr) {
        console.error("[LeadAssign] lead fetch failed:", leadFetchErr.message);
      }

      if (lead) {
        const formattedValue = Number(lead.value_in_rupees).toLocaleString("en-IN");
        const categoryLabel = LEAD_CATEGORIES.find(c => c.value === lead.category)?.label || lead.category;

        // Notification record — admin role satisfies the INSERT RLS policy
        const { error: notifErr } = await supabase.from("notifications").insert({
          user_id: assignee,
          message: `New lead assigned: ${lead.customer_name} · ₹${formattedValue} · ${lead.customer_phone}`,
          type: "lead_assigned",
        });
        if (notifErr) console.error("[LeadAssign] notification insert failed:", notifErr.message);

        // Chat DM — best-effort, never blocks the assignment success toast
        const { data: channelId, error: rpcErr } = await supabase.rpc(
          "get_or_create_dm_channel",
          { _other: assignee }
        );
        if (rpcErr) {
          console.error("[LeadAssign] get_or_create_dm_channel failed:", rpcErr.message);
        } else if (channelId && user?.id) {
          const adminName = profiles.find(p => p.id === user.id)?.name || "Admin";
          const followUp = lead.next_follow_up_date
            ? new Date(lead.next_follow_up_date).toLocaleDateString("en-IN")
            : "Not set";
          const notesPart = reason ? `\n📝 Notes: ${reason}` : "";
          const { error: msgErr } = await supabase.from("chat_messages").insert({
            channel_id: channelId as string,
            sender_id: user.id,
            body: `🎯 NEW LEAD ASSIGNED\n\n👤 Customer: ${lead.customer_name}\n📱 Phone: ${lead.customer_phone}\n🛋️ Product: ${categoryLabel}\n💰 Value: ₹${formattedValue}\n📅 Follow-up: ${followUp}${notesPart}\n\nAssigned by: ${adminName}`,
          });
          if (msgErr) console.error("[LeadAssign] chat message insert failed:", msgErr.message);
        }
      }

      toast.success("Lead assigned & sales person notified");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to assign");
    } finally { setSaving(false); }
  };

  if (user?.role !== "admin") return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserCheck className="w-4 h-4" /> Assign Lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {customerName && (
            <div className="text-sm text-muted-foreground">
              Customer: <span className="font-medium text-foreground">{customerName}</span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Assign to (Sales) *</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger><SelectValue placeholder="Select sales person" /></SelectTrigger>
              <SelectContent>
                {sales.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reason / Notes</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Optional reason for assignment" />
          </div>
          <Button onClick={submit} disabled={saving} className="w-full gradient-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : currentAssignee ? "Reassign" : "Assign"}
          </Button>

          {history.length > 0 && (
            <div className="pt-3 border-t">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2">
                <History className="w-3 h-3" /> Assignment History
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {history.map(h => (
                  <div key={h.id} className="text-xs border rounded p-2 bg-muted/30">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{nameOf(h.from_user)}</Badge>
                      <span>→</span>
                      <Badge className="text-[10px]">{nameOf(h.to_user)}</Badge>
                    </div>
                    <div className="text-muted-foreground mt-1">
                      by {nameOf(h.assigned_by)} · {new Date(h.created_at).toLocaleString("en-IN")}
                    </div>
                    {h.reason && <div className="mt-1 italic">"{h.reason}"</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LeadAssignmentModal;
