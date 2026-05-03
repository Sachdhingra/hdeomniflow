import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Loader2, Globe } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Run {
  id: string;
  started_at: string;
  finished_at: string | null;
  mode: string;
  status: string;
  urls_discovered: number;
  products_upserted: number;
  products_skipped: number;
  error_message: string | null;
}

interface Counts {
  total: number;
  byCategory: { category: string; count: number }[];
}

export default function GodrejScraperCard() {
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [counts, setCounts] = useState<Counts>({ total: 0, byCategory: [] });

  const refresh = async () => {
    const { data: runs } = await supabase
      .from("godrej_scrape_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1);
    setLastRun((runs && runs[0]) || null);

    const { data: products } = await supabase
      .from("godrej_products")
      .select("category")
      .eq("active", true);
    if (products) {
      const map: Record<string, number> = {};
      for (const p of products) map[p.category] = (map[p.category] || 0) + 1;
      setCounts({
        total: products.length,
        byCategory: Object.entries(map).map(([category, count]) => ({ category, count })),
      });
    }
  };

  useEffect(() => { refresh(); }, []);

  const run = async (mode: "map" | "discover" | "scrape") => {
    setRunning(true);
    try {
      const body: any = { mode };
      if (mode === "scrape") body.product_limit = 25;
      else body.limit = 100;
      const { data, error } = await supabase.functions.invoke("godrej-scrape", { body });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || "Scrape failed");
      toast.success(
        `${mode}: ${data?.urls_discovered ?? 0} URLs · ${data?.products_upserted ?? 0} saved`,
      );
      await refresh();
    } catch (e: any) {
      toast.error(`Scrape failed: ${e.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4" /> Godrej Interio Catalog
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={trigger} disabled={running} size="sm">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {running ? "Scraping…" : "Scrape Godrej Products"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {counts.total} active products
          </span>
          {lastRun && (
            <span className="text-xs text-muted-foreground">
              Last run: {formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })} ·{" "}
              <Badge variant={lastRun.status === "completed" ? "secondary" : "destructive"}>
                {lastRun.status}
              </Badge>
            </span>
          )}
        </div>

        {counts.byCategory.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {counts.byCategory.map((c) => (
              <Badge key={c.category} variant="outline">
                {c.category}: {c.count}
              </Badge>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Pilot mode: Firecrawl /map only — discovers product URLs & names. Run again later to
          enrich with prices/images.
        </p>
      </CardContent>
    </Card>
  );
}
