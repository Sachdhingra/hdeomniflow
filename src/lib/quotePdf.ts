import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { priceBreakdown } from "@/lib/productLibrary";
import {
  FOOTER_LINES,
  INTRO_BODY,
  NOTE,
  QUOTE_SUBJECT,
  TERMS,
  deliveryText,
  fetchImage,
  type QuoteExcelLine,
  type QuoteExcelMeta,
} from "@/lib/quoteExcel";

/**
 * Quotation PDF on the HDE letterhead. Every page carries the letterhead unchanged
 * (public/quote/letterhead.jpg: the Canva "Letter Head - HDE" PDF rendered at 250 dpi),
 * and all quote content stays inside its writing area.
 */
export const LETTERHEAD_URL = "/quote/letterhead.jpg";

// A4 in points, matching the letterhead (595.5 x 842.25 pt).
const PAGE_W = 595.5;
const PAGE_H = 842.25;
// Writing area, measured from the letterhead: the header rule runs x 22-575 at
// y 161-165, and the footer artwork starts at y 754.
export const AREA = { left: 22, right: 575, top: 180, bottom: 740 } as const;
const WIDTH = AREA.right - AREA.left;

const MAROON: [number, number, number] = [112, 38, 50];
const GREY_FILL: [number, number, number] = [242, 242, 242];
const IMG_W = 62;
const IMG_H = 50;

export interface QuotePdfAssets {
  /** Letterhead as a JPEG data URL; null draws plain pages (e.g. if it failed to load). */
  letterhead: string | null;
  /** Per line: product photo as a JPEG data URL, or null. */
  images: (string | null)[];
}

const amount = (n: number) =>
  Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildQuotePdf(lines: QuoteExcelLine[], meta: QuoteExcelMeta, assets: QuotePdfAssets) {
  const doc = new jsPDF({ unit: "pt", format: [PAGE_W, PAGE_H], compress: true });
  const decorated = new Set<number>();

  const decorate = () => {
    const page = doc.getCurrentPageInfo().pageNumber;
    if (decorated.has(page)) return;
    decorated.add(page);
    if (assets.letterhead) {
      // Same alias on every page, so the image is stored in the file only once.
      doc.addImage(assets.letterhead, "JPEG", 0, 0, PAGE_W, PAGE_H, "hde-letterhead", "FAST");
    }
  };
  const newPage = () => {
    doc.addPage([PAGE_W, PAGE_H]);
    decorate();
    return AREA.top as number;
  };

  /** Wrapped text that continues on a new letterhead page when it reaches the footer. */
  const write = (
    text: string,
    y: number,
    opts: { size?: number; bold?: boolean; gap?: number; color?: [number, number, number] } = {},
  ) => {
    const size = opts.size ?? 9;
    const lineH = size * 1.3;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? [0, 0, 0]));
    for (const para of text.split("\n")) {
      const wrapped: string[] = para.trim() ? doc.splitTextToSize(para.trim(), WIDTH) : [""];
      for (const line of wrapped) {
        if (y + lineH > AREA.bottom) y = newPage();
        doc.text(line, AREA.left, y + size);
        y += lineH;
      }
    }
    doc.setTextColor(0, 0, 0);
    return y + (opts.gap ?? 6);
  };

  decorate();
  let y: number = AREA.top;

  // Quote number and date, right-aligned under the letterhead rule.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`Quotation No: ${meta.quoteNumber}`, AREA.right, y + 9, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text(`Date: ${meta.quoteDate}`, AREA.right, y + 21, { align: "right" });

  y = write("To,", y, { gap: 0 });
  y = write(meta.customerName || "", y, { bold: true, gap: 8 });
  y = write(QUOTE_SUBJECT.replace(" :", ": "), y, { bold: true, size: 10, gap: 8, color: MAROON });
  y = write(INTRO_BODY, y, { size: 8.5, gap: 10 });

  // Customer details.
  autoTable(doc, {
    startY: y,
    margin: { left: AREA.left, right: PAGE_W - AREA.right, top: AREA.top, bottom: PAGE_H - AREA.bottom },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 4, lineColor: [0, 0, 0], lineWidth: 0.4, textColor: [0, 0, 0], fillColor: false },
    columnStyles: { 0: { cellWidth: WIDTH / 2 }, 1: { cellWidth: WIDTH / 2 } },
    body: [[`Billing address:\n${meta.billingAddress || "-"}`, `Delivery address:\n${meta.deliveryAddress || "-"}`]],
    willDrawPage: decorate,
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Products. Columns follow the Excel quote; prices work back from the GST-inclusive price.
  const gstHeader = lines.length && lines.every((l) => l.gst_percent === lines[0].gst_percent)
    ? `GST ${lines[0].gst_percent}%`
    : "GST";
  const body = lines.map((l, idx) => {
    const b = priceBreakdown(l.unit_price, l.gst_percent, l.discount_percent || 0);
    return [
      String(idx + 1),
      "",
      `${(l.product_name || "").toUpperCase()}${l.sku ? `\n${l.sku}` : ""}${l.discount_percent ? `\nDiscount ${l.discount_percent}%` : ""}`,
      amount(b.unitBasic),
      amount(b.specialBasic),
      amount(b.unitGst),
      amount(b.unitInclusive),
      String(l.quantity),
      amount(b.unitInclusive * l.quantity),
    ];
  });
  const itemsTotal = lines.reduce(
    (s, l) => s + priceBreakdown(l.unit_price, l.gst_percent, l.discount_percent || 0).unitInclusive * l.quantity,
    0,
  );
  const foot: string[][] = [];
  if (meta.handlingCharges > 0) {
    foot.push(["", "", "Outstation handling / packaging charges to destination (incl. GST)", "", "", "", "", "", amount(meta.handlingCharges)]);
  }
  foot.push(["", "", "TOTAL PRICE in INR (All Inclusive)", "", "", "", "", "", amount(itemsTotal + (meta.handlingCharges || 0))]);

  autoTable(doc, {
    startY: y,
    margin: { left: AREA.left, right: PAGE_W - AREA.right, top: AREA.top, bottom: PAGE_H - AREA.bottom },
    theme: "grid",
    rowPageBreak: "avoid",
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 3,
      lineColor: [0, 0, 0],
      lineWidth: 0.4,
      textColor: [0, 0, 0],
      // Transparent cells, so the letterhead (and its watermark) shows through unchanged.
      fillColor: false,
      valign: "middle",
      halign: "right",
    },
    headStyles: { fillColor: GREY_FILL, fontStyle: "bold", halign: "center", fontSize: 7 },
    footStyles: { fillColor: [255, 242, 204], fontStyle: "bold", textColor: [0, 0, 0], fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 24, halign: "center" },
      1: { cellWidth: IMG_W + 6, minCellHeight: IMG_H + 6 },
      2: { cellWidth: 148, halign: "left" },
      3: { cellWidth: 55 },
      4: { cellWidth: 55 },
      5: { cellWidth: 50 },
      6: { cellWidth: 57 },
      7: { cellWidth: 28, halign: "center" },
      8: { cellWidth: WIDTH - (24 + IMG_W + 6 + 148 + 55 + 55 + 50 + 57 + 28) },
    },
    head: [[
      "SR.\nNO",
      "REF. IMAGE",
      "GODREJ PRODUCT",
      "UNIT PRICE\n(EXCL. GST)",
      "SPECIAL PRICE\n(EXCL. GST)",
      gstHeader,
      "UNIT PRICE\n(GST INCL.)",
      "QTY",
      "TOTAL PRICE\n(ALL INCL.)",
    ]],
    body,
    foot,
    showFoot: "lastPage",
    didParseCell: (data) => {
      if (data.section === "foot" && data.column.index === 2) {
        data.cell.colSpan = 6;
        data.cell.styles.halign = "left";
      }
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 1) return;
      const img = assets.images[data.row.index];
      if (!img) return;
      try {
        const props = doc.getImageProperties(img);
        const scale = Math.min(IMG_W / props.width, IMG_H / props.height);
        const w = props.width * scale;
        const h = props.height * scale;
        doc.addImage(
          img,
          "JPEG",
          data.cell.x + (data.cell.width - w) / 2,
          data.cell.y + (data.cell.height - h) / 2,
          w,
          h,
          undefined,
          "FAST",
        );
      } catch {
        /* unreadable photo: leave the cell empty */
      }
    },
    willDrawPage: decorate,
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  // Notes and commercial terms, as in the Excel quote.
  y = write(NOTE, y, { size: 8, gap: 10 });
  FOOTER_LINES.forEach((line, i) => {
    const text = i === 2 ? deliveryText(meta.contactLine) : line;
    if (!text) return;
    const [label, ...rest] = text.split(" : ");
    if (rest.length && label.length < 30 && !text.includes("\n")) {
      // "Label : value" lines: bold label.
      if (y + 11 > AREA.bottom) y = newPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      const head = `${label.trim()} : `;
      doc.text(head, AREA.left, y + 8);
      const indent = doc.getTextWidth(head);
      doc.setFont("helvetica", "normal");
      const wrapped: string[] = doc.splitTextToSize(rest.join(" : "), WIDTH - indent);
      wrapped.forEach((w, k) => {
        if (k > 0 && y + 10.4 > AREA.bottom) y = newPage();
        doc.text(w, AREA.left + indent, y + 8);
        y += 10.4;
      });
      y += 4;
    } else {
      y = write(text, y, { size: 8, gap: 4 });
    }
  });

  // Terms and conditions on their own letterhead page(s).
  y = newPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...MAROON);
  doc.text("TERMS AND CONDITIONS", PAGE_W / 2, y + 11, { align: "center" });
  doc.setTextColor(0, 0, 0);
  y += 22;
  TERMS.forEach((t, i) => {
    y = write(`${i + 1}. ${t}`, y, { size: 7.5, gap: 6 });
  });

  // Page numbers inside the writing area, clear of the letterhead artwork.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(90, 90, 90);
    doc.text(`${meta.quoteNumber} · Page ${p} of ${pages}`, AREA.right, AREA.bottom + 8, { align: "right" });
  }
  doc.setTextColor(0, 0, 0);
  return doc;
}

/** Any image (JPEG, PNG, WebP…) → small white-backed JPEG data URL jsPDF can embed. */
async function toJpegDataUrl(base64: string, mime: string, maxSide = 360): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = `data:${mime};base64,${base64}`;
  });
}

async function loadLetterhead(): Promise<string | null> {
  try {
    const res = await fetch(LETTERHEAD_URL);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function downloadQuotePdf(lines: QuoteExcelLine[], meta: QuoteExcelMeta) {
  const [letterhead, images] = await Promise.all([
    loadLetterhead(),
    Promise.all(
      lines.map(async (l) => {
        const img = await fetchImage(l.image_url);
        return img ? toJpegDataUrl(img.base64, img.ext === "png" ? "image/png" : "image/jpeg") : null;
      }),
    ),
  ]);
  if (!letterhead) throw new Error("Could not load the letterhead");
  const doc = buildQuotePdf(lines, meta, { letterhead, images });
  doc.save(`${meta.quoteNumber.replace(/[^\w-]+/g, "_") || "Quotation"}.pdf`);
}
