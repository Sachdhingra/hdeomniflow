import { Textarea } from "@/components/ui/textarea";
import { useQuote } from "@/contexts/QuoteContext";
import {
  X3_LAYOUTS,
  isX3QuoteLine,
  x3PhotoLine,
  x3UnitNumbers,
  type X3UnitInfo,
} from "@/lib/kreationX3Quote";
import QuoteLineImage from "./QuoteLineImage";

export type CopyType = "internal" | "customer";

const EMPTY_UNIT: X3UnitInfo = { layout: null, dimensions: "" };

/**
 * Shown on a quotation that has Kreation X3 items. Internal copy: every part with its item
 * code. Customer copy: one line per Kreation unit, each with its layout name, the dimensions
 * covered, a photo and one price, with no codes. Sales set the layout, edit the dimensions and
 * add the photo of each unit before sharing.
 */
const KreationLayoutCard = ({ copyType, onCopyType }: { copyType: CopyType; onCopyType: (t: CopyType) => void }) => {
  const { items, meta, setMeta } = useQuote();
  if (!items.some(isX3QuoteLine)) return null;
  const unitNos = x3UnitNumbers(items);
  const many = unitNos.length > 1;
  const customer = copyType === "customer";

  const patchUnit = (n: number, patch: Partial<X3UnitInfo>) =>
    setMeta({ x3Units: { ...meta.x3Units, [n]: { ...(meta.x3Units[n] ?? EMPTY_UNIT), ...patch } } });

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">
          Kreation X3 quote{many ? ` · ${unitNos.length} units` : ""}
        </p>
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

      {!customer ? (
        <p className="text-[11px] text-muted-foreground">
          The internal copy lists every part with its item code{many ? " and its unit number" : ""}. Switch to Customer
          copy to share with the customer.
        </p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            The customer copy shows {many ? "each unit's" : "the"} layout, dimensions, photo and one price. No item codes
            or parts list. PDF, Excel and Share use this copy.
          </p>
          {unitNos.map((n) => {
            const info = meta.x3Units[n] ?? EMPTY_UNIT;
            const photoLine = x3PhotoLine(items, n);
            const idBase = `x3-unit-${n}`;
            return (
              <fieldset key={n} className="space-y-2 rounded-md border bg-background p-2">
                {many && <legend className="px-1 text-xs font-semibold">Unit {n}</legend>}
                <div role="radiogroup" aria-label={`Kreation layout${many ? ` for unit ${n}` : ""}`} className="grid grid-cols-2 gap-1.5">
                  {X3_LAYOUTS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      role="radio"
                      aria-checked={info.layout === l.id}
                      onClick={() => patchUnit(n, { layout: l.id })}
                      className={`min-h-10 rounded-md border px-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        info.layout === l.id
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
                    <label htmlFor={`${idBase}-dimensions`} className="text-[11px] font-medium">
                      Dimensions covered
                    </label>
                    <Textarea
                      id={`${idBase}-dimensions`}
                      rows={3}
                      value={info.dimensions}
                      onChange={(e) => patchUnit(n, { dimensions: e.target.value })}
                      placeholder="e.g. Wall A 8 ft + Wall B 6 ft, height 2500 mm"
                      className="text-xs"
                    />
                  </div>
                </div>
                {(!info.layout || !info.dimensions.trim()) && (
                  <p className="rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-900">
                    {!info.layout ? "Choose the layout" : "Add the dimensions covered"}
                    {many ? ` for unit ${n}` : ""} before you share this copy.
                  </p>
                )}
              </fieldset>
            );
          })}
        </>
      )}
    </div>
  );
};

export default KreationLayoutCard;
