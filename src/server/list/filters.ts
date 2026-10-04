/**
 * Generic list filtering for ModuleListPage (prompt 17 §3a / §4 FilterPanel).
 * Conditions travel in the URL as repeated `f=field~op~value[~value2]`; only fields declared in the
 * module's FieldDef whitelist are accepted, values are validated per type, and the result is a Prisma
 * `where` fragment that is ANDed with the access scope by scopedDb (filters can only narrow).
 * Pure functions – unit-tested.
 */

export type FieldType = "text" | "enum" | "number" | "date" | "boolean";
export type FilterOp = "is" | "isnt" | "contains" | "startsWith" | "isEmpty" | "isNotEmpty" | "between" | "lastNDays" | "gt" | "lt";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: Array<{ value: string; label: string }>;
  /** Non-nullable columns cannot use isEmpty. */
  nullable?: boolean;
  /** Filter on a to-one relation's column: { relation: "stage", column: "key" } → where: { stage: { key: … } }. */
  relation?: string;
  column?: string;
  /** Custom field: filter on customFields-><jsonPath> (text / enum / number / boolean). */
  jsonPath?: string;
}

export interface Condition {
  field: string;
  op: FilterOp;
  value?: string;
  value2?: string;
}

export const OPS_BY_TYPE: Record<FieldType, FilterOp[]> = {
  text: ["contains", "is", "isnt", "startsWith", "isEmpty", "isNotEmpty"],
  enum: ["is", "isnt", "isEmpty", "isNotEmpty"],
  number: ["is", "gt", "lt", "between", "isEmpty"],
  date: ["between", "lastNDays", "isEmpty"],
  boolean: ["is"],
};

export const OP_LABELS: Record<FilterOp, string> = {
  is: "is",
  isnt: "isn't",
  contains: "contains",
  startsWith: "starts with",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  between: "between",
  lastNDays: "in the last N days",
  gt: "greater than",
  lt: "less than",
};

const NO_VALUE: FilterOp[] = ["isEmpty", "isNotEmpty"];

export function encodeCondition(c: Condition): string {
  return [c.field, c.op, c.value ?? "", c.value2 ?? ""].map((p) => p.replace(/~/g, "")).join("~").replace(/~+$/, "");
}

/** Parses + validates `f` params against the whitelist; invalid conditions are dropped. */
export function parseConditions(raw: string | string[] | undefined | null, defs: FieldDef[]): Condition[] {
  const list = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
  const out: Condition[] = [];
  for (const item of list.slice(0, 20)) {
    const [field, op, value, value2] = item.split("~");
    const def = defs.find((d) => d.key === field);
    if (!def || !op || !OPS_BY_TYPE[def.type].includes(op as FilterOp)) continue;
    const c: Condition = { field: def.key, op: op as FilterOp, value: value || undefined, value2: value2 || undefined };
    if (isValid(def, c)) out.push(c);
  }
  return out;
}

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isNum = (v?: string) => v !== undefined && v !== "" && Number.isFinite(Number(v));

function isValid(def: FieldDef, c: Condition): boolean {
  if (NO_VALUE.includes(c.op)) return c.op === "isNotEmpty" || def.nullable !== false;
  switch (def.type) {
    case "text":
      return !!c.value && c.value.length <= 200;
    case "enum":
      return !!c.value && (!def.options || c.value.split(",").every((v) => def.options!.some((o) => o.value === v)));
    case "number":
      return c.op === "between" ? isNum(c.value) && isNum(c.value2) : isNum(c.value);
    case "date":
      if (c.op === "lastNDays") return isNum(c.value) && Number(c.value) > 0 && Number(c.value) <= 3650;
      return isDate(c.value) || isDate(c.value2);
    case "boolean":
      return c.value === "true" || c.value === "false";
  }
}

type Where = Record<string, unknown>;

/** Custom fields live in the JSONB column "customFields"; Prisma's JSON path filters translate to ->> expressions. */
function jsonLeaf(def: FieldDef, c: Condition): Where {
  const at = (cond: Where): Where => ({ customFields: { path: [def.jsonPath!], ...cond } });
  const value = (v: string | undefined) => (def.type === "number" ? Number(v) : def.type === "boolean" ? v === "true" : (v ?? ""));
  switch (c.op) {
    case "is":
      return def.type === "enum" ? { OR: (c.value ?? "").split(",").map((v) => at({ equals: v })) } : at({ equals: value(c.value) });
    case "isnt":
      return { NOT: def.type === "enum" ? { OR: (c.value ?? "").split(",").map((v) => at({ equals: v })) } : at({ equals: value(c.value) }) };
    case "contains":
      return at({ string_contains: c.value ?? "" });
    case "startsWith":
      return at({ string_starts_with: c.value ?? "" });
    case "gt":
      return at({ gt: Number(c.value) });
    case "lt":
      return at({ lt: Number(c.value) });
    case "between":
      return { AND: [at({ gte: def.type === "number" ? Number(c.value) : c.value }), at({ lte: def.type === "number" ? Number(c.value2) : c.value2 })] };
    default:
      return {};
  }
}

function one(def: FieldDef, c: Condition, now: Date): Where {
  if (def.jsonPath) return jsonLeaf(def, c);
  const where = leaf(def, c, now);
  return def.relation ? { [def.relation]: where } : where;
}

function leaf(def: FieldDef, c: Condition, now: Date): Where {
  const f = def.column ?? def.key;
  const v = c.value;
  switch (c.op) {
    case "isEmpty":
      return def.type === "text" ? { OR: [{ [f]: null }, { [f]: "" }] } : { [f]: null };
    case "isNotEmpty":
      return def.type === "text" ? { AND: [{ [f]: { not: null } }, { [f]: { not: "" } }] } : { [f]: { not: null } };
    case "contains":
      return { [f]: { contains: v, mode: "insensitive" } };
    case "startsWith":
      return { [f]: { startsWith: v, mode: "insensitive" } };
    case "is":
      if (def.type === "enum") return { [f]: { in: v!.split(",") } };
      if (def.type === "boolean") return { [f]: v === "true" };
      if (def.type === "number") return { [f]: Number(v) };
      return { [f]: { equals: v, mode: "insensitive" } };
    case "isnt":
      if (def.type === "enum") return { OR: [{ [f]: { notIn: v!.split(",") } }, ...(def.nullable === false ? [] : [{ [f]: null }])] };
      return { NOT: { [f]: { equals: v, mode: "insensitive" } } };
    case "gt":
      return { [f]: { gt: Number(v) } };
    case "lt":
      return { [f]: { lt: Number(v) } };
    case "between":
      if (def.type === "number") return { [f]: { gte: Number(v), lte: Number(c.value2) } };
      return {
        [f]: {
          ...(isDate(v) ? { gte: new Date(`${v}T00:00:00.000Z`) } : {}),
          ...(isDate(c.value2) ? { lte: new Date(`${c.value2}T23:59:59.999Z`) } : {}),
        },
      };
    case "lastNDays":
      return { [f]: { gte: new Date(now.getTime() - Number(v) * 86_400_000) } };
  }
}

/** Conditions → Prisma where (AND). */
export function conditionsToWhere(conditions: Condition[], defs: FieldDef[], now = new Date()): Where {
  const parts = conditions
    .map((c) => {
      const def = defs.find((d) => d.key === c.field);
      return def ? one(def, c, now) : null;
    })
    .filter((x): x is Where => !!x);
  return parts.length ? { AND: parts } : {};
}

/** Zoho-style "System Defined Filters". */
export const SYSTEM_FILTERS = {
  touched: { label: "Touched records (last 7 days)", where: (now: Date) => ({ updatedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }) },
  untouched: { label: "Untouched records (7+ days)", where: (now: Date) => ({ updatedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } }) },
} as const;
export type SystemFilter = keyof typeof SYSTEM_FILTERS;

export function systemFilterWhere(key: string | undefined, now = new Date()): Where {
  return key && key in SYSTEM_FILTERS ? SYSTEM_FILTERS[key as SystemFilter].where(now) : {};
}

export const PAGE_SIZES = [10, 20, 50, 100] as const;

export function parsePaging(sp: { page?: string; per?: string }): { page: number; per: number; skip: number } {
  const per = PAGE_SIZES.includes(Number(sp.per) as (typeof PAGE_SIZES)[number]) ? Number(sp.per) : 20;
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  return { page, per, skip: (page - 1) * per };
}
