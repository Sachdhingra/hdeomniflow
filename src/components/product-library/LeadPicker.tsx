import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Link2, Loader2, UserRound, X } from "lucide-react";
import { searchLeads, leadLabel, type LeadOption } from "@/lib/savedQuotes";
import { toast } from "@/lib/toast";

interface Props {
  leadId: string | null;
  label: string | null;
  onChange: (lead: LeadOption | null) => void;
}

/** Link the quote to one of the user's leads (searched by customer name or phone). */
const LeadPicker = ({ leadId, label, onChange }: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await searchLeads(query));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Lead search failed");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  if (leadId) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
        <Link2 className="w-4 h-4 text-primary shrink-0" />
        <span className="flex-1 truncate">Lead: {label || "Linked lead"}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Unlink lead"
          onClick={() => onChange(null)}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start text-muted-foreground font-normal">
          <Link2 className="w-4 h-4 mr-2 shrink-0" /> Link to a lead (optional)…
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Customer name or phone…" value={query} onValueChange={setQuery} />
          <CommandList>
            {loading && (
              <div className="py-6 flex justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && <CommandEmpty>No matching leads.</CommandEmpty>}
            <CommandGroup>
              {results.map((l) => (
                <CommandItem
                  key={l.id}
                  value={l.id}
                  onSelect={() => {
                    onChange(l);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex items-center gap-2"
                >
                  <UserRound className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{leadLabel(l)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default LeadPicker;
