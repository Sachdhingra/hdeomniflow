import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, ServiceJob } from "@/contexts/DataContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Phone, MapPin, Calendar, User, Truck, Wrench, IndianRupee,
  CheckCircle2, XCircle, Clock, FileText, Image as ImageIcon, Info, Pencil,
  UserPlus, CalendarClock,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  pending_accounts_approval: "bg-warning/10 text-warning",
  assigned: "bg-primary/10 text-primary",
  in_progress: "bg-accent/10 text-accent-foreground",
  on_route: "bg-primary/10 text-primary",
  on_site: "bg-accent/10 text-accent-foreground",
  completed: "bg-success/10 text-success",
  rescheduled: "bg-warning/10 text-warning",
  accounts_rejected: "bg-destructive/10 text-destructive",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  pending_accounts_approval: "Pending Accounts",
  assigned: "Assigned",
  in_progress: "In Progress",
  on_route: "On Route",
  on_site: "On Site",
  completed: "Completed",
  rescheduled: "Rescheduled",
  accounts_rejected: "Rejected by Accounts",
};

const APPROVAL_BADGE: Record<string, string> = {
  approved: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  rejected: "bg-destructive/10 text-destructive",
};

const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—";
const fmtDateTime = (d?: string | null) => d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const orDash = (v?: string | number | null) => (v === null || v === undefined || v === "") ? "—" : String(v);

interface Props {
  job: ServiceJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (job: ServiceJob) => void;
  onAssign: (jobId: string) => void;
  onReschedule: (jobId: string, currentAgent: string | null) => void;
}

const ServiceDetailModal = ({ job, open, onOpenChange, onEdit, onAssign, onReschedule }: Props) => {
  const { user } = useAuth();
  const { profiles, leads, updateServiceJob } = useData();

  const agent = useMemo(() => job?.assigned_agent ? profiles.find(p => p.id === job.assigned_agent) : null, [job, profiles]);
  const owner = useMemo(() => {
    if (!job?.source_lead_id) return null;
    const lead = leads.find(l => l.id === job.source_lead_id);
    if (!lead) return null;
    return profiles.find(p => p.id === lead.created_by) || null;
  }, [job, leads, profiles]);
  const approver = useMemo(
    () => (job as any)?.accounts_approved_by ? profiles.find(p => p.id === (job as any).accounts_approved_by) : null,
    [job, profiles],
  );

  if (!job) return null;

  const isAdmin = user?.role === "admin";
  const isServiceHead = user?.role === "service_head";
  const canAssign = isAdmin || isServiceHead;
  const photos = (job.photos || []).filter(p => typeof p === "string" && p.startsWith("http"));
  const approvalStatus = (job as any).accounts_approval_status || "pending";

  const handleComplete = async () => {
    if (!confirm("Mark this job as completed?")) return;
    try {
      await updateServiceJob(job.id, { status: "completed" as any, completed_at: new Date().toISOString() } as any);
      toast.success("Job marked as completed");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to update");
    }
  };

  const Row = ({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) => (
    <div className={`flex justify-between gap-3 py-1.5 text-sm ${highlight ? "bg-warning/10 -mx-3 px-3 rounded" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {/* Header */}
        <DialogHeader className="p-4 sm:p-6 pb-3 border-b">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg sm:text-xl truncate">{job.customer_name}</DialogTitle>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <Badge className={STATUS_BADGE[job.status] || ""}>{STATUS_LABEL[job.status] || job.status}</Badge>
                <Badge variant="outline" className="gap-1 text-xs">
                  {job.type === "delivery" ? <Truck className="w-3 h-3" /> : job.type === "self_delivery" ? <Truck className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                  {job.type}
                </Badge>
                <Badge className={APPROVAL_BADGE[approvalStatus] || ""}>
                  Accounts: {approvalStatus}
                </Badge>
                {job.is_foc && <Badge variant="outline" className="text-xs">FOC</Badge>}
                {job.claim_part_no && <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">Claim</Badge>}
              </div>
            </div>
            {!job.is_foc && (
              <div className="text-right shrink-0">
                <div className="flex items-center gap-0.5 text-lg sm:text-xl font-bold">
                  <IndianRupee className="w-4 h-4" />{Number(job.value).toLocaleString("en-IN")}
                </div>
              </div>
            )}
          </div>
        </DialogHeader>

        <Tabs defaultValue="details" className="px-4 sm:px-6 pb-4">
          <div className="w-full overflow-x-auto -mx-1 px-1">
            <TabsList className="inline-flex h-auto w-max flex-nowrap gap-1 p-1">
              <TabsTrigger value="details" className="whitespace-nowrap text-xs sm:text-sm">Details</TabsTrigger>
              <TabsTrigger value="system" className="whitespace-nowrap text-xs sm:text-sm">System / RLS</TabsTrigger>
              <TabsTrigger value="photos" className="whitespace-nowrap text-xs sm:text-sm">Photos {photos.length > 0 && `(${photos.length})`}</TabsTrigger>
              <TabsTrigger value="notes" className="whitespace-nowrap text-xs sm:text-sm">Notes</TabsTrigger>
            </TabsList>
          </div>

          {/* DETAILS TAB */}
          <TabsContent value="details" className="space-y-3 mt-3">
            {/* Customer / delivery */}
            <div className="border rounded-lg p-3 space-y-1">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Delivery Details
              </p>
              <Row label="Phone" value={<a href={`tel:${job.customer_phone}`} className="text-primary">{job.customer_phone}</a>} />
              <Row label="Address" value={orDash(job.address)} />
              <Row label="Category" value={orDash(job.category)} />
              <Row label="Date Received" value={fmtDate(job.date_received)} />
              <Row label="Scheduled Date" value={fmtDate(job.date_to_attend)} />
            </div>

            {/* Items / description */}
            <div className="border rounded-lg p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1">
                <FileText className="w-3 h-3" /> Items / Description
              </p>
              <p className="text-sm whitespace-pre-wrap">{orDash(job.description)}</p>
            </div>

            {/* Agent */}
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
                <User className="w-3 h-3" /> Assigned Agent
              </p>
              {agent ? (
                <div className="text-sm">
                  <p className="font-medium">{agent.name}</p>
                  {agent.phone_number && <p className="text-muted-foreground text-xs">{agent.phone_number}</p>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Not assigned</p>
              )}
              {owner && (
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  Salesperson: <span className="font-medium text-foreground">{owner.name}</span>
                  {owner.phone_number && <> · {owner.phone_number}</>}
                </div>
              )}
            </div>

            {/* Claim */}
            {job.claim_part_no && (
              <div className="border border-destructive/30 rounded-lg p-3 bg-destructive/5">
                <p className="text-xs font-semibold uppercase text-destructive mb-1">Claim Details</p>
                <Row label="Part No." value={orDash(job.claim_part_no)} />
                <Row label="Reason" value={orDash(job.claim_reason)} />
                <Row label="Due Date" value={fmtDate(job.claim_due_date)} />
              </div>
            )}
          </TabsContent>

          {/* SYSTEM / RLS TAB */}
          <TabsContent value="system" className="space-y-3 mt-3">
            <div className="border rounded-lg p-3 bg-muted/30">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                <Info className="w-3 h-3" /> Critical RLS Fields
              </p>
              <Row label="type" value={<code className="bg-background px-1.5 py-0.5 rounded">{String(job.type)}</code>} highlight />
              <Row label="status" value={<code className="bg-background px-1.5 py-0.5 rounded">{String(job.status)}</code>} highlight />
              <Row label="accounts_approval_status" value={<code className="bg-background px-1.5 py-0.5 rounded">{String(approvalStatus)}</code>} highlight />
              <Row label="deleted_at" value={(job as any).deleted_at ? fmtDateTime((job as any).deleted_at) : <span className="text-success">null (active)</span>} />
            </div>

            <div className="border rounded-lg p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Approval Info</p>
              <Row label="Approved By" value={orDash(approver?.name)} />
              <Row label="Approved At" value={fmtDateTime((job as any).accounts_approved_at)} />
              <Row label="Rejection Reason" value={orDash((job as any).accounts_rejection_reason)} />
              <Row label="Accounts Notes" value={orDash((job as any).accounts_notes)} />
              <Row label="Payment Status" value={orDash((job as any).payment_status)} />
              <Row label="Amount Paid" value={`₹${Number((job as any).amount_paid || 0).toLocaleString("en-IN")}`} />
              <Row label="Amount Pending" value={`₹${Number((job as any).amount_pending || 0).toLocaleString("en-IN")}`} />
            </div>

            <div className="border rounded-lg p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Job Metadata</p>
              <Row label="Job ID" value={<code className="text-xs">{job.id}</code>} />
              <Row label="Source Lead" value={job.source_lead_id ? <code className="text-xs">{job.source_lead_id.slice(0, 8)}…</code> : "—"} />
              <Row label="Created" value={fmtDateTime(job.created_at)} />
              <Row label="Updated" value={fmtDateTime(job.updated_at)} />
              <Row label="Accepted At" value={fmtDateTime((job as any).accepted_at)} />
              <Row label="Travel Started" value={fmtDateTime((job as any).travel_started_at)} />
              <Row label="Reached At" value={fmtDateTime((job as any).agent_reached_at)} />
              <Row label="Completed At" value={fmtDateTime((job as any).completed_at)} />
            </div>
          </TabsContent>

          {/* PHOTOS TAB */}
          <TabsContent value="photos" className="mt-3">
            {photos.length === 0 ? (
              <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
                <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                No photos uploaded yet
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                    <img src={url} alt={`Photo ${i + 1}`} className="w-full aspect-square object-cover rounded-lg border" />
                  </a>
                ))}
              </div>
            )}
          </TabsContent>

          {/* NOTES TAB */}
          <TabsContent value="notes" className="space-y-3 mt-3">
            <div className="border rounded-lg p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Field Agent Remarks</p>
              <p className="text-sm whitespace-pre-wrap">{orDash(job.remarks)}</p>
            </div>
            <div className="border rounded-lg p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Payment Notes</p>
              <p className="text-sm whitespace-pre-wrap">{orDash((job as any).payment_notes)}</p>
            </div>
            {(job as any).accounts_rejection_reason && (
              <div className="border border-destructive/30 rounded-lg p-3 bg-destructive/5">
                <p className="text-xs font-semibold uppercase text-destructive mb-1 flex items-center gap-1">
                  <XCircle className="w-3 h-3" /> Accounts Rejection Reason
                </p>
                <p className="text-sm whitespace-pre-wrap">{(job as any).accounts_rejection_reason}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Action footer */}
        <div className="border-t p-3 sm:p-4 flex flex-wrap gap-2 justify-end bg-muted/20">
          {canAssign && job.status === "pending" && approvalStatus === "approved" && (
            <Button size="sm" onClick={() => onAssign(job.id)} className="gap-1">
              <UserPlus className="w-3 h-3" /> Assign Agent
            </Button>
          )}
          {canAssign && !["completed"].includes(job.status) && (
            <Button size="sm" variant="outline" onClick={() => onReschedule(job.id, job.assigned_agent)} className="gap-1">
              <CalendarClock className="w-3 h-3" /> Reschedule
            </Button>
          )}
          {(isAdmin || isServiceHead) && job.status !== "completed" && job.assigned_agent && (
            <Button size="sm" variant="outline" onClick={handleComplete} className="gap-1">
              <CheckCircle2 className="w-3 h-3" /> Mark Complete
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onEdit(job)} className="gap-1">
            <Pencil className="w-3 h-3" /> Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ServiceDetailModal;
