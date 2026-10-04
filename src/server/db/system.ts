/**
 * Narrow, named system queries that must run without a user context (login, building the access
 * context itself). Each one returns only what its caller needs. Do not add general-purpose helpers.
 */
import "server-only";
import { BRAND_OWNED_MODELS, delegateName } from "@/server/access/brand-owned";
import { unsafeDb } from "./unsafe";

/** Login: includes the password hash – the only query that may. */
export function findUserForLogin(email: string) {
  return unsafeDb.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, name: true, active: true, passwordHash: true },
  });
}

/** SSO: match an existing active user by email (no auto-provisioning). */
export function findActiveUserIdByEmail(email: string) {
  return unsafeDb.user.findFirst({
    where: { email: email.trim().toLowerCase(), active: true },
    select: { id: true },
  });
}

/** Everything getAccessContext needs, in one round trip. */
export function loadAccessRows(userId: string) {
  return unsafeDb.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      role: { select: { name: true } },
      profile: {
        select: { id: true, name: true, scope: true, permissions: true, fieldPermissions: true },
      },
      memberships: {
        select: {
          isManager: true,
          territory: { select: { id: true, brandId: true, regionId: true } },
        },
      },
    },
  });
}

export type AccessRows = NonNullable<Awaited<ReturnType<typeof loadAccessRows>>>;

/** Brand ids visible to scope-ALL users (active + future). */
export async function loadAllBrandIds(): Promise<string[]> {
  const brands = await unsafeDb.brand.findMany({
    where: { status: { not: "INACTIVE" } },
    select: { id: true },
    orderBy: { code: "asc" },
  });
  return brands.map((b) => b.id);
}

/**
 * Brand-owned records (INCLUDING soft-deleted ones) per model for a territory or brand.
 * Used to block territory deletion and brand-code changes – soft-deleted rows count as "used".
 */
export async function countBrandOwnedRecords(
  where: { territoryId: string } | { brandId: string },
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const model of BRAND_OWNED_MODELS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over brand-owned delegates
    out[model] = await (unsafeDb as any)[delegateName(model)].count({ where });
  }
  return out;
}

/**
 * Admin "move records to…" for a territory being retired: re-points every brand-owned record
 * (including soft-deleted ones, which scopedDb cannot see) to the target brand/region/territory.
 * Caller must be an administrator and must audit the move.
 */
export async function moveTerritoryRecords(
  sourceTerritoryId: string,
  target: { territoryId: string; brandId: string; regionId: string },
  actingUserId: string,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const model of BRAND_OWNED_MODELS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over brand-owned delegates
    const res = await (unsafeDb as any)[delegateName(model)].updateMany({
      where: { territoryId: sourceTerritoryId },
      data: { ...target, updatedById: actingUserId },
    });
    out[model] = res.count;
  }
  return out;
}

export interface AuditQuery {
  userId?: string;
  entity?: string;
  brandId?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

/** Audit log viewer (admin only). The RLS role has no access to AuditLog by design. */
export async function queryAuditLog(q: AuditQuery) {
  const where = {
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.brandId ? { brandId: q.brandId } : {}),
    ...(q.from || q.to ? { at: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    unsafeDb.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { at: "desc" },
      skip: q.skip ?? 0,
      take: Math.min(q.take ?? 50, 50_000),
    }),
    unsafeDb.auditLog.count({ where }),
  ]);
  return { rows, total };
}

/** Distinct entity names in the audit log (filter dropdown). */
export async function auditEntities(): Promise<string[]> {
  const rows = await unsafeDb.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } });
  return rows.map((r) => r.entity);
}

/**
 * Duplicate check across ALL brands: how many non-deleted leads match mobile/email, excluding the ids
 * the user can already see. Returns a COUNT only – never details of another brand's lead.
 */
export async function countHiddenLeadMatches(
  match: { mobile: string | null; email: string | null },
  excludeIds: string[],
): Promise<number> {
  const or = [
    ...(match.mobile ? [{ mobile: match.mobile }] : []),
    ...(match.email ? [{ email: match.email }] : []),
  ];
  if (or.length === 0) return 0;
  return unsafeDb.lead.count({ where: { OR: or, deletedAt: null, id: { notIn: excludeIds } } });
}

/** Field history for a record's timeline. Caller MUST have verified the record is visible to the user. */
export function auditTrail(entity: string, entityId: string, take = 50) {
  return unsafeDb.auditLog.findMany({
    where: { entity, entityId },
    include: { user: { select: { name: true } } },
    orderBy: { at: "desc" },
    take,
  });
}

/** Fallback round-robin counter for a Brand–Region (when no assignment rule matched). */
export function countLeadsInTerritory(brandId: string, regionId: string): Promise<number> {
  return unsafeDb.lead.count({ where: { brandId, regionId } });
}
