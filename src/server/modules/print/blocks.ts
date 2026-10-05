/**
 * Print layouts: a template is a list of blocks; this file renders them to one self-contained HTML document
 * (print CSS included) for the browser's print preview and for the PDF renderer. Pure – no database, no network.
 *
 * Everything that comes from a record or a letterhead is escaped. The only HTML that passes through is the body of
 * "richText" / "terms" blocks, which the service sanitises when the template is saved (print/sanitize.ts).
 */
import { amountInWords, escapeHtml as esc, renderMerge, renderMergeHtml, type MergeData } from "@/server/modules/messaging/merge";
import { barcodeSvg, qrSvg } from "./codes";
import type { PrintRecord, PrintTable } from "./describe";

export type Paper = "A4" | "LETTER" | "A5";
export interface LetterheadStyle {
  logo?: "left" | "center" | "right";
  details?: "beside" | "below";
}
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export type Orientation = "portrait" | "landscape";

export type PrintBlock =
  | ({ type: "letterhead" } & LetterheadStyle)
  | { type: "title"; text: string }
  | { type: "fields"; title?: string; columns: 1 | 2 | 3; fields: string[] }
  | { type: "richText"; html: string }
  | { type: "lineItems"; title?: string; /** column keys in print order ("sn" = serial number); all columns when missing */ columns?: string[]; zebra?: boolean }
  | { type: "related"; list: string; title?: string }
  | { type: "totals"; /** adds the grand total in words */ words?: boolean }
  /** HTML produced by the document-template compiler (prompt 21) from the record – already escaped, not merged again */
  | { type: "html"; html: string }
  | { type: "terms"; html?: string; /** false = without the bank details (the document has its own payment block) */ bank?: boolean }
  | { type: "signatures"; roles: string[]; /** a box for the company stamp */ stamp?: boolean }
  | { type: "qr"; value: "url" | "vin" | "number"; caption?: string }
  | { type: "barcode"; value: "vin" | "number" }
  | { type: "image"; url: string; alt: string; widthMm: number }
  | { type: "pageBreak" }
  | { type: "footer"; text: string };

export interface PrintLayout {
  blocks: PrintBlock[];
  // ── document templates (prompt 21): regions that repeat on every page ──
  /** sanitised rich text with merge fields, printed at the top of every page (after the letterhead, when shown) */
  header?: string;
  /** letterhead inside the repeating header; undefined = the layout places its own letterhead block */
  headerLetterhead?: LetterheadStyle | null;
  /** sanitised rich text with merge fields, printed at the bottom of every page */
  footer?: string;
  /** page margins in mm */
  margins?: Margins;
  /** allow-listed CSS declarations for the sheet (built by the service – never raw user CSS) */
  css?: string;
  /** the page-number line, e.g. "Page {{page}} of {{pages}}" */
  pageLine?: string;
}

export const BLOCK_LABELS: Record<PrintBlock["type"], string> = {
  html: "Generated content",
  letterhead: "Letterhead header",
  title: "Title",
  fields: "Field grid",
  richText: "Rich text",
  lineItems: "Line-items table",
  related: "Related list table",
  totals: "Totals",
  terms: "Terms & conditions",
  signatures: "Signature boxes",
  qr: "QR code",
  barcode: "Barcode",
  image: "Image",
  pageBreak: "Page break",
  footer: "Footer text",
};

/** What is printed on top of (and under) every page: one brand's letterhead profile, or the group's. */
export interface Letterhead {
  /** brand id, or null for the group letterhead */
  brandId: string | null;
  code: string;
  name: string;
  legalEntity: string;
  rcNumber: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  vatNumber: string | null;
  bankDetails: string | null;
  color: string;
  footerText: string | null;
  /** data: URI of the logo (PNG / JPEG / SVG), or null → the brand name is set as a word mark */
  logo: string | null;
}

export interface PrintOptions {
  paper: Paper;
  orientation: Orientation;
  /** e.g. "COPY", or "Internal – Ada Okafor – 05/10/2026" */
  watermark?: string | null;
  printedBy: string;
  printedAt: Date;
  /** absolute base URL of the application (QR codes that point to the record) */
  appUrl: string;
  /** the page-number line of the PDF, e.g. "Page {{page}} of {{pages}}" (document templates) */
  pageLine?: string | null;
  /** path of the record in the application, per record id */
  recordPath?: (record: PrintRecord) => string;
}

const PAGE = { A4: "210mm 297mm", LETTER: "8.5in 11in", A5: "148mm 210mm" } as const;
const SHEET = { A4: ["210mm", "297mm"], LETTER: ["8.5in", "11in"], A5: ["148mm", "210mm"] } as const;
const mm = (n: number, max = 60) => `${Math.min(max, Math.max(0, Number(n) || 0))}mm`;
const safeColor = (c: string | null | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#1565d0");
const nl2br = (s: string) => esc(s).replace(/\r?\n/g, "<br>");
const stamp = (d: Date) =>
  `${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "numeric" }).format(d)} ${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(d)}`;

/** The CSS of every printout. `@page` sets paper and margins; the running footer uses a fixed element (repeats on each page). */
export function printCss(o: { paper: Paper; orientation: Orientation; color: string }): string {
  return `
@page { size: ${PAGE[o.paper]} ${o.orientation}; margin: 14mm 14mm 20mm 14mm; }
* { box-sizing: border-box; }
html { font-size: 10pt; }
body { margin: 0; font-family: "Lato", "Inter", Arial, Helvetica, sans-serif; color: #1f2937; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { position: relative; }
.record { break-after: page; page-break-after: always; }
.record:last-child { break-after: auto; page-break-after: auto; }
.lh { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; padding-bottom: 3mm; border-bottom: 1.2mm solid ${o.color}; margin-bottom: 5mm; }
.lh-logo img { max-width: 60mm; max-height: 20mm; display: block; }
.lh-mark { font-size: 20pt; font-weight: 700; color: ${o.color}; letter-spacing: 0.3pt; }
.lh-details { text-align: right; font-size: 8.5pt; color: #374151; }
.lh-details strong { display: block; font-size: 11pt; color: #111827; }
h1.title { font-size: 15pt; margin: 0 0 1mm; color: #111827; }
.subtitle { color: #4b5563; margin-bottom: 4mm; }
h2.block-title { font-size: 10.5pt; margin: 5mm 0 2mm; padding-bottom: 1mm; border-bottom: 0.3mm solid #d1d5db; color: #111827; }
.grid { display: grid; column-gap: 8mm; row-gap: 1.2mm; }
.grid.c1 { grid-template-columns: 1fr; } .grid.c2 { grid-template-columns: 1fr 1fr; } .grid.c3 { grid-template-columns: 1fr 1fr 1fr; }
.fld { display: grid; grid-template-columns: 38% 1fr; gap: 3mm; break-inside: avoid; }
.fld dt { color: #4b5563; font-size: 8.5pt; } .fld dd { margin: 0; overflow-wrap: anywhere; }
dl { margin: 0; }
table.t { width: 100%; border-collapse: collapse; margin: 1mm 0 3mm; }
table.t thead { display: table-header-group; }
table.t th { text-align: left; font-size: 8.5pt; padding: 1.6mm 2mm; background: #f3f4f6; border-bottom: 0.4mm solid ${o.color}; color: #374151; }
table.t td { padding: 1.5mm 2mm; border-bottom: 0.2mm solid #e5e7eb; vertical-align: top; overflow-wrap: anywhere; }
table.t tr { break-inside: avoid; page-break-inside: avoid; }
table.t .r { text-align: right; white-space: nowrap; }
.totals { margin-left: auto; width: 75mm; break-inside: avoid; }
.totals div { display: flex; justify-content: space-between; padding: 1mm 2mm; }
.totals .strong { font-weight: 700; border-top: 0.4mm solid ${o.color}; font-size: 11pt; }
.rich { margin: 2mm 0; overflow-wrap: anywhere; } .rich p { margin: 0 0 2mm; } .rich table { border-collapse: collapse; } .rich td, .rich th { border: 0.2mm solid #9ca3af; padding: 1mm 2mm; }
.rich img { max-width: 100%; }
.terms { font-size: 8.5pt; color: #374151; margin-top: 4mm; }
.sigs { display: flex; gap: 10mm; margin-top: 16mm; break-inside: avoid; }
.sig { flex: 1; border-top: 0.3mm solid #111827; padding-top: 1.5mm; font-size: 8.5pt; color: #374151; }
.code { display: inline-block; text-align: center; font-size: 7.5pt; color: #4b5563; margin: 2mm 4mm 2mm 0; break-inside: avoid; }
.code svg { display: block; }
.note { font-size: 8.5pt; color: #4b5563; margin-top: 3mm; }
.break { break-after: page; page-break-after: always; height: 0; }
.wm { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
.wm span { font-size: 64pt; font-weight: 700; color: rgba(0,0,0,0.07); transform: rotate(-32deg); white-space: nowrap; }
.foot { position: fixed; left: 0; right: 0; bottom: -14mm; font-size: 7.5pt; color: #6b7280; display: flex; justify-content: space-between; gap: 6mm; border-top: 0.2mm solid #d1d5db; padding-top: 1.2mm; }
.lh.lh-right { flex-direction: row-reverse; } .lh.lh-right .lh-details { text-align: left; }
.lh.lh-center, .lh.lh-below { flex-direction: column; gap: 2mm; }
.lh.lh-center { align-items: center; } .lh.lh-center .lh-details { text-align: center; }
.lh.lh-below.lh-left { align-items: flex-start; } .lh.lh-below.lh-left .lh-details { text-align: left; }
.lh.lh-below.lh-right { align-items: flex-end; } .lh.lh-below.lh-right .lh-details { text-align: right; }
table.pg { width: 100%; border-collapse: collapse; } table.pg > thead { display: table-header-group; } table.pg > tfoot { display: table-footer-group; }
table.pg > thead > tr > td, table.pg > tbody > tr > td, table.pg > tfoot > tr > td { padding: 0; vertical-align: top; }
.pg-head { margin-bottom: 3mm; } .pg-foot { margin-top: 4mm; padding-top: 1.5mm; border-top: 0.2mm solid #d1d5db; font-size: 8pt; color: #4b5563; }
table.t.zebra tbody tr:nth-child(even) td { background: #f9fafb; }
.words { margin: 1mm 0 3mm; font-size: 9pt; break-inside: avoid; } .words strong { color: #111827; }
.doc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm; margin-bottom: 4mm; }
.doc-head h1 { margin: 0; font-size: 16pt; letter-spacing: 0.4pt; color: #111827; } .doc-head .no { font-size: 11pt; font-weight: 700; color: var(--c, #1565d0); }
.doc-head dl { display: grid; grid-template-columns: auto auto; column-gap: 3mm; font-size: 9pt; text-align: right; } .doc-head dt { color: #4b5563; } .doc-head dd { margin: 0; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin: 2mm 0 4mm; break-inside: avoid; }
.party h3 { margin: 0 0 1mm; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.5pt; color: #4b5563; } .party p { margin: 0; }
.box { border: 0.2mm solid #d1d5db; border-radius: 1.5mm; padding: 2.5mm 3mm; margin: 3mm 0; break-inside: avoid; } .box h3 { margin: 0 0 1mm; font-size: 9.5pt; color: #111827; }
.stamp { flex: 0 0 34mm; height: 24mm; border: 0.3mm dashed #9ca3af; border-top-style: dashed; display: flex; align-items: center; justify-content: center; text-align: center; }
.badge { display: inline-block; padding: 0 1.5mm; border: 0.2mm solid #9ca3af; border-radius: 1mm; font-size: 7.5pt; font-weight: 700; }
@media screen {
  body { background: #e5e7eb; }
  .sheet { background: #fff; width: ${SHEET[o.paper][o.orientation === "portrait" ? 0 : 1]}; min-height: ${SHEET[o.paper][o.orientation === "portrait" ? 1 : 0]}; margin: 18mm auto 10mm; padding: 14mm; box-shadow: 0 2px 12px rgba(0,0,0,.18); }
  .foot { position: static; margin-top: 10mm; }
  .wm { position: absolute; }
  .toolbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 14px; background: #1e2638; color: #fff; font: 13px Arial, sans-serif; }
  .toolbar select, .toolbar button, .toolbar a { font: inherit; height: 30px; padding: 0 10px; border-radius: 4px; border: 1px solid #cfd6de; background: #fff; color: #1f2937; text-decoration: none; display: inline-flex; align-items: center; cursor: pointer; }
  .toolbar button.primary { background: #1565d0; border-color: #1565d0; color: #fff; font-weight: 700; }
  .toolbar label { display: inline-flex; align-items: center; gap: 6px; }
  .toolbar .grow { flex: 1; }
}
@media print { .toolbar { display: none !important; } }
`;
}

export function letterheadHtml(lh: Letterhead, style: LetterheadStyle = {}): string {
  const cls = [style.logo === "center" ? "lh-center" : style.logo === "right" ? "lh-right" : "lh-left", style.details === "below" && style.logo !== "center" ? "lh-below" : ""].filter(Boolean).join(" ");
  const details = [
    lh.rcNumber ? `RC ${esc(lh.rcNumber)}` : null,
    lh.address ? nl2br(lh.address) : null,
    [lh.phone ? esc(lh.phone) : null, lh.email ? esc(lh.email) : null].filter(Boolean).join(" · ") || null,
    [lh.website ? esc(lh.website) : null, lh.vatNumber ? `VAT ${esc(lh.vatNumber)}` : null].filter(Boolean).join(" · ") || null,
  ].filter(Boolean);
  return `<header class="lh ${cls}" data-letterhead="${esc(lh.code)}">
  <div class="lh-logo">${lh.logo ? `<img src="${esc(lh.logo)}" alt="${esc(lh.name)} logo">` : `<div class="lh-mark">${esc(lh.name)}</div>`}</div>
  <div class="lh-details"><strong>${esc(lh.legalEntity)}</strong>${details.join("<br>")}</div>
</header>`;
}

/** A table reduced to the chosen columns, in that order; "sn" adds a serial number. Unknown keys are ignored. */
export function pickColumns(t: PrintTable, keys: string[] | undefined): PrintTable {
  if (!keys?.length) return t;
  const chosen = keys.map((k) => (k === "sn" ? -1 : t.columns.findIndex((c) => c.key === k))).filter((i, n) => i === -1 ? keys.indexOf("sn") === n : i >= 0);
  if (!chosen.some((i) => i >= 0)) return t;
  return { ...t, columns: chosen.map((i) => (i === -1 ? { key: "sn", label: "S/N", align: "left" as const } : t.columns[i]!)), rows: t.rows.map((r, n) => chosen.map((i) => (i === -1 ? String(n + 1) : (r[i] ?? "")))) };
}

/** The grand total of a record as a number (documents), or null. */
export function grandTotal(record: PrintRecord): number | null {
  const root = record.merge.record ?? {};
  for (const k of ["total", "grandTotal", "amount"]) if (typeof root[k] === "number") return root[k];
  return null;
}

function tableHtml(t: PrintTable, title?: string, zebra = false): string {
  if (!t.rows.length) return "";
  return `${title ? `<h2 class="block-title">${esc(title)}</h2>` : ""}<table class="t${zebra ? " zebra" : ""}" data-table="${esc(t.key)}"><thead><tr>${t.columns.map((c) => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${t.rows
    .map((r) => `<tr>${r.map((v, i) => `<td class="${t.columns[i]!.align === "right" ? "r" : ""}">${esc(v)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

/** Merge data of a record on a letterhead: the record's groups, the company (always the letterhead's) and the user. */
export function mergeOf(record: PrintRecord, lh: Letterhead, o: Pick<PrintOptions, "printedBy">): MergeData {
  return { ...record.merge, brand: { name: lh.name, code: lh.code, legalEntity: lh.legalEntity, address: lh.address, phone: lh.phone, email: lh.email, website: lh.website, rcNumber: lh.rcNumber, vatNumber: lh.vatNumber, bankDetails: lh.bankDetails, ...(record.merge.brand ?? {}) }, user: { name: o.printedBy } };
}
/** One-word merge fields: {{amountInWords}} (the server-computed total – never typed into a template). */
export function extraOf(record: PrintRecord): Record<string, string> {
  const total = grandTotal(record);
  return total === null ? {} : { amountInWords: amountInWords(total) };
}

function blockHtml(b: PrintBlock, record: PrintRecord, lh: Letterhead, o: PrintOptions): string {
  const merge = mergeOf(record, lh, o);
  const extra = extraOf(record);
  switch (b.type) {
    case "letterhead":
      return letterheadHtml(lh, b);
    case "html":
      return b.html;
    case "title":
      return `<h1 class="title">${esc(renderMerge(b.text, merge, extra))}</h1>`;
    case "fields": {
      const chosen = b.fields.map((k) => record.fields.find((f) => f.key === k)).filter((f): f is PrintRecord["fields"][number] => !!f && f.value !== "");
      if (!chosen.length) return "";
      return `${b.title ? `<h2 class="block-title">${esc(b.title)}</h2>` : ""}<dl class="grid c${b.columns}">${chosen.map((f) => `<div class="fld"><dt>${esc(f.label)}</dt><dd data-field="${esc(f.key)}">${esc(f.value)}</dd></div>`).join("")}</dl>`;
    }
    case "richText":
      return `<div class="rich">${renderMergeHtml(b.html, merge, extra)}</div>`;
    case "lineItems":
      return record.lines ? tableHtml(pickColumns(record.lines, b.columns), b.title, b.zebra) : "";
    case "related": {
      const t = record.tables.find((x) => x.key === b.list);
      return t ? tableHtml(t, b.title ?? t.title) : "";
    }
    case "totals": {
      const total = b.words ? grandTotal(record) : null;
      const words = total !== null ? `<p class="words" data-words="true"><strong>Amount in words:</strong> ${esc(amountInWords(total))}</p>` : "";
      return record.totals.length ? `<div class="totals">${record.totals.map((t) => `<div class="${t.strong ? "strong" : ""}"><span>${esc(t.label)}</span><span>${esc(t.value)}</span></div>`).join("")}</div>${words}` : "";
    }
    case "terms": {
      const body = b.html ? renderMergeHtml(b.html, merge) : record.terms ? nl2br(record.terms) : "";
      const bank = lh.bankDetails && b.bank !== false ? `<p><strong>Bank details</strong><br>${nl2br(lh.bankDetails)}</p>` : "";
      return body || bank ? `<div class="terms">${body ? `<p><strong>Terms &amp; conditions</strong></p><div class="rich">${body}</div>` : ""}${bank}</div>` : "";
    }
    case "signatures":
      return b.roles.length || b.stamp ? `<div class="sigs">${b.roles.slice(0, 4).map((r) => `<div class="sig">${esc(r)}<br>Name / signature / date</div>`).join("")}${b.stamp ? `<div class="sig stamp">Company stamp</div>` : ""}</div>` : "";
    case "qr": {
      const value = b.value === "vin" ? record.vin : b.value === "number" ? record.number : `${o.appUrl}${o.recordPath?.(record) ?? ""}`;
      return value ? `<div class="code">${qrSvg(value, 88)}${esc(b.caption ?? (b.value === "url" ? "Scan to open the record" : value))}</div>` : "";
    }
    case "barcode": {
      const value = b.value === "vin" ? record.vin : record.number;
      return value ? `<div class="code">${barcodeSvg(value)}</div>` : "";
    }
    case "image":
      // images come from our own storage or a data: URI – the service refuses anything else when saving
      return `<div class="rich"><img src="${esc(b.url)}" alt="${esc(b.alt)}" style="width:${Math.min(180, Math.max(10, b.widthMm))}mm"></div>`;
    case "pageBreak":
      return `<div class="break"></div>`;
    case "footer":
      return `<p class="note">${esc(renderMerge(b.text, merge))}</p>`;
  }
}

function footerHtml(lh: Letterhead, o: PrintOptions, ref: string | null): string {
  return `<footer class="foot"><span>${esc(lh.legalEntity)}${lh.address ? ` · ${esc(lh.address.replace(/\s*\r?\n\s*/g, ", "))}` : ""}${lh.footerText ? ` · ${esc(lh.footerText)}` : ""}</span><span>Printed by ${esc(o.printedBy)} on ${esc(stamp(o.printedAt))}${ref ? ` · ${esc(ref)}` : ""}</span></footer>`;
}

const watermarkHtml = (text: string | null | undefined) => (text ? `<div class="wm" aria-hidden="true"><span>${esc(text)}</span></div>` : "");

function documentHtml(title: string, css: string, body: string, toolbar = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${css}</style></head><body>${toolbar}${body}</body></html>`;
}

/**
 * One or more records on a letterhead. `letterheadFor` returns the letterhead of each record – for a brand-owned
 * record that is ALWAYS its own brand's (the caller cannot pass another one, see print/service.ts).
 */
export function renderRecordsHtml(input: { records: PrintRecord[]; layout: PrintLayout; letterheadFor: (r: PrintRecord) => Letterhead; options: PrintOptions; toolbar?: string; extraCss?: string }): string {
  const { records, layout, options } = input;
  const first = records[0] ? input.letterheadFor(records[0]) : null;
  const m = layout.margins;
  const pageCss = m ? `\n@page { margin: ${mm(m.top)} ${mm(m.right)} ${mm(Math.max(m.bottom, 12))} ${mm(m.left)}; }\n@media screen { .sheet { padding: ${mm(m.top)} ${mm(m.right)} ${mm(m.bottom)} ${mm(m.left)}; } }\n` : "";
  const css = printCss({ paper: options.paper, orientation: options.orientation, color: safeColor(first?.color) }) + pageCss + (layout.css ? `\n.sheet { ${layout.css} }\n` : "") + (input.extraCss ?? "");
  const hasLetterhead = layout.blocks.some((b) => b.type === "letterhead");
  const sheets = records
    .map((record) => {
      const lh = input.letterheadFor(record);
      const paged = layout.header !== undefined || layout.footer !== undefined || layout.headerLetterhead !== undefined;
      const blocks = (hasLetterhead || paged ? layout.blocks : [{ type: "letterhead" } as PrintBlock, ...layout.blocks]).map((b) => blockHtml(b, record, lh, options)).join("\n");
      // per-record brand colour: a bulk print can mix brands
      const open = `<section class="sheet record" data-record="${esc(record.id)}" data-module="${esc(record.module)}" style="--c:${safeColor(lh.color)}">${watermarkHtml(options.watermark)}`;
      if (!paged) return `${open}${blocks}${footerHtml(lh, options, record.number)}</section>`;
      // document templates: header and footer sit in the head / foot of a page table, which browsers repeat on every page
      const merge = mergeOf(record, lh, options);
      const extra = { ...extraOf(record), page: "", pages: "" };
      const head = `${layout.headerLetterhead ? letterheadHtml(lh, layout.headerLetterhead) : ""}${layout.header ? `<div class="rich pg-head">${renderMergeHtml(layout.header, merge, extra)}</div>` : ""}`;
      const foot = layout.footer ? `<div class="rich pg-foot">${renderMergeHtml(layout.footer, merge, extra)}</div>` : "";
      return `${open}<table class="pg" role="presentation">${head ? `<thead><tr><td data-region="header">${head}</td></tr></thead>` : ""}${foot ? `<tfoot><tr><td data-region="footer">${foot}</td></tr></tfoot>` : ""}<tbody><tr><td data-region="body">${blocks}</td></tr></tbody></table></section>`;
    })
    .join("\n");
  const title = records.length === 1 ? `${records[0]!.moduleLabel} – ${records[0]!.title}` : `${records.length} ${records[0]?.moduleLabel ?? "records"}`;
  return documentHtml(title, css, sheets, input.toolbar);
}

export interface ListPrint {
  title: string;
  subtitle: string;
  columns: Array<{ label: string; align: "left" | "right" }>;
  rows: string[][];
  /** label → value shown under the table (e.g. "Total records", "Total amount") */
  totals: Array<{ label: string; value: string }>;
}

/** A list view (or report table) as a table on one letterhead. */
export function renderListHtml(input: { list: ListPrint; letterhead: Letterhead; options: PrintOptions; toolbar?: string }): string {
  const { list, letterhead: lh, options } = input;
  const css = printCss({ paper: options.paper, orientation: options.orientation, color: safeColor(lh.color) });
  const body = `<section class="sheet" data-list="true">${watermarkHtml(options.watermark)}${letterheadHtml(lh)}
<h1 class="title">${esc(list.title)}</h1><div class="subtitle">${esc(list.subtitle)}</div>
<table class="t"><thead><tr>${list.columns.map((c) => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${list.rows
    .map((r) => `<tr>${r.map((v, i) => `<td class="${list.columns[i]!.align === "right" ? "r" : ""}">${esc(v)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>
<div class="totals">${list.totals.map((t, i) => `<div class="${i === list.totals.length - 1 ? "strong" : ""}"><span>${esc(t.label)}</span><span>${esc(t.value)}</span></div>`).join("")}</div>
${footerHtml(lh, options, null)}</section>`;
  return documentHtml(list.title, css, body, input.toolbar);
}

// ───────────────────────────── built-in layouts ─────────────────────────────

/** The default layout of a module, built from the fields of a record of that module. */
export function defaultLayout(record: Pick<PrintRecord, "fields" | "lines" | "tables" | "totals" | "moduleLabel" | "vin" | "number">): PrintLayout {
  const skip = new Set(["name", "terms", "termsAndConditions", "description", "notes"]);
  const keys = record.fields.filter((f) => !skip.has(f.key) && f.value.length <= 120).map((f) => f.key);
  const long = record.fields.filter((f) => ["description", "notes"].includes(f.key) && f.value);
  const blocks: PrintBlock[] = [
    { type: "letterhead" },
    { type: "title", text: `${record.moduleLabel}: {{record.name}}` },
    { type: "fields", columns: 2, fields: keys },
  ];
  for (const f of long) blocks.push({ type: "fields", title: f.label, columns: 1, fields: [f.key] });
  if (record.lines) blocks.push({ type: "lineItems", title: "Items" });
  for (const t of record.tables.filter((x) => x.key !== "lines").slice(0, 3)) blocks.push({ type: "related", list: t.key });
  if (record.totals.length) blocks.push({ type: "totals" });
  if (record.vin) blocks.push({ type: "barcode", value: "vin" });
  blocks.push({ type: "qr", value: "url" });
  return { blocks };
}

export interface BuiltinTemplate {
  /** stable id used in URLs: "builtin:<key>" */
  key: string;
  name: string;
  modules: string[];
  /** only offered when the record matches (e.g. the gate pass for gate-pass documents) */
  when?: (record: PrintRecord) => boolean;
  layout: (record: PrintRecord) => PrintLayout;
}

const customerFields = ["account", "customerName", "contact", "customerPhone", "customerEmail", "email", "mobile", "phone"];
const docFields = ["number", "status", "issueDate", "quoteDate", "orderDate", "invoiceDate", "validUntil", "dueDate", "deal", "owner", "currency", "paymentTerms"];

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  { key: "standard", name: "Standard", modules: ["*"], layout: (r) => defaultLayout(r) },
  {
    key: "document",
    name: "Commercial document",
    modules: ["quotes", "salesOrders", "invoices"],
    layout: (r) => ({
      blocks: [
        { type: "letterhead" },
        { type: "title", text: `${r.moduleLabel.toUpperCase()} {{record.number}}` },
        { type: "fields", title: "Customer", columns: 2, fields: customerFields },
        { type: "fields", title: "Details", columns: 2, fields: docFields },
        { type: "lineItems", title: "Items" },
        { type: "totals" },
        { type: "terms" },
        { type: "signatures", roles: ["Customer", "Sales Executive", "Brand Manager"] },
        { type: "barcode", value: "number" },
      ],
    }),
  },
  {
    key: "booking-receipt",
    name: "Booking receipt",
    modules: ["deals"],
    layout: () => ({
      blocks: [
        { type: "letterhead" },
        { type: "title", text: "BOOKING RECEIPT" },
        { type: "richText", html: "<p>Received from <strong>{{deal.customerName | \"the customer\"}}</strong> the booking deposit for the vehicle described below.</p>" },
        { type: "fields", columns: 2, fields: ["name", "account", "contact", "model", "colour", "vinChassisNo", "amount", "depositAmount", "depositReceiptNo", "paymentType", "financeBank", "owner"] },
        { type: "richText", html: "<p>This receipt confirms the booking only. The balance is payable before delivery, as stated in the sales order.</p>" },
        { type: "signatures", roles: ["Customer", "Sales Executive", "Accounts"] },
        { type: "qr", value: "url" },
      ],
    }),
  },
  {
    key: "test-drive-indemnity",
    name: "Test drive indemnity",
    modules: ["activities"],
    when: (r) => /test.?drive/i.test(String(r.merge.record?.type ?? "")),
    layout: () => ({
      blocks: [
        { type: "letterhead" },
        { type: "title", text: "TEST DRIVE INDEMNITY" },
        { type: "fields", columns: 2, fields: ["subject", "dueAt", "startAt", "owner", "location", "parentType"] },
        { type: "related", list: "testDrive", title: "Test drive" },
        {
          type: "richText",
          html: "<p>I confirm that I hold a valid driving licence, that I will drive the vehicle with care and within the law, and that I am responsible for any traffic offence committed while I am driving. I accept that {{brand.legalEntity}} may charge me for damage caused by my negligence.</p>",
        },
        { type: "signatures", roles: ["Customer", "Sales Executive"] },
      ],
    }),
  },
  {
    key: "gate-pass",
    name: "Gate pass",
    modules: ["inventoryDocuments"],
    when: (r) => /gate/i.test(String(r.merge.record?.type ?? "")),
    layout: () => ({
      blocks: [
        { type: "letterhead" },
        { type: "title", text: "GATE PASS {{record.number}}" },
        { type: "fields", columns: 2, fields: ["number", "status", "docDate", "warehouse", "toWarehouse", "reference", "notes", "owner"] },
        { type: "lineItems", title: "Vehicles / items leaving the premises" },
        { type: "richText", html: "<p>Security: check every VIN against this pass before the vehicle leaves.</p>" },
        { type: "signatures", roles: ["Issued by", "Security", "Received by"] },
        { type: "barcode", value: "number" },
      ],
    }),
  },
];

export function builtinsFor(record: PrintRecord): BuiltinTemplate[] {
  return BUILTIN_TEMPLATES.filter((t) => (t.modules.includes("*") || t.modules.includes(record.module)) && (!t.when || t.when(record)));
}
