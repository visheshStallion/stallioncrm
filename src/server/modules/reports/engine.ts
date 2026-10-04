/**
 * Report engine (prompt 09). A report definition is translated to ONE SQL statement that runs through
 * `scopedDb(ctx).$queryRaw`, i.e. inside the viewer's RLS transaction (role stallion_rls + app.* settings).
 * Postgres therefore filters every table the query touches – base table, joins and sub-selects – by the
 * VIEWER's access, no matter who built or shared the report. Identifiers come from the catalog only; every
 * value is a bound parameter.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { isNumeric, reportField, reportModule, type Granularity, type JoinKey, type RField, type RModule } from "./catalog";
import { resolveRange, type ReportDefinition } from "./definition";

export interface ResultColumn {
  key: string;
  label: string;
  type: RField["type"];
}
export interface ReportResult {
  kind: "summary" | "tabular";
  columns: ResultColumn[];
  rows: Array<Array<string | number | null>>;
  /** tabular: ids of the rows (for links to the record) */
  ids?: string[];
  /** total number of records (tabular) or groups (summary) */
  total: number;
  truncated: boolean;
  /** number of leading group columns (summary) */
  groupCount: number;
}
export interface RunOptions {
  /** brand switcher / region filter – only ever narrows */
  brandId?: string | null;
  regionId?: string | null;
  /** "My …" widgets: only records owned by this user */
  ownerId?: string | null;
  /** overrides the definition's date range (viewer picks another period) */
  dateRange?: { preset: string; from?: string; to?: string };
  take?: number;
  skip?: number;
  now?: Date;
}

export const MAX_GROUPS = 2000;
export const MAX_EXPORT_ROWS = 50_000;

const raw = Prisma.raw;
const sql = Prisma.sql;
/** UTC wall-clock literal for comparisons with `timestamp` columns (independent of the session time zone). */
const ts = (d: Date) => sql`${d.toISOString().replace("T", " ").replace("Z", "")}::timestamp`;
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

const DATE_FORMAT: Record<Granularity, [string, string]> = {
  day: ["day", "YYYY-MM-DD"],
  week: ["week", 'IYYY-"W"IW'],
  month: ["month", "YYYY-MM"],
  quarter: ["quarter", 'YYYY-"Q"Q'],
  year: ["year", "YYYY"],
};
/** Date bucket in Africa/Lagos time (UTC+1, no DST). */
function groupExpr(f: RField, granularity?: Granularity): string {
  if (f.type !== "date") return `coalesce((${f.sql})::text, '(none)')`;
  const [unit, fmt] = DATE_FORMAT[granularity ?? "month"];
  return `coalesce(to_char(date_trunc('${unit}', (${f.sql}) + interval '1 hour'), '${fmt}'), '(none)')`;
}

function filterSql(f: RField, op: string, value: unknown): Prisma.Sql {
  const col = raw(`(${f.sql})`);
  const numeric = isNumeric(f);
  if (op === "isEmpty") return numeric || f.type === "date" ? sql`${col} IS NULL` : sql`(${col} IS NULL OR ${col}::text = '')`;
  if (op === "notEmpty") return numeric || f.type === "date" ? sql`${col} IS NOT NULL` : sql`(${col} IS NOT NULL AND ${col}::text <> '')`;
  if (f.type === "date") {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date for ${f.label}`);
    const cmp = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", neq: "<>" }[op];
    if (!cmp) throw new Error(`Operator ${op} is not supported for dates`);
    return sql`${col} ${raw(cmp)} ${ts(d)}`;
  }
  if (numeric) {
    const n = Number(value);
    if (Number.isNaN(n)) throw new Error(`Invalid number for ${f.label}`);
    const cmp = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", neq: "<>" }[op];
    if (!cmp) throw new Error(`Operator ${op} is not supported for numbers`);
    return sql`${col} ${raw(cmp)} ${n}::numeric`;
  }
  const text = String(value ?? "");
  switch (op) {
    case "eq":
      return sql`lower(${col}::text) = lower(${text})`;
    case "neq":
      return sql`lower(${col}::text) IS DISTINCT FROM lower(${text})`;
    case "contains":
      return sql`${col}::text ILIKE ${`%${likeEscape(text)}%`}`;
    case "in": {
      const values = text.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
      return values.length ? sql`lower(${col}::text) IN (${Prisma.join(values)})` : sql`FALSE`;
    }
    default:
      throw new Error(`Operator ${op} is not supported for text`);
  }
}

interface Built {
  mod: RModule;
  from: Prisma.Sql;
  where: Prisma.Sql;
}

function build(def: ReportDefinition, opts: RunOptions, fields: RField[]): Built {
  const mod = reportModule(def.module)!;
  const need = new Set<JoinKey>();
  const addJoins = (f: RField) => f.joins?.forEach((j) => need.add(j));
  fields.forEach(addJoins);
  const conditions: Prisma.Sql[] = [sql`t."deletedAt" IS NULL`];
  for (const c of def.filters) {
    const f = reportField(mod, c.field);
    if (!f) throw new Error(`Unknown field ${c.field}`);
    addJoins(f);
    conditions.push(filterSql(f, c.op, c.value));
  }
  if (def.dateRange) {
    const f = reportField(mod, def.dateRange.field);
    if (!f || f.type !== "date") throw new Error("The date range needs a date field");
    addJoins(f);
    const { from, to } = resolveRange(opts.dateRange ?? def.dateRange, opts.now);
    if (from) conditions.push(sql`(${raw(f.sql)}) >= ${ts(from)}`);
    if (to) conditions.push(sql`(${raw(f.sql)}) < ${ts(to)}`);
  }
  if (opts.brandId) conditions.push(sql`t."brandId" = ${opts.brandId}`);
  if (opts.regionId) conditions.push(sql`t."regionId" = ${opts.regionId}`);
  if (opts.ownerId) conditions.push(sql`t."ownerId" = ${opts.ownerId}`);
  const joins = [...need].map((j) => mod.joins[j]).filter(Boolean).join("\n");
  return { mod, from: raw(`${mod.table} t\n${joins}`), where: Prisma.join(conditions, " AND ") };
}

const cell = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
};
const valueExpr = (f: RField) => (isNumeric(f) ? `(${f.sql})::float8` : f.type === "date" ? `(${f.sql})` : `(${f.sql})::text`);

/** Runs a report with the viewer's access context. */
export async function runReport(ctx: AccessContext, def: ReportDefinition, opts: RunOptions = {}): Promise<ReportResult> {
  if (def.special) return runSpecial(ctx, def, opts);
  const mod = reportModule(def.module)!;
  const db = scopedDb(ctx);
  const get = (key: string) => {
    const f = reportField(mod, key);
    if (!f) throw new Error(`Unknown field ${key}`);
    return f;
  };

  if (def.groupBy.length > 0) {
    const groups = def.groupBy.map((g) => ({ f: get(g.field), granularity: g.granularity }));
    const summaries = (def.summaries.length ? def.summaries : [{ fn: "count" as const }]).map((s) => ({ fn: s.fn, f: s.fn === "count" ? null : get(s.field!) }));
    const { from, where } = build(def, opts, [...groups.map((g) => g.f), ...summaries.flatMap((s) => (s.f ? [s.f] : []))]);
    const select = [
      ...groups.map((g, i) => `${groupExpr(g.f, g.granularity)} AS g${i}`),
      ...summaries.map((s, i) => (s.fn === "count" ? `count(*)::int AS s${i}` : `${s.fn}(${s.f!.sql})::float8 AS s${i}`)),
    ].join(", ");
    const positions = groups.map((_, i) => i + 1).join(", ");
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>(sql`SELECT ${raw(select)} FROM ${from} WHERE ${where} GROUP BY ${raw(positions)} ORDER BY ${raw(positions)} LIMIT ${MAX_GROUPS + 1}`);
    const truncated = rows.length > MAX_GROUPS;
    return {
      kind: "summary",
      groupCount: groups.length,
      columns: [
        ...groups.map((g) => ({ key: g.f.key, label: g.f.label + (g.f.type === "date" ? ` (${g.granularity ?? "month"})` : ""), type: "text" as const })),
        ...summaries.map((s) => ({
          key: `${s.fn}:${s.f?.key ?? "*"}`,
          label: s.fn === "count" ? "Records" : `${{ sum: "Sum of", avg: "Average", min: "Min", max: "Max" }[s.fn]} ${s.f!.label}`,
          type: s.fn === "count" ? ("number" as const) : s.f!.type,
        })),
      ],
      rows: rows.slice(0, MAX_GROUPS).map((r) => [...groups.map((_, i) => cell(r[`g${i}`])), ...summaries.map((_, i) => cell(r[`s${i}`]))]),
      total: Math.min(rows.length, MAX_GROUPS),
      truncated,
    };
  }

  const columns = (def.columns.length ? def.columns : mod.defaultColumns).map(get);
  const sortField = get(def.sort?.field ?? mod.defaultSort);
  const { from, where } = build(def, opts, [...columns, sortField]);
  const take = Math.min(Math.max(opts.take ?? 50, 1), MAX_EXPORT_ROWS);
  const select = ["t.id AS id", ...columns.map((f, i) => `${valueExpr(f)} AS c${i}`)].join(", ");
  const order = `(${sortField.sql}) ${def.sort?.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, t.id`;
  const [rows, count] = await Promise.all([
    db.$queryRaw<Array<Record<string, unknown>>>(sql`SELECT ${raw(select)} FROM ${from} WHERE ${where} ORDER BY ${raw(order)} LIMIT ${take} OFFSET ${Math.max(opts.skip ?? 0, 0)}`),
    db.$queryRaw<Array<{ n: number }>>(sql`SELECT count(*)::int AS n FROM ${from} WHERE ${where}`),
  ]);
  const total = count[0]?.n ?? 0;
  return {
    kind: "tabular",
    groupCount: 0,
    columns: columns.map((f) => ({ key: f.key, label: f.label, type: f.type })),
    rows: rows.map((r) => columns.map((_, i) => cell(r[`c${i}`]))),
    ids: rows.map((r) => String(r.id)),
    total,
    truncated: total > (opts.skip ?? 0) + rows.length,
  };
}

/**
 * Ids of the records a report's filters select for the viewer (campaign audiences use a saved report as their
 * filter). Grouping / columns are ignored; specials have no record list.
 */
export async function reportRecordIds(ctx: AccessContext, def: ReportDefinition, opts: RunOptions = {}, limit = 20_000): Promise<string[]> {
  if (def.special) throw new Error("This report has no record list");
  const { from, where } = build(def, opts, []);
  const rows = await scopedDb(ctx).$queryRaw<Array<{ id: string }>>(sql`SELECT t.id FROM ${from} WHERE ${where} ORDER BY t.id LIMIT ${limit}`);
  return rows.map((r) => r.id);
}

// ───────────────────────────── fixed multi-source reports ─────────────────────────────

async function runSpecial(ctx: AccessContext, def: ReportDefinition, opts: RunOptions): Promise<ReportResult> {
  const db = scopedDb(ctx);
  const { from, to } = resolveRange(opts.dateRange ?? def.dateRange, opts.now);
  const range = (col: string) => sql`${from ? sql`AND ${raw(col)} >= ${ts(from)}` : Prisma.empty} ${to ? sql`AND ${raw(col)} < ${ts(to)}` : Prisma.empty}`;
  const scope = (alias: string) =>
    sql`${opts.brandId ? sql`AND ${raw(alias)}."brandId" = ${opts.brandId}` : Prisma.empty} ${opts.regionId ? sql`AND ${raw(alias)}."regionId" = ${opts.regionId}` : Prisma.empty} ${opts.ownerId ? sql`AND ${raw(alias)}."ownerId" = ${opts.ownerId}` : Prisma.empty}`;
  const num = (v: unknown) => Number(v ?? 0);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a * 1000) / b) / 10 : 0);

  if (def.special === "FUNNEL") {
    // "Reached" = the deal entered that stage or any later one (stage history), for deals created in the period.
    const reached = (keys: string[]) => sql`
      SELECT count(*)::int AS n FROM "Deal" d
      WHERE d."deletedAt" IS NULL ${range('d."createdAt"')} ${scope("d")}
        AND EXISTS (SELECT 1 FROM "DealStageHistory" h JOIN "PipelineStage" s ON s.id = h."toStageId"
                    WHERE h."dealId" = d.id AND (s.key IN (${Prisma.join(keys)}) OR s.type = 'WON'))`;
    const [leads, drives, bookings, deliveries] = await Promise.all([
      db.$queryRaw<Array<{ n: number }>>(sql`SELECT count(*)::int AS n FROM "Lead" l WHERE l."deletedAt" IS NULL ${range('l."createdAt"')} ${scope("l")}`),
      db.$queryRaw<Array<{ n: number }>>(reached(["TEST_DRIVE", "QUOTATION", "BOOKING", "FINANCE_PAYMENT", "DELIVERY"])),
      db.$queryRaw<Array<{ n: number }>>(reached(["BOOKING", "FINANCE_PAYMENT", "DELIVERY"])),
      db.$queryRaw<Array<{ n: number }>>(reached(["DELIVERY"])),
    ]);
    const steps: Array<[string, number]> = [
      ["Leads", num(leads[0]?.n)],
      ["Test Drive", num(drives[0]?.n)],
      ["Booking", num(bookings[0]?.n)],
      ["Delivery", num(deliveries[0]?.n)],
    ];
    return {
      kind: "summary",
      groupCount: 1,
      columns: [
        { key: "step", label: "Step", type: "text" },
        { key: "count", label: "Records", type: "number" },
        { key: "rate", label: "% of leads", type: "percent" },
      ],
      rows: steps.map(([label, n]) => [label, n, pct(n, steps[0]![1])]),
      total: steps.length,
      truncated: false,
    };
  }

  if (def.special === "LEAD_SOURCE_ROI") {
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>(sql`
      SELECT b.code AS brand, l.source::text AS source, count(*)::int AS leads,
             (count(*) FILTER (WHERE l.status = 'CONVERTED'))::int AS converted,
             (count(d.id) FILTER (WHERE s.type = 'WON'))::int AS won,
             coalesce(sum(d.amount) FILTER (WHERE s.type = 'WON'), 0)::float8 AS revenue
      FROM "Lead" l
      JOIN "Brand" b ON b.id = l."brandId"
      LEFT JOIN "Deal" d ON d.id = l."convertedDealId" AND d."deletedAt" IS NULL
      LEFT JOIN "PipelineStage" s ON s.id = d."stageId"
      WHERE l."deletedAt" IS NULL ${range('l."createdAt"')} ${scope("l")}
      GROUP BY 1, 2 ORDER BY 1, 2`);
    return {
      kind: "summary",
      groupCount: 2,
      columns: [
        { key: "brand", label: "Brand", type: "text" },
        { key: "source", label: "Source", type: "text" },
        { key: "leads", label: "Leads", type: "number" },
        { key: "converted", label: "Converted", type: "number" },
        { key: "conversion", label: "Conversion %", type: "percent" },
        { key: "won", label: "Won deals", type: "number" },
        { key: "revenue", label: "Won revenue", type: "money" },
        { key: "perLead", label: "Revenue per lead", type: "money" },
      ],
      rows: rows.map((r) => [cell(r.brand), cell(r.source), num(r.leads), num(r.converted), pct(num(r.converted), num(r.leads)), num(r.won), num(r.revenue), num(r.leads) ? Math.round(num(r.revenue) / num(r.leads)) : 0]),
      total: rows.length,
      truncated: false,
    };
  }

  // EXEC_PERFORMANCE
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>(sql`
    WITH leads AS (
      SELECT l."ownerId" AS o, count(*)::int AS n FROM "Lead" l WHERE l."deletedAt" IS NULL ${range('l."createdAt"')} ${scope("l")} GROUP BY 1
    ), drives AS (
      SELECT a."ownerId" AS o, count(*)::int AS n FROM "Activity" a
      WHERE a."deletedAt" IS NULL AND a.type = 'TEST_DRIVE' AND a.status = 'COMPLETED' ${range('a."completedAt"')} ${scope("a")} GROUP BY 1
    ), bookings AS (
      SELECT d."ownerId" AS o, count(DISTINCT d.id)::int AS n FROM "Deal" d
      JOIN "DealStageHistory" h ON h."dealId" = d.id JOIN "PipelineStage" s ON s.id = h."toStageId"
      WHERE d."deletedAt" IS NULL AND s.key = 'BOOKING' ${range('h."at"')} ${scope("d")} GROUP BY 1
    ), deliveries AS (
      SELECT d."ownerId" AS o, count(*)::int AS n, coalesce(sum(d.amount), 0)::float8 AS revenue FROM "Deal" d
      JOIN "PipelineStage" s ON s.id = d."stageId"
      WHERE d."deletedAt" IS NULL AND s.type = 'WON' ${range('d."stageEnteredAt"')} ${scope("d")} GROUP BY 1
    )
    SELECT u.name, coalesce(l.n, 0) AS leads, coalesce(t.n, 0) AS drives, coalesce(b.n, 0) AS bookings, coalesce(dl.n, 0) AS deliveries, coalesce(dl.revenue, 0) AS revenue
    FROM "User" u
    LEFT JOIN leads l ON l.o = u.id LEFT JOIN drives t ON t.o = u.id LEFT JOIN bookings b ON b.o = u.id LEFT JOIN deliveries dl ON dl.o = u.id
    WHERE coalesce(l.n, 0) + coalesce(t.n, 0) + coalesce(b.n, 0) + coalesce(dl.n, 0) > 0
    ORDER BY deliveries DESC, bookings DESC, leads DESC, u.name
    LIMIT ${MAX_GROUPS}`);
  return {
    kind: "summary",
    groupCount: 1,
    columns: [
      { key: "exec", label: "Sales exec", type: "text" },
      { key: "leads", label: "Leads", type: "number" },
      { key: "drives", label: "Test drives", type: "number" },
      { key: "bookings", label: "Bookings", type: "number" },
      { key: "deliveries", label: "Deliveries", type: "number" },
      { key: "conversion", label: "Conversion %", type: "percent" },
      { key: "revenue", label: "Won revenue", type: "money" },
    ],
    rows: rows.map((r) => [cell(r.name), num(r.leads), num(r.drives), num(r.bookings), num(r.deliveries), pct(num(r.deliveries), num(r.leads)), num(r.revenue)]),
    total: rows.length,
    truncated: false,
  };
}

/** Chart series of a summary result: first group = category, optional second group = series, first numeric = value. */
export function chartData(result: ReportResult, valueIndex = 0): { categories: string[]; series: Array<{ name: string; values: number[] }> } {
  if (result.kind !== "summary" || result.rows.length === 0) return { categories: [], series: [] };
  const v = result.groupCount + valueIndex;
  const categories = [...new Set(result.rows.map((r) => String(r[0] ?? "(none)")))];
  if (result.groupCount < 2) {
    return { categories, series: [{ name: result.columns[v]?.label ?? "Value", values: categories.map((c) => Number(result.rows.find((r) => String(r[0] ?? "(none)") === c)?.[v] ?? 0)) }] };
  }
  const names = [...new Set(result.rows.map((r) => String(r[1] ?? "(none)")))].slice(0, 12);
  return {
    categories,
    series: names.map((name) => ({
      name,
      // further group levels are summed into the (category, series) cell
      values: categories.map((c) => result.rows.filter((r) => String(r[0] ?? "(none)") === c && String(r[1] ?? "(none)") === name).reduce((a, r) => a + Number(r[v] ?? 0), 0)),
    })),
  };
}
