/**
 * Dashboards (prompt 09): four seeded definitions (Group, Brand, Region, My Sales). The SAME definition shows
 * different data per viewer – every widget is computed through scopedDb / RLS with the viewer's context.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { assertCan, hasPermission } from "@/server/access/can";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { listActivities } from "@/server/modules/activities/queries";
import { getForecast, parsePeriod, viewerNode, type ForecastNode } from "@/server/modules/forecasts/service";
import { definitionSchema, resolveRange, type ReportDefinition } from "@/server/modules/reports/definition";
import { chartData, runReport, type ReportResult } from "@/server/modules/reports/engine";

type Metric = "pipelineValue" | "weightedPipeline" | "openDeals" | "wonMonth" | "conversion" | "tasksDue";
type Source =
  | { kind: "kpi"; metric: Metric }
  | { kind: "report"; definition: Record<string, unknown>; valueIndex?: number; top?: number }
  | { kind: "forecast" }
  | { kind: "forecastTable" }
  | { kind: "tasks" };

export interface WidgetDef {
  id: string;
  type: "kpi" | "chart" | "table" | "meter" | "leaderboard";
  title: string;
  /** grid columns (of 4) */
  span: 1 | 2 | 3 | 4;
  source: Source;
  chart?: "bar" | "line" | "pie" | "funnel";
  /** only the viewer's own records */
  mine?: boolean;
  href?: string;
}
export interface DashboardDef {
  key: "group" | "brand" | "region" | "my";
  name: string;
  audience: string;
  widgets: WidgetDef[];
}

const open = { field: "stageType", op: "eq", value: "OPEN" };
const won = { field: "stageType", op: "eq", value: "WON" };
const wonThisYear = { filters: [won], dateRange: { field: "stageEnteredAt", preset: "THIS_YEAR" } };
const execPerformance = { module: "deals", special: "EXEC_PERFORMANCE", dateRange: { field: "createdAt", preset: "THIS_QUARTER" } };

const kpi = (id: string, title: string, metric: Metric, mine = false): WidgetDef => ({ id, type: "kpi", title, span: 1, source: { kind: "kpi", metric }, mine });

export const DASHBOARDS: DashboardDef[] = [
  {
    key: "group",
    name: "Group",
    audience: "MD, Head of Sales",
    widgets: [
      kpi("pipeline", "Open pipeline", "pipelineValue"),
      kpi("won", "Won this month", "wonMonth"),
      kpi("conversion", "Conversion this quarter", "conversion"),
      kpi("deals", "Open deals", "openDeals"),
      { id: "sales", type: "chart", title: "Sales by brand and region (this year)", span: 2, chart: "bar", source: { kind: "report", valueIndex: 1, definition: { module: "deals", ...wonThisYear, groupBy: [{ field: "brand" }, { field: "region" }], summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }] } }, href: "/reports/won-by-brand-region-month" },
      { id: "target", type: "meter", title: "Month vs target", span: 2, source: { kind: "forecast" }, href: "/forecasts" },
      { id: "stages", type: "chart", title: "Pipeline value by brand and stage", span: 2, chart: "bar", source: { kind: "report", valueIndex: 1, definition: { module: "deals", filters: [open], groupBy: [{ field: "brand" }, { field: "stage" }], summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }] } }, href: "/reports/pipeline-by-stage-brand" },
      { id: "top", type: "leaderboard", title: "Top 10 sales execs (this quarter)", span: 2, source: { kind: "report", definition: execPerformance, top: 10 }, href: "/reports/exec-performance" },
    ],
  },
  {
    key: "brand",
    name: "Brand",
    audience: "Brand Managers (own brand)",
    widgets: [
      kpi("pipeline", "Open pipeline", "pipelineValue"),
      kpi("weighted", "Weighted pipeline", "weightedPipeline"),
      kpi("won", "Won this month", "wonMonth"),
      kpi("conversion", "Conversion this quarter", "conversion"),
      { id: "regions", type: "chart", title: "Pipeline: Lagos and the regions", span: 2, chart: "bar", source: { kind: "report", valueIndex: 1, definition: { module: "deals", filters: [open], groupBy: [{ field: "region" }, { field: "stage" }], summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }] } } },
      { id: "target", type: "meter", title: "Forecast vs target (this month)", span: 2, source: { kind: "forecast" }, href: "/forecasts" },
      { id: "execs", type: "table", title: "Sales execs (this quarter)", span: 2, source: { kind: "report", definition: execPerformance }, href: "/reports/exec-performance" },
      { id: "monthly", type: "chart", title: "Won revenue by month", span: 2, chart: "line", source: { kind: "report", valueIndex: 1, definition: { module: "deals", ...wonThisYear, groupBy: [{ field: "stageEnteredAt", granularity: "month" }], summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }] } } },
    ],
  },
  {
    key: "region",
    name: "Region",
    audience: "Regional Sales Managers",
    widgets: [
      kpi("pipeline", "Open pipeline", "pipelineValue"),
      kpi("won", "Won this month", "wonMonth"),
      kpi("conversion", "Conversion this quarter", "conversion"),
      kpi("deals", "Open deals", "openDeals"),
      { id: "brands", type: "chart", title: "All brands by region (open pipeline)", span: 2, chart: "bar", source: { kind: "report", valueIndex: 1, definition: { module: "deals", filters: [open], groupBy: [{ field: "region" }, { field: "brand" }], summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }] } } },
      { id: "wonBrands", type: "chart", title: "Won revenue by brand (this year)", span: 2, chart: "pie", source: { kind: "report", valueIndex: 1, definition: { module: "deals", ...wonThisYear, groupBy: [{ field: "brand" }], summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }] } } },
      { id: "execs", type: "table", title: "Regional exec performance (this quarter)", span: 4, source: { kind: "report", definition: execPerformance }, href: "/reports/exec-performance" },
    ],
  },
  {
    key: "my",
    name: "My Sales",
    audience: "Sales Execs",
    widgets: [
      kpi("pipeline", "My open pipeline", "pipelineValue", true),
      kpi("won", "My sales this month", "wonMonth", true),
      kpi("deals", "My open deals", "openDeals", true),
      kpi("tasks", "Tasks due", "tasksDue", true),
      { id: "stages", type: "chart", title: "My pipeline by stage", span: 2, chart: "funnel", mine: true, source: { kind: "report", valueIndex: 1, definition: { module: "deals", filters: [open], groupBy: [{ field: "stage" }], summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }] } }, href: "/deals?layout=kanban" },
      { id: "target", type: "meter", title: "My target (this month)", span: 2, source: { kind: "forecast" }, mine: true, href: "/forecasts" },
      { id: "tasks", type: "table", title: "My tasks due", span: 4, source: { kind: "tasks" }, mine: true, href: "/activities" },
    ],
  },
];

export type WidgetData =
  | { type: "kpi"; value: number; format: "money" | "number" | "percent"; sub?: string }
  | { type: "chart"; chart: "bar" | "line" | "pie" | "funnel"; categories: string[]; series: Array<{ name: string; values: number[] }>; format: "money" | "number" }
  | { type: "table"; columns: Array<{ label: string; type: string }>; rows: Array<Array<string | number | null>>; links?: Array<string | null> }
  | { type: "meter"; label: string; target: number; won: number; forecast: number; attainment: number | null }
  | { type: "leaderboard"; rows: Array<{ name: string; value: number; sub: string }> };

/** The dashboard a viewer lands on: Group (management), Brand (Brand Manager), Region (RSM), My Sales (exec). */
export function defaultDashboard(ctx: AccessContext): DashboardDef["key"] {
  if (ctx.scope === "ALL") return "group";
  if (ctx.memberships.some((m) => m.isManager && m.regionId === null)) return "brand";
  if (ctx.memberships.some((m) => m.isManager)) return "region";
  return "my";
}

interface Ui {
  brandId?: string | null;
  regionId?: string | null;
}
const ts = (d: Date) => Prisma.sql`${d.toISOString().replace("T", " ").replace("Z", "")}::timestamp`;

async function kpis(ctx: AccessContext, ui: Ui, ownerId: string | null, now: Date) {
  const db = scopedDb(ctx);
  const month = resolveRange({ preset: "THIS_MONTH" }, now);
  const quarter = resolveRange({ preset: "THIS_QUARTER" }, now);
  const narrow = (alias: string) =>
    Prisma.sql`${ui.brandId ? Prisma.sql`AND ${Prisma.raw(alias)}."brandId" = ${ui.brandId}` : Prisma.empty} ${ui.regionId ? Prisma.sql`AND ${Prisma.raw(alias)}."regionId" = ${ui.regionId}` : Prisma.empty} ${ownerId ? Prisma.sql`AND ${Prisma.raw(alias)}."ownerId" = ${ownerId}` : Prisma.empty}`;
  const [deal, lead] = await Promise.all([
    db.$queryRaw<Array<{ pipeline: number; weighted: number; open: number; wonMonth: number; wonMonthCount: number; wonQuarter: number }>>(Prisma.sql`
      SELECT coalesce(sum(f.amount) FILTER (WHERE f."stageType" = 'OPEN'), 0)::float8 AS pipeline,
             coalesce(sum(f."weightedAmount") FILTER (WHERE f."stageType" = 'OPEN'), 0)::float8 AS weighted,
             (count(*) FILTER (WHERE f."stageType" = 'OPEN'))::int AS open,
             coalesce(sum(f.amount) FILTER (WHERE f."stageType" = 'WON' AND f."stageEnteredAt" >= ${ts(month.from!)} AND f."stageEnteredAt" < ${ts(month.to!)}), 0)::float8 AS "wonMonth",
             (count(*) FILTER (WHERE f."stageType" = 'WON' AND f."stageEnteredAt" >= ${ts(month.from!)} AND f."stageEnteredAt" < ${ts(month.to!)}))::int AS "wonMonthCount",
             (count(*) FILTER (WHERE f."stageType" = 'WON' AND f."stageEnteredAt" >= ${ts(quarter.from!)} AND f."stageEnteredAt" < ${ts(quarter.to!)}))::int AS "wonQuarter"
      FROM "DealFact" f
      WHERE (f."stageType" = 'OPEN' OR (f."stageType" = 'WON' AND f."stageEnteredAt" >= ${ts(quarter.from!)})) ${narrow("f")}`),
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM "Lead" l WHERE l."deletedAt" IS NULL AND l."createdAt" >= ${ts(quarter.from!)} AND l."createdAt" < ${ts(quarter.to!)} ${narrow("l")}`),
  ]);
  const d = deal[0] ?? { pipeline: 0, weighted: 0, open: 0, wonMonth: 0, wonMonthCount: 0, wonQuarter: 0 };
  const leads = lead[0]?.n ?? 0;
  return { ...d, leadsQuarter: leads, conversion: leads > 0 ? Math.round((d.wonQuarter * 1000) / leads) / 10 : 0 };
}

/** Loads every widget of a dashboard for the viewer. Shared inputs (KPIs, forecast) are computed once. */
export async function loadDashboard(ctx: AccessContext, key: string, ui: Ui = {}, now = new Date()): Promise<{ dashboard: DashboardDef; widgets: Array<{ def: WidgetDef; data: WidgetData }> }> {
  assertCan(ctx, "dashboards", "read");
  const dashboard = DASHBOARDS.find((d) => d.key === key) ?? DASHBOARDS.find((d) => d.key === defaultDashboard(ctx))!;
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(k: string, fn: () => Promise<T>) => {
    if (!cache.has(k)) cache.set(k, fn());
    return cache.get(k) as Promise<T>;
  };
  const canForecast = hasPermission(ctx, "forecasts", "read");

  const load = async (w: WidgetDef): Promise<WidgetData> => {
    const ownerId = w.mine ? ctx.userId : null;
    const src = w.source;
    if (src.kind === "kpi") {
      if (src.metric === "tasksDue") {
        const n = hasPermission(ctx, "activities", "read") ? (await once("tasks", () => listActivities(ctx, { view: "my", type: "TASK" }, ui, { take: 8 }))).total : 0;
        return { type: "kpi", value: n, format: "number" };
      }
      const k = await once(`kpi:${ownerId}`, () => kpis(ctx, ui, ownerId, now));
      if (src.metric === "pipelineValue") return { type: "kpi", value: k.pipeline, format: "money", sub: `${k.open} open deals` };
      if (src.metric === "weightedPipeline") return { type: "kpi", value: k.weighted, format: "money", sub: "amount × stage probability" };
      if (src.metric === "openDeals") return { type: "kpi", value: k.open, format: "number" };
      if (src.metric === "wonMonth") return { type: "kpi", value: k.wonMonth, format: "money", sub: `${k.wonMonthCount} deals` };
      return { type: "kpi", value: k.conversion, format: "percent", sub: `${k.wonQuarter} won of ${k.leadsQuarter} leads` };
    }
    if (src.kind === "forecast" || src.kind === "forecastTable") {
      const empty: WidgetData = { type: "meter", label: "", target: 0, won: 0, forecast: 0, attainment: null };
      if (!canForecast) return empty;
      const period = parsePeriod(null, now);
      const root = await once<ForecastNode>("forecast", () => getForecast(ctx, period, ui));
      const node = viewerNode(ctx, root);
      return { type: "meter", label: `${node.label} · ${period.label}`, target: node.target, won: node.won, forecast: node.forecast, attainment: node.attainment };
    }
    if (src.kind === "tasks") {
      const { rows } = hasPermission(ctx, "activities", "read") ? await once("tasks", () => listActivities(ctx, { view: "my", type: "TASK" }, ui, { take: 8 })) : { rows: [] };
      return {
        type: "table",
        columns: [
          { label: "Task", type: "text" },
          { label: "Due", type: "date" },
          { label: "Status", type: "text" },
        ],
        rows: rows.map((a) => [a.subject, a.at, a.overdue ? "Overdue" : "Open"]),
        links: rows.map((a) => `/activities/${a.id}`),
      };
    }
    const definition = definitionSchema.parse({ filters: [], ...src.definition }) as ReportDefinition;
    const result: ReportResult = await runReport(ctx, definition, { ...ui, ownerId, now });
    if (w.type === "leaderboard") {
      // exec performance: name, leads, drives, bookings, deliveries, conversion, revenue
      const rows = [...result.rows].sort((a, b) => Number(b[6]) - Number(a[6]) || Number(b[4]) - Number(a[4])).slice(0, src.top ?? 10);
      return { type: "leaderboard", rows: rows.map((r) => ({ name: String(r[0]), value: Number(r[6]), sub: `${r[4]} deliveries · ${r[3]} bookings · ${r[1]} leads` })) };
    }
    if (w.type === "chart") {
      const data = chartData(result, src.valueIndex ?? 0);
      const col = result.columns[result.groupCount + (src.valueIndex ?? 0)];
      return { type: "chart", chart: w.chart ?? "bar", ...data, format: col?.type === "money" ? "money" : "number" };
    }
    return { type: "table", columns: result.columns.map((c) => ({ label: c.label, type: c.type })), rows: result.rows.slice(0, 15) };
  };
  return { dashboard, widgets: await Promise.all(dashboard.widgets.map(async (def) => ({ def, data: await load(def) }))) };
}
