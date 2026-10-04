/**
 * Inventory PDFs (prompt 16): the purchase order on the brand's legal entity, and VIN labels with a
 * Code 39 barcode (the symbology used for VIN labels; readable by handheld scanners and the phone scanner).
 */
import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { hasPermission } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { getInvDocument, isSalesView } from "./queries";

/** Code 39: each character is 9 elements (bar, space, bar …), `1` = wide. `*` is the start / stop character. */
const CODE39: Record<string, string> = {
  "0": "000110100", "1": "100100001", "2": "001100001", "3": "101100000", "4": "000110001", "5": "100110000", "6": "001110000", "7": "000100101", "8": "100100100", "9": "001100100",
  A: "100001001", B: "001001001", C: "101001000", D: "000011001", E: "100011000", F: "001011000", G: "000001101", H: "100001100", I: "001001100", J: "000011100",
  K: "100000011", L: "001000011", M: "101000010", N: "000010011", O: "100010010", P: "001010010", Q: "000000111", R: "100000110", S: "001000110", T: "000010110",
  U: "110000001", V: "011000001", W: "111000000", X: "010010001", Y: "110010000", Z: "011010000", "-": "010000101", "*": "010010100",
};

/** Bars of a Code 39 symbol as [x, width] in narrow-bar units, plus the total width. Pure. */
export function code39Bars(value: string): { bars: Array<[number, number]>; width: number } {
  const text = `*${value.toUpperCase().replace(/[^A-Z0-9-]/g, "")}*`;
  const bars: Array<[number, number]> = [];
  let x = 0;
  for (const ch of text) {
    const pattern = CODE39[ch]!;
    for (let i = 0; i < 9; i++) {
      const w = pattern[i] === "1" ? 3 : 1;
      if (i % 2 === 0) bars.push([x, w]);
      x += w;
    }
    x += 1; // inter-character gap
  }
  return { bars, width: x - 1 };
}

const ansi = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "-");

/** VIN stickers (one per unit, 3 per row on A4) for units of the caller's brands. */
export async function vinLabelsPdf(ctx: AccessContext, unitIds: string[]): Promise<Uint8Array> {
  if (!hasPermission(ctx, "inventory", "read") || isSalesView(ctx)) throw new ForbiddenError("You cannot print stock labels");
  const units = await scopedDb(ctx).vehicleUnit.findMany({ where: { id: { in: unitIds.slice(0, 300) } }, include: { product: { select: { name: true } } }, orderBy: { vin: "asc" } });
  if (units.length === 0) throw new NotFoundError();
  const brands = await scopedDb(ctx).brand.findMany({ select: { id: true, code: true } });
  const pdf = await PDFDocument.create();
  pdf.setTitle("VIN labels");
  pdf.setCreator("StallionCRM");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H, M, cols, rows] = [595.28, 841.89, 28, 2, 7];
  const cw = (W - 2 * M) / cols;
  const ch = (H - 2 * M) / rows;
  let page = pdf.addPage([W, H]);
  units.forEach((u, i) => {
    const slot = i % (cols * rows);
    if (i > 0 && slot === 0) page = pdf.addPage([W, H]);
    const x = M + (slot % cols) * cw;
    const y = H - M - Math.floor(slot / cols) * ch;
    page.drawRectangle({ x: x + 4, y: y - ch + 4, width: cw - 8, height: ch - 8, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
    page.drawText(ansi(`${brands.find((b) => b.id === u.brandId)?.code ?? ""}  ${u.product.name}`).slice(0, 48), { x: x + 12, y: y - 22, size: 9, font: bold });
    page.drawText(ansi([u.colour, u.modelYear].filter(Boolean).join(" · ")), { x: x + 12, y: y - 34, size: 8, font });
    const { bars, width } = code39Bars(u.vin);
    const unit = Math.min(1.1, (cw - 28) / width);
    for (const [bx, bw] of bars) page.drawRectangle({ x: x + 12 + bx * unit, y: y - 82, width: bw * unit, height: 38, color: rgb(0, 0, 0) });
    page.drawText(u.vin, { x: x + 12, y: y - 96, size: 11, font: bold });
  });
  return pdf.save();
}

/** Purchase order on the brand's legal entity. Needs access to the document (and to its prices). */
export async function purchaseOrderPdf(ctx: AccessContext, id: string): Promise<{ bytes: Uint8Array; number: string }> {
  const doc = await getInvDocument(ctx, id);
  if (doc.type !== "PO") throw new NotFoundError();
  const db = scopedDb(ctx);
  const [brand, vendor, warehouse] = await Promise.all([db.brand.findUniqueOrThrow({ where: { id: doc.brandId }, select: { code: true, name: true, legalEntity: true, address: true } }), doc.vendorId ? db.vendor.findUnique({ where: { id: doc.vendorId } }) : null, doc.warehouseId ? db.warehouse.findUnique({ where: { id: doc.warehouseId }, select: { name: true, address: true } }) : null]);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Purchase order ${doc.number}`);
  pdf.setAuthor(brand.legalEntity ?? brand.name);
  pdf.setCreator("StallionCRM");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H, M] = [595.28, 841.89, 40];
  let page = pdf.addPage([W, H]);
  const text = (s: string, x: number, y: number, size = 9, f = font) => page.drawText(ansi(s), { x, y, size, font: f, color: rgb(0.12, 0.16, 0.22) });
  const right = (s: string, x: number, y: number, size = 9, f = font) => text(s, x - f.widthOfTextAtSize(ansi(s), size), y, size, f);
  const amount = (n: number | undefined) => (n === undefined ? "" : n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  let y = H - M;
  text(brand.legalEntity ?? brand.name, M, y - 12, 13, bold);
  if (brand.address) text(brand.address.slice(0, 90), M, y - 26, 8);
  right("PURCHASE ORDER", W - M, y - 14, 16, bold);
  right(doc.number, W - M, y - 30, 10, bold);
  right(`Date ${doc.docDate}${doc.expectedDate ? `   Expected ${doc.expectedDate}` : ""}`, W - M, y - 42, 8);
  y -= 70;
  text("VENDOR", M, y, 7, bold);
  text(vendor?.name ?? "-", M, y - 12, 10, bold);
  if (vendor?.contactName) text(vendor.contactName, M, y - 24, 8);
  if (vendor?.paymentTerms) text(`Terms: ${vendor.paymentTerms}`, M, y - 34, 8);
  text("DELIVER TO", W / 2, y, 7, bold);
  text(warehouse?.name ?? "-", W / 2, y - 12, 10, bold);
  if (warehouse?.address) text(warehouse.address.slice(0, 60), W / 2, y - 24, 8);
  if (doc.reference) text(`Vendor reference: ${doc.reference}`, W / 2, y - 34, 8);
  y -= 58;
  page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 16, color: rgb(0.94, 0.95, 0.97) });
  text("#", M + 4, y, 8, bold);
  text("Item", M + 24, y, 8, bold);
  right("Qty", W - M - 190, y, 8, bold);
  right(`Unit cost (${doc.currency})`, W - M - 90, y, 8, bold);
  right("Amount", W - M - 4, y, 8, bold);
  y -= 18;
  for (const l of doc.lines) {
    if (y < 90) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
    text(String(l.position), M + 4, y);
    text(l.description.slice(0, 70), M + 24, y);
    right(String(l.qty), W - M - 190, y);
    right(amount(l.unitCost), W - M - 90, y);
    right(amount(l.lineTotal), W - M - 4, y);
    y -= 14;
  }
  page.drawLine({ start: { x: W - M - 200, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  right(`Total ${doc.currency}`, W - M - 90, y - 10, 10, bold);
  right(amount(doc.total), W - M - 4, y - 10, 10, bold);
  if (doc.notes) text(doc.notes.slice(0, 110), M, y - 34, 8);
  return { bytes: await pdf.save(), number: doc.number };
}
