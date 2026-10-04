/**
 * Narrow, named system queries that must run without a user context (login, building the access
 * context itself). Each one returns only what its caller needs. Do not add general-purpose helpers.
 */
import "server-only";
import { BRAND_OWNED_MODELS, brandOwnedModelsWith, delegateName } from "@/server/access/brand-owned";
import { unsafeDb } from "./unsafe";

/** Login: includes the password hash – the only query that may. */
export function findUserForLogin(email: string) {
  return unsafeDb.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, name: true, active: true, passwordHash: true, isIntegration: true, failedLogins: true, lockedUntil: true, totpSecret: true, totpEnabledAt: true },
  });
}

/** SSO: match an existing active user by email (no auto-provisioning). */
export function findActiveUserIdByEmail(email: string) {
  return unsafeDb.user.findFirst({
    where: { email: email.trim().toLowerCase(), active: true, isIntegration: false },
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

export function countCasesInTerritory(brandId: string, regionId: string): Promise<number> {
  return unsafeDb.case.count({ where: { brandId, regionId } });
}

/**
 * Customer merge (admin / management): re-points every child of `fromId` to `intoId`, INCLUDING soft-deleted
 * rows and rows of every brand (the merge keeps all brand-owned children). Caller checks permission and audits.
 */
export async function repointCustomerChildren(kind: "account" | "contact", fromId: string, intoId: string): Promise<Record<string, number>> {
  const field = kind === "account" ? "accountId" : "contactId";
  const moved: Record<string, number> = {};
  await unsafeDb.$transaction(async (tx) => {
    for (const model of brandOwnedModelsWith(field)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over brand-owned delegates
      const res = await (tx as any)[delegateName(model)].updateMany({ where: { [field]: fromId }, data: { [field]: intoId } });
      moved[model] = res.count;
    }
    if (kind === "account") {
      moved.Contact = (await tx.contact.updateMany({ where: { accountId: fromId }, data: { accountId: intoId } })).count;
      const links = await tx.customerBrandLink.findMany({ where: { accountId: fromId } });
      for (const l of links) {
        await tx.customerBrandLink.upsert({
          where: { accountId_brandId: { accountId: intoId, brandId: l.brandId } },
          update: {},
          create: { accountId: intoId, brandId: l.brandId, firstSeenAt: l.firstSeenAt },
        });
      }
      await tx.customerBrandLink.deleteMany({ where: { accountId: fromId } });
    } else {
      moved.Lead = (await tx.lead.updateMany({ where: { convertedContactId: fromId }, data: { convertedContactId: intoId } })).count;
      const consents = await tx.contactBrandConsent.findMany({ where: { contactId: fromId } });
      for (const c of consents) {
        const existing = await tx.contactBrandConsent.findUnique({ where: { contactId_brandId: { contactId: intoId, brandId: c.brandId } } });
        // Keep the most recent decision per brand.
        if (!existing || existing.at < c.at) {
          await tx.contactBrandConsent.upsert({
            where: { contactId_brandId: { contactId: intoId, brandId: c.brandId } },
            update: { consent: c.consent, at: c.at },
            create: { contactId: intoId, brandId: c.brandId, consent: c.consent, at: c.at },
          });
        }
      }
      await tx.contactBrandConsent.deleteMany({ where: { contactId: fromId } });
      await tx.account.updateMany({ where: { primaryContactId: fromId }, data: { primaryContactId: intoId } });
    }
  });
  return moved;
}

/** Domain event outbox (user sessions have no access to it). Use emitEvent() from "@/server/events". */
export async function storeDomainEvent(name: string, brandId: string | null, payload: object): Promise<void> {
  await unsafeDb.domainEvent.create({ data: { name, brandId, payload: JSON.parse(JSON.stringify(payload)) } });
}

// ───────────────────────────── sign-in protection (prompt 15) ─────────────────────────────

/** A failed password / code attempt: counts up and locks the account after `max` consecutive failures. */
export async function recordLoginFailure(userId: string, max: number, lockMinutes: number): Promise<{ locked: boolean }> {
  const user = await unsafeDb.user.update({ where: { id: userId }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
  if (user.failedLogins < max) return { locked: false };
  await unsafeDb.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + lockMinutes * 60_000), failedLogins: 0 } });
  return { locked: true };
}

export async function recordLoginSuccess(userId: string): Promise<void> {
  await unsafeDb.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
}

export function totpState(userId: string) {
  return unsafeDb.user.findUnique({ where: { id: userId }, select: { email: true, totpSecret: true, totpEnabledAt: true } });
}

export async function storeTotp(userId: string, sealedSecret: string | null, enabled: boolean): Promise<void> {
  await unsafeDb.user.update({ where: { id: userId }, data: { totpSecret: sealedSecret, totpEnabledAt: enabled ? new Date() : null } });
}

/** Administrator: clears a lockout. */
export async function unlockUser(userId: string): Promise<void> {
  await unsafeDb.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null } });
}

/** Access review: every user with profile, role, territories and sign-in facts. */
export function accessReviewRows() {
  return unsafeDb.user.findMany({
    select: { id: true, name: true, email: true, active: true, isIntegration: true, lastLoginAt: true, lockedUntil: true, totpEnabledAt: true, createdAt: true, role: { select: { name: true } }, profile: { select: { name: true, scope: true } }, memberships: { select: { isManager: true, territory: { select: { name: true, brand: { select: { code: true } }, region: { select: { name: true } } } } } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

/** Liveness of the database for the health endpoint. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await unsafeDb.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
