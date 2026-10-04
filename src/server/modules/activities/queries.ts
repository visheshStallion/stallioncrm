import "server-only";
import type { Prisma } from "@prisma/client";
import { assertCan } from "@/server/access/can";
import { NotFoundError } from "@/server/access/errors";
import { filterWhere, type UiFilters } from "@/server/access/filters";
import type { AccessContext } from "@/server/access/types";
import { isManagerOf } from "@/server/access/visibility";
import { scopedDb } from "@/server/db";

const select = {
  id: true,
  type: true,
  parentType: true,
  parentId: true,
  subject: true,
  description: true,
  dueAt: true,
  startAt: true,
  endAt: true,
  status: true,
  priority: true,
  participants: true,
  outcome: true,
  reminderAt: true,
  recurrence: true,
  completedAt: true,
  direction: true,
  durationSec: true,
  phone: true,
  disposition: true,
  brandId: true,
  regionId: true,
  ownerId: true,
  owner: { select: { name: true } },
  createdAt: true,
  testDrive: { include: { product: { select: { name: true } } } },
} as const satisfies Prisma.ActivitySelect;
type ActivityRecord = Prisma.ActivityGetPayload<{ select: typeof select }>;

export interface ActivityRow {
  id: string;
  type: string;
  parentType: string;
  parentId: string;
  parentHref: string | null;
  subject: string;
  description: string | null;
  /** the moment the activity is scheduled for: startAt (meetings / test drives) or dueAt */
  at: string | null;
  dueAt: string | null;
  startAt: string | null;
  endAt: string | null;
  status: string;
  overdue: boolean;
  priority: string;
  outcome: string | null;
  recurrence: string | null;
  completedAt: string | null;
  direction: string | null;
  durationSec: number | null;
  phone: string | null;
  disposition: string | null;
  brandId: string;
  regionId: string;
  ownerId: string;
  ownerName: string;
  testDrive: null | {
    productName: string | null;
    vehicleVin: string | null;
    vehiclePlate: string | null;
    location: string;
    licenceChecked: boolean;
    /** sensitive – masked unless the viewer is the owner, a manager of the record or management */
    licenceNumber: string | null;
    indemnitySigned: boolean;
    odometerStart: number | null;
    odometerEnd: number | null;
    feedbackRating: number | null;
    followUpAt: string | null;
  };
}

const PARENT_PATHS: Record<string, string> = { Lead: "/leads", Deal: "/deals", Account: "/accounts", Case: "/cases" };
const iso = (d: Date | null) => d?.toISOString() ?? null;

function toRow(ctx: AccessContext, a: ActivityRecord, now = new Date()): ActivityRow {
  const at = a.startAt ?? a.dueAt;
  const seeSensitive = a.ownerId === ctx.userId || isManagerOf(ctx, a.brandId, a.regionId);
  const td = a.testDrive;
  return {
    id: a.id,
    type: a.type,
    parentType: a.parentType,
    parentId: a.parentId,
    parentHref: PARENT_PATHS[a.parentType] ? `${PARENT_PATHS[a.parentType]}/${a.parentId}` : null,
    subject: a.subject,
    description: a.description,
    at: iso(at),
    dueAt: iso(a.dueAt),
    startAt: iso(a.startAt),
    endAt: iso(a.endAt),
    status: a.status,
    overdue: a.status === "OPEN" && !!at && (a.endAt ?? at) < now,
    priority: a.priority,
    outcome: a.outcome,
    recurrence: a.recurrence,
    completedAt: iso(a.completedAt),
    direction: a.direction,
    durationSec: a.durationSec,
    phone: a.phone,
    disposition: a.disposition,
    brandId: a.brandId,
    regionId: a.regionId,
    ownerId: a.ownerId,
    ownerName: a.owner.name,
    testDrive: td
      ? {
          productName: td.product?.name ?? null,
          vehicleVin: td.vehicleVin,
          vehiclePlate: td.vehiclePlate,
          location: td.location,
          licenceChecked: td.licenceChecked,
          licenceNumber: td.licenceNumber ? (seeSensitive ? td.licenceNumber : `****${td.licenceNumber.slice(-2)}`) : null,
          indemnitySigned: td.indemnitySigned,
          odometerStart: td.odometerStart,
          odometerEnd: td.odometerEnd,
          feedbackRating: td.feedbackRating,
          followUpAt: iso(td.followUpAt),
        }
      : null,
  };
}

export interface ActivityFilter {
  /** my | overdue | today | open | all */
  view?: string;
  type?: string;
  ownerIds?: string[];
  parentType?: string;
  parentId?: string;
  from?: Date;
  to?: Date;
  q?: string;
}

const dayRange = (d = new Date()) => {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86_400_000) };
};

export function activityWhere(ctx: AccessContext, f: ActivityFilter, now = new Date()): Prisma.ActivityWhereInput {
  const and: Prisma.ActivityWhereInput[] = [];
  const inRange = (gte?: Date, lt?: Date): Prisma.ActivityWhereInput => ({ OR: [{ startAt: { gte, lt } }, { startAt: null, dueAt: { gte, lt } }] });
  if (f.view === "my" || !f.view) and.push({ ownerId: ctx.userId, status: "OPEN" });
  if (f.view === "open") and.push({ status: "OPEN" });
  if (f.view === "overdue") and.push({ ownerId: ctx.userId, status: "OPEN" }, { OR: [{ endAt: { lt: now } }, { endAt: null, startAt: { lt: now } }, { startAt: null, dueAt: { lt: now } }] });
  if (f.view === "today") {
    const { start, end } = dayRange(now);
    and.push({ ownerId: ctx.userId }, inRange(start, end));
  }
  if (f.type) and.push({ type: f.type as never });
  if (f.ownerIds?.length) and.push({ ownerId: { in: f.ownerIds } });
  if (f.parentType && f.parentId) and.push({ parentType: f.parentType, parentId: f.parentId });
  if (f.from || f.to) and.push(inRange(f.from, f.to));
  if (f.q?.trim()) and.push({ subject: { contains: f.q.trim(), mode: "insensitive" } });
  return { AND: and };
}

export async function listActivities(
  ctx: AccessContext,
  f: ActivityFilter = {},
  ui: UiFilters = {},
  opts: { take?: number; skip?: number; order?: "asc" | "desc" } = {},
): Promise<{ rows: ActivityRow[]; total: number }> {
  assertCan(ctx, "activities", "read");
  const db = scopedDb(ctx);
  const where: Prisma.ActivityWhereInput = { AND: [filterWhere(ctx, ui), activityWhere(ctx, f)] };
  const [rows, total] = await Promise.all([
    db.activity.findMany({ where, select, orderBy: [{ startAt: opts.order ?? "asc" }, { dueAt: opts.order ?? "asc" }, { createdAt: "desc" }], take: Math.min(opts.take ?? 50, 1000), skip: opts.skip ?? 0 }),
    db.activity.count({ where }),
  ]);
  const now = new Date();
  return { rows: rows.map((r) => toRow(ctx, r, now)), total };
}

/** 404 for missing AND out-of-scope activities. */
export async function getActivity(ctx: AccessContext, id: string): Promise<ActivityRow> {
  assertCan(ctx, "activities", "read");
  const a = await scopedDb(ctx).activity.findUnique({ where: { id }, select });
  if (!a) throw new NotFoundError();
  return toRow(ctx, a);
}

/** Activity panel of a record: upcoming, overdue and history. */
export async function recordActivities(ctx: AccessContext, parentType: string, parentId: string) {
  const { rows } = await listActivities(ctx, { view: "all", parentType, parentId }, {}, { take: 200, order: "desc" });
  return {
    overdue: rows.filter((r) => r.overdue),
    upcoming: rows.filter((r) => r.status === "OPEN" && !r.overdue).reverse(),
    history: rows.filter((r) => r.status !== "OPEN"),
  };
}

/** Number of the user's overdue open activities (badge in the module rail). */
export async function overdueCount(ctx: AccessContext): Promise<number> {
  return scopedDb(ctx).activity.count({ where: activityWhere(ctx, { view: "overdue" }) });
}

/**
 * Users whose calendars the viewer may overlay: management → everyone; managers → the members of the
 * territories they manage (their brand / region). Everyone else: only themselves.
 */
export async function teamMembers(ctx: AccessContext): Promise<Array<{ id: string; name: string }>> {
  const db = scopedDb(ctx);
  if (ctx.scope === "ALL") return db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const managed = ctx.memberships.filter((m) => m.isManager);
  if (managed.length === 0) return [];
  return db.user.findMany({
    where: {
      active: true,
      id: { not: ctx.userId },
      memberships: { some: { territory: { OR: managed.map((m) => ({ brandId: m.brandId, ...(m.regionId ? { regionId: m.regionId } : {}) })) } } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Users who can see a record of this brand-region (candidates for @mentions and participants). */
export async function usersWhoCanSee(ctx: AccessContext, brandId: string, regionId: string): Promise<Array<{ id: string; name: string }>> {
  return scopedDb(ctx).user.findMany({
    where: {
      active: true,
      OR: [{ profile: { scope: "ALL" } }, { memberships: { some: { territory: { brandId, OR: [{ regionId: null }, { regionId }] } } } }],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function searchActivities(ctx: AccessContext, q: string, take = 10) {
  const rows = await scopedDb(ctx).activity.findMany({
    where: { subject: { contains: q, mode: "insensitive" } },
    select: { id: true, subject: true, type: true, status: true, brandId: true, regionId: true, parentType: true, parentId: true },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows;
}
