/**
 * Safe expression engine for formula custom fields (prompt 12) – pure, unit-tested, no eval / Function.
 *
 *   amount * (1 - discountPct / 100)        IF(paymentType = "CASH", "Cash sale", "Financed")
 *   ROUND(amount / quantity, 2)             CONCAT(firstName, " ", lastName)
 *
 * Grammar: numbers, "strings", field names (record fields and custom fields by api name), + - * / %, comparisons
 * (= != < <= > >=), AND / OR / NOT, parentheses and a fixed set of functions. A formula is parsed once and
 * evaluated on plain values; anything else is a parse error. Evaluation is bounded (no loops, no recursion in the
 * language, expression size and depth limited).
 */
export type Value = number | string | boolean | null;

type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | { t: "field"; name: string }
  | { t: "unary"; op: "-" | "NOT"; a: Node }
  | { t: "binary"; op: string; a: Node; b: Node }
  | { t: "call"; fn: string; args: Node[] };

const MAX_LENGTH = 500;
const MAX_DEPTH = 20;

const FUNCTIONS: Record<string, { min: number; max: number; fn: (args: Value[]) => Value }> = {
  IF: { min: 3, max: 3, fn: ([c, a, b]) => (truthy(c!) ? a! : b!) },
  ROUND: { min: 1, max: 2, fn: ([n, d]) => (num(n!) === null ? null : round(num(n!)!, num(d ?? 0) ?? 0)) },
  ABS: { min: 1, max: 1, fn: ([n]) => (num(n!) === null ? null : Math.abs(num(n!)!)) },
  MIN: { min: 1, max: 10, fn: (a) => numbers(a, Math.min) },
  MAX: { min: 1, max: 10, fn: (a) => numbers(a, Math.max) },
  CONCAT: { min: 1, max: 10, fn: (a) => a.map((v) => (v === null ? "" : String(v))).join("").slice(0, 2000) },
  UPPER: { min: 1, max: 1, fn: ([s]) => (s === null ? null : String(s).toUpperCase()) },
  LOWER: { min: 1, max: 1, fn: ([s]) => (s === null ? null : String(s).toLowerCase()) },
  LEN: { min: 1, max: 1, fn: ([s]) => (s === null ? 0 : String(s).length) },
  ISBLANK: { min: 1, max: 1, fn: ([v]) => v === null || v === "" },
  COALESCE: { min: 1, max: 10, fn: (a) => a.find((v) => v !== null && v !== "") ?? null },
  /** whole days from a to b (dates as ISO strings) */
  DAYS: { min: 2, max: 2, fn: ([a, b]) => (date(a!) === null || date(b!) === null ? null : Math.round((date(b!)! - date(a!)!) / 86_400_000)) },
  TODAY: { min: 0, max: 0, fn: () => new Date().toISOString().slice(0, 10) },
};

const truthy = (v: Value) => v !== null && v !== false && v !== 0 && v !== "";
const num = (v: Value): number | null => {
  if (v === null || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const date = (v: Value): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
const round = (n: number, d: number) => {
  const f = 10 ** Math.max(0, Math.min(8, Math.trunc(d)));
  return Math.round(n * f) / f;
};
const numbers = (a: Value[], fn: (...n: number[]) => number): Value => {
  const n = a.map(num).filter((x): x is number => x !== null);
  return n.length ? fn(...n) : null;
};

// ───────────────────────────── tokenizer ─────────────────────────────

type Token = { k: "num"; v: number } | { k: "str"; v: string } | { k: "id"; v: string } | { k: "op"; v: string };

function tokenize(src: string): Token[] {
  if (src.length > MAX_LENGTH) throw new Error(`A formula can have at most ${MAX_LENGTH} characters`);
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+/.exec(src.slice(i));
      if (!m) throw new Error(`Unexpected "${ch}"`);
      out.push({ k: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new Error("Unterminated text");
      out.push({ k: "str", v: src.slice(i + 1, end) });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ k: "id", v: m[0] });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (["<=", ">=", "!=", "<>"].includes(two)) {
        out.push({ k: "op", v: two === "<>" ? "!=" : two });
        i += 2;
      } else if ("+-*/%()=<>,".includes(ch)) {
        out.push({ k: "op", v: ch });
        i++;
      } else throw new Error(`Unexpected "${ch}"`);
    }
  }
  return out;
}

// ───────────────────────────── parser (precedence climbing) ─────────────────────────────

const PRECEDENCE: Record<string, number> = { OR: 1, AND: 2, "=": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

export interface Formula {
  source: string;
  /** field names the formula reads */
  fields: string[];
  node: Node;
}

/** Parses a formula; throws an Error with a user-readable message when it is not valid. */
export function parseFormula(source: string): Formula {
  const tokens = tokenize(source);
  const fields = new Set<string>();
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.k === "op" && peek()!.v === v;
  const word = () => (peek()?.k === "id" ? (peek() as { v: string }).v.toUpperCase() : null);

  function primary(depth: number): Node {
    if (depth > MAX_DEPTH) throw new Error("The formula is nested too deeply");
    const t = tokens[pos++];
    if (!t) throw new Error("The formula ends unexpectedly");
    if (t.k === "num") return { t: "num", v: t.v };
    if (t.k === "str") return { t: "str", v: t.v };
    if (t.k === "op" && t.v === "(") {
      const e = expression(0, depth + 1);
      if (!isOp(")")) throw new Error('Missing ")"');
      pos++;
      return e;
    }
    if (t.k === "op" && t.v === "-") return { t: "unary", op: "-", a: primary(depth + 1) };
    if (t.k === "id") {
      const upper = t.v.toUpperCase();
      if (upper === "NOT") return { t: "unary", op: "NOT", a: primary(depth + 1) };
      if (upper === "TRUE") return { t: "bool", v: true };
      if (upper === "FALSE") return { t: "bool", v: false };
      if (upper === "NULL") return { t: "null" };
      if (isOp("(")) {
        const def = FUNCTIONS[upper];
        if (!def) throw new Error(`Unknown function ${t.v}`);
        pos++;
        const args: Node[] = [];
        if (!isOp(")")) {
          do {
            args.push(expression(0, depth + 1));
          } while (isOp(",") && ++pos);
        }
        if (!isOp(")")) throw new Error('Missing ")"');
        pos++;
        if (args.length < def.min || args.length > def.max) throw new Error(`${upper} takes ${def.min === def.max ? def.min : `${def.min}–${def.max}`} argument(s)`);
        return { t: "call", fn: upper, args };
      }
      if (["__proto__", "constructor", "prototype"].includes(t.v)) throw new Error(`"${t.v}" is not a field`);
      fields.add(t.v);
      return { t: "field", name: t.v };
    }
    throw new Error(`Unexpected "${t.v}"`);
  }

  function expression(minPrec: number, depth: number): Node {
    let left = primary(depth);
    for (;;) {
      const t = peek();
      const op = t?.k === "op" ? t.v : word() === "AND" || word() === "OR" ? word()! : null;
      const prec = op ? PRECEDENCE[op] : undefined;
      if (!op || prec === undefined || prec < minPrec) return left;
      pos++;
      left = { t: "binary", op, a: left, b: expression(prec + 1, depth + 1) };
    }
  }

  if (tokens.length === 0) throw new Error("The formula is empty");
  const node = expression(0, 0);
  if (pos < tokens.length) throw new Error(`Unexpected "${String((tokens[pos] as { v: unknown }).v)}"`);
  return { source, fields: [...fields], node };
}

// ───────────────────────────── evaluation ─────────────────────────────

function compare(a: Value, b: Value): number | null {
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null && typeof a !== "boolean" && typeof b !== "boolean") return na - nb;
  if (a === null || b === null) return a === b ? 0 : null;
  return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
}

function evalNode(n: Node, record: Record<string, unknown>): Value {
  switch (n.t) {
    case "num":
    case "str":
    case "bool":
      return n.v;
    case "null":
      return null;
    case "field": {
      const v = Object.hasOwn(record, n.name) ? record[n.name] : null;
      if (v === null || v === undefined) return null;
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") return (v as { toNumber: () => number }).toNumber();
      return null; // objects and arrays are not formula values
    }
    case "unary": {
      const a = evalNode(n.a, record);
      return n.op === "NOT" ? !truthy(a) : num(a) === null ? null : -num(a)!;
    }
    case "call":
      return FUNCTIONS[n.fn]!.fn(n.args.map((a) => evalNode(a, record)));
    case "binary": {
      if (n.op === "AND") return truthy(evalNode(n.a, record)) && truthy(evalNode(n.b, record));
      if (n.op === "OR") return truthy(evalNode(n.a, record)) || truthy(evalNode(n.b, record));
      const a = evalNode(n.a, record);
      const b = evalNode(n.b, record);
      if (["=", "!=", "<", "<=", ">", ">="].includes(n.op)) {
        const c = compare(a, b);
        if (c === null) return n.op === "!=";
        return n.op === "=" ? c === 0 : n.op === "!=" ? c !== 0 : n.op === "<" ? c < 0 : n.op === "<=" ? c <= 0 : n.op === ">" ? c > 0 : c >= 0;
      }
      if (n.op === "+" && (typeof a === "string" || typeof b === "string") && (num(a) === null || num(b) === null)) return `${a ?? ""}${b ?? ""}`.slice(0, 2000);
      const x = num(a);
      const y = num(b);
      if (x === null || y === null) return null;
      const r = n.op === "+" ? x + y : n.op === "-" ? x - y : n.op === "*" ? x * y : n.op === "/" ? (y === 0 ? null : x / y) : y === 0 ? null : x % y;
      return r === null || !Number.isFinite(r) ? null : r;
    }
  }
}

/** Evaluates a parsed formula on a record (plain object of field values). Never throws; errors yield null. */
export function evaluateFormula(formula: Formula, record: Record<string, unknown>): Value {
  try {
    return evalNode(formula.node, record);
  } catch {
    return null;
  }
}

export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS);
