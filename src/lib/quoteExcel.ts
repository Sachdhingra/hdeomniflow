import ExcelJS from "exceljs";
import { BUCKET_IMAGES, resolveUrl } from "@/lib/productLibrary";

export interface QuoteExcelLine {
  image_url: string | null;
  product_name: string;
  sku: string | null;
  unit_price: number; // list / unit price before discount
  discount_percent: number; // special price discount
  gst_percent: number;
  quantity: number;
}

export interface QuoteExcelMeta {
  customerName: string;
  billingAddress: string;
  deliveryAddress: string;
  quoteNumber: string;
  quoteDate: string;
  handlingCharges: number;
  contactLine: string;
}

const INTRO = `To,
{{NAME}}

SUBJECT :QUOTE FOR GODREJ FURNITURE 

A workplace should be invigorating, inspiring and engaging. 
At Godrej Interio, we specialize in offering workspace solutions that are aesthetically pleasant as they are functionally efficient. We offer all this through a wide range of products that are designed to optimize space and increase convenience through thoughtful features and technological innovations. From seating, desking, storages to modular work stations and lab / healthcare, security — our furniture doesn't just make workplaces, it transforms them.
As a market leader in the country, we bring to you reliable processes in design-development, manufacturing, marketing, and service to ensure excellence in products and services in line with your expectations that will give you lasting value over time. 

We are pleased to offer you our quote as below.`;

const NOTE = `Note:-
1. The Images Provided in the Quotation are Indicative.
2. The delivery of the products will happen from one or more of the manufacturing locations viz. Bhagwanpur, Shriwal, Haridwar and Mumbai. 
3. Our products are packed and delivered in 'knocked down' condition to avoid damage during transportation. Kindly ensure the payment is released on receipt of goods in knocked down condition at respective location/s mentioned in the PO. (applicable where payment is against delivery)
4. Payment should be released if products cannot be delivered due to installation site not being ready and material has to be kept at site in packed condition or at Godrej w/h till site is made suitable for installation (applicable where payment is on installation)`;

const TERMS: string[] = [
  `Prices : Unit prices stated are FOR Destination (within the municipal limits of the branch or dealer town, till ground floor of the premises) in India in Indian Rupees (Rs.) and Inclusive of GST. Prices quoted are for the standard range of finishes. Should there be any change in government levies between acceptance of the contract and delivery, the changed levies [duties & taxes] applicable at time of delivery shall be binding on the client.

Delivery: The delivery at site will be effected within 6-8 weeks from the date of technically and commercially clear purchase order which includes receipt of approved colour schemes from our standard range and fulfilling the agreed payment terms. Any change in selection of product or quantity may impact the committed delivery time. Partial deliveries may be made. Each partial delivery may be invoiced separately. The delivery of Furniture / Workstation(s) shall be made from our warehouses in unassembled / assembled form to be assembled at site. The Company will not incur any obligation or liability for failure to deliver by specified date unless it has committed to an agreed ex-factory date in a separately signed document executed by its authorized personnel.`,
  `Payment Terms: The amount considered as paid shall be that which is actually credited to our account in the bank. Payments should be made either by "A/c Payee" cheque or NEFT / Demand Drafts in favour of the authorized dealer, payable at the respective branch. Should any payment instalment be delayed, interest on arrears shall be automatically charged at the rate of 1.5% per month. Should payment be delayed beyond 2 weeks, or should there be justified doubts about the solvency of the client, we are entitled to revoke all credit and to withdraw from any as yet unfulfilled part of the contract, or to call for full balance payment in advance. In case of any delay in making payments as per agreed milestones, warehousing charges / inventory holding cost at 2% of the contract value per month will be charged on a pro-rata basis.`,
  `Validity: Prices & delivery period quoted are valid for acceptance within the validity period stated in this offer. In case the finalization of order is deferred by the client beyond the validity period, reconfirmation of price & delivery period will be required.

Confirmation of Order: Customer can confirm the order by attaching a copy of this quotation to their Purchase Order or by referring to the Quotation Number and Date in their communication. Orders will be deemed accepted only on fulfilment of the payment terms offered in the quotation and realization of the payment in our bank. Orders once placed cannot ordinarily be cancelled. Order cancellations if any shall result in forfeit of any advance payment.

Tax Deductions: This offer is made under a Sales Contract. GST will be charged in each invoice as applicable and no deduction at source of Income Tax or Works Contract Tax is permitted.`,
  `Transit Insurance: Since our prices are FOR destination, all transit risk for damages of the goods en-route shall be on our account. However, if goods en-route are detained by any statutory or check post authority due to improper road permit / way bill / declaration given by the client, then the client shall be responsible for such delays, for the charges levied by such authority and also for detention charges payable to the transporters.

Material Handling and Storage at Site: The client will provide adequate space for unloading and storage of material at the site with requisite security arrangements. For safe handling of material a lift is essential for carrying material to higher floors. If between delivery of items at site and use, any damage or loss is caused to the material by any other contractor/supplier employed by the client, the cost of replacement/rectification will be borne by the client.`,
  `Ownership: The title of goods supplied will pass on to the client as soon as the goods are delivered at the client's site. The goods are covered under transit insurance till delivery at the client's site. Any subsequent insurance coverage will be the client's responsibility. However, we will have a lien on the goods supplied by us until the client has fulfilled the financial obligations arising out of the sales contract.`,
  `Warranty: All Godrej products are offered with a warranty of ONE YEAR from the date of purchase by the original purchaser against manufacturing defects. Any defect must be notified to the company in writing as soon as it is noticed. Detailed description and proof of faults or defects must be supplied either in photo or electronic file format for investigation. The decision to repair/replace any piece of furniture will be at the sole discretion of the Company based on the report submitted by the Company's service representative.`,
  `Installation: Installation of the products is included in the price unless otherwise stated. The client shall provide a clear, ready and safe site along with power supply for installation. Any idle time or repeat visits caused by site unreadiness will be charged extra.`,
  `Force Majeure: The Company shall not be liable for any delay or failure in performance arising out of causes beyond its reasonable control including but not limited to acts of God, strikes, lockouts, fire, flood, epidemic, war, riot, or restrictions imposed by any government authority.`,
  `Jurisdiction: All disputes arising out of this contract shall be subject to the exclusive jurisdiction of the courts at Dehradun, Uttarakhand.`,
  `Acceptance: Placement of a Purchase Order against this quotation shall be deemed as acceptance of all the terms and conditions stated herein.`,
];

const FOOTER_LINES = [
  "Rates : The rates mentioned are inclusive of GST.",
  "Validity : Offer valid for 30 days.",
  "", // delivery block placeholder
  "Payment : 100% Advance payment along with PO.",
  "Order Placement :  Authorized Dealer of Godrej — Home Decor Enterprises",
  "Warranty : One Year from the date of supply/installation against any manufacturing defect. AMC (Annual Maintenance Contract) available post warranty period.",
  "BANK DETAILS : HDFC BANK LTD. A/C# 50200081341475, RAJPUR ROAD, DEHRADUN-248001. IFSC CODE: HDFC0000225",
];

const THIN = { style: "thin" as const, color: { argb: "FF000000" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

async function fetchImage(path: string | null): Promise<{ base64: string; ext: "png" | "jpeg" } | null> {
  try {
    const url = await resolveUrl(BUCKET_IMAGES, path);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const buf = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return {
      base64: btoa(binary),
      ext: blob.type.includes("png") ? "png" : "jpeg",
    };
  } catch {
    return null;
  }
}

export async function buildQuoteWorkbook(lines: QuoteExcelLine[], meta: QuoteExcelMeta) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Home Decor Enterprises";
  const ws = wb.addWorksheet("Quote", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });

  const widths: Record<string, number> = {
    A: 3, B: 12.57, C: 30, D: 46, E: 2, F: 14, G: 14, H: 12, I: 14, J: 8, K: 18,
  };
  Object.entries(widths).forEach(([col, w]) => (ws.getColumn(col).width = w));

  const base = { name: "Arial", size: 10 };

  // Intro block (rows 5-6)
  ws.mergeCells("B5:K5");
  const intro = ws.getCell("B5");
  intro.value = INTRO.replace("{{NAME}}", meta.customerName || "PLS INSERT NAME");
  intro.alignment = { wrapText: true, vertical: "top" };
  intro.font = base;
  ws.getRow(5).height = 210;

  // Customer / quote meta
  ws.mergeCells("B7:F7");
  ws.getCell("B7").value = `Customer name : ${meta.customerName || ""}`;
  ws.mergeCells("H7:K7");
  ws.getCell("H7").value = `Quotation Number : ${meta.quoteNumber}`;

  ws.mergeCells("B8:C8");
  ws.getCell("B8").value = `Billing Address : ${meta.billingAddress || ""}`;
  ws.mergeCells("D8:F8");
  ws.getCell("D8").value = `Delivery Address : ${meta.deliveryAddress || ""}`;
  ws.mergeCells("H8:K8");
  ws.getCell("H8").value = meta.quoteDate;
  [7, 8].forEach((r) => {
    ws.getRow(r).height = 34;
    ws.getRow(r).eachCell((c) => {
      c.font = { ...base, bold: true };
      c.alignment = { wrapText: true, vertical: "top" };
    });
  });

  // Header rows 9-10
  const headers: [string, string][] = [
    ["B", "SR.NO"],
    ["C", " REF. IMAGE"],
    ["D", "GODREJ PRODUCT"],
    ["F", "UNIT PRICE"],
    ["G", "SPECIAL PRICE"],
    ["H", "GST PRICE"],
    ["I", "UNIT PRICE"],
    ["J", "QTY"],
    ["K", "TOTAL PRICE"],
  ];
  ["B", "C", "F", "J", "K"].forEach((c) => ws.mergeCells(`${c}9:${c}10`));
  ws.mergeCells("D9:E10");
  ws.mergeCells("G9:G10");
  headers.forEach(([col, label]) => {
    const cell = ws.getCell(`${col}9`);
    cell.value = label;
  });
  ws.getCell("H10").value = 0.18;
  ws.getCell("H10").numFmt = "0%";
  ws.getCell("I10").value = "(GST INCLUDED)";
  ws.getCell("K10").value = "(ALL INCLUSIVE)";
  [9, 10].forEach((r) => {
    ws.getRow(r).height = 22;
    for (let c = 2; c <= 11; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { ...base, bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
      cell.border = BORDER;
    }
  });

  // Item blocks — 8 rows each, matching the template
  const BLOCK = 8;
  let row = 11;
  const firstRow = row;
  for (let idx = 0; idx < lines.length; idx++) {
    const l = lines[idx];
    const top = row;
    const bottom = row + BLOCK - 1;
    for (let r = top; r <= bottom; r++) ws.getRow(r).height = 20;

    ["B", "C", "F", "G", "H", "I", "J", "K"].forEach((c) => ws.mergeCells(`${c}${top}:${c}${bottom}`));

    ws.getCell(`B${top}`).value = idx + 1;
    ws.getCell(`D${top}`).value = l.product_name?.toUpperCase() || "";
    ws.getCell(`D${top + 1}`).value = l.sku || "";
    ws.mergeCells(`D${top}:E${top}`);
    ws.mergeCells(`D${top + 1}:E${top + 1}`);
    ws.mergeCells(`D${top + 2}:E${bottom}`);

    ws.getCell(`F${top}`).value = l.unit_price;
    ws.getCell(`G${top}`).value = { formula: `F${top}-(F${top}*${(l.discount_percent || 0) / 100})` };
    ws.getCell(`H${top}`).value = { formula: `G${top}*${(l.gst_percent || 0) / 100}` };
    ws.getCell(`I${top}`).value = { formula: `G${top}+H${top}` };
    ws.getCell(`J${top}`).value = l.quantity;
    ws.getCell(`K${top}`).value = { formula: `I${top}*J${top}` };

    for (let r = top; r <= bottom; r++) {
      for (let c = 2; c <= 11; c++) {
        const cell = ws.getCell(r, c);
        cell.border = BORDER;
        cell.font = base;
        cell.alignment = { vertical: "middle", wrapText: true, horizontal: c === 4 || c === 5 ? "left" : "center" };
        if (c >= 6 && c <= 9) cell.numFmt = "#,##0.00";
        if (c === 11) cell.numFmt = "#,##0.00";
      }
    }
    ws.getCell(`D${top}`).font = { ...base, bold: true };

    const img = await fetchImage(l.image_url);
    if (img) {
      const id = wb.addImage({ base64: img.base64, extension: img.ext });
      ws.addImage(id, {
        tl: { col: 2.1, row: top - 1 + 0.15 },
        ext: { width: 190, height: 140 },
        editAs: "oneCell",
      });
    }

    row = bottom + 1;
  }

  // Handling charges
  if (meta.handlingCharges > 0) {
    ws.mergeCells(`D${row}:J${row + 1}`);
    ws.getCell(`D${row}`).value =
      "OUTSTATION HANDLING/PACKAGING CHARGES TO DESTINATION\nINCLUDING GST";
    ws.getCell(`D${row}`).alignment = { wrapText: true, vertical: "middle" };
    ws.mergeCells(`K${row}:K${row + 1}`);
    ws.getCell(`K${row}`).value = meta.handlingCharges;
    ws.getCell(`K${row}`).numFmt = "#,##0.00";
    for (let r = row; r <= row + 1; r++)
      for (let c = 2; c <= 11; c++) {
        ws.getCell(r, c).border = BORDER;
        ws.getCell(r, c).font = base;
      }
    row += 2;
  }

  // Total
  const totalRow = row;
  ws.mergeCells(`B${totalRow}:J${totalRow}`);
  ws.getCell(`B${totalRow}`).value = "TOTAL PRICE in IND ₹ ( All Inclusive)";
  ws.getCell(`K${totalRow}`).value = { formula: `SUM(K${firstRow}:K${totalRow - 1})` };
  ws.getCell(`K${totalRow}`).numFmt = "#,##0.00";
  ws.getRow(totalRow).height = 26;
  for (let c = 2; c <= 11; c++) {
    const cell = ws.getCell(totalRow, c);
    cell.font = { ...base, bold: true, size: 11 };
    cell.border = BORDER;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    cell.alignment = { vertical: "middle", horizontal: c === 11 ? "right" : "left" };
  }
  row = totalRow + 1;

  // Note block
  ws.mergeCells(`B${row}:K${row}`);
  const note = ws.getCell(`B${row}`);
  note.value = NOTE;
  note.alignment = { wrapText: true, vertical: "top" };
  note.font = base;
  ws.getRow(row).height = 110;
  row += 2;

  const delivery = `Delivery Period : Material will commence in 6-8 weeks and will be completed as per readiness of site.
${meta.contactLine}
Delivery period will start once the following details are shared with us:
1. Colour shades selected
2. Final furniture layout
3. Typical Module Drawings
4. Switch samples along with positions marked in typical module drawings
5. Electrical Layout. Any delay in sharing sign off details will affect committed delivery period. Hence request you to share these details along with PO copy wherever applicable.`;

  FOOTER_LINES.forEach((line, i) => {
    const text = i === 2 ? delivery : line;
    ws.mergeCells(`B${row}:K${row}`);
    const cell = ws.getCell(`B${row}`);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: "top" };
    cell.font = base;
    ws.getRow(row).height = i === 2 ? 120 : 20;
    row += 1;
  });

  /* ---------------- Terms sheet ---------------- */
  const tws = wb.addWorksheet("TERMS AND CONDITIONS", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });
  tws.getColumn("B").width = 4;
  tws.getColumn("C").width = 110;
  tws.mergeCells("B3:I3");
  const th = tws.getCell("B3");
  th.value = "TERMS AND CONDITIONS";
  th.font = { name: "Arial", size: 14, bold: true };
  th.alignment = { horizontal: "center" };
  tws.getRow(3).height = 28;

  TERMS.forEach((t, i) => {
    const r = 4 + i;
    tws.mergeCells(`C${r}:I${r}`);
    const cell = tws.getCell(`C${r}`);
    cell.value = t;
    cell.font = base;
    cell.alignment = { wrapText: true, vertical: "top" };
    const wrapped = t
      .split("\n")
      .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / 150)), 0);
    tws.getRow(r).height = Math.min(300, Math.max(16, wrapped * 13));
  });

  return wb;
}

export async function downloadQuoteExcel(lines: QuoteExcelLine[], meta: QuoteExcelMeta) {
  const wb = await buildQuoteWorkbook(lines, meta);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${meta.quoteNumber.replace(/[^\w-]+/g, "_") || "Quotation"}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
