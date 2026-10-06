/**
 * Document templates (prompt 21): the content model of the rich template builder and its compiler.
 *
 * A template is a page with three regions – header (repeats on every page), body (smart blocks and rich text) and
 * footer (repeats) – and is COMPILED for one record into a layout of the print engine of prompt 20. So a document
 * template prints, downloads, bulk-prints and attaches to e-mails through exactly the same pipeline, with the same
 * access rules, as every other printout.
 *
 * Pure functions: the record is already loaded with the user's access and field mask; nothing is read here.
 * Amounts and totals come from the record, never from the template.
 */
import { escapeHtml as esc, renderMerge, renderMergeHtml, type MergeData, type MergeValue } from "@/server/modules/messaging/merge";
import { extraOf, mergeOf, type Letterhead, type LetterheadStyle, type Margins, type PrintBlock, type PrintLayout } from "@/server/modules/print/blocks";
import { formatValue, type PrintRecord } from "@/server/modules/print/describe";

export const CONDITION_OPS = ["eq", "ne", "gt", "lt", "empty", "notEmpty"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export const CONDITION_LABELS: Record<ConditionOp, string> = { eq: "is", ne: "is not", gt: "is greater than", lt: "is less than", empty: "is empty", notEmpty: "is not empty" };

export type DocBlock =
  | { type: "rich"; html: string }
  | { type: "title"; text: string; showNumber: boolean; showDates: boolean }
  | { type: "parties"; shipTo: boolean }
  | { type: "fields"; title?: string; columns: 1 | 2 | 3; fields: string[] }
  | { type: "lineItems"; title?: string; columns: string[]; zebra: boolean }
  | { type: "totals"; words: boolean }
  | { type: "payment"; terms?: string }
  | { type: "vehicle" }
  | { type: "terms"; html?: string }
  | { type: "signatures"; roles: string[]; stamp: boolean }
  | { type: "qr"; value: "url" | "vin" | "number" }
  | { type: "barcode"; value: "vin" | "number" }
  | { type: "conditional"; field: string; op: ConditionOp; value: string; html: string }
  | { type: "repeat"; list: string; title?: string; html: string }
  | { type: "related"; list: string; title?: string }
  | { type: "pageBreak" };

export interface DocContent {
  letterhead: { show: boolean } & Required<LetterheadStyle>;
  /** rich text at the top of every page (below the letterhead) */
  header: string;
  body: DocBlock[];
  /** rich text at the bottom of every page; a line with {{page}} / {{pages}} becomes the page-number line */
  footer: string;
}

export const DOC_BLOCK_LABELS: Record<DocBlock["type"], string> = {
  rich: "Text",
  title: "Document title & number",
  parties: "Bill to / Ship to",
  fields: "Field grid",
  lineItems: "Line-items table",
  totals: "Totals",
  payment: "Payment details",
  vehicle: "Vehicle card",
  terms: "Terms & conditions",
  signatures: "Signature & stamp",
  qr: "QR code",
  barcode: "Barcode",
  conditional: "Conditional section",
  repeat: "Repeating section",
  related: "Related list table",
  pageBreak: "Page break",
};

export const DOC_BLOCK_HINTS: Record<DocBlock["type"], string> = {
  rich: "Free text with formatting, tables, images and merge fields",
  title: "The document's name with its number and dates",
  parties: "Customer name, address, phone and e-mail from the record",
  fields: "Any fields of the record in one to three columns",
  lineItems: "The items of the document; the column header repeats on every page",
  totals: "Subtotal, VAT, total, paid and balance as computed by the system; optional amount in words",
  payment: "The company's bank details and payment terms",
  vehicle: "Model, colour, VIN and engine number of the record's vehicle",
  terms: "The record's terms, or your own text",
  signatures: "Signature lines and an optional box for the company stamp",
  qr: "A QR code of the record's address, VIN or number",
  barcode: "A barcode of the VIN or document number",
  conditional: "Text that prints only when a field has a certain value",
  repeat: "Your own text once per row of a related list",
  related: "A related list as a table",
  pageBreak: "Continue on a new page",
};

export const DEFAULT_MARGINS: Margins = { top: 14, right: 14, bottom: 18, left: 14 };
export const PAPERS = ["A4", "LETTER", "A5"] as const;
export const VISIBILITIES = ["PERSONAL", "SHARED_BRAND", "GROUP"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const STATUSES = ["DRAFT", "PENDING_APPROVAL", "PUBLISHED", "ARCHIVED"] as const;
export type TemplateStatus = (typeof STATUSES)[number];
export const VISIBILITY_LABELS: Record<Visibility, string> = { PERSONAL: "Personal", SHARED_BRAND: "Shared (brand)", GROUP: "Group" };
export const STATUS_LABELS: Record<TemplateStatus, string> = { DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", PUBLISHED: "Published", ARCHIVED: "Archived" };

/** Official financial documents: sent, printed and downloaded with shared, published templates only (prompt 21 §4). */
export const FINANCIAL_MODULES = ["invoices", "salesOrders", "inventoryDocuments"];

export const emptyContent = (): DocContent => ({ letterhead: { show: true, logo: "left", details: "beside" }, header: "", body: [{ type: "rich", html: "<p></p>" }], footer: "<p>Page {{page}} of {{pages}}</p>" });

// ───────────────────────────── values and conditions ─────────────────────────────

/** A value of the record by "group.field" or a bare field name of the record itself. Own properties only. */
export function valueOf(merge: MergeData, path: string): MergeValue {
  const [a, b] = path.trim().split(".");
  if (!a) return undefined;
  const group = b ? (Object.hasOwn(merge, a) ? merge[a] : undefined) : (merge.record ?? undefined);
  const key = b ?? a;
  return group && Object.hasOwn(group, key) ? group[key] : undefined;
}

const isEmpty = (v: MergeValue) => v === null || v === undefined || v === "" || v === false;
const norm = (v: MergeValue | string) => (v instanceof Date ? v.toISOString() : String(v ?? "")).trim().toLowerCase().replace(/[\s_-]+/g, " ");

/** Does the condition of a conditional section hold for the record? Numbers compare as numbers, text ignoring case. */
export function conditionHolds(merge: MergeData, c: { field: string; op: ConditionOp; value: string }): boolean {
  const v = valueOf(merge, c.field);
  switch (c.op) {
    case "empty":
      return isEmpty(v);
    case "notEmpty":
      return !isEmpty(v);
    case "eq":
    case "ne": {
      const same = typeof v === "number" && c.value.trim() !== "" && Number.isFinite(Number(c.value)) ? v === Number(c.value) : typeof v === "boolean" ? v === ["yes", "true", "1"].includes(norm(c.value)) : norm(v) === norm(c.value);
      return c.op === "eq" ? same : !same;
    }
    case "gt":
    case "lt": {
      const [x, y] = [Number(v), Number(c.value)];
      if (isEmpty(v) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      return c.op === "gt" ? x > y : x < y;
    }
  }
}

// ───────────────────────────── compiler ─────────────────────────────

const first = (merge: MergeData, paths: string[]): string => {
  for (const p of paths) {
    const v = valueOf(merge, p);
    if (!isEmpty(v)) return v instanceof Date ? formatValue(v, "date") : String(v);
  }
  return "";
};
const lines = (parts: string[]) => parts.filter(Boolean).map((p) => esc(p).replace(/\r?\n/g, "<br>")).join("<br>");

function partyHtml(title: string, merge: MergeData, own: boolean): string {
  // the customer of the record: its account, else its contact, else the record itself (leads, contacts, accounts)
  // documents print their bill-to snapshot first (prompt 23): complete even without an account
  const g = own ? ["record"] : ["billTo", "account", "contact", "customer", "record"];
  const pick = (keys: string[]) => first(merge, g.flatMap((x) => keys.map((k) => `${x}.${k}`)));
  const name = first(merge, own ? ["record.name"] : ["billTo.name", "account.name", "contact.name", "record.customerName", "record.accountName", "record.contactName", "customer.name"]);
  const company = own ? "" : first(merge, ["billTo.company"]);
  const body = lines([name, company !== name ? company : "", pick(["billingAddress", "address", "street"]), [pick(["city"]), pick(["state"])].filter(Boolean).join(", "), pick(["phone", "mobile"]), pick(["email"]), pick(["tin", "taxId"]) ? `TIN ${pick(["tin", "taxId"])}` : ""]);
  return `<div class="party"><h3>${esc(title)}</h3><p>${body || "&nbsp;"}</p></div>`;
}

function shipToHtml(merge: MergeData): string {
  const name = first(merge, ["shipTo.name", "billTo.name", "account.name", "contact.name", "record.customerName", "record.name"]);
  const address = first(merge, ["shipTo.address", "record.shippingAddress", "record.deliveryAddress", "account.shippingAddress", "account.billingAddress", "account.address", "contact.address"]);
  return `<div class="party"><h3>Ship to</h3><p>${lines([name, address]) || "&nbsp;"}</p></div>`;
}

function titleHtml(b: Extract<DocBlock, { type: "title" }>, record: PrintRecord, merge: MergeData, extra: Record<string, string>): string {
  const date = first(merge, ["record.issueDate", "record.invoiceDate", "record.orderDate", "record.quoteDate", "record.date", "record.createdAt"]);
  const due = first(merge, ["record.dueDate", "record.validUntil", "record.deliveryDate"]);
  const fmt = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? formatValue(s, "date") : s);
  const dueLabel = valueOf(merge, "record.dueDate") ? "Due date" : valueOf(merge, "record.validUntil") ? "Valid until" : "Delivery date";
  const dates = b.showDates && (date || due) ? `<dl>${date ? `<dt>Date</dt><dd>${esc(fmt(date))}</dd>` : ""}${due ? `<dt>${dueLabel}</dt><dd>${esc(fmt(due))}</dd>` : ""}</dl>` : "";
  return `<div class="doc-head" data-block="title"><div><h1>${esc(renderMerge(b.text, merge, extra))}</h1>${b.showNumber && record.number ? `<div class="no">${esc(record.number)}</div>` : ""}</div>${dates}</div>`;
}

function vehicleHtml(record: PrintRecord, merge: MergeData): string {
  const rows: Array<[string, string]> = [
    ["Model", first(merge, ["record.model", "record.modelName", "model.name", "product.name", "record.productName"])],
    ["Variant", first(merge, ["record.variant", "product.variant"])],
    ["Colour", first(merge, ["record.colour", "record.color", "record.exteriorColour"])],
    ["VIN", record.vin ?? ""],
    ["Engine no.", first(merge, ["record.engineNo", "record.engineNumber"])],
  ];
  const shown = rows.filter(([, v]) => v);
  return shown.length ? `<div class="box" data-block="vehicle"><h3>Vehicle</h3><dl class="grid c2">${shown.map(([l, v]) => `<div class="fld"><dt>${l}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>` : "";
}

function repeatHtml(b: Extract<DocBlock, { type: "repeat" }>, record: PrintRecord, merge: MergeData, extra: Record<string, string>): string {
  const t = record.tables.find((x) => x.key === b.list);
  if (!t?.rows.length) return "";
  const rows = t.rows.map((r, i) => {
    const row: Record<string, MergeValue> = { index: i + 1 };
    t.columns.forEach((c, n) => (row[c.key] = r[n] ?? ""));
    return `<div class="rich" data-row="${i + 1}">${renderMergeHtml(b.html, { ...merge, row }, extra)}</div>`;
  });
  return `${b.title ? `<h2 class="block-title">${esc(b.title)}</h2>` : ""}${rows.join("")}`;
}

/** Splits the footer into the rich part and the page-number line (the paragraph that uses {{page}} / {{pages}}). */
export function splitFooter(footer: string): { html: string; pageLine: string | null } {
  let pageLine: string | null = null;
  const html = footer.replace(/<p\b[^>]*>((?:(?!<\/p>)[\s\S])*\{\{\s*pages?\s*\}\}(?:(?!<\/p>)[\s\S])*)<\/p>/gi, (_m, inner: string) => {
    pageLine ??= inner.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    return "";
  });
  return { html: html.replace(/\{\{\s*pages?\s*\}\}/g, "").trim(), pageLine };
}

/**
 * The template's content for one record on its letterhead → a layout of the print engine. The letterhead is the one
 * the print service chose for the record (a brand-owned record: always its own brand's) – a template cannot name one.
 */
export function compileDoc(content: DocContent, record: PrintRecord, lh: Letterhead, o: { printedBy: string; margins?: Margins | null; css?: string | null }): PrintLayout {
  const merge = mergeOf(record, lh, o);
  const extra = extraOf(record);
  const html = (h: string): PrintBlock[] => (h ? [{ type: "html", html: h }] : []);
  const blocks = content.body.flatMap((b): PrintBlock[] => {
    switch (b.type) {
      case "rich":
        return [{ type: "richText", html: b.html }];
      case "title":
        return html(titleHtml(b, record, merge, extra));
      case "parties":
        return html(`<div class="parties" data-block="parties">${partyHtml("Bill to", merge, !["billTo", "account", "contact", "customer"].some((g) => merge[g]) && !valueOf(merge, "record.customerName"))}${b.shipTo ? shipToHtml(merge) : ""}</div>`);
      case "fields":
        return [{ type: "fields", title: b.title, columns: b.columns, fields: b.fields }];
      case "lineItems":
        return [{ type: "lineItems", title: b.title, columns: b.columns, zebra: b.zebra }];
      case "totals":
        return [{ type: "totals", words: b.words }];
      case "payment": {
        const bank = lh.bankDetails ? `<p>${esc(lh.bankDetails).replace(/\r?\n/g, "<br>")}</p>` : "";
        const terms = b.terms ? `<p>${esc(renderMerge(b.terms, merge, extra)).replace(/\r?\n/g, "<br>")}</p>` : "";
        return html(bank || terms ? `<div class="box" data-block="payment"><h3>Payment details</h3>${bank}${terms}</div>` : "");
      }
      case "vehicle":
        return html(vehicleHtml(record, merge));
      case "terms":
        return [{ type: "terms", html: b.html || undefined, bank: !content.body.some((x) => x.type === "payment") }];
      case "signatures":
        return [{ type: "signatures", roles: b.roles, stamp: b.stamp }];
      case "qr":
        return [{ type: "qr", value: b.value }];
      case "barcode":
        return [{ type: "barcode", value: b.value }];
      case "conditional":
        return conditionHolds(merge, b) ? [{ type: "richText", html: b.html }] : [];
      case "repeat":
        return html(repeatHtml(b, record, merge, extra));
      case "related":
        return [{ type: "related", list: b.list, title: b.title }];
      case "pageBreak":
        return [{ type: "pageBreak" }];
    }
  });
  const footer = splitFooter(content.footer);
  return { blocks, header: content.header, headerLetterhead: content.letterhead.show ? { logo: content.letterhead.logo, details: content.letterhead.details } : null, footer: footer.html, pageLine: footer.pageLine ?? undefined, margins: o.margins ?? DEFAULT_MARGINS, css: o.css ?? undefined };
}

/** All text of a template that can hold merge fields (lint, search). */
export function contentSource(c: DocContent): string {
  return [c.header, c.footer, ...c.body.map((b) => (b.type === "rich" || b.type === "conditional" || b.type === "repeat" ? b.html : b.type === "title" ? b.text : b.type === "terms" ? (b.html ?? "") : b.type === "payment" ? (b.terms ?? "") : ""))].join("\n");
}

// ───────────────────────────── restricted CSS ─────────────────────────────

const FONTS = ["Lato", "Inter", "Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New"];
export const CSS_FONTS = FONTS;
const CSS_RULES: Record<string, RegExp> = {
  "font-family": new RegExp(`^(${FONTS.join("|")})$`, "i"),
  "font-size": /^(8|9|10|11|12)pt$/,
  "line-height": /^1(\.\d{1,2})?$|^2$/,
  color: /^#[0-9a-fA-F]{6}$/,
};

/** Cleaned declarations → CSS for the sheet (font names quoted, with fallbacks). */
export const sheetCss = (css: string | null | undefined) => cleanCss(css).css.replace(/font-family: ([^;]+)/, (_m, f: string) => `font-family: "${f}", Arial, sans-serif`);

/** Keeps only allow-listed declarations ("font-family: Georgia; font-size: 11pt"); everything else is dropped. */
export function cleanCss(raw: string | null | undefined): { css: string; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const decl of (raw ?? "").split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) {
      if (decl.trim()) dropped.push(decl.trim());
      continue;
    }
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (CSS_RULES[prop]?.test(value)) kept.push(`${prop}: ${prop === "font-family" ? FONTS.find((f) => f.toLowerCase() === value.toLowerCase()) : value}`);
    else dropped.push(prop || decl.trim());
  }
  return { css: kept.join("; "), dropped };
}
