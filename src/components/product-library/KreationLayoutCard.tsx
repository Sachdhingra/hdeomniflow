import { Textarea } from "@/components/ui/textarea";
import { useQuote } from "@/contexts/QuoteContext";
import { X3_LAYOUTS, isX3QuoteLine, x3PhotoLine } from "@/lib/kreationX3Quote";
import QuoteLineImage from "./QuoteLineImage";

export type CopyType = "internal" | "customer";

/**
 * Shown on a quotation that has Kreation X3 items. Internal copy: every part with its item
 * code. Customer copy: one line named after the layout, the dimensions covered and one price,
 * with no codes. Sales set the layout, edit the dimensions and add the photo before sharing.
 */
const KreationLayoutCard = ({ copyType, onCopyType }: { copyType: CopyType; onCopyType: (t: CopyType) => void }) => {
  const { items, meta, setMeta } = useQuote();
  if (!items.some(isX3QuoteLine)) return null;
  const photoLine = x3PhotoLine(items);
  const customer = copyType === "customer";

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Kreation X3 quote</p>
        <div role="group" aria-label="Quote copy" className="flex rounded-md border bg-background p-0.5 text-xs">
          {(
            [
              ["internal", "Internal (with codes)"],
              ["customer", "Customer copy"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={copyType === id}
              onClick={() => onCopyType(id)}
              className={`min-h-8 rounded px-2 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                copyType === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {customer ? (
        <>
          <p className="text-[11px] text-muted-foreground">
            The customer copy shows the layout, dimensions, photo and one price. No item codes or parts list.
            PDF, Excel and Share use this copy.
          </p>
          <div role="radiogroup" aria-label="Kreation layout" className="grid grid-cols-2 gap-1.5">
            {X3_LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={meta.x3Layout === l.id}
                onClick={() => setMeta({ x3Layout: l.id })}
                className={`min-h-10 rounded-md border px-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  meta.x3Layout === l.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:border-primary/50"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {photoLine && <QuoteLineImage line={photoLine} />}
            <div className="min-w-0 flex-1 space-y-1">
              <label htmlFor="x3-dimensions" className="text-[11px] font-medium">
                Dimensions covered
              </label>
              <Textarea
                id="x3-dimensions"
                rows={3}
                value={meta.x3Dimensions}
                onChange={(e) => setMeta({ x3Dimensions: e.target.value })}
                placeholder="e.g. Wall A 8 ft + Wall B 6 ft, height 2500 mm"
                className="text-xs"
              />
            </div>
          </div>
          {(!meta.x3Layout || !meta.x3Dimensions.trim()) && (
            <p className="rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-900">
              {!meta.x3Layout ? "Choose the layout" : "Add the dimensions covered"} before you share this copy.
            </p>
          )}
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          The internal copy lists every part with its item code. Switch to Customer copy to share with the customer.
        </p>
      )}
    </div>
  );
};

export default KreationLayoutCard;
