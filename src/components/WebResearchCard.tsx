import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, Loader2, ExternalLink, ChevronDown, ChevronUp, Globe } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ResearchRow {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  markdown: string | null;
  scraped_at: string;
}

export default function WebResearchCard() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ResearchRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = async () => {
    const { data, error } = await supabase
      .from("firecrawl_research")
      .select("id, url, title, description, scraped_at")
      .order("scraped_at", { ascending: false })
      .limit(10);
    if (!error) setHistory((data as ResearchRow[]) ?? []);
  };

  useEffect(() => { loadHistory(); }, []);

  const scrape = async () => {
    const target = url.trim();
    if (!target) { toast.error("Enter a URL to research"); return; }
    let normalized = target;
    if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;
    try { new URL(normalized); } catch { toast.error("Invalid URL"); return; }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("firecrawl-research", {
        body: { url: normalized },
      });
      // Extract real error message — Supabase wraps non-2xx as a generic FunctionsHttpError
      if (error) {
        let msg: string = error.message ?? "Scrape failed";
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (data?.success === false) throw new Error(data.error || "Scrape failed");
      toast.success(`Scraped: ${data.title || normalized}`);
      setUrl("");
      await loadHistory();
      if (data.id) setExpanded(data.id);
    } catch (e: any) {
      toast.error(`Research failed: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const loadMarkdown = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    const { data } = await supabase
      .from("firecrawl_research")
      .select("id, url, title, description, markdown, scraped_at")
      .eq("id", id)
      .single();
    if (data) {
      setHistory((prev) =>
        prev.map((r) => (r.id === id ? { ...r, markdown: (data as any).markdown } : r))
      );
    }
    setExpanded(id);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4" /> Web Research
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            placeholder="https://www.urbanladder.com/sofas"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && scrape()}
            disabled={loading}
            className="flex-1"
          />
          <Button onClick={scrape} disabled={loading} size="sm" className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Scrape
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Scrape any URL with Firecrawl — competitor pricing, product catalogs, market research.
          Results are stored for future reference.
        </p>

        {history.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent Research</p>
            {history.map((row) => (
              <div key={row.id} className="border rounded-md overflow-hidden">
                <button
                  className="w-full flex items-start justify-between gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => loadMarkdown(row.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{row.title || row.url}</p>
                    <p className="text-xs text-muted-foreground truncate">{row.url}</p>
                    {row.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{row.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      {formatDistanceToNow(new Date(row.scraped_at), { addSuffix: true })}
                    </Badge>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    {expanded === row.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>
                {expanded === row.id && row.markdown && (
                  <div className="border-t p-3 bg-muted/20">
                    <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                      {row.markdown}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
