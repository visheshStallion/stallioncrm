/**
 * Merge fields of message templates (pure, unit-tested):  {{contact.firstName}}  {{deal.model}}  {{brand.name}} …
 * Unknown fields render empty; values are inserted as plain text (email HTML is produced later by escaping the
 * whole text, so merged values can never inject markup).
 */
export type MergeData = Record<string, Record<string, string | number | null | undefined>>;

export const MERGE_FIELDS: Array<{ field: string; label: string }> = [
  { field: "contact.firstName", label: "Customer first name" },
  { field: "contact.lastName", label: "Customer last name" },
  { field: "contact.name", label: "Customer full name" },
  { field: "deal.name", label: "Deal name" },
  { field: "deal.model", label: "Model" },
  { field: "brand.name", label: "Brand name" },
  { field: "brand.code", label: "Brand code" },
  { field: "owner.name", label: "Sales exec name" },
  { field: "unsubscribeUrl", label: "Unsubscribe link (campaigns)" },
];

const FIELD = /\{\{\s*([a-zA-Z]+)(?:\.([a-zA-Z]+))?\s*\}\}/g;

export function renderMerge(text: string, data: MergeData, extra: Record<string, string> = {}): string {
  return text.replace(FIELD, (_m, a: string, b?: string) => {
    // own properties only – "{{constructor.name}}" must not reach the prototype chain
    if (!b) return Object.hasOwn(extra, a) ? extra[a]! : "";
    const group = Object.hasOwn(data, a) ? data[a] : undefined;
    const v = group && Object.hasOwn(group, b) ? group[b] : undefined;
    return v === null || v === undefined ? "" : String(v);
  });
}

/** Merge fields used by a template that this system does not know (shown as a warning in the template editor). */
export function unknownFields(text: string): string[] {
  const known = new Set(MERGE_FIELDS.map((f) => f.field));
  const out = new Set<string>();
  for (const m of text.matchAll(FIELD)) {
    const key = m[2] ? `${m[1]}.${m[2]}` : m[1]!;
    if (!known.has(key)) out.add(key);
  }
  return [...out];
}

/** Sender ID rules of Nigerian operators: 3–11 characters, letters / digits / space. */
export const isValidSenderId = (s: string) => /^[A-Za-z0-9 ]{3,11}$/.test(s);
export const isValidEmail = (s: string) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(s) && s.length <= 254;
