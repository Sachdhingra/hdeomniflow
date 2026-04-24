import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  CheckCircle2, XCircle, ShieldCheck, Phone, IndianRupee, Loader2, AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import StatCard from "@/components/StatCard";

type Job = {
  id: string;
  customer_name: string;
  customer_phone: string;
  category: string;
  type: string;
  value: number;
  date_to_attend: string | null;
  date_received: string;
  description: string;
  source_lead_id: string | null;
  accounts_approval_status: "pending" | "approved" | "rejected";
  accounts_rejection_reason: string | null;
  accounts_notes: string | null;
  accounts_approved_at: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-warning/15 text-warning border-warning/30",
  approved: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
};

const AccountsApprovals = () => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [actionJob, setActionJob] = useState<Job | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject">("approve");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [duesByPhone, setDuesByPhone] = useState<Record<string, { total: number; count: number }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("service_jobs")
      .select("id,customer_name,customer_phone,category,type,value,date_to_attend,date_received,description,source_lead_id,accounts_approval_status,accounts_rejection_reason,accounts_notes,accounts_approved_at")
      .is("deleted_at", null)
      .order("date_received", { ascending: false })
      .limit(200);
    if (error) {
      toast.error("Failed to load approvals");
      setLoading(false);
      return;
    }
    setJobs((data || []) as Job[]);

    // Look up dues for unique phones
    const phones = Array.from(new Set((data || []).map((j: any) => j.customer_phone).filter(Boolean)));
    const duesMap: Record<string, { total: number; count: number }> = {};
    await Promise.all(phones.map(async (phone) => {
      const { data: d } = await supabase.rpc("check_customer_dues", { p_customer_phone: phone });
      const row: any = Array.isArray(d) ? d[0] : d;
      if (row?.has_dues) {
        duesMap[phone] = { total: Number(row.total_pending) || 0, count: Number(row.due_count) || 0 };
      }
    }));
    setDuesByPhone(duesMap);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = jobs.filter(j => j.accounts_approval_status === tab);

  const counts = {
    pending: jobs.filter(j => j.accounts_approval_status === "pending").length,
    approved: jobs.filter(j => j.accounts_approval_status === "approved").length,
    rejected: jobs.filter(j => j.accounts_approval_status === "rejected").length,
  };

  const openAction = (job: Job, type: "approve" | "reject") => {
    setActionJob(job);
    setActionType(type);
    setNotes("");
    setReason("");
  };

  const submitAction = async () => {
    if (!actionJob || !user) return;
    if (actionType === "reject" && !reason.trim()) {
      toast.error("Rejection reason is required");
      return;
    }
    setSaving(true);
    try {
      const updates: any = {
        accounts_approval_status: actionType === "approve" ? "approved" : "rejected",
        accounts_approved_by: user.id,
        accounts_approved_at: new Date().toISOString(),
        accounts_notes: notes || null,
        accounts_rejection_reason: actionType === "reject" ? reason : null,
        status: actionType === "approve" ? "pending" : "accounts_rejected",
      };
      const { error: jErr } = await supabase
        .from("service_jobs")
        .update(updates)
        .eq("id", actionJob.id);
      if (jErr) throw jErr;

      const { error: lErr } = await supabase.from("accounts_approvals_log" as any).insert({
        service_job_id: actionJob.id,
        action: actionType === "approve" ? "approved" : "rejected",
        performed_by: user.id,
        notes: notes || null,
        amount_verified: actionJob.value,
        dues_checked: !!duesByPhone[actionJob.customer_phone],
      });
      if (lErr) throw lErr;

      toast.success(actionType === "approve" ? "✅ Dispatch approved" : "❌ Dispatch rejected");
      setActionJob(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-primary" /> Accounts Approvals
        </h1>
        <p className="text-sm text-muted-foreground">
          Verify customer dues & approve dispatches before service dispatch
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard title="Pending" value={counts.pending} icon={<AlertTriangle className="w-5 h-5" />} />
        <StatCard title="Approved" value={counts.approved} icon={<CheckCircle2 className="w-5 h-5" />} />
        <StatCard title="Rejected" value={counts.rejected} icon={<XCircle className="w-5 h-5" />} />
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({counts.pending})</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No {tab} dispatches</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(job => {
            const dues = duesByPhone[job.customer_phone];
            return (
              <Card key={job.id} className="shadow-card">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{job.customer_name}</h3>
                        <Badge variant="outline" className={STATUS_BADGE[job.accounts_approval_status]}>
                          {job.accounts_approval_status.toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className="text-xs uppercase">{job.type}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{job.customer_phone}</span>
                        <span>{job.category}</span>
                        {job.date_to_attend && <span>📅 {job.date_to_attend}</span>}
                      </p>
                      {job.description && <p className="text-sm mt-1">{job.description}</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-bold flex items-center gap-1 justify-end">
                        <IndianRupee className="w-4 h-4" />{Number(job.value).toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>

                  {dues && (
                    <div className="p-2 rounded-md bg-destructive/10 border border-destructive/30 text-xs">
                      <p className="font-semibold text-destructive flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Customer has pending dues
                      </p>
                      <p className="text-destructive/80">
                        ₹{dues.total.toLocaleString("en-IN")} across {dues.count} record(s)
                      </p>
                    </div>
                  )}

                  {job.accounts_approval_status === "rejected" && job.accounts_rejection_reason && (
                    <div className="p-2 rounded-md bg-destructive/10 border border-destructive/30 text-xs">
                      <span className="font-semibold">Reason: </span>{job.accounts_rejection_reason}
                    </div>
                  )}
                  {job.accounts_notes && (
                    <p className="text-xs text-muted-foreground">📝 {job.accounts_notes}</p>
                  )}

                  {job.accounts_approval_status === "pending" && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90 gap-1"
                        onClick={() => openAction(job, "approve")}>
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" className="gap-1"
                        onClick={() => openAction(job, "reject")}>
                        <XCircle className="w-4 h-4" /> Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!actionJob} onOpenChange={o => !o && setActionJob(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionType === "approve" ? (
                <><CheckCircle2 className="w-5 h-5 text-success" /> Approve dispatch</>
              ) : (
                <><XCircle className="w-5 h-5 text-destructive" /> Reject dispatch</>
              )}
            </DialogTitle>
          </DialogHeader>
          {actionJob && (
            <div className="space-y-3">
              <div className="p-2 rounded bg-muted text-sm">
                <p className="font-medium">{actionJob.customer_name}</p>
                <p className="text-xs text-muted-foreground">
                  {actionJob.customer_phone} · ₹{Number(actionJob.value).toLocaleString("en-IN")}
                </p>
              </div>
              {actionType === "reject" && (
                <div className="space-y-1.5">
                  <Label>Rejection reason *</Label>
                  <Textarea value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="e.g. Customer has ₹15,000 outstanding from prev invoice" rows={3} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Notes {actionType === "approve" && "(optional)"}</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Internal notes / verification details" rows={2} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionJob(null)}>Cancel</Button>
            <Button
              className={actionType === "approve" ? "bg-success text-success-foreground hover:bg-success/90" : ""}
              variant={actionType === "reject" ? "destructive" : "default"}
              onClick={submitAction}
              disabled={saving}
            >
              {saving ? "Saving..." : actionType === "approve" ? "Confirm Approval" : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AccountsApprovals;
