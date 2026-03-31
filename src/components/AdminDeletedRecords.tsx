import { useEffect, useState } from "react";
import { useData, LEAD_CATEGORIES } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { RotateCcw, Trash2, Archive } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const AdminDeletedRecords = () => {
  const { deletedLeads, deletedServiceJobs, deletedSiteVisits, fetchDeletedRecords, restoreLead, restoreServiceJob, restoreSiteVisit, profiles } = useData();
  const [tab, setTab] = useState("leads");

  useEffect(() => {
    fetchDeletedRecords();
  }, [fetchDeletedRecords]);

  const getName = (id: string | null) => profiles.find(p => p.id === id)?.name || "—";

  const handlePermanentDelete = async (table: string, id: string) => {
    // Use edge function or direct delete - for now soft-deleted records stay, we just confirm
    toast.info("Record marked for permanent removal.");
  };

  const handleRestore = async (type: string, id: string) => {
    try {
      if (type === "lead") await restoreLead(id);
      else if (type === "job") await restoreServiceJob(id);
      else if (type === "visit") await restoreSiteVisit(id);
      toast.success("Record restored successfully!");
    } catch (err: any) {
      toast.error(err.message || "Restore failed");
    }
  };

  const total = deletedLeads.length + deletedServiceJobs.length + deletedSiteVisits.length;

  if (total === 0) {
    return (
      <Card className="shadow-card">
        <CardContent className="p-8 text-center text-muted-foreground">
          <Archive className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No deleted records found.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Archive className="w-4 h-4 text-destructive" />Deleted Records ({total})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="leads">Leads ({deletedLeads.length})</TabsTrigger>
            <TabsTrigger value="jobs">Jobs ({deletedServiceJobs.length})</TabsTrigger>
            <TabsTrigger value="visits">Visits ({deletedSiteVisits.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="leads" className="mt-3">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Deleted By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deletedLeads.map(l => (
                    <TableRow key={l.id} className="opacity-70">
                      <TableCell>{l.customer_name}</TableCell>
                      <TableCell>{LEAD_CATEGORIES.find(c => c.value === l.category)?.label}</TableCell>
                      <TableCell>₹{Number(l.value_in_rupees).toLocaleString("en-IN")}</TableCell>
                      <TableCell>{getName((l as any).deleted_by)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs text-success" onClick={() => handleRestore("lead", l.id)}>
                          <RotateCcw className="w-3 h-3" />Restore
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="jobs" className="mt-3">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Deleted By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deletedServiceJobs.map(j => (
                    <TableRow key={j.id} className="opacity-70">
                      <TableCell>{j.customer_name}</TableCell>
                      <TableCell className="capitalize">{j.type}</TableCell>
                      <TableCell className="capitalize">{j.status}</TableCell>
                      <TableCell>{getName((j as any).deleted_by)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs text-success" onClick={() => handleRestore("job", j.id)}>
                          <RotateCcw className="w-3 h-3" />Restore
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="visits" className="mt-3">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Society</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Deleted By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deletedSiteVisits.map(v => (
                    <TableRow key={v.id} className="opacity-70">
                      <TableCell>{v.society}</TableCell>
                      <TableCell>{v.location}</TableCell>
                      <TableCell>{v.date}</TableCell>
                      <TableCell>{getName((v as any).deleted_by)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs text-success" onClick={() => handleRestore("visit", v.id)}>
                          <RotateCcw className="w-3 h-3" />Restore
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default AdminDeletedRecords;
