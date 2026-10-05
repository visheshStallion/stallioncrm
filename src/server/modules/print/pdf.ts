/**
 * PDF output of the print engine (prompt 20 §A4). Two renderers behind one function:
 *
 *   chromium  the print HTML rendered by headless Chromium (Playwright) – identical to the browser's print preview,
 *             repeating table headers, embedded fonts. Used when a Chromium is available to the server
 *             (PRINT_PDF_ENGINE=chromium, or unset and the `playwright` package can be loaded).
 *   basic     drawn directly with pdf-lib from the same blocks – no browser needed, so it works on serverless
 *             hosting. Plainer typography (standard PDF fonts, no rich-text styling), same content and letterhead.
 *
 * Both get records that were loaded with the user's access; nothing is read here.
 */
import "server-only";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { logger } from "@/server/log";
import { renderMerge } from "@/server/modules/messaging/merge";
import { code128Widths, qrMatrix } from "./codes";
import type { PrintRecord, PrintTable } from "./describe";
import type { Letterhead, ListPrint, Orientation, Paper, PrintBlock, PrintLayout, PrintOptions } from "./blocks";
import { htmlToText } from "./sanitize";

export type PdfEngine = "chromium" | "basic";

interface Browser {
  newPage(): Promise<{ setContent(html: string, o: { waitUntil: "load" }): Promise<void>; pdf(o: Record<string, unknown>): Promise<Uint8Array>; close(): Promise<void> }>;
  close(): Promise<void>;
  isConnected(): boolean;
}
let browser: Promise<Browser | null> | null = null;

/** One shared headless browser per server process; null when Chromium is not available here. */
async function chromium(): Promise<Browser | null> {
  if (process.env.PRINT_PDF_ENGINE === "basic") return null;
  if (!browser) {
    browser = (async () => {
      try {
        // not a static import: the package is optional and must not be bundled into serverless functions
        const name = "playwright";
        const mod = (await import(/* webpackIgnore: true */ name)) as { chromium: { launch(o: { headless: boolean }): Promise<Browser> } };
        return await mod.chromium.launch({ headless: true });
      } catch (err) {
        if (process.env.PRINT_PDF_ENGINE === "chromium") logger.warn({ err }, "PRINT_PDF_ENGINE=chromium but Chromium could not be started – using the basic PDF renderer");
        return null;
      }
    })();
  }
  const b = await browser;
  if (b && !b.isConnected()) {
    browser = null;
    return chromium();
  }
  return b;
}

/** HTML → PDF with headless Chromium; null when no Chromium is available (the caller falls back to `basicPdf`). */
export async function chromiumPdf(html: string, o: { paper: Paper; orientation: Orientation }): Promise<Uint8Array | null> {
  const b = await chromium();
  if (!b) return null;
  const page = await b.newPage();
  try {
    // the document is self-contained (inline CSS, data: images): nothing is fetched while rendering
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: o.paper === "A4" ? "A4" : "Letter",
      landscape: o.orientation === "landscape",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-size:7px;color:#6b7280;text-align:right;padding:0 14mm">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function pageCount(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf)).getPageCount();
}

/** Several PDFs as one. */
export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const doc = await PDFDocument.load(f);
    for (const p of await out.copyPages(doc, doc.getPageIndices())) out.addPage(p);
  }
  return out.save();
}

// ───────────────────────────── basic renderer (pdf-lib) ─────────────────────────────

const MM = 72 / 25.4;
const SIZES: Record<Paper, [number, number]> = { A4: [595.28, 841.89], LETTER: [612, 792] };

/** The standard PDF fonts only cover WinAnsi – replace anything else (e.g. the Naira sign). */
const ansi = (s: string) =>
  s
    .replace(/₦/g, "NGN")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\xA0/g, " ")
    .replace(/[^\x20-\x7E\xA1-\xFF–—•]/g, "?");

function hex(color: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return m ? rgb(parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255) : rgb(0.08, 0.4, 0.82);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of ansi(text).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
      // a single word wider than the column is cut
      while (font.widthOfTextAtSize(line, size) > width && line.length > 4) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

class Canvas {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  readonly margin = 14 * MM;
  readonly bottom = 20 * MM;
  constructor(
    readonly doc: PDFDocument,
    readonly w: number,
    readonly h: number,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    private onNewPage: (c: Canvas) => void,
  ) {
    this.addPage();
  }
  get width() {
    return this.w - 2 * this.margin;
  }
  addPage() {
    this.page = this.doc.addPage([this.w, this.h]);
    this.pages.push(this.page);
    this.y = this.h - this.margin;
    this.onNewPage(this);
  }
  need(height: number) {
    if (this.y - height < this.bottom) this.addPage();
  }
  text(s: string, x: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; right?: number } = {}) {
    const size = o.size ?? 9;
    const font = o.bold ? this.bold : this.font;
    const t = ansi(s);
    const px = o.right !== undefined ? o.right - font.widthOfTextAtSize(t, size) : x;
    this.page.drawText(t, { x: px, y: this.y, size, font, color: o.color ?? rgb(0.12, 0.16, 0.22) });
  }
  paragraph(s: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 9;
    const lines = wrap(s, o.bold ? this.bold : this.font, size, o.width ?? this.width);
    for (const line of lines) {
      this.need(size * 1.4);
      this.y -= size * 1.15;
      this.text(line, o.x ?? this.margin, o);
      this.y -= size * 0.25;
    }
    this.y -= o.gap ?? 2;
  }
  rule(color = rgb(0.82, 0.84, 0.87), thickness = 0.5) {
    this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.w - this.margin, y: this.y }, thickness, color });
  }
}

async function embedLogo(doc: PDFDocument, lh: Letterhead): Promise<PDFImage | null> {
  const m = /^data:(image\/(?:png|jpe?g));base64,(.+)$/i.exec(lh.logo ?? "");
  if (!m) return null;
  try {
    const bytes = Buffer.from(m[2]!, "base64");
    return /png/i.test(m[1]!) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

function drawLetterhead(c: Canvas, lh: Letterhead, logo: PDFImage | null) {
  const top = c.y;
  let left = top;
  if (logo) {
    const scale = Math.min((60 * MM) / logo.width, (20 * MM) / logo.height, 1);
    c.page.drawImage(logo, { x: c.margin, y: top - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
    left = top - logo.height * scale;
  } else {
    c.y = top - 18;
    c.text(lh.name, c.margin, { size: 18, bold: true, color: hex(lh.color) });
    left = top - 22;
  }
  c.y = top - 10;
  c.text(lh.legalEntity, 0, { size: 10.5, bold: true, right: c.w - c.margin });
  const details = [lh.rcNumber ? `RC ${lh.rcNumber}` : null, ...(lh.address ? lh.address.split(/\r?\n/) : []), [lh.phone, lh.email].filter(Boolean).join(" · ") || null, [lh.website, lh.vatNumber ? `VAT ${lh.vatNumber}` : null].filter(Boolean).join(" · ") || null].filter((x): x is string => !!x);
  for (const d of details) {
    c.y -= 10.5;
    c.text(d, 0, { size: 8, right: c.w - c.margin, color: rgb(0.25, 0.3, 0.36) });
  }
  c.y = Math.min(c.y, left) - 8;
  c.page.drawLine({ start: { x: c.margin, y: c.y }, end: { x: c.w - c.margin, y: c.y }, thickness: 3, color: hex(lh.color) });
  c.y -= 16;
}

function drawTable(c: Canvas, t: PrintTable, title: string | undefined, accent: ReturnType<typeof rgb>) {
  if (!t.rows.length) return;
  if (title) {
    c.need(40);
    c.y -= 6;
    c.paragraph(title, { size: 10, bold: true });
  }
  // column widths: proportional to the longest of the first rows, numbers narrower
  const weights = t.columns.map((col, i) => Math.min(40, Math.max(col.label.length, ...t.rows.slice(0, 30).map((r) => (r[i] ?? "").length), 6)));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / total) * c.width);
  const header = () => {
    c.need(34);
    c.page.drawRectangle({ x: c.margin, y: c.y - 14, width: c.width, height: 14, color: rgb(0.95, 0.96, 0.97) });
    let x = c.margin;
    c.y -= 10;
    t.columns.forEach((col, i) => {
      if (col.align === "right") c.text(col.label, 0, { size: 8, bold: true, right: x + widths[i]! - 3 });
      else c.text(col.label, x + 3, { size: 8, bold: true });
      x += widths[i]!;
    });
    c.y -= 4;
    c.page.drawLine({ start: { x: c.margin, y: c.y }, end: { x: c.w - c.margin, y: c.y }, thickness: 1, color: accent });
  };
  header();
  for (const row of t.rows) {
    const cells = row.map((v, i) => wrap(v, c.font, 8.5, widths[i]! - 6).slice(0, 6));
    const height = Math.max(...cells.map((l) => l.length)) * 10.5 + 5;
    if (c.y - height < c.bottom) {
      c.addPage();
      header(); // the header row repeats on every page
    }
    let x = c.margin;
    const top = c.y;
    cells.forEach((lines, i) => {
      c.y = top - 10;
      for (const line of lines) {
        if (t.columns[i]!.align === "right") c.text(line, 0, { size: 8.5, right: x + widths[i]! - 3 });
        else c.text(line, x + 3, { size: 8.5 });
        c.y -= 10.5;
      }
      x += widths[i]!;
    });
    c.y = top - height;
    c.rule(rgb(0.9, 0.91, 0.92), 0.4);
  }
  c.y -= 8;
}

function drawBlock(c: Canvas, b: PrintBlock, record: PrintRecord, lh: Letterhead, logo: PDFImage | null, o: PrintOptions) {
  const accent = hex(lh.color);
  const merge = { ...record.merge, brand: { name: lh.name, code: lh.code, legalEntity: lh.legalEntity, ...(record.merge.brand ?? {}) }, user: { name: o.printedBy } };
  switch (b.type) {
    case "letterhead":
      return drawLetterhead(c, lh, logo);
    case "title":
      c.need(30);
      return c.paragraph(renderMerge(b.text, merge), { size: 14, bold: true, gap: 6 });
    case "fields": {
      const chosen = b.fields.map((k) => record.fields.find((f) => f.key === k)).filter((f): f is PrintRecord["fields"][number] => !!f && f.value !== "");
      if (!chosen.length) return;
      if (b.title) {
        c.need(40);
        c.y -= 4;
        c.paragraph(b.title, { size: 10, bold: true });
      }
      const cols = b.columns;
      const colW = c.width / cols;
      for (let i = 0; i < chosen.length; i += cols) {
        const rowFields = chosen.slice(i, i + cols);
        const lines = rowFields.map((f) => wrap(f.value, c.font, 9, colW * 0.6 - 6));
        const height = Math.max(...lines.map((l) => l.length)) * 11.5 + 2;
        c.need(height);
        const top = c.y;
        rowFields.forEach((f, j) => {
          const x = c.margin + j * colW;
          c.y = top - 10;
          c.text(f.label, x, { size: 8, color: rgb(0.3, 0.34, 0.4) });
          for (const line of lines[j]!) {
            c.text(line, x + colW * 0.4, { size: 9 });
            c.y -= 11.5;
          }
        });
        c.y = top - height;
      }
      c.y -= 6;
      return;
    }
    case "richText":
      return c.paragraph(renderMerge(htmlToText(b.html), merge), { gap: 6 });
    case "lineItems":
      return record.lines ? drawTable(c, record.lines, b.title, accent) : undefined;
    case "related": {
      const t = record.tables.find((x) => x.key === b.list);
      return t ? drawTable(c, t, b.title ?? t.title, accent) : undefined;
    }
    case "totals": {
      if (!record.totals.length) return;
      c.need(record.totals.length * 14 + 6);
      for (const t of record.totals) {
        c.y -= 13;
        c.text(t.label, c.w - c.margin - 200, { size: t.strong ? 10.5 : 9, bold: t.strong });
        c.text(t.value, 0, { size: t.strong ? 10.5 : 9, bold: t.strong, right: c.w - c.margin });
      }
      c.y -= 10;
      return;
    }
    case "terms": {
      const body = b.html ? renderMerge(htmlToText(b.html), merge) : (record.terms ?? "");
      if (body) {
        c.y -= 4;
        c.paragraph("Terms & conditions", { size: 8.5, bold: true });
        c.paragraph(body, { size: 8, color: rgb(0.25, 0.3, 0.36), gap: 6 });
      }
      if (lh.bankDetails) {
        c.paragraph("Bank details", { size: 8.5, bold: true });
        c.paragraph(lh.bankDetails, { size: 8, color: rgb(0.25, 0.3, 0.36), gap: 6 });
      }
      return;
    }
    case "signatures": {
      if (!b.roles.length) return;
      c.need(70);
      c.y -= 44;
      const roles = b.roles.slice(0, 4);
      const w = (c.width - (roles.length - 1) * 20) / roles.length;
      roles.forEach((role, i) => {
        const x = c.margin + i * (w + 20);
        c.page.drawLine({ start: { x, y: c.y }, end: { x: x + w, y: c.y }, thickness: 0.7, color: rgb(0.1, 0.1, 0.1) });
        const keep = c.y;
        c.y -= 11;
        c.text(role, x, { size: 8 });
        c.y = keep;
      });
      c.y -= 24;
      return;
    }
    case "qr": {
      const value = b.value === "vin" ? record.vin : b.value === "number" ? record.number : `${o.appUrl}${o.recordPath?.(record) ?? ""}`;
      if (!value) return;
      const matrix = qrMatrix(value);
      const size = 62;
      const cell = size / (matrix.length + 4);
      c.need(size + 16);
      const top = c.y;
      matrix.forEach((row, yy) => row.forEach((on, xx) => on && c.page.drawRectangle({ x: c.margin + (xx + 2) * cell, y: top - (yy + 3) * cell, width: cell, height: cell, color: rgb(0, 0, 0) })));
      c.y = top - size - 9;
      c.text(b.caption ?? (b.value === "url" ? "Scan to open the record" : value), c.margin, { size: 7, color: rgb(0.3, 0.34, 0.4) });
      c.y -= 8;
      return;
    }
    case "barcode": {
      const value = b.value === "vin" ? record.vin : record.number;
      if (!value) return;
      c.need(52);
      const widths = code128Widths(value);
      const unit = 0.9;
      let x = c.margin;
      const top = c.y;
      widths.forEach((w, i) => {
        if (i % 2 === 0) c.page.drawRectangle({ x, y: top - 30, width: w * unit, height: 30, color: rgb(0, 0, 0) });
        x += w * unit;
      });
      c.y = top - 40;
      c.text(value, c.margin, { size: 8 });
      c.y -= 8;
      return;
    }
    case "image":
      return; // images of rich templates need the Chromium renderer
    case "pageBreak":
      return c.addPage();
    case "footer":
      return c.paragraph(renderMerge(b.text, merge), { size: 8, color: rgb(0.3, 0.34, 0.4) });
  }
}

function finish(c: Canvas, footers: string[], watermark: string | null | undefined) {
  c.pages.forEach((page, i) => {
    if (watermark) page.drawText(ansi(watermark), { x: c.w * 0.14, y: c.h * 0.36, size: 54, font: c.bold, color: rgb(0, 0, 0), opacity: 0.07, rotate: degrees(32) });
    page.drawLine({ start: { x: c.margin, y: 12 * MM }, end: { x: c.w - c.margin, y: 12 * MM }, thickness: 0.4, color: rgb(0.82, 0.84, 0.87) });
    page.drawText(ansi(footers[i] ?? footers[0] ?? "").slice(0, 150), { x: c.margin, y: 8.5 * MM, size: 6.5, font: c.font, color: rgb(0.42, 0.45, 0.5) });
    const n = `Page ${i + 1} of ${c.pages.length}`;
    page.drawText(n, { x: c.w - c.margin - c.font.widthOfTextAtSize(n, 6.5), y: 8.5 * MM, size: 6.5, font: c.font, color: rgb(0.42, 0.45, 0.5) });
  });
}

const stamp = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
const footerText = (lh: Letterhead, o: PrintOptions, ref: string | null) => `${lh.legalEntity}${lh.address ? ` · ${lh.address.replace(/\s*\r?\n\s*/g, ", ")}` : ""} · Printed by ${o.printedBy} on ${stamp(o.printedAt)}${ref ? ` · ${ref}` : ""}`;

function dims(o: PrintOptions): [number, number] {
  const [w, h] = SIZES[o.paper];
  return o.orientation === "landscape" ? [h, w] : [w, h];
}

/** Records on their letterheads, drawn with pdf-lib. */
export async function basicRecordsPdf(input: { records: PrintRecord[]; layoutFor: (r: PrintRecord) => PrintLayout; letterheadFor: (r: PrintRecord) => Letterhead; options: PrintOptions }): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const record of input.records) {
    const doc = await PDFDocument.create();
    const [font, bold] = [await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold)];
    const lh = input.letterheadFor(record);
    const logo = await embedLogo(doc, lh);
    const [w, h] = dims(input.options);
    const c = new Canvas(doc, w, h, font, bold, () => undefined);
    const layout = input.layoutFor(record);
    const blocks = layout.blocks.some((b) => b.type === "letterhead") ? layout.blocks : [{ type: "letterhead" } as PrintBlock, ...layout.blocks];
    for (const b of blocks) drawBlock(c, b, record, lh, logo, input.options);
    finish(c, [footerText(lh, input.options, record.number)], input.options.watermark);
    const saved = await PDFDocument.load(await doc.save());
    for (const p of await out.copyPages(saved, saved.getPageIndices())) out.addPage(p);
  }
  return out.save();
}

/** A list (table) on one letterhead, drawn with pdf-lib. */
export async function basicListPdf(input: { list: ListPrint; letterhead: Letterhead; options: PrintOptions }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [font, bold] = [await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold)];
  const [w, h] = dims(input.options);
  const c = new Canvas(doc, w, h, font, bold, () => undefined);
  drawLetterhead(c, input.letterhead, await embedLogo(doc, input.letterhead));
  c.paragraph(input.list.title, { size: 14, bold: true });
  c.paragraph(input.list.subtitle, { size: 8.5, color: rgb(0.3, 0.34, 0.4), gap: 6 });
  drawTable(c, { key: "list", title: "", columns: input.list.columns.map((col, i) => ({ key: String(i), label: col.label, align: col.align })), rows: input.list.rows }, undefined, hex(input.letterhead.color));
  for (const t of input.list.totals) {
    c.need(14);
    c.y -= 13;
    c.text(t.label, c.w - c.margin - 200, { size: 9.5, bold: true });
    c.text(t.value, 0, { size: 9.5, bold: true, right: c.w - c.margin });
  }
  finish(c, [footerText(input.letterhead, input.options, null)], input.options.watermark);
  return doc.save();
}
