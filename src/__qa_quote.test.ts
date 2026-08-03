import { test, mock } from "bun:test";
mock.module("@/lib/productLibrary", () => ({
  BUCKET_IMAGES: "product-images",
  resolveUrl: async () => null,
}));
const { buildQuoteWorkbook } = await import("@/lib/quoteExcel");
test("build", async () => {
  const lines = [
    { image_url: null, product_name: "Godrej Table T-09", sku: "56101519SD01125", unit_price: 27656, discount_percent: 0, gst_percent: 18, quantity: 1 },
    { image_url: null, product_name: "Godrej Bravo High Back Chair", sku: "56101522SD04776", unit_price: 12953, discount_percent: 5, gst_percent: 18, quantity: 4 },
  ];
  const wb = await buildQuoteWorkbook(lines, { customerName: "ABC Pvt Ltd", billingAddress: "12 Rajpur Road, Dehradun", deliveryAddress: "Same as billing", quoteNumber: "HDE/Dehradun/2026-27/008", quoteDate: "03/08/2026", handlingCharges: 20000, contactLine: "CONTACT: 9917233664 / SACHIN DHINGRA" });
  await wb.xlsx.writeFile("/tmp/qa/out.xlsx");
});
