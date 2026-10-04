/**
 * Forecasts & targets (prompt 09).
 *   forecast = won in the period + committed (open deals at Booking or later) + weighted rest of the pipeline
 *              (amount × stage probability), for deals expected to close in the period
 * rolled up User → Brand-Region → Brand → Group along the territory tree. Every number comes from the
 * `DealFact` view (security_invoker) through scopedDb, so a viewer only ever rolls up deals they may see.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertCan, hasPermission } from "@/server/access/can";
import { ForbiddenError } from "@/server/access/errors";
import { loadAccessContext } from "@/server/access/context";
import type { AccessContext } from "@/server/access/types";
import { hasTerritoryAccess, isManagerOf } from "@/server/access/visibility";
import { audit, scopedDb } from "@/server/db";
import { BadRequestError } from "@/server/errors";

export interface Period {
  type: "MONTH" | "QUARTER";
  /** first day (UTC date) */
  start: Date;
  /** "2026-10" / "2026-Q4" */
  key: string;
  label: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LAGOS = 3_600_000;

/** Parses "2026-10" or "2026-Q4"; anything else → the current month (Africa/Lagos). */
export function parsePeriod(key?: string | null, now = new Date()): Period {
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key ?? "");
  if (month) {
    const [y, m] = [Number(month[1]), Number(month[2]) - 1];
    return { type: "MONTH", start: new Date(Date.UTC(y, m, 1)), key: key!, label: `${MONTHS[m]} ${y}` };
  }
  const quarter = /^(\d{4})-Q([1-4])$/.exec(key ?? "");
  if (quarter) {
    const [y, q] = [Number(quarter[1]), Number(quarter[2])];
    return { type: "QUARTER", start: new Date(Date.UTC(y, (q - 1) * 3, 1)), key: key!, label: `Q${q} ${y}` };
  }
  const local = new Date(now.getTime() + LAGOS);
  return parsePeriod(`${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`);
}

/** The period before / after, and the quarter / month view of the same date. */
export function shiftPeriod(p: Period, by: number): string {
  const months = p.type === "MONTH" ? by : by * 3;
  const d = new Date(Date.UTC(p.start.getUTCFullYear(), p.start.getUTCMonth() + months, 1));
  return p.type === "MONTH" ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}
export const quarterOf = (p: Period) => `${p.start.getUTCFullYear()}-Q${Math.floor(p.start.getUTCMonth() / 3) + 1}`;
export const monthOf = (p: Period) => `${p.start.getUTCFullYear()}-${String(p.start.getUTCMonth() + 1).padStart(2, "0")}`;

/** [from, to) of the period as instants (Lagos midnight). */
function bounds(p: Period) {
  const end = new Date(Date.UTC(p.start.getUTCFullYear(), p.start.getUTCMonth() + (p.type === "MONTH" ? 1 : 3), 1));
  return { from: new Date(p.start.getTime() - LAGOS), to: new Date(end.getTime() - LAGOS) };
}
const ts = (d: Date) => Prisma.sql`${d.toISOString().replace("T", " ").replace("Z", "")}::timestamp`;

export interface ForecastNode {
  key: string;
  level: "group" | "brand" | "region" | "user";
  label: string;
  brandId: string | null;
  regionId: string | null;
  userId: string | null;
  /** revenue target (0 = none set) and whether it was set at this level or summed from below */
  target: number;
  targetUnits: number;
  targetSet: boolean;
  won: number;
  wonUnits: number;
  committed: number;
  /** weighted value of the open, not yet committed deals */
  weighted: number;
  /** unweighted open pipeline expected to close in the period */
  pipeline: number;
  openDeals: number;
  adjustment: number;
  forecast: number;
  /** won ÷ target in percent (null without a target) */
  attainment: number | null;
  children: ForecastNode[];
  notes: Array<{ id: string; note: string; adjustment: number | null; author: string; at: string; mine: boolean }>;
}

interface Fact {
  brandId: string;
  regionId: string;
  ownerId: string;
  won: number;
  wonUnits: number;
  committed: number;
  weighted: number;
  pipeline: number;
  openDeals: number;
}

const blank = (key: string, level: ForecastNode["level"], label: string, ids: Partial<Pick<ForecastNode, "brandId" | "regionId" | "userId">>): ForecastNode => ({
  key,
  level,
  label,
  brandId: ids.brandId ?? null,
  regionId: ids.regionId ?? null,
  userId: ids.userId ?? null,
  target: 0,
  targetUnits: 0,
  targetSet: false,
  won: 0,
  wonUnits: 0,
  committed: 0,
  weighted: 0,
  pipeline: 0,
  openDeals: 0,
  adjustment: 0,
  forecast: 0,
  attainment: null,
  children: [],
  notes: [],
});

export const canSetTargets = (ctx: AccessContext, brandId: string) =>
  hasPermission(ctx, "forecasts", "edit") && (ctx.scope === "ALL" || ctx.memberships.some((m) => m.brandId === brandId && m.regionId === null && m.isManager));

/** Managers of the brand (or the brand-region) may add commit / adjustment notes. */
export const canAnnotate = (ctx: AccessContext, brandId: string, regionId: string | null) =>
  ctx.scope === "ALL" ? hasPermission(ctx, "forecasts", "edit") : regionId ? isManagerOf(ctx, brandId, regionId) : ctx.memberships.some((m) => m.brandId === brandId && m.regionId === null && m.isManager);

/**
 * Forecast tree for a period. The roll-up contains exactly the deals the viewer may see: Head of Sales gets the
 * group, a Brand Manager one brand with its regions, an exec their own brand-region(s) (targets of colleagues
 * are not shown to non-managers).
 */
export async function getForecast(ctx: AccessContext, period: Period, ui: { brandId?: string | null; regionId?: string | null } = {}): Promise<ForecastNode> {
  assertCan(ctx, "forecasts", "read");
  const db = scopedDb(ctx);
  const { from, to } = bounds(period);
  const inClose = Prisma.sql`f."closeDate" >= ${ts(from)} AND f."closeDate" < ${ts(to)}`;
  const inWon = Prisma.sql`f."stageEnteredAt" >= ${ts(from)} AND f."stageEnteredAt" < ${ts(to)}`;
  const [facts, targets, notes, brands, regions] = await Promise.all([
    db.$queryRaw<Fact[]>(Prisma.sql`
      SELECT f."brandId", f."regionId", f."ownerId",
             coalesce(sum(f.amount) FILTER (WHERE f."stageType" = 'WON'), 0)::float8 AS won,
             coalesce(sum(f.quantity) FILTER (WHERE f."stageType" = 'WON'), 0)::int AS "wonUnits",
             coalesce(sum(f.amount) FILTER (WHERE f."stageType" = 'OPEN' AND f.committed), 0)::float8 AS committed,
             coalesce(sum(f."weightedAmount") FILTER (WHERE f."stageType" = 'OPEN' AND NOT f.committed), 0)::float8 AS weighted,
             coalesce(sum(f.amount) FILTER (WHERE f."stageType" = 'OPEN'), 0)::float8 AS pipeline,
             (count(*) FILTER (WHERE f."stageType" = 'OPEN'))::int AS "openDeals"
      FROM "DealFact" f
      WHERE ((f."stageType" = 'OPEN' AND ${inClose}) OR (f."stageType" = 'WON' AND ${inWon}))
        ${ui.brandId ? Prisma.sql`AND f."brandId" = ${ui.brandId}` : Prisma.empty}
        ${ui.regionId ? Prisma.sql`AND f."regionId" = ${ui.regionId}` : Prisma.empty}
      GROUP BY 1, 2, 3`),
    db.target.findMany({ where: { periodType: period.type, periodStart: period.start, ...(ui.brandId ? { brandId: ui.brandId } : {}) } }),
    db.forecastNote.findMany({ where: { periodType: period.type, periodStart: period.start }, include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 500 }),
    db.brand.findMany({ where: { id: { in: ctx.brandIds } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    db.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const userIds = [...new Set([...facts.map((f) => f.ownerId), ...targets.flatMap((t) => (t.userId ? [t.userId] : []))])];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "Unknown user";

  const root = blank("group", "group", "Group", {});
  const brandNode = new Map<string, ForecastNode>();
  const regionNode = new Map<string, ForecastNode>();
  const userNode = new Map<string, ForecastNode>();
  const brandOf = (brandId: string) => {
    let n = brandNode.get(brandId);
    if (!n) {
      const b = brands.find((x) => x.id === brandId);
      n = blank(`b:${brandId}`, "brand", b ? `${b.code} – ${b.name}` : "Brand", { brandId });
      brandNode.set(brandId, n);
      root.children.push(n);
    }
    return n;
  };
  const regionOf = (brandId: string, regionId: string) => {
    const k = `${brandId}:${regionId}`;
    let n = regionNode.get(k);
    if (!n) {
      n = blank(`r:${k}`, "region", regions.find((r) => r.id === regionId)?.name ?? "Region", { brandId, regionId });
      regionNode.set(k, n);
      brandOf(brandId).children.push(n);
    }
    return n;
  };
  const userOf = (brandId: string, regionId: string, userId: string) => {
    const k = `${brandId}:${regionId}:${userId}`;
    let n = userNode.get(k);
    if (!n) {
      n = blank(`u:${k}`, "user", name(userId), { brandId, regionId, userId });
      userNode.set(k, n);
      regionOf(brandId, regionId).children.push(n);
    }
    return n;
  };

  for (const f of facts) {
    const n = userOf(f.brandId, f.regionId, f.ownerId);
    n.won = f.won;
    n.wonUnits = f.wonUnits;
    n.committed = f.committed;
    n.weighted = f.weighted;
    n.pipeline = f.pipeline;
    n.openDeals = f.openDeals;
  }
  // Targets: RLS already limits them to the viewer's brands / regions; colleagues' personal targets are
  // additionally hidden from non-managers.
  for (const t of targets) {
    if (ui.regionId && t.regionId && t.regionId !== ui.regionId) continue;
    const peer = t.userId && t.userId !== ctx.userId && !isManagerOf(ctx, t.brandId, t.regionId!);
    if (peer) continue;
    const n = t.userId ? userOf(t.brandId, t.regionId!, t.userId) : t.regionId ? regionOf(t.brandId, t.regionId) : brandOf(t.brandId);
    n.target = Number(t.revenue.toString());
    n.targetUnits = t.units;
    n.targetSet = true;
  }
  for (const note of notes) {
    const n = note.userId && note.regionId ? userNode.get(`${note.brandId}:${note.regionId}:${note.userId}`) : note.regionId ? regionNode.get(`${note.brandId}:${note.regionId}`) : brandNode.get(note.brandId);
    if (!n) continue;
    const adjustment = note.adjustment === null ? null : Number(note.adjustment.toString());
    n.notes.push({ id: note.id, note: note.note, adjustment, author: note.author.name, at: note.createdAt.toISOString(), mine: note.authorId === ctx.userId });
    n.adjustment += adjustment ?? 0;
  }

  const rollUp = (n: ForecastNode): ForecastNode => {
    n.children.forEach(rollUp);
    n.children.sort((a, b) => b.won + b.committed + b.weighted - (a.won + a.committed + a.weighted) || a.label.localeCompare(b.label));
    for (const c of n.children) {
      n.won += c.won;
      n.wonUnits += c.wonUnits;
      n.committed += c.committed;
      n.weighted += c.weighted;
      n.pipeline += c.pipeline;
      n.openDeals += c.openDeals;
      n.adjustment += c.adjustment;
    }
    // A level without its own target shows the sum of the targets below it.
    if (!n.targetSet) {
      n.target = n.children.reduce((a, c) => a + c.target, 0);
      n.targetUnits = n.children.reduce((a, c) => a + c.targetUnits, 0);
    }
    n.forecast = Math.round((n.won + n.committed + n.weighted + n.adjustment) * 100) / 100;
    n.attainment = n.target > 0 ? Math.round((n.won * 1000) / n.target) / 10 : null;
    return n;
  };
  return rollUp(root);
}

/** The node that represents the viewer: the group (management), their brand (Brand Manager) or themselves. */
export function viewerNode(ctx: AccessContext, root: ForecastNode): ForecastNode {
  if (ctx.scope === "ALL") return root;
  const brandLevel = ctx.memberships.filter((m) => m.regionId === null);
  if (brandLevel.length === 1) return root.children.find((b) => b.brandId === brandLevel[0]!.brandId) ?? root;
  if (ctx.memberships.some((m) => m.isManager)) return root;
  // a sales exec: their own lines, summed over their brand-regions
  const mine = root.children.flatMap((b) => b.children.flatMap((r) => r.children.filter((u) => u.userId === ctx.userId)));
  const me = blank("me", "user", ctx.user.name, { userId: ctx.userId });
  for (const n of mine) {
    me.target += n.target;
    me.targetUnits += n.targetUnits;
    me.won += n.won;
    me.wonUnits += n.wonUnits;
    me.committed += n.committed;
    me.weighted += n.weighted;
    me.pipeline += n.pipeline;
    me.openDeals += n.openDeals;
    me.forecast += n.forecast;
  }
  me.targetSet = mine.some((n) => n.targetSet);
  me.attainment = me.target > 0 ? Math.round((me.won * 1000) / me.target) / 10 : null;
  return me;
}

const targetSchema = z.object({
  period: z.string().min(6).max(8),
  brandId: z.string().min(1),
  regionId: z.string().nullish().transform((v) => v || null),
  userId: z.string().nullish().transform((v) => v || null),
  units: z.coerce.number().int().min(0).max(1_000_000).default(0),
  revenue: z.coerce.number().min(0).max(1e13).default(0),
});

/** Head of Sales (management) or the Brand Manager of the brand sets a target at brand, region or user level. */
export async function setTarget(ctx: AccessContext, input: unknown) {
  const data = targetSchema.parse(input);
  if (!canSetTargets(ctx, data.brandId)) throw new ForbiddenError("Targets are set by the Head of Sales or the Brand Manager of the brand");
  const period = parsePeriod(data.period);
  if (period.key !== data.period) throw new BadRequestError("Unknown period");
  if (data.userId) {
    if (!data.regionId) throw new BadRequestError("A user target needs a region");
    const user = await loadAccessContext(data.userId);
    if (!user || !hasTerritoryAccess(user, data.brandId, data.regionId)) throw new BadRequestError("This user does not work in the brand-region");
  }
  const db = scopedDb(ctx);
  const where = { periodType: period.type, periodStart: period.start, brandId: data.brandId, regionId: data.regionId, userId: data.userId };
  const existing = await db.target.findFirst({ where });
  const values = { units: data.units, revenue: data.revenue, updatedById: ctx.userId };
  const target = existing ? await db.target.update({ where: { id: existing.id }, data: values }) : await db.target.create({ data: { ...where, ...values, createdById: ctx.userId } });
  await audit({
    ctx,
    action: existing ? "UPDATE" : "CREATE",
    entity: "Target",
    entityId: target.id,
    brandId: data.brandId,
    before: existing ? { units: existing.units, revenue: existing.revenue } : undefined,
    after: { period: period.key, regionId: data.regionId, userId: data.userId, units: data.units, revenue: data.revenue },
  });
  return { id: target.id };
}

const noteSchema = z.object({
  period: z.string().min(6).max(8),
  brandId: z.string().min(1),
  regionId: z.string().nullish().transform((v) => v || null),
  userId: z.string().nullish().transform((v) => v || null),
  adjustment: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().min(-1e13).max(1e13).nullable()),
  note: z.string().trim().min(1, "Write a note").max(1000),
});

export async function addForecastNote(ctx: AccessContext, input: unknown) {
  const data = noteSchema.parse(input);
  if (!canAnnotate(ctx, data.brandId, data.regionId)) throw new ForbiddenError("Only managers of this brand / region can add forecast notes");
  const period = parsePeriod(data.period);
  if (period.key !== data.period) throw new BadRequestError("Unknown period");
  if (data.userId && !data.regionId) throw new BadRequestError("A note about a user needs a region");
  return scopedDb(ctx).forecastNote.create({
    data: { periodType: period.type, periodStart: period.start, brandId: data.brandId, regionId: data.regionId, userId: data.userId, adjustment: data.adjustment, note: data.note, authorId: ctx.userId },
    select: { id: true },
  });
}

export async function deleteForecastNote(ctx: AccessContext, id: string) {
  await scopedDb(ctx).forecastNote.deleteMany({ where: { id, authorId: ctx.userId } });
}
