/**
 * Merge fields of message and print templates (pure, unit-tested):
 *   {{contact.firstName}}  {{deal.model}}  {{brand.name}}  {{today}}
 *   {{contact.firstName | "Customer"}}        fallback when the value is empty
 *   {{deal.amount | currency}}  {{deal.closeDate | date}}  {{deal.name | upper}}  {{account.name | lower}}  {{x | number}}
 * Unknown fields render empty. `renderMerge` inserts values as plain text; `renderMergeHtml` is for HTML
 * templates and escapes every merged value, so a value can never inject markup.
 */
export type MergeValue = string | number | boolean | Date | null | undefined;
export type MergeData = Record<string, Record<string, MergeValue>>;

export const MERGE_FIELDS: Array<{ field: string; label: string }> = [
  { field: "contact.firstName", label: "Customer first name" },
  { field: "contact.lastName", label: "Customer last name" },
  { field: "contact.name", label: "Customer full name" },
  { field: "deal.name", label: "Deal name" },
  { field: "deal.model", label: "Model" },
  { field: "case.number", label: "Case number" },
  { field: "case.subject", label: "Case subject" },
  { field: "surveyUrl", label: "Satisfaction survey link (cases)" },
  { field: "brand.name", label: "Brand name" },
  { field: "brand.code", label: "Brand code" },
  { field: "owner.name", label: "Sales exec name" },
  { field: "unsubscribeUrl", label: "Unsubscribe link (campaigns)" },
];

/** {{ group.field | "fallback" | format }} – group and field are identifiers; filters are optional. */
const FIELD = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)(?:\.([a-zA-Z][a-zA-Z0-9_]*))?\s*((?:\|\s*(?:"[^"{}]*"|[a-zA-Z]+)\s*)*)\}\}/g;
const FILTER = /\|\s*(?:"([^"{}]*)"|([a-zA-Z]+))/g;

export const MERGE_FORMATS = ["currency", "usd", "number", "date", "datetime", "upper", "lower", "title", "words"] as const;

const ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
  const rest = n % 100;
  if (rest) parts.push((parts.length ? "and " : "") + (rest < 20 ? ONES[rest]! : TENS[Math.floor(rest / 10)]! + (rest % 10 ? `-${ONES[rest % 10]}` : "")));
  return parts.join(" ");
}
/** A whole number in English words: 1250000 → "One Million, Two Hundred and Fifty Thousand". */
export function numberWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1e15) return String(n);
  let rest = Math.floor(n);
  if (rest === 0) return "Zero";
  const groups: string[] = [];
  for (const unit of ["", " Thousand", " Million", " Billion", " Trillion"]) {
    const g = rest % 1000;
    if (g) groups.unshift(below1000(g) + unit);
    rest = Math.floor(rest / 1000);
  }
  // "One Thousand and Five", not "One Thousand, Five"
  const last = groups.at(-1)!;
  if (groups.length > 1 && !last.includes("Hundred") && !/ (Thousand|Million|Billion|Trillion)$/.test(last)) return `${groups.slice(0, -1).join(", ")} and ${last}`;
  return groups.join(", ");
}
/** An amount in words for documents: 9406250.5 → "Nine Million, … Naira and Fifty Kobo Only". */
export function amountInWords(amount: number, major = "Naira", minor = "Kobo"): string {
  if (!Number.isFinite(amount)) return "";
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100);
  const part = cents % 100;
  return `${amount < 0 ? "Minus " : ""}${numberWords(whole)} ${major}${part ? ` and ${numberWords(part)} ${minor}` : ""} Only`;
}
const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const money = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plainNumber = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });

function toDate(v: MergeValue): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function applyFormat(v: MergeValue, format: string): string {
  if (v === null || v === undefined || v === "") return "";
  switch (format) {
    case "currency": {
      const n = Number(v);
      return Number.isFinite(n) ? `₦ ${money.format(n)}` : String(v);
    }
    case "number": {
      const n = Number(v);
      return Number.isFinite(n) ? plainNumber.format(n) : String(v);
    }
    case "date": {
      const d = toDate(v);
      return d ? dateFmt.format(d) : String(v);
    }
    case "datetime": {
      const d = toDate(v);
      return d ? `${dateFmt.format(d)} ${timeFmt.format(d)}` : String(v);
    }
    case "usd": {
      const n = Number(v);
      return Number.isFinite(n) ? `$ ${usd.format(n)}` : String(v);
    }
    case "words": {
      const n = Number(v);
      return Number.isFinite(n) ? amountInWords(n) : String(v);
    }
    case "title":
      return plain(v).toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());
    case "upper":
      return plain(v).toUpperCase();
    case "lower":
      return plain(v).toLowerCase();
    default:
      return plain(v);
  }
}

function plain(v: MergeValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return dateFmt.format(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function resolve(data: MergeData, extra: Record<string, string>, a: string, b: string | undefined, filters: string): string {
  // own properties only – "{{constructor.name}}" must not reach the prototype chain
  let value: MergeValue;
  if (!b) value = Object.hasOwn(extra, a) ? extra[a] : a === "today" ? new Date() : undefined;
  else {
    const group = Object.hasOwn(data, a) ? data[a] : undefined;
    value = group && Object.hasOwn(group, b) ? group[b] : undefined;
  }
  let fallback = "";
  let format = "";
  for (const m of filters.matchAll(FILTER)) {
    if (m[1] !== undefined) fallback = m[1];
    else if (m[2]) format = m[2];
  }
  const text = format ? applyFormat(value, format) : plain(value);
  return text === "" ? fallback : text;
}

export function renderMerge(text: string, data: MergeData, extra: Record<string, string> = {}): string {
  return text.replace(FIELD, (_m, a: string, b: string | undefined, filters: string) => resolve(data, extra, a, b, filters ?? ""));
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** For HTML templates: every merged value (and fallback) is escaped. The template's own markup is left alone. */
export function renderMergeHtml(html: string, data: MergeData, extra: Record<string, string> = {}): string {
  return html.replace(FIELD, (_m, a: string, b: string | undefined, filters: string) => escapeHtml(resolve(data, extra, a, b, filters ?? "")));
}

/** Every merge field a text uses, as "group.field" (or the bare name). */
export function usedFields(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(FIELD)) out.add(m[2] ? `${m[1]}.${m[2]}` : m[1]!);
  return [...out];
}

/** Placeholders that look like merge fields but cannot be read (e.g. "{{ deal name }}", an unknown format). */
export function brokenFields(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const whole = m[0];
    FIELD.lastIndex = 0;
    const ok = FIELD.exec(whole);
    FIELD.lastIndex = 0;
    if (!ok || ok[0] !== whole) out.push(whole);
    else for (const f of (ok[3] ?? "").matchAll(FILTER)) if (f[2] && !(MERGE_FORMATS as readonly string[]).includes(f[2])) out.push(whole);
  }
  if (/\{\{[^}]*$/.test(text.replace(/\{\{[^{}]*\}\}/g, ""))) out.push("{{ … (not closed)");
  return [...new Set(out)];
}

/** Merge fields used by a template that this system does not know (shown as a warning in the template editor). */
export function unknownFields(text: string, known: string[] = MERGE_FIELDS.map((f) => f.field)): string[] {
  const set = new Set([...known, "today"]);
  return usedFields(text).filter((f) => !set.has(f));
}

/** Sender ID rules of Nigerian operators: 3–11 characters, letters / digits / space. */
export const isValidSenderId = (s: string) => /^[A-Za-z0-9 ]{3,11}$/.test(s);
export const isValidEmail = (s: string) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(s) && s.length <= 254;
