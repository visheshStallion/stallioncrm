import { z } from "zod";
import { CHART_TYPES, DATE_PRESETS, FILTER_OPS, GRANULARITIES, isNumeric, reportField, reportModule, SPECIALS, SUMMARY_FNS } from "./catalog";

const key = z.string().min(1).max(40);

export const definitionSchema = z
  .object({
    module: z.enum(["deals", "leads", "quotes", "activities"]),
    /** fixed multi-source standard reports */
    special: z.enum(SPECIALS).optional(),
    columns: z.array(key).max(20).default([]),
    filters: z.array(z.object({ field: key, op: z.enum(FILTER_OPS), value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]).optional() })).max(15).default([]),
    dateRange: z.object({ field: key, preset: z.enum(DATE_PRESETS), from: z.string().max(10).optional(), to: z.string().max(10).optional() }).optional(),
    groupBy: z.array(z.object({ field: key, granularity: z.enum(GRANULARITIES).optional() })).max(3).default([]),
    summaries: z.array(z.object({ fn: z.enum(SUMMARY_FNS), field: key.optional() })).max(6).default([]),
    sort: z.object({ field: key, dir: z.enum(["asc", "desc"]).default("asc") }).optional(),
    chart: z.object({ type: z.enum(CHART_TYPES) }).default({ type: "none" }),
  })
  .superRefine((d, ctx) => {
    const mod = reportModule(d.module)!;
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const field = (k: string) => reportField(mod, k);
    for (const c of d.columns) if (!field(c)) issue(`Unknown column "${c}"`);
    for (const f of d.filters) if (!field(f.field)) issue(`Unknown filter field "${f.field}"`);
    if (d.dateRange && field(d.dateRange.field)?.type !== "date") issue("The date range needs a date field");
    for (const g of d.groupBy) {
      const f = field(g.field);
      if (!f) issue(`Unknown grouping field "${g.field}"`);
      else if (g.granularity && f.type !== "date") issue(`"${f.label}" is not a date`);
    }
    for (const s of d.summaries) {
      if (s.fn === "count") continue;
      const f = s.field ? field(s.field) : undefined;
      if (!f || !isNumeric(f)) issue(`${s.fn} needs a numeric field`);
    }
    if (d.sort && !field(d.sort.field)) issue(`Unknown sort field "${d.sort.field}"`);
    if (!d.special && d.groupBy.length === 0 && d.columns.length === 0) issue("Choose columns or a grouping");
  });
export type ReportDefinition = z.infer<typeof definitionSchema>;

export const reportSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
  folder: z.enum(["PRIVATE", "BRAND", "GROUP"]).default("PRIVATE"),
  brandId: z.string().max(40).nullish().transform((v) => v || null),
  definition: definitionSchema,
});

const DAY = 86_400_000;
const LAGOS = 3_600_000;
/** Lagos midnight (UTC+1, no DST) of a Lagos calendar date, as an instant. */
const lagos = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - LAGOS);

/** [from, to) of a date preset in Africa/Lagos time; null = unbounded. */
export function resolveRange(range: { preset: string; from?: string; to?: string } | undefined, now = new Date()): { from: Date | null; to: Date | null } {
  if (!range || range.preset === "ALL") return { from: null, to: null };
  const local = new Date(now.getTime() + LAGOS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const q = Math.floor(m / 3) * 3;
  const today = lagos(y, m, local.getUTCDate());
  switch (range.preset) {
    case "THIS_MONTH":
      return { from: lagos(y, m, 1), to: lagos(y, m + 1, 1) };
    case "LAST_MONTH":
      return { from: lagos(y, m - 1, 1), to: lagos(y, m, 1) };
    case "THIS_QUARTER":
      return { from: lagos(y, q, 1), to: lagos(y, q + 3, 1) };
    case "LAST_QUARTER":
      return { from: lagos(y, q - 3, 1), to: lagos(y, q, 1) };
    case "THIS_YEAR":
      return { from: lagos(y, 0, 1), to: lagos(y + 1, 0, 1) };
    case "LAST_YEAR":
      return { from: lagos(y - 1, 0, 1), to: lagos(y, 0, 1) };
    case "LAST_7_DAYS":
      return { from: new Date(today.getTime() - 6 * DAY), to: new Date(today.getTime() + DAY) };
    case "LAST_30_DAYS":
      return { from: new Date(today.getTime() - 29 * DAY), to: new Date(today.getTime() + DAY) };
    case "LAST_90_DAYS":
      return { from: new Date(today.getTime() - 89 * DAY), to: new Date(today.getTime() + DAY) };
    case "CUSTOM": {
      const parse = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? lagos(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) : null);
      const to = parse(range.to);
      return { from: parse(range.from), to: to ? new Date(to.getTime() + DAY) : null };
    }
    default:
      return { from: null, to: null };
  }
}
