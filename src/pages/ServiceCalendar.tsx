import { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const ServiceCalendar = () => {
  const { serviceJobs } = useData();
  const [selected, setSelected] = useState<Date | undefined>(new Date());

  const selectedStr = selected ? format(selected, "yyyy-MM-dd") : "";
  const dayJobs = serviceJobs.filter(j => j.date_to_attend === selectedStr);
  const jobDates = new Set(serviceJobs.map(j => j.date_to_attend).filter(Boolean));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Service Calendar</h1>
        <p className="text-sm text-muted-foreground">Today's jobs & schedule overview</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-card">
          <CardContent className="p-4 flex justify-center">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={setSelected}
              className={cn("p-3 pointer-events-auto")}
              modifiers={{ hasJobs: (date) => jobDates.has(format(date, "yyyy-MM-dd")) }}
              modifiersClassNames={{ hasJobs: "bg-primary/10 font-bold text-primary" }}
            />
          </CardContent>
        </Card>
        <div className="space-y-3">
          <h2 className="font-semibold">{selected ? format(selected, "dd MMM yyyy") : "Select a date"} — {dayJobs.length} job(s)</h2>
          {dayJobs.map(job => (
            <Card key={job.id} className="shadow-card">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{job.customer_name}</p>
                    <p className="text-sm text-muted-foreground">{job.description}</p>
                    <p className="text-xs text-muted-foreground">{job.address}</p>
                  </div>
                  <Badge>{job.status.replace("_", " ")}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
          {dayJobs.length === 0 && <p className="text-muted-foreground text-sm">No jobs scheduled for this date.</p>}
        </div>
      </div>
    </div>
  );
};

export default ServiceCalendar;
