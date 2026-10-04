/**
 * Criteria trees shared by approval processes (step conditions) and workflow rules (pure, unit-tested).
 *   { all: [ … ] }  – every node matches (AND)      { any: [ … ] } – at least one matches (OR)
 * A node is a condition { field, op, value } or a nested tree. `{}` always matches. A string value that starts
 * with `$` refers to another fact, e.g. { field: "discountPct", op: "gt", value: "$escalationPct" }.
 * The same tree is evaluated in memory (`evaluate`) and translated to a Prisma `where` (`toWhere`) for
 * scheduled rules.
 */
import { z } from "zod";

export const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "isEmpty", "notEmpty", "olderThanHours", "olderThanDays", "withinDays"] as const;
export type Op = (typeof OPS)[number];

export interface Condition {
  field: string;
  op: Op;
  value?: unknown;
}
export interface Criteria {
  all?: Node[];
  any?: Node[];
}
export type Node = Condition | Criteria;
export type Facts = Record<string, unknown>;

export const OP_LABELS: Record<Op, string> = {
  eq: "is",
  neq: "is not",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  in: "is one of",
  isEmpty: "is empty",
  notEmpty: "is not empty",
  olderThanHours: "is older than (hours)",
  olderThanDays: "is older than (days)",
  withinDays: "is within the next (days)",
};

const conditionSchema = z.object({ field: z.string().min(1).max(60), op: z.enum(OPS), value: z.unknown().optional() });
const MAX_DEPTH = 4;
function nodeSchema(depth: number): z.ZodType<Node> {
  if (depth >= MAX_DEPTH) return conditionSchema as z.ZodType<Node>;
  const child = z.lazy(() => nodeSchema(depth + 1));
  const group = z.object({ all: z.array(child).max(20).optional(), any: z.array(child).max(20).optional() }).strict();
  return z.union([conditionSchema, group]) as z.ZodType<Node>;
}
/** Validates untrusted criteria JSON (bounded depth and size). */
export const criteriaSchema: z.ZodType<Criteria> = z
  .object({ all: z.array(nodeSchema(1)).max(20).optional(), any: z.array(nodeSchema(1)).max(20).optional() })
  .strict() as z.ZodType<Criteria>;

export const isCondition = (n: Node): n is Condition => typeof (n as Condition).field === "string";

const HOUR = 3_600_000;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === "number" ? v : Number(typeof v === "object" ? String(v) : v);
  return Number.isNaN(n) ? null : n;
};
const time = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
};
const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown) => {
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null && typeof a !== "string") return na === nb;
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
};

function resolve(value: unknown, facts: Facts): unknown {
  return typeof value === "string" && value.startsWith("$") ? facts[value.slice(1)] : value;
}

export function evaluateCondition(c: Condition, facts: Facts, now = new Date()): boolean {
  const actual = facts[c.field];
  const expected = resolve(c.value, facts);
  switch (c.op) {
    case "eq":
      return same(actual, expected);
    case "neq":
      return !same(actual, expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = num(actual);
      const b = num(expected);
      if (a === null || b === null) return false;
      return c.op === "gt" ? a > b : c.op === "gte" ? a >= b : c.op === "lt" ? a < b : a <= b;
    }
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "in":
      return (Array.isArray(expected) ? expected : String(expected ?? "").split(",")).some((v) => same(actual, typeof v === "string" ? v.trim() : v));
    case "isEmpty":
      return empty(actual);
    case "notEmpty":
      return !empty(actual);
    case "olderThanHours":
    case "olderThanDays": {
      const t = time(actual);
      const n = num(expected);
      if (t === null || n === null) return false;
      return t <= now.getTime() - n * (c.op === "olderThanDays" ? 24 * HOUR : HOUR);
    }
    case "withinDays": {
      const t = time(actual);
      const n = num(expected);
      if (t === null || n === null) return false;
      return t >= now.getTime() && t <= now.getTime() + n * 24 * HOUR;
    }
  }
}

/** `{}` (no all / any) matches everything. */
export function evaluate(criteria: Criteria | null | undefined, facts: Facts, now = new Date()): boolean {
  if (!criteria) return true;
  const test = (n: Node): boolean => (isCondition(n) ? evaluateCondition(n, facts, now) : evaluate(n, facts, now));
  if (criteria.all && !criteria.all.every(test)) return false;
  if (criteria.any && criteria.any.length > 0 && !criteria.any.some(test)) return false;
  return true;
}

/** How a criteria field maps to the database. */
export interface WhereField {
  /** Prisma column (default: the field key). */
  column?: string;
  type: "text" | "number" | "enum" | "date" | "boolean";
  /** Custom translation for virtual fields (e.g. isOpen → { stage: { type: "OPEN" } }). */
  where?: (op: Op, value: unknown) => Record<string, unknown> | null;
}

/** Translates a criteria tree to a Prisma `where`. Unknown fields / unsupported operators throw. */
export function toWhere(criteria: Criteria | null | undefined, fields: Record<string, WhereField>, now = new Date()): Record<string, unknown> {
  if (!criteria) return {};
  const one = (n: Node): Record<string, unknown> => {
    if (!isCondition(n)) return toWhere(n, fields, now);
    const def = fields[n.field];
    if (!def) throw new Error(`Unknown field: ${n.field}`);
    if (typeof n.value === "string" && n.value.startsWith("$")) throw new Error("Field references are not supported in scheduled rules");
    if (def.where) {
      const w = def.where(n.op, n.value);
      if (!w) throw new Error(`Operator ${n.op} is not supported for ${n.field}`);
      return w;
    }
    const col = def.column ?? n.field;
    const cast = (v: unknown) => (def.type === "number" ? Number(v) : def.type === "boolean" ? v === true || v === "true" : def.type === "date" && v ? new Date(String(v)) : v);
    switch (n.op) {
      case "eq":
        return { [col]: cast(n.value) };
      case "neq":
        return { NOT: { [col]: cast(n.value) } };
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        return { [col]: { [n.op]: cast(n.value) } };
      case "contains":
        return { [col]: { contains: String(n.value ?? ""), mode: "insensitive" } };
      case "in":
        return { [col]: { in: (Array.isArray(n.value) ? n.value : String(n.value ?? "").split(",")).map((v) => cast(typeof v === "string" ? v.trim() : v)) } };
      case "isEmpty":
        return { [col]: null };
      case "notEmpty":
        return { NOT: { [col]: null } };
      case "olderThanHours":
        return { [col]: { lte: new Date(now.getTime() - Number(n.value) * HOUR) } };
      case "olderThanDays":
        return { [col]: { lte: new Date(now.getTime() - Number(n.value) * 24 * HOUR) } };
      case "withinDays":
        return { [col]: { gte: now, lte: new Date(now.getTime() + Number(n.value) * 24 * HOUR) } };
    }
  };
  const and: Array<Record<string, unknown>> = [];
  if (criteria.all?.length) and.push(...criteria.all.map(one));
  if (criteria.any?.length) and.push({ OR: criteria.any.map(one) });
  return and.length ? { AND: and } : {};
}

/** Fields referenced by a criteria tree (for validation against a module schema). */
export function criteriaFields(criteria: Criteria | null | undefined): string[] {
  if (!criteria) return [];
  const out: string[] = [];
  for (const n of [...(criteria.all ?? []), ...(criteria.any ?? [])]) out.push(...(isCondition(n) ? [n.field] : criteriaFields(n)));
  return [...new Set(out)];
}

/** Replaces {{field}} placeholders in notification / task texts. */
export function renderTemplate(text: string, facts: Facts): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = facts[key];
    return v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  });
}
