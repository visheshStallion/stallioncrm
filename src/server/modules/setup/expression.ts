/**
 * Safe expression engine for validation rules (prompt 19 §2.5). A small recursive-descent parser and evaluator:
 * no `eval`, no property access, no loops – an expression can only read the fields of the record being saved,
 * compare, combine and call the functions listed below. Length and nesting are limited.
 *
 *   amount > 50000000 && isBlank(financeBank)
 *   stage == "BOOKING" and depositAmount <= 0
 *   !isBlank(email) && !contains(email, "@")
 *   closeDate < today()
 *
 * Operators: == != > >= < <=   + - * /   && || !  (also: and, or, not)
 * Functions: isBlank(x) len(x) lower(x) upper(x) contains(text, part) startsWith(text, part) endsWith(text, part)
 *            in(x, a, b, …) today() days(a, b) number(x)
 * A rule FAILS the save when its expression is true.
 */

export const MAX_EXPRESSION_LENGTH = 500;
const MAX_DEPTH = 20;

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

type Token = { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

/** Own properties only: a field called "constructor" or "toString" must not find something on Object.prototype. */
const own = <T,>(table: Record<string, T>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

const KEYWORD_OPS: Record<string, string> = { and: "&&", or: "||", not: "!" };

function tokenize(src: string): Token[] {
  if (src.length > MAX_EXPRESSION_LENGTH) throw new ExpressionError(`The formula is longer than ${MAX_EXPRESSION_LENGTH} characters`);
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new ExpressionError(`"${src.slice(i, j)}" is not a number`);
      out.push({ t: "num", v: n });
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new ExpressionError("A text value is missing its closing quote");
      out.push({ t: "str", v: s });
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      const op = own(KEYWORD_OPS, word.toLowerCase());
      out.push(op ? { t: "op", v: op } : { t: "id", v: word });
      i = j;
    } else {
      const two = src.slice(i, i + 2);
      if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) {
        out.push({ t: "op", v: two });
        i += 2;
      } else if ("()<>+-*/!,".includes(c)) {
        out.push({ t: "op", v: c });
        i++;
      } else {
        throw new ExpressionError(`Unexpected character "${c}"`);
      }
    }
  }
  return out;
}

export type Node =
  | { k: "lit"; v: number | string | boolean | null }
  | { k: "field"; name: string }
  | { k: "call"; fn: string; args: Node[] }
  | { k: "un"; op: "!" | "-"; arg: Node }
  | { k: "bin"; op: string; l: Node; r: Node };

type Value = number | string | boolean | null | Date;

const FUNCTIONS: Record<string, { min: number; max: number; run: (a: Value[]) => Value }> = {
  isBlank: { min: 1, max: 1, run: ([x]) => x === null || x === undefined || (typeof x === "string" && x.trim() === "") },
  len: { min: 1, max: 1, run: ([x]) => (x === null || x === undefined ? 0 : String(x).length) },
  lower: { min: 1, max: 1, run: ([x]) => text(x).toLowerCase() },
  upper: { min: 1, max: 1, run: ([x]) => text(x).toUpperCase() },
  contains: { min: 2, max: 2, run: ([a, b]) => text(a).toLowerCase().includes(text(b).toLowerCase()) },
  startsWith: { min: 2, max: 2, run: ([a, b]) => text(a).toLowerCase().startsWith(text(b).toLowerCase()) },
  endsWith: { min: 2, max: 2, run: ([a, b]) => text(a).toLowerCase().endsWith(text(b).toLowerCase()) },
  in: { min: 2, max: 30, run: ([x, ...rest]) => rest.some((r) => looseEqual(x ?? null, r ?? null)) },
  today: { min: 0, max: 0, run: () => startOfDay(new Date()) },
  /** whole days from a to b (b − a) */
  days: { min: 2, max: 2, run: ([a, b]) => { const x = toDate(a), y = toDate(b); return x && y ? Math.round((startOfDay(y).getTime() - startOfDay(x).getTime()) / 86_400_000) : null; } },
  number: { min: 1, max: 1, run: ([x]) => toNumber(x) },
};

export const EXPRESSION_FUNCTIONS = Object.keys(FUNCTIONS);

const text = (v: Value | undefined) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v));
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function toDate(v: Value | undefined): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toNumber(v: Value | undefined): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function looseEqual(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === b || (a === null && b === "") || (b === null && a === "");
  const da = toDate(a), db = toDate(b);
  if (da && db) return da.getTime() === db.getTime();
  if (typeof a === "number" || typeof b === "number") {
    const x = toNumber(a), y = toNumber(b);
    return x !== null && y !== null && x === y;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  return text(a) === text(b);
}

/** <0, 0, >0 – or null when the two values cannot be ordered (then every ordering comparison is false). */
function compare(a: Value, b: Value): number | null {
  if (a === null || b === null) return null;
  const da = toDate(a), db = toDate(b);
  if (da && db) return da.getTime() - db.getTime();
  const x = toNumber(a), y = toNumber(b);
  if (x !== null && y !== null) return x - y;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return null;
}

/** Parses a formula. `fields` (when given) is the whitelist of field names it may read. */
export function parseExpression(src: string, fields?: readonly string[]): Node {
  const tokens = tokenize(src);
  if (!tokens.length) throw new ExpressionError("The formula is empty");
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const eat = (v: string) => {
    if (!isOp(v)) throw new ExpressionError(`Expected "${v}"${peek() ? ` before "${String(peek()!.v)}"` : " at the end"}`);
    pos++;
  };
  const nest = <T,>(fn: () => T): T => {
    if (++depth > MAX_DEPTH) throw new ExpressionError("The formula is nested too deeply");
    try {
      return fn();
    } finally {
      depth--;
    }
  };

  const or = (): Node => nest(() => {
    let l = and();
    while (isOp("||")) { pos++; l = { k: "bin", op: "||", l, r: and() }; }
    return l;
  });
  const and = (): Node => {
    let l = not();
    while (isOp("&&")) { pos++; l = { k: "bin", op: "&&", l, r: not() }; }
    return l;
  };
  const not = (): Node => {
    if (isOp("!")) { pos++; return nest(() => ({ k: "un", op: "!", arg: not() })); }
    return cmp();
  };
  const cmp = (): Node => {
    const l = add();
    const t = peek();
    if (t?.t === "op" && ["==", "!=", ">", ">=", "<", "<="].includes(t.v)) { pos++; return { k: "bin", op: t.v, l, r: add() }; }
    return l;
  };
  const add = (): Node => {
    let l = mul();
    while (isOp("+") || isOp("-")) { const op = peek()!.v as string; pos++; l = { k: "bin", op, l, r: mul() }; }
    return l;
  };
  const mul = (): Node => {
    let l = unary();
    while (isOp("*") || isOp("/")) { const op = peek()!.v as string; pos++; l = { k: "bin", op, l, r: unary() }; }
    return l;
  };
  const unary = (): Node => {
    if (isOp("-")) { pos++; return nest(() => ({ k: "un", op: "-", arg: unary() })); }
    return primary();
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new ExpressionError("The formula ends too early");
    pos++;
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "op" && t.v === "(") { const inner = or(); eat(")"); return inner; }
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      if (isOp("(")) {
        const fn = own(FUNCTIONS, t.v);
        if (!fn) throw new ExpressionError(`Unknown function "${t.v}" – available: ${EXPRESSION_FUNCTIONS.join(", ")}`);
        pos++;
        const args: Node[] = [];
        if (!isOp(")")) {
          do { args.push(or()); } while (isOp(",") && ++pos);
        }
        eat(")");
        if (args.length < fn.min || args.length > fn.max) throw new ExpressionError(`${t.v}() takes ${fn.min === fn.max ? fn.min : `${fn.min}–${fn.max}`} value(s)`);
        return { k: "call", fn: t.v, args };
      }
      if (fields && !fields.includes(t.v)) throw new ExpressionError(`Unknown field "${t.v}"`);
      return { k: "field", name: t.v };
    }
    throw new ExpressionError(`Unexpected "${String(t.v)}"`);
  };

  const tree = or();
  if (pos < tokens.length) throw new ExpressionError(`Unexpected "${String(tokens[pos]!.v)}"`);
  return tree;
}

function normalise(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return Number(v);
  // Prisma Decimal and similar: use the number when it is one
  const n = Number(String(v));
  return Number.isFinite(n) ? n : String(v);
}

export function evaluate(node: Node, record: Record<string, unknown>): Value {
  switch (node.k) {
    case "lit":
      return node.v;
    case "field":
      return Object.prototype.hasOwnProperty.call(record, node.name) ? normalise(record[node.name]) : null;
    case "call":
      return own(FUNCTIONS, node.fn)!.run(node.args.map((a) => evaluate(a, record)));
    case "un": {
      const v = evaluate(node.arg, record);
      if (node.op === "!") return !truthy(v);
      const n = toNumber(v);
      return n === null ? null : -n;
    }
    case "bin": {
      if (node.op === "&&") return truthy(evaluate(node.l, record)) && truthy(evaluate(node.r, record));
      if (node.op === "||") return truthy(evaluate(node.l, record)) || truthy(evaluate(node.r, record));
      const l = evaluate(node.l, record);
      const r = evaluate(node.r, record);
      if (node.op === "==") return looseEqual(l, r);
      if (node.op === "!=") return !looseEqual(l, r);
      if (["<", "<=", ">", ">="].includes(node.op)) {
        const c = compare(l, r);
        if (c === null) return false;
        return node.op === "<" ? c < 0 : node.op === "<=" ? c <= 0 : node.op === ">" ? c > 0 : c >= 0;
      }
      if (node.op === "+" && (typeof l === "string" || typeof r === "string")) return text(l) + text(r);
      const x = toNumber(l), y = toNumber(r);
      if (x === null || y === null) return null;
      if (node.op === "+") return x + y;
      if (node.op === "-") return x - y;
      if (node.op === "*") return x * y;
      return y === 0 ? null : x / y;
    }
  }
}

export const truthy = (v: Value) => !(v === null || v === false || v === 0 || v === "");

/** True when the formula holds for the record (i.e. the validation rule is violated). */
export function matches(expression: string, record: Record<string, unknown>): boolean {
  return truthy(evaluate(parseExpression(expression), record));
}
