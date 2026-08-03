import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Save, Share2, FileText, FileSpreadsheet } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { downloadQuoteExcel } from "@/lib/quoteExcel";
import { useQuote } from "@/contexts/QuoteContext";
import { money, lineTotal, plDb } from "@/lib/productLibrary";
import StorageImage from "./StorageImage";
import { toast } from "sonner";

const QuoteDrawer = () => {
  const { items, open, setOpen, updateItem, removeItem, clear, subtotal, gstTotal, grandTotal } =
    useQuote();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [handlingCharges, setHandlingCharges] = useState(0);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const quoteNumber = useMemo(() => {
    const d = new Date();
    const fy = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
    const seq = String(Math.floor(d.getTime() / 1000) % 1000).padStart(3, "0");
    return `HDE/Dehradun/${fy}-${String((fy + 1) % 100).padStart(2, "0")}/${seq}`;
  }, [open]);

  const exportExcel = async () => {
    if (!items.length) return;
    setExporting(true);
    try {
      await downloadQuoteExcel(
        items.map((i) => ({
          image_url: i.image_url,
          product_name: i.product_name,
          sku: i.sku,
          unit_price: i.unit_price,
          discount_percent: i.discount_percent || 0,
          gst_percent: i.gst_percent,
          quantity: i.quantity,
        })),
        {
          customerName,
          billingAddress,
          deliveryAddress,
          quoteNumber,
          quoteDate: new Date().toLocaleDateString("en-GB"),
          handlingCharges: Number(handlingCharges) || 0,
          contactLine: "CONTACT: 9917233664 / SACHIN DHINGRA / EMAIL: SACHDHINGRA@GMAIL.COM",
        },
      );
      toast.success("Quotation downloaded");
    } catch (e: any) {
      toast.error(e.message || "Could not generate Excel");
    } finally {
      setExporting(false);
    }
  };

  const saveQuote = async () => {
    if (!items.length) return;
    setSaving(true);
    try {
      const { data: quote, error } = await plDb
        .from("quotes")
        .insert({ customer_name: customerName || null, customer_phone: customerPhone || null })
        .select("id")
        .single();
      if (error) throw error;
      const rows = items.map((i, idx) => ({
        quote_id: quote.id,
        product_id: i.product_id,
        variant_id: i.variant_id,
        image_url: i.image_url,
        product_name: i.product_name,
        sku: i.sku,
        description: i.description,
        quantity: i.quantity,
        unit_price: i.unit_price,
        gst_percent: i.gst_percent,
        total: lineTotal(i.quantity, i.unit_price, i.gst_percent),
        sort_order: idx,
      }));
      const { error: itemErr } = await plDb.from("quote_items").insert(rows);
      if (itemErr) throw itemErr;
      toast.success("Quote saved");
      clear();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Could not save quote");
    } finally {
      setSaving(false);
    }
  };

  const shareQuote = async () => {
    const text = [
      "Home Decor Enterprises — Quotation",
      ...items.map(
        (i) =>
          `• ${i.product_name} (${i.sku || "-"}) x${i.quantity} @ ${money(i.unit_price)} + ${i.gst_percent}% GST = ${money(lineTotal(i.quantity, i.unit_price, i.gst_percent))}`,
      ),
      `Subtotal: ${money(subtotal)}`,
      `GST: ${money(gstTotal)}`,
      `Total: ${money(grandTotal)}`,
    ].join("\n");
    if (navigator.share) {
      try {
        await navigator.share({ title: "Quotation", text });
        return;
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard.writeText(text);
    toast.success("Quote copied to clipboard");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Quotation
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-2 py-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Customer name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
            <Input
              placeholder="Phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea
              placeholder="Billing address"
              rows={2}
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              className="text-xs"
            />
            <Textarea
              placeholder="Delivery address"
              rows={2}
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              className="text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 items-center">
            <span className="text-xs text-muted-foreground">Handling / packaging (incl. GST)</span>
            <Input
              type="number"
              value={handlingCharges}
              onChange={(e) => setHandlingCharges(Number(e.target.value) || 0)}
              className="h-8 text-xs"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">Quote No: {quoteNumber}</p>
        </div>

        <ScrollArea className="flex-1 -mx-2 px-2">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground py-10 text-center">
              No products added yet. Use “Add to Quote” from the Product Library.
            </p>
          )}
          <div className="space-y-3">
            {items.map((i) => (
              <div key={i.id} className="flex gap-3 rounded-lg border p-2">
                <StorageImage
                  path={i.image_url}
                  alt={i.product_name}
                  className="w-16 h-16 rounded object-cover shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{i.product_name}</p>
                      <p className="text-xs text-muted-foreground">{i.sku}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeItem(i.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    <Input
                      type="number"
                      min={1}
                      value={i.quantity}
                      onChange={(e) =>
                        updateItem(i.id, { quantity: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      value={i.unit_price}
                      onChange={(e) => updateItem(i.id, { unit_price: Number(e.target.value) || 0 })}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      value={i.gst_percent}
                      onChange={(e) => updateItem(i.id, { gst_percent: Number(e.target.value) || 0 })}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      placeholder="Disc %"
                      value={i.discount_percent ?? 0}
                      onChange={(e) =>
                        updateItem(i.id, { discount_percent: Number(e.target.value) || 0 })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <p className="text-xs text-right font-semibold">
                    {money(lineTotal(i.quantity, i.unit_price, i.gst_percent))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="pt-3 space-y-1 text-sm">
          <Separator className="mb-2" />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{money(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">GST</span>
            <span>{money(gstTotal)}</span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span>{money(grandTotal)}</span>
          </div>
          <div className="flex gap-2 pt-3">
            <Button className="flex-1" onClick={saveQuote} disabled={!items.length || saving}>
              <Save className="w-4 h-4 mr-1" /> Save
            </Button>
            <Button variant="outline" onClick={exportExcel} disabled={!items.length || exporting}>
              <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="icon" onClick={shareQuote} disabled={!items.length}>
              <Share2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default QuoteDrawer;
