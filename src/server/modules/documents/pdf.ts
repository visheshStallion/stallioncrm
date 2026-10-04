/**
 * Server-side PDF for quotes, sales orders and invoices (prompt 06 rule 6). One template, filled per brand:
 * logo, LEGAL ENTITY name, address, bank details and terms come from the Brands master.
 * `documentPdfModel` loads the data through the scoped client (so a hidden document is a 404 before any
 * rendering); `renderDocumentPdf` is pure.
 */
import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { DOCS, type DocType } from "./config";
import { getDocument, type DocDetail } from "./queries";

export interface PdfModel {
  title: string;
  statusLabel: string;
  dateLabel: string;
  brand: { code: string; name: string; legalEntity: string; address: string | null; bankDetails: string | null; color: string | null };
  logo: { bytes: Uint8Array; type: string } | null;
  customer: { name: string; lines: string[] };
  doc: DocDetail;
}

export async function documentPdfModel(ctx: AccessContext, type: DocType, id: string): Promise<PdfModel> {
  const doc = await getDocument(ctx, type, id); // 404 for hidden documents – nothing is rendered
  const db = scopedDb(ctx);
  const [brand, account, contact] = await Promise.all([
    db.brand.findUniqueOrThrow({ where: { id: doc.brandId }, select: { code: true, name: true, legalEntity: true, address: true, bankDetails: true, color: true, logoData: true, logoMimeType: true } }),
    doc.accountId ? db.account.findUnique({ where: { id: doc.accountId }, select: { name: true, address: true, city: true, state: true } }) : null,
    doc.contactId ? db.contact.findUnique({ where: { id: doc.contactId }, select: { firstName: true, lastName: true } }) : null,
  ]);
  const cfg = DOCS[type];
  return {
    title: cfg.label.toUpperCase(),
    statusLabel: cfg.statuses[doc.status] ?? doc.status,
    dateLabel: cfg.dateLabel,
    brand: { code: brand.code, name: brand.name, legalEntity: brand.legalEntity || brand.name, address: brand.address, bankDetails: brand.bankDetails, color: brand.color },
    logo: brand.logoData && brand.logoMimeType && ["image/png", "image/jpeg"].includes(brand.logoMimeType) ? { bytes: new Uint8Array(brand.logoData), type: brand.logoMimeType } : null,
    customer: {
      name: account?.name ?? doc.customerName ?? "Customer",
      lines: [contact ? `Attn: ${[contact.firstName, contact.lastName].filter(Boolean).join(" ")}` : null, account?.address, [account?.city, account?.state].filter(Boolean).join(", ") || null].filter((x): x is string => !!x),
    },
    doc,
  };
}

/** The standard PDF fonts only cover WinAnsi – replace anything else (e.g. the Naira sign). */
const ansi = (s: string) =>
  s
    .replace(/₦/g, "NGN ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF–—•]/g, "?");

const money = (n: number, currency: string) => `${currency} ${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function hexColor(hex: string | null) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  return m ? rgb(parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255) : rgb(0.08, 0.4, 0.82);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of ansi(text).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function renderDocumentPdf(m: PdfModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  // Metadata carries the issuing legal entity (also used by tests).
  pdf.setTitle(`${m.title} ${m.doc.number}`);
  pdf.setAuthor(m.brand.legalEntity);
  pdf.setSubject(`${m.brand.code} – ${m.customer.name}`);
  pdf.setCreator("StallionCRM");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = hexColor(m.brand.color);
  const grey = rgb(0.4, 0.44, 0.5);
  const W = 595.28;
  const H = 841.89;
  const M = 40;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const text = (s: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(ansi(s), { x, y: yy, size: o.size ?? 9, font: o.f ?? font, color: o.color ?? rgb(0.12, 0.16, 0.22) });
  const right = (s: string, x: number, yy: number, o: { size?: number; f?: PDFFont } = {}) => text(s, x - (o.f ?? font).widthOfTextAtSize(ansi(s), o.size ?? 9), yy, o);

  // Header: brand colour band, logo, legal entity, address
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });
  let x = M;
  if (m.logo) {
    try {
      const img = m.logo.type === "image/png" ? await pdf.embedPng(m.logo.bytes) : await pdf.embedJpg(m.logo.bytes);
      const scale = Math.min(110 / img.width, 42 / img.height);
      page.drawImage(img, { x: M, y: y - img.height * scale, width: img.width * scale, height: img.height * scale });
      x = M + img.width * scale + 12;
    } catch {
      /* unreadable logo – continue without it */
    }
  }
  text(m.brand.legalEntity, x, y - 12, { size: 13, f: bold });
  let hy = y - 26;
  for (const l of wrap(m.brand.address ?? "", font, 8, 260).filter(Boolean)) {
    text(l, x, hy, { size: 8, color: grey });
    hy -= 10;
  }
  right(m.title, W - M, y - 14, { size: 18, f: bold });
  right(m.doc.number, W - M, y - 30, { size: 10, f: bold });
  right(`Status: ${m.statusLabel}`, W - M, y - 42, { size: 8 });
  y = Math.min(hy, y - 52) - 14;

  // Customer + dates
  text("BILL TO", M, y, { size: 7, f: bold, color: grey });
  text(m.customer.name, M, y - 12, { size: 10, f: bold });
  let cy = y - 24;
  for (const l of m.customer.lines) {
    text(l, M, cy, { size: 8 });
    cy -= 10;
  }
  const meta: Array<[string, string]> = [
    ["Issue date", m.doc.issueDate.split("-").reverse().join("/")],
    [m.dateLabel, m.doc.date ? m.doc.date.split("-").reverse().join("/") : "-"],
    ["Deal", m.doc.dealName],
    ["Prepared by", m.doc.ownerName],
  ];
  let my = y;
  for (const [k, v] of meta) {
    text(k, W - M - 190, my, { size: 8, color: grey });
    right(v.length > 34 ? `${v.slice(0, 33)}…` : v, W - M, my, { size: 8 });
    my -= 11;
  }
  y = Math.min(cy, my) - 12;

  // Lines
  const cols = { desc: M + 4, qty: 330, price: 410, disc: 455, total: W - M - 4 };
  const head = () => {
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 16, color: accent });
    const white = rgb(1, 1, 1);
    text("Description", cols.desc, y, { size: 8, f: bold, color: white });
    page.drawText("Qty", { x: cols.qty - bold.widthOfTextAtSize("Qty", 8), y, size: 8, font: bold, color: white });
    page.drawText("Unit price", { x: cols.price - bold.widthOfTextAtSize("Unit price", 8), y, size: 8, font: bold, color: white });
    page.drawText("Disc %", { x: cols.disc - bold.widthOfTextAtSize("Disc %", 8), y, size: 8, font: bold, color: white });
    page.drawText("Amount", { x: cols.total - bold.widthOfTextAtSize("Amount", 8), y, size: 8, font: bold, color: white });
    y -= 18;
  };
  const ensure = (need: number) => {
    if (y - need < M + 20) {
      page = pdf.addPage([W, H]);
      y = H - M;
      head();
    }
  };
  head();
  for (const l of m.doc.lines) {
    const desc = wrap(l.vin ? `${l.description}\nVIN: ${l.vin}` : l.description, font, 9, 250);
    ensure(desc.length * 11 + 6);
    desc.forEach((d, i) => text(d, cols.desc, y - i * 11));
    right(String(l.qty), cols.qty, y);
    right(l.unitPrice.toLocaleString("en-NG", { minimumFractionDigits: 2 }), cols.price, y);
    right(l.discountPct ? String(l.discountPct) : "-", cols.disc, y);
    right(l.lineTotal.toLocaleString("en-NG", { minimumFractionDigits: 2 }), cols.total, y);
    y -= desc.length * 11 + 4;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.5, color: rgb(0.89, 0.91, 0.93) });
  }

  // Totals
  ensure(90);
  y -= 6;
  const totals: Array<[string, string, boolean]> = [
    ["Subtotal", money(m.doc.subtotal, m.doc.currency), false],
    ["Discount", `- ${money(m.doc.discountTotal, m.doc.currency)}`, false],
    ["VAT", money(m.doc.taxTotal, m.doc.currency), false],
    ["Total", money(m.doc.total, m.doc.currency), true],
  ];
  if (m.doc.amountPaid !== null && m.doc.amountPaid > 0) {
    totals.push(["Paid", money(m.doc.amountPaid, m.doc.currency), false], ["Balance due", money(m.doc.total - m.doc.amountPaid, m.doc.currency), true]);
  }
  for (const [k, v, strong] of totals) {
    text(k, W - M - 200, y, { f: strong ? bold : font, size: strong ? 10 : 9 });
    right(v, cols.total, y, { f: strong ? bold : font, size: strong ? 10 : 9 });
    y -= strong ? 15 : 12;
  }

  // Bank details + terms
  for (const [label, body] of [
    ["Bank details", m.brand.bankDetails],
    ["Terms & conditions", m.doc.terms],
    ["Notes", m.doc.notes],
  ] as const) {
    if (!body) continue;
    const lines = wrap(body, font, 8, W - 2 * M);
    ensure(lines.length * 10 + 24);
    y -= 8;
    text(label.toUpperCase(), M, y, { size: 7, f: bold, color: grey });
    y -= 11;
    for (const l of lines) {
      ensure(12);
      text(l, M, y, { size: 8 });
      y -= 10;
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(ansi(`${m.brand.legalEntity} · ${m.doc.number} · page ${i + 1} of ${pages.length}`), { x: M, y: 22, size: 7, font, color: grey });
  });
  return pdf.save();
}
