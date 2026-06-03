import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Loader2 } from "lucide-react";

type CalJob = {
  id: string;
  customer_name: string;
  description: string | null;
  address: string | null;
  status: string;
  type: string;
  date_to_attend: string | null;
  assigned_agent: string | null;
  accounts_approval_status: string | null;
};

const ServiceCalendar = () => {
  const { user } = useAuth();
  const { profiles } = useData();
  const [selected, setSelected] = useState<Date | undefined>(new Date());
  const [month, setMonth] = useState<Date>(new Date());
  const [jobs, setJobs] = useState<CalJob[]>([]);
  const [loading, setLoading] = useState(false);

  const isServiceHead = user?.role === "service_head";
  const isAdmin = user?.role === "admin";

  // Fetch directly from Supabase for the visible month so paginated cache
  // doesn't hide older jobs that were rescheduled/assigned into this month.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const start = format(startOfMonth(month), "yyyy-MM-dd");
      const end = format(endOfMonth(month), "yyyy-MM-dd");
      const { data } = await supabase
        .from("service_jobs")
        .select("id, customer_name, description, address, status, type, date_to_attend, assigned_agent, accounts_approval_status")
        .is("deleted_at", null)
        .not("date_to_attend", "is", null)
        .gte("date_to_attend", start)
        .lte("date_to_attend", end);
      if (cancelled) return;
      setJobs((data as CalJob[]) || []);
      setLoading(false);
    };
    run();
  }, [month]);

  const visibleJobs = useMemo(() => {
    if (isAdmin || !isServiceHead) return jobs;
    // Service head: hide self_delivery and non-approved deliveries
    return jobs.filter(j => {
      if (j.type === "self_delivery") return false;
      if (j.type === "service") return true;
      if (j.type === "delivery") return j.accounts_approval_status === "approved";
      return false;
    });
  }, [jobs, isServiceHead, isAdmin]);

  const selectedStr = selected ? format(selected, "yyyy-MM-dd") : "";
  const dayJobs = visibleJobs.filter(j => j.date_to_attend === selectedStr);
  const jobDates = new Set(visibleJobs.map(j => j.date_to_attend).filter(Boolean) as string[]);

  const agentName = (id: string | null) =>
    id ? (profiles.find(p => p.id === id)?.name || "—") : "Unassigned";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Service Calendar</h1>
        <p className="text-sm text-muted-foreground">All scheduled jobs for the selected month (live)</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-card">
          <CardContent className="p-4 flex justify-center">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={setSelected}
              month={month}
              onMonthChange={setMonth}
              className={cn("p-3 pointer-events-auto")}
              modifiers={{ hasJobs: (date) => jobDates.has(format(date, "yyyy-MM-dd")) }}
              modifiersClassNames={{ hasJobs: "bg-primary/10 font-bold text-primary" }}
            />
          </CardContent>
        </Card>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">
              {selected ? format(selected, "dd MMM yyyy") : "Select a date"} — {dayJobs.length} job(s)
            </h2>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          {dayJobs.map(job => (
            <Card key={job.id} className="shadow-card">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{job.customer_name}</p>
                    <p className="text-sm text-muted-foreground truncate">{job.description}</p>
                    <p className="text-xs text-muted-foreground truncate">{job.address}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Agent: <span className="text-foreground">{agentName(job.assigned_agent)}</span>
                      <span className="mx-1">·</span>
                      <span className="capitalize">{job.type.replace("_", " ")}</span>
                    </p>
                  </div>
                  <Badge>{job.status.replace(/_/g, " ")}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
          {!loading && dayJobs.length === 0 && (
            <p className="text-muted-foreground text-sm">No jobs scheduled for this date.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ServiceCalendar;
