import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  FileDown,
  FileSpreadsheet,
  Link2,
  Loader2,
  Pencil,
  Search,
  ShoppingCart,
  Trash2,
  UserRound,
} from "lucide-react";
import QuoteDrawer from "@/components/product-library/QuoteDrawer";
import { useQuote } from "@/contexts/QuoteContext";
import { useAuth } from "@/contexts/AuthContext";
import { money, plDb } from "@/lib/productLibrary";
import {
  QUOTE_STATUSES,
  deleteQuote,
  downloadSavedQuoteExcel,
  downloadSavedQuotePdf,
  leadLabel,
  listQuotes,
  loadQuote,
  setQuoteStatus,
  type QuoteStatus,
  type SavedQuoteRow,
} from "@/lib/savedQuotes";
import { toast } from "@/lib/toast";

const STATUS_STYLE: Record<QuoteStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-primary/10 text-primary",
  accepted: "bg-success/15 text-success",
  rejected: "bg-destructive/10 text-destructive",
};

const formatDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

type Row = SavedQuoteRow & { leadText?: string; ownerName?: string };

/** Every saved quotation: your own (admins see everyone's), with lead link and status. */
const SavedQuotes = () => {
  const { user, isAdmin } = useAuth();
  const { meta, items, loadSaved, setMeta, open, setOpen, count } = useQuote();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | QuoteStatus>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const quotes = await listQuotes();
      const leadIds = [...new Set(quotes.map((q) => q.lead_id).filter(Boolean))] as string[];
      const ownerIds = [...new Set(quotes.map((q) => q.created_by))];
      const [{ data: leads }, { data: profiles }] = await Promise.all([
        leadIds.length
          ? plDb.from("leads").select("id, customer_name, customer_phone").in("id", leadIds)
          : Promise.resolve({ data: [] }),
        ownerIds.length
          ? plDb.from("profiles").select("id, name").in("id", ownerIds)
          : Promise.resolve({ data: [] }),
      ]);
      const leadMap = new Map<string, string>(
        (leads || []).map((l: { id: string; customer_name: string; customer_phone: string }) => [l.id, leadLabel(l)]),
      );
      const ownerMap = new Map<string, string>(
        (profiles || []).map((p: { id: string; name: string }) => [p.id, p.name]),
      );
      setRows(
        quotes.map((q) => ({
          ...q,
          leadText: q.lead_id ? leadMap.get(q.lead_id) ?? "Linked lead" : undefined,
          ownerName: ownerMap.get(q.created_by),
        })),
      );
    } catch (e) {
      toast.error(errorText(e, "Could not load quotes"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on arrival, and again when the quote drawer closes (it may have saved changes).
  useEffect(() => {
    if (!open) void load();
  }, [load, open]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return rows.filter(
      (q) =>
        (status === "all" || q.status === status) &&
        (!t ||
          [q.quote_number, q.customer_name, q.customer_phone, q.leadText]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(t))),
    );
  }, [rows, search, status]);

  const openForEdit = async (q: Row) => {
    if (items.length && !meta.quoteId) {
      if (!window.confirm("Your current quote isn't saved. Replace it with this saved quote?")) return;
    }
    setBusyId(q.id);
    try {
      const { meta: m, lines } = await loadQuote(q.id);
      loadSaved(m, lines);
      setOpen(true);
    } catch (e) {
      toast.error(errorText(e, "Could not open quote"));
    } finally {
      setBusyId(null);
    }
  };

  const download = async (q: Row, format: "pdf" | "excel") => {
    setBusyId(q.id);
    try {
      const { meta: m, lines } = await loadQuote(q.id);
      if (format === "pdf") await downloadSavedQuotePdf(lines, m, new Date(q.created_at));
      else await downloadSavedQuoteExcel(lines, m, new Date(q.created_at));
    } catch (e) {
      toast.error(errorText(e, format === "pdf" ? "Could not generate PDF" : "Could not generate Excel"));
    } finally {
      setBusyId(null);
    }
  };

  const changeStatus = async (q: Row, next: QuoteStatus) => {
    try {
      await setQuoteStatus(q.id, next, q.sent_at);
      if (meta.quoteId === q.id) setMeta({ status: next });
      if (q.lead_id && next === "sent") toast.success("Marked as sent. Lead moved to “Quote sent”.");
      else if (q.lead_id && next === "accepted") toast.success("Accepted. Lead's deal marked as won.");
      else if (q.lead_id && next === "rejected")
        toast.success("Marked rejected. Close the deal on the pipeline if the customer has decided.");
      else toast.success("Status updated");
      await load();
    } catch (e) {
      toast.error(errorText(e, "Could not update status"));
    }
  };

  const remove = async (q: Row) => {
    if (!window.confirm(`Delete quote ${q.quote_number ?? ""}? This can't be undone.`)) return;
    try {
      await deleteQuote(q.id);
      if (meta.quoteId === q.id) setMeta({ quoteId: null, quoteNumber: null, status: "draft" });
      setRows((prev) => prev.filter((r) => r.id !== q.id));
      toast.success("Quote deleted");
    } catch (e) {
      toast.error(errorText(e, "Could not delete quote"));
    }
  };

  const admin = isAdmin();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1 h-7 px-2 text-xs">
            <Link to="/product-library">
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Product Library
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Saved Quotes</h1>
          <p className="text-sm text-muted-foreground">
            {admin ? "All quotations saved by the team." : "Quotations you have saved."} Linked quotes
            move the lead's deal to “Quote sent” once marked sent.
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <ShoppingCart className="w-4 h-4 mr-1" /> Current quote
          {count > 0 && <Badge className="ml-2">{count}</Badge>}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Quote number, customer, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as "all" | QuoteStatus)}>
          <SelectTrigger className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {QUOTE_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {rows.length ? "No quotes match." : "No saved quotes yet. Save or download a quote from the Product Library."}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((q) => {
            const own = q.created_by === user?.id;
            const canEdit = own || admin;
            return (
              <Card key={q.id} className={meta.quoteId === q.id ? "border-primary" : undefined}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{q.customer_name || "No customer name"}</p>
                      <p className="text-xs text-muted-foreground">
                        {q.quote_number} · {formatDate(q.created_at)}
                        {q.customer_phone ? ` · ${q.customer_phone}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold">{money(q.grand_total)}</p>
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[q.status]}`}>
                        {QUOTE_STATUSES.find((s) => s.value === q.status)?.label}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {q.leadText ? (
                      <span className="flex items-center gap-1 text-primary">
                        <Link2 className="w-3.5 h-3.5" /> {q.leadText}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Link2 className="w-3.5 h-3.5" /> No lead linked
                      </span>
                    )}
                    {admin && q.ownerName && (
                      <span className="flex items-center gap-1">
                        <UserRound className="w-3.5 h-3.5" /> {q.ownerName}
                      </span>
                    )}
                    {q.sent_at && <span>Sent {formatDate(q.sent_at)}</span>}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {canEdit && (
                      <Select value={q.status} onValueChange={(v) => void changeStatus(q, v as QuoteStatus)}>
                        <SelectTrigger className="h-8 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {QUOTE_STATUSES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={busyId === q.id}
                        onClick={() => void openForEdit(q)}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" /> Open
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={busyId === q.id}
                      onClick={() => void download(q, "pdf")}
                    >
                      {busyId === q.id ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5 mr-1" />
                      )}
                      PDF
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={busyId === q.id}
                      onClick={() => void download(q, "excel")}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
                      Excel
                    </Button>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 ml-auto text-destructive"
                        onClick={() => void remove(q)}
                        title="Delete quote"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <QuoteDrawer />
    </div>
  );
};

export default SavedQuotes;
