/**
 * Turns a record – exactly as the module's own query returned it for THIS user (scoped, field-masked) – into what
 * the print engine needs: labelled fields, tables of related rows, totals and merge data. Pure.
 *
 * Nothing is loaded here and nothing is added: a field the user's query did not return cannot be printed.
 */
import type { MergeData, MergeValue } from "@/server/modules/messaging/merge";

export type FieldKind = "text" | "money" | "number" | "percent" | "date" | "datetime" | "bool";

export interface PrintField {
  key: string;
  label: string;
  value: string;
  kind: FieldKind;
}

export interface PrintTable {
  key: string;
  title: string;
  columns: Array<{ key: string; label: string; align: "left" | "right" }>;
  rows: string[][];
}

export interface PrintRecord {
  module: string;
  moduleLabel: string;
  id: string;
  title: string;
  /** document / case / unit number, when the record has one */
  number: string | null;
  brandId: string | null;
  fields: PrintField[];
  tables: PrintTable[];
  /** line items of a document (also present in `tables` under "lines") */
  lines: PrintTable | null;
  totals: Array<{ label: string; value: string; strong: boolean }>;
  terms: string | null;
  vin: string | null;
  merge: MergeData;
}

const HIDDEN = new Set(["id", "deletedAt", "customFields", "passwordHash", "storageKey", "utm", "logoData", "logoMimeType", "territoryId", "createdById", "updatedById", "mergedIntoId", "definition", "payload", "layout", "permissions"]);
const MONEY = /(amount|price|total|cost|budget|balance|paid|deposit|value|subtotal|charge|fee|vat$|tax$)/i;
const PERCENT = /(pct|percent|probability|rate)$/i;
const DATE_ONLY = /(date|on|dob|birthday|expiry|until|from)$/i;

const money = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });

/** "closeDate" → "Close date", "vinChassisNo" → "Vin chassis no", "kycStatus" → "Kyc status". */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .trim()
    .toLowerCase();
  const fixed = words.replace(/\bvin\b/g, "VIN").replace(/\bkyc\b/g, "KYC").replace(/\bvat\b/g, "VAT").replace(/\brc\b/g, "RC").replace(/\bsla\b/g, "SLA").replace(/\bpdi\b/g, "PDI").replace(/\bid\b/g, "ID");
  return fixed.charAt(0).toUpperCase() + fixed.slice(1);
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date) && !isDecimal(v);
const isDecimal = (v: unknown): v is { toNumber?: () => number; toFixed: (n?: number) => string } => typeof v === "object" && v !== null && typeof (v as { toFixed?: unknown }).toFixed === "function";

/** A scalar the engine can print, or undefined for everything else (objects, arrays, bytes). */
function scalar(v: unknown): MergeValue | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  if (typeof v === "bigint") return Number(v);
  if (isDecimal(v)) return Number(v.toFixed(4));
  return undefined;
}

function kindOf(key: string, v: MergeValue): FieldKind {
  if (typeof v === "boolean") return "bool";
  if (v instanceof Date) return DATE_ONLY.test(key) ? "date" : "datetime";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return DATE_ONLY.test(key) ? "date" : "datetime";
  if (typeof v === "number") return PERCENT.test(key) ? "percent" : MONEY.test(key) ? "money" : "number";
  return "text";
}

export function formatValue(v: MergeValue, kind: FieldKind): string {
  if (v === null || v === undefined || v === "") return "";
  switch (kind) {
    case "bool":
      return v ? "Yes" : "No";
    case "money":
      return `₦ ${money.format(Number(v))}`;
    case "percent":
      return `${num.format(Number(v))} %`;
    case "number":
      return num.format(Number(v));
    case "date":
    case "datetime": {
      const d = v instanceof Date ? v : new Date(String(v));
      if (Number.isNaN(d.getTime())) return String(v);
      return kind === "date" ? dateFmt.format(d) : `${dateFmt.format(d)} ${timeFmt.format(d)}`;
    }
    default:
      // enum-like values read better in sentence case: "CLOSED_WON" → "Closed won"
      return typeof v === "string" && /^[A-Z][A-Z0-9_]+$/.test(v) ? humanize(v.toLowerCase()) : String(v);
  }
}

/** The printable name of a nested object (owner → its name, brand → "HMNL – Hyundai", contact → first + last). */
function nameOf(o: Record<string, unknown>): string | null {
  const s = (k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : null);
  if (s("firstName") || s("lastName")) return [s("firstName"), s("lastName")].filter(Boolean).join(" ");
  if (s("code") && s("name")) return `${s("code")} – ${s("name")}`;
  return s("name") ?? s("number") ?? s("subject") ?? s("title") ?? s("vin") ?? s("code") ?? s("label") ?? null;
}

const LINE_COLUMNS = ["description", "productName", "product", "name", "vin", "quantity", "qty", "unitPrice", "price", "discountPct", "discount", "taxPct", "unitCost", "lineTotal", "total", "amount"];

function tableOf(key: string, rows: Array<Record<string, unknown>>): PrintTable | null {
  if (!rows.length) return null;
  const seen: string[] = [];
  for (const r of rows.slice(0, 20)) {
    for (const [k, v] of Object.entries(r)) {
      if (seen.includes(k) || HIDDEN.has(k) || /Id$/.test(k)) continue;
      if (scalar(v) !== undefined || (isPlain(v) && nameOf(v))) seen.push(k);
    }
  }
  // line items: the columns people expect, in the usual order; other tables: the first eight columns
  const preferred = LINE_COLUMNS.filter((c) => seen.includes(c));
  const keys = (key === "lines" && preferred.length >= 2 ? preferred : seen).slice(0, 8);
  if (!keys.length) return null;
  const sample = (k: string) => rows.map((r) => r[k]).find((v) => v !== null && v !== undefined);
  const kinds = keys.map((k) => {
    const v = sample(k);
    const sc = isPlain(v) ? nameOf(v) : scalar(v);
    return kindOf(k, sc ?? null);
  });
  return {
    key,
    title: humanize(key),
    columns: keys.map((k, i) => ({ key: k, label: humanize(k), align: ["money", "number", "percent"].includes(kinds[i]!) ? "right" : "left" })),
    rows: rows.slice(0, 500).map((r) =>
      keys.map((k, i) => {
        const v = r[k];
        return isPlain(v) ? (nameOf(v) ?? "") : formatValue(scalar(v) ?? null, kinds[i]!);
      }),
    ),
  };
}

const TOTAL_KEYS: Array<[string, string, boolean]> = [
  ["subtotal", "Subtotal", false],
  ["discountTotal", "Discount", false],
  ["taxTotal", "VAT", false],
  ["vatAmount", "VAT", false],
  ["total", "Total", true],
  ["grandTotal", "Total", true],
  ["amountPaid", "Paid", false],
  ["balance", "Balance due", true],
  ["balanceDue", "Balance due", true],
];

export function describeRecord(input: { module: string; moduleLabel: string; mergeName: string; record: Record<string, unknown> }): PrintRecord {
  const { record } = input;
  const fields: PrintField[] = [];
  const tables: PrintTable[] = [];
  const root: Record<string, MergeValue> = {};
  const merge: MergeData = {};

  for (const [key, raw] of Object.entries(record)) {
    if (HIDDEN.has(key) || /Id$/.test(key)) continue;
    const sc = scalar(raw);
    if (sc !== undefined) {
      const kind = kindOf(key, sc);
      root[key] = sc;
      fields.push({ key, label: humanize(key), value: formatValue(sc, kind), kind });
    } else if (Array.isArray(raw)) {
      const rows = raw.filter(isPlain);
      const table = tableOf(key, rows);
      if (table) tables.push(table);
      else if (raw.length && raw.every((x) => typeof x === "string")) fields.push({ key, label: humanize(key), value: (raw as string[]).join(", "), kind: "text" });
    } else if (isPlain(raw)) {
      const name = nameOf(raw);
      if (name) {
        fields.push({ key, label: humanize(key), value: name, kind: "text" });
        root[key] = name;
      }
      const group: Record<string, MergeValue> = { ...(name ? { name } : {}) };
      for (const [k, v] of Object.entries(raw)) {
        if (HIDDEN.has(k) || /Id$/.test(k)) continue;
        const inner = scalar(v);
        if (inner !== undefined) group[k] = inner;
      }
      merge[key] = group;
    }
  }
  // custom fields print like any other field, under their own key
  if (isPlain(record.customFields)) {
    for (const [k, v] of Object.entries(record.customFields)) {
      const sc = scalar(v);
      if (sc === undefined || sc === null || sc === "") continue;
      const kind = kindOf(k, sc);
      root[k] ??= sc;
      fields.push({ key: `cf.${k}`, label: humanize(k), value: formatValue(sc, kind), kind });
    }
  }

  const str = (k: string) => (typeof record[k] === "string" && record[k] ? (record[k] as string) : null);
  const person = [str("firstName"), str("lastName")].filter(Boolean).join(" ") || null;
  const number = str("number") ?? str("code");
  const title = str("name") ?? person ?? (number && str("subject") ? `${number} – ${str("subject")}` : null) ?? str("subject") ?? number ?? str("vin") ?? `${input.moduleLabel} ${String(record.id ?? "")}`;
  root.name ??= title;
  merge[input.mergeName] = root;
  merge.record = root;

  // the balance of an invoice is computed here, from the server-side amounts – a template cannot state one
  if (typeof root.total === "number" && typeof root.amountPaid === "number" && root.balance === undefined && root.balanceDue === undefined) root.balance = Math.round((root.total - root.amountPaid) * 100) / 100;
  const lines = tables.find((t) => t.key === "lines") ?? null;
  const totals = TOTAL_KEYS.filter(([k]) => typeof root[k] === "number").map(([k, label, strong]) => ({ label, value: formatValue(root[k]!, "money"), strong }));

  return {
    module: input.module,
    moduleLabel: input.moduleLabel,
    id: String(record.id ?? ""),
    title,
    number: number ?? null,
    brandId: typeof record.brandId === "string" ? record.brandId : null,
    fields,
    tables,
    lines,
    // labels may repeat (total / grandTotal): keep the first of each
    totals: totals.filter((t, i) => totals.findIndex((x) => x.label === t.label) === i),
    terms: str("terms") ?? str("termsAndConditions") ?? null,
    vin: str("vin") ?? str("vinChassisNo") ?? null,
    merge,
  };
}
