import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, XCircle, Phone, IndianRupee, Loader2, AlertTriangle, Eye } from "lucide-react";
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
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-warning/15 text-warning border-warning/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
};

const ServiceHeadPendingApprovals = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "rejected">("pending");
  const [ownersByJob, setOwnersByJob] = useState<
    Record<string, { owner_name: string | null; assignee_name: string | null }>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("service_jobs")
      .select(
        "id,customer_name,customer_phone,category,type,value,date_to_attend,date_received,description,source_lead_id,accounts_approval_status,accounts_rejection_reason,accounts_notes"
      )
      .eq("type", "delivery")
      .in("accounts_approval_status", ["pending", "rejected"])
      .is("deleted_at", null)
      .order("date_received", { ascending: false })
      .limit(200);
    if (error) {
      toast.error("Failed to load pending approvals");
      setLoading(false);
      return;
    }
    setJobs((data || []) as Job[]);

    const jobIds = (data || []).map((j: any) => j.id);
    if (jobIds.length) {
      const { data: owners } = await supabase.rpc("get_lead_owners_for_jobs" as any, {
        p_job_ids: jobIds,
      });
      const map: Record<string, { owner_name: string | null; assignee_name: string | null }> = {};
      (owners || []).forEach((o: any) => {
        map[o.job_id] = { owner_name: o.owner_name, assignee_name: o.assignee_name };
      });
      setOwnersByJob(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("service-head-pending-approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_jobs" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const filtered = jobs.filter((j) => j.accounts_approval_status === tab);
  const counts = {
    pending: jobs.filter((j) => j.accounts_approval_status === "pending").length,
    rejected: jobs.filter((j) => j.accounts_approval_status === "rejected").length,
  };

  const daysWaiting = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Eye className="w-6 h-6 text-primary" /> Pending Accounts Approvals
        </h1>
        <p className="text-sm text-muted-foreground">
          Read-only view of delivery requests awaiting accounts approval. Follow up with accounts to
          reduce dispatch delays.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard title="Awaiting approval" value={counts.pending} icon={<Clock className="w-5 h-5" />} />
        <StatCard title="Rejected" value={counts.rejected} icon={<XCircle className="w-5 h-5" />} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({counts.pending})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({counts.rejected})</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No {tab} dispatch requests
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => {
            const owner = ownersByJob[job.id];
            const ownerLabel = owner?.owner_name || owner?.assignee_name;
            const waiting = daysWaiting(job.date_received);
            return (
              <Card key={job.id} className="shadow-card">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{job.customer_name}</h3>
                        <Badge
                          variant="outline"
                          className={STATUS_BADGE[job.accounts_approval_status]}
                        >
                          {job.accounts_approval_status.toUpperCase()}
                        </Badge>
                        {job.accounts_approval_status === "pending" && waiting >= 1 && (
                          <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {waiting}d waiting
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {job.customer_phone}
                        </span>
                        <span>{job.category}</span>
                        {job.date_to_attend && <span>📅 {job.date_to_attend}</span>}
                      </p>
                      {ownerLabel && (
                        <p className="text-xs mt-1">
                          <span className="text-muted-foreground">Requested by: </span>
                          <span className="font-medium text-foreground">{ownerLabel}</span>
                        </p>
                      )}
                      {job.description && <p className="text-sm mt-1">{job.description}</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-bold flex items-center gap-1 justify-end">
                        <IndianRupee className="w-4 h-4" />
                        {Number(job.value).toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>

                  {job.accounts_approval_status === "rejected" && job.accounts_rejection_reason && (
                    <div className="p-2 rounded-md bg-destructive/10 border border-destructive/30 text-xs">
                      <span className="font-semibold">Reason: </span>
                      {job.accounts_rejection_reason}
                    </div>
                  )}
                  {job.accounts_notes && (
                    <p className="text-xs text-muted-foreground">📝 {job.accounts_notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ServiceHeadPendingApprovals;
