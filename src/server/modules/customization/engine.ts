/**
 * Custom fields & layout rules (prompt 12) – pure engine, shared by server validation and the client forms.
 *
 *  • A custom field belongs to a module and optionally to ONE brand (then it only exists on that brand's
 *    records). Values live in the record's JSONB `customFields` under the field's api name.
 *  • The Zod schema for a record's custom fields is generated at runtime from the definitions that apply to it.
 *  • Formula fields are computed (safe expression engine) and never stored from user input.
 *  • Layout rules show / hide / require fields depending on other values; they are evaluated on the client for
 *    the form and again on the server, so a hidden-required field can never block and a required one cannot be
 *    skipped.
 */
import { z } from "zod";
import { evaluateFormula, parseFormula } from "@/server/automation/formula";

export const CUSTOM_MODULES = ["leads", "deals", "accounts", "contacts", "cases"] as const;
export type CustomModule = (typeof CUSTOM_MODULES)[number];
/** Shared customer records have no brand, so their custom fields cannot be brand-specific. */
export const BRANDED_MODULES: CustomModule[] = ["leads", "deals", "cases"];

export const FIELD_TYPES = ["TEXT", "NUMBER", "CURRENCY", "DATE", "PICKLIST", "MULTI_PICKLIST", "LOOKUP", "BOOLEAN", "FORMULA"] as const;
export type CustomFieldType = (typeof FIELD_TYPES)[number];
export const TYPE_LABELS: Record<CustomFieldType, string> = { TEXT: "Text", NUMBER: "Number", CURRENCY: "Currency (₦)", DATE: "Date", PICKLIST: "Picklist", MULTI_PICKLIST: "Multi-select picklist", LOOKUP: "Lookup", BOOLEAN: "Checkbox", FORMULA: "Formula" };
export const LOOKUP_TARGETS = ["users", "products"] as const;

export interface CustomFieldDef {
  id: string;
  module: string;
  apiName: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  lookupTarget: string | null;
  formula: string | null;
  /** NULL = every brand; otherwise the field exists only on this brand's records */
  brandId: string | null;
  required: boolean;
  active: boolean;
  position: number;
}

export type CustomValues = Record<string, string | number | boolean | string[] | null>;
export const cfKey = (apiName: string) => `cf_${apiName}`;
export const API_NAME = /^[a-z][a-zA-Z0-9]{1,39}$/;

/** The definitions that apply to a record of this brand (group fields + the brand's own), in layout order. */
export function fieldsFor(defs: CustomFieldDef[], module: string, brandId: string | null): CustomFieldDef[] {
  return defs.filter((d) => d.active && d.module === module && (d.brandId === null || d.brandId === brandId)).sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
}

const blank = (v: unknown) => v === "" || v === null || v === undefined;

function fieldSchema(d: CustomFieldDef): z.ZodTypeAny | null {
  const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (blank(v) ? null : v), s.nullable());
  switch (d.type) {
    case "TEXT":
      return opt(z.string().trim().max(500));
    case "NUMBER":
      return opt(z.coerce.number().finite().min(-1e15).max(1e15));
    case "CURRENCY":
      return opt(z.coerce.number().finite().min(0).max(1e15));
    case "DATE":
      return opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date (YYYY-MM-DD)").refine((s) => !Number.isNaN(Date.parse(s)), "a valid date"));
    case "PICKLIST":
      return opt(z.string().refine((v) => d.options.includes(v), `one of: ${d.options.join(", ")}`));
    case "MULTI_PICKLIST":
      return z.preprocess((v) => (blank(v) ? [] : Array.isArray(v) ? v : String(v).split(",").map((x) => x.trim()).filter(Boolean)), z.array(z.string().refine((v) => d.options.includes(v), `one of: ${d.options.join(", ")}`)).max(50));
    case "LOOKUP":
      return opt(z.string().max(40));
    case "BOOLEAN":
      return z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());
    case "FORMULA":
      return null; // computed, never accepted from input
  }
}

/**
 * Validates the custom-field input of a record against the definitions that apply to it. Unknown keys (other
 * brands' fields, inactive fields, formulas) are dropped. `required` (plus `extraRequired` from layout rules)
 * is checked unless the field is hidden by a rule. Returns the cleaned values and the field errors.
 */
export function validateCustomFields(
  defs: CustomFieldDef[],
  input: Record<string, unknown> | null | undefined,
  opts: { hidden?: Set<string>; extraRequired?: Set<string>; partial?: boolean } = {},
): { values: CustomValues; errors: string[] } {
  const values: CustomValues = {};
  const errors: string[] = [];
  const src = input ?? {};
  for (const d of defs) {
    const schema = fieldSchema(d);
    if (!schema) continue;
    const given = Object.hasOwn(src, d.apiName);
    if (!given && opts.partial) continue;
    const parsed = schema.safeParse(given ? src[d.apiName] : undefined);
    if (!parsed.success) {
      errors.push(`${d.label}: ${parsed.error.issues[0]?.message ?? "invalid value"}`);
      continue;
    }
    const v = parsed.data as CustomValues[string];
    const hidden = opts.hidden?.has(cfKey(d.apiName));
    const required = (d.required || opts.extraRequired?.has(cfKey(d.apiName))) && !hidden;
    if (required && (blank(v) || (Array.isArray(v) && v.length === 0) || (d.type === "BOOLEAN" && v !== true))) errors.push(`${d.label} is required`);
    values[d.apiName] = v;
  }
  return { values, errors };
}

/** Formula fields of a record: evaluated on the record's standard fields plus its custom values. */
export function computeFormulas(defs: CustomFieldDef[], record: Record<string, unknown>, values: CustomValues): CustomValues {
  const out: CustomValues = {};
  const scope = { ...record, ...values };
  for (const d of defs) {
    if (d.type !== "FORMULA" || !d.formula) continue;
    try {
      const v = evaluateFormula(parseFormula(d.formula), scope);
      out[d.apiName] = typeof v === "number" ? Math.round(v * 100) / 100 : v;
    } catch {
      out[d.apiName] = null;
    }
  }
  return out;
}

// ───────────────────────────── layouts & rules ─────────────────────────────

export const RULE_OPS = ["eq", "neq", "in", "isEmpty", "notEmpty", "gt", "lt"] as const;
export const ruleSchema = z.object({
  when: z.object({ field: z.string().min(1).max(60), op: z.enum(RULE_OPS), value: z.union([z.string().max(200), z.number(), z.boolean(), z.null()]).optional() }),
  action: z.enum(["SHOW", "HIDE", "REQUIRE"]),
  fields: z.array(z.string().min(1).max(60)).min(1).max(30),
});
export type LayoutRule = z.infer<typeof ruleSchema>;

export const layoutSchema = z.object({
  /** sections of the custom-field block, in order; fields are keys (`cf_<apiName>`) */
  sections: z.array(z.object({ title: z.string().trim().min(1).max(80), fields: z.array(z.string().max(60)).max(60) })).max(20).default([]),
  /** additionally required fields (standard field names or `cf_` keys) */
  required: z.array(z.string().max(60)).max(60).default([]),
  rules: z.array(ruleSchema).max(40).default([]),
});
export type LayoutDef = z.infer<typeof layoutSchema>;
export const EMPTY_LAYOUT: LayoutDef = { sections: [], required: [], rules: [] };

function matches(rule: LayoutRule["when"], values: Record<string, unknown>): boolean {
  const raw = Object.hasOwn(values, rule.field) ? values[rule.field] : null;
  const actual = Array.isArray(raw) ? raw.join(",") : raw;
  const text = (v: unknown) => String(v ?? "").trim().toLowerCase();
  switch (rule.op) {
    case "eq":
      return text(actual) === text(rule.value);
    case "neq":
      return text(actual) !== text(rule.value);
    case "in":
      return text(rule.value).split(",").map((s) => s.trim()).includes(text(actual));
    case "isEmpty":
      return blank(actual) || text(actual) === "";
    case "notEmpty":
      return !blank(actual) && text(actual) !== "";
    case "gt":
      return Number(actual) > Number(rule.value);
    case "lt":
      return Number(actual) < Number(rule.value);
  }
}

/**
 * Evaluates the layout rules on the current values (standard fields by name, custom fields by `cf_` key).
 *   SHOW   – the fields are visible only while the condition holds
 *   HIDE   – the fields are hidden while the condition holds
 *   REQUIRE – the fields are required while the condition holds
 * Hidden wins over required.
 */
export function applyRules(layout: LayoutDef, values: Record<string, unknown>): { hidden: Set<string>; required: Set<string> } {
  const hidden = new Set<string>();
  const required = new Set<string>(layout.required);
  for (const rule of layout.rules) {
    const on = matches(rule.when, values);
    if (rule.action === "SHOW" && !on) rule.fields.forEach((f) => hidden.add(f));
    if (rule.action === "HIDE" && on) rule.fields.forEach((f) => hidden.add(f));
    if (rule.action === "REQUIRE" && on) rule.fields.forEach((f) => required.add(f));
  }
  for (const f of hidden) required.delete(f);
  return { hidden, required };
}

/** Flat values for rule evaluation: standard fields + custom fields under their `cf_` keys. */
export function ruleValues(standard: Record<string, unknown>, custom: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return { ...standard, ...Object.fromEntries(Object.entries(custom ?? {}).map(([k, v]) => [cfKey(k), v])) };
}

/** The effective layout for a record: the brand's variant when one exists, otherwise the module's default. */
export function pickLayout<T extends { brandId: string | null }>(layouts: T[], brandId: string | null): T | null {
  return layouts.find((l) => l.brandId !== null && l.brandId === brandId) ?? layouts.find((l) => l.brandId === null) ?? null;
}
