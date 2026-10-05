/**
 * Database access for Setup (prompt 19). The Setup tables (OrgSetting, SetupApproval, BrandAdmin, SharingRule,
 * ValidationRule) are closed to user sessions, and several Setup functions work across brands on purpose (recycle
 * bin, mass operations, health), so this file uses the system client. NOTHING here checks access: every caller is a
 * Setup service that has already run assertSetup / assertSuperAdmin / assertSetupBrand.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { delegateName } from "@/server/access/brand-owned";
import { unsafeDb } from "./unsafe";

/* eslint-disable @typescript-eslint/no-explicit-any -- generic delegate access over models */

// ───────────────────────────── organisation settings ─────────────────────────────

const SETTING_TTL_MS = 10_000;
const settingCache = new Map<string, { at: number; value: unknown }>();

/** Raw stored value (undefined when never saved). Cached for a few seconds: policies are read on every sign-in. */
export async function readSetting(key: string): Promise<unknown> {
  const hit = settingCache.get(key);
  if (hit && Date.now() - hit.at < SETTING_TTL_MS) return hit.value;
  const row = await unsafeDb.orgSetting.findUnique({ where: { key } });
  settingCache.set(key, { at: Date.now(), value: row?.value });
  return row?.value;
}

export async function writeSetting(key: string, value: unknown, userId: string | null): Promise<void> {
  await unsafeDb.orgSetting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue, updatedById: userId },
    create: { key, value: value as Prisma.InputJsonValue, updatedById: userId },
  });
  settingCache.delete(key);
}

export const listSettingRows = () => unsafeDb.orgSetting.findMany({ orderBy: { key: "asc" } });

export function clearSetupCaches(): void {
  settingCache.clear();
  ruleCache.clear();
}

// ───────────────────────────── validation rules ─────────────────────────────

export interface StoredValidationRule {
  id: string;
  module: string;
  brandId: string | null;
  name: string;
  expression: string;
  message: string;
  active: boolean;
}

const ruleCache = new Map<string, { at: number; rules: StoredValidationRule[] }>();

/** Active rules of a module (cached for a few seconds – read on every save of the module's records). */
export async function activeValidationRules(module: string): Promise<StoredValidationRule[]> {
  const hit = ruleCache.get(module);
  if (hit && Date.now() - hit.at < SETTING_TTL_MS) return hit.rules;
  const rules = await unsafeDb.validationRule.findMany({ where: { module, active: true }, orderBy: { createdAt: "asc" } });
  ruleCache.set(module, { at: Date.now(), rules });
  return rules;
}

export const listValidationRules = () => unsafeDb.validationRule.findMany({ orderBy: [{ module: "asc" }, { createdAt: "asc" }], include: { brand: { select: { code: true } } } });
export const getValidationRule = (id: string) => unsafeDb.validationRule.findUnique({ where: { id } });

export async function saveValidationRule(id: string | null, data: { module: string; brandId: string | null; name: string; expression: string; message: string; active: boolean }) {
  ruleCache.clear();
  return id ? unsafeDb.validationRule.update({ where: { id }, data }) : unsafeDb.validationRule.create({ data });
}

export async function deleteValidationRule(id: string) {
  ruleCache.clear();
  return unsafeDb.validationRule.delete({ where: { id } });
}

/** Up to `take` live records of a model for the impact preview of a rule. */
export function sampleRecords(model: string, brandId: string | null, take: number): Promise<Array<Record<string, unknown>>> {
  return (unsafeDb as any)[delegateName(model)].findMany({ where: { deletedAt: null, ...(brandId ? { brandId } : {}) }, orderBy: { updatedAt: "desc" }, take });
}

// ───────────────────────────── sharing rules ─────────────────────────────

export const listSharingRules = () => unsafeDb.sharingRule.findMany({ orderBy: { createdAt: "asc" } });
export const createSharingRule = (data: Prisma.SharingRuleUncheckedCreateInput) => unsafeDb.sharingRule.create({ data });
export const deleteSharingRule = (id: string) => unsafeDb.sharingRule.delete({ where: { id } });
export const getSharingRule = (id: string) => unsafeDb.sharingRule.findUnique({ where: { id } });

export const getTerritory = (id: string) => unsafeDb.territory.findUnique({ where: { id }, select: { id: true, name: true, brandId: true, regionId: true } });

/** Brands a user reaches through territory memberships (scope-ALL profiles reach every brand: `all`). */
export async function userBrandReach(userIds: string[]): Promise<Map<string, { all: boolean; brandIds: Set<string>; name: string }>> {
  const users = await unsafeDb.user.findMany({
    where: { id: { in: userIds }, active: true },
    select: { id: true, name: true, profile: { select: { scope: true } }, memberships: { select: { territory: { select: { brandId: true } } } } },
  });
  return new Map(users.map((u) => [u.id, { all: u.profile.scope === "ALL", name: u.name, brandIds: new Set(u.memberships.map((m) => m.territory.brandId).filter((b): b is string => !!b)) }]));
}

export async function targetUserIds(targetType: string, targetId: string): Promise<string[]> {
  if (targetType === "USER") return (await unsafeDb.user.findMany({ where: { id: targetId, active: true }, select: { id: true } })).map((u) => u.id);
  if (targetType === "ROLE") return (await unsafeDb.user.findMany({ where: { roleId: targetId, active: true }, select: { id: true } })).map((u) => u.id);
  return (await unsafeDb.territoryMember.findMany({ where: { territoryId: targetId, user: { active: true } }, select: { userId: true } })).map((m) => m.userId);
}

export function countTerritoryRecords(model: string, territory: { brandId: string; regionId: string | null }): Promise<number> {
  return (unsafeDb as any)[delegateName(model)].count({ where: { deletedAt: null, brandId: territory.brandId, ...(territory.regionId ? { regionId: territory.regionId } : {}) } });
}

export const listRoles = () => unsafeDb.role.findMany({ select: { id: true, name: true, parentRoleId: true }, orderBy: { name: "asc" } });
export const listTerritories = (brandIds: string[] | null) =>
  unsafeDb.territory.findMany({
    where: { brandId: brandIds === null ? { not: null } : { in: brandIds } },
    select: { id: true, name: true, brandId: true, regionId: true, managerId: true },
    orderBy: { name: "asc" },
  });

// ───────────────────────────── tiers: super admins, brand admins, setup permissions ─────────────────────────────

export async function listAdministrators() {
  const users = await unsafeDb.user.findMany({
    where: { isIntegration: false },
    select: { id: true, name: true, email: true, active: true, isSuperAdmin: true, lastLoginAt: true, profile: { select: { name: true, permissions: true } } },
    orderBy: { name: "asc" },
  });
  return users.filter((u) => (u.profile.permissions as any)?.admin?.edit === true).map(({ profile, ...u }) => ({ ...u, profileName: profile.name }));
}

export const countActiveSuperAdmins = (exceptUserId?: string) =>
  unsafeDb.user.count({ where: { isSuperAdmin: true, active: true, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) } });

export const getUserBasics = (id: string) =>
  unsafeDb.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, active: true, isSuperAdmin: true, isIntegration: true, profile: { select: { id: true, name: true, permissions: true } } } });

export const findUserByEmail = (email: string) =>
  unsafeDb.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" }, active: true, isIntegration: false }, select: { id: true, name: true, email: true } });

export const setSuperAdminFlag = (userId: string, value: boolean) => unsafeDb.user.update({ where: { id: userId }, data: { isSuperAdmin: value }, select: { id: true } });
export const setUserActive = (userId: string, active: boolean) => unsafeDb.user.update({ where: { id: userId }, data: { active }, select: { id: true } });

export const listBrandAdmins = () =>
  unsafeDb.brandAdmin.findMany({ include: { user: { select: { name: true, email: true, active: true } }, brand: { select: { code: true, name: true } } }, orderBy: { createdAt: "asc" } });
export const grantBrandAdmin = (userId: string, brandId: string, grantedById: string) =>
  unsafeDb.brandAdmin.upsert({ where: { userId_brandId: { userId, brandId } }, update: {}, create: { userId, brandId, grantedById } });
export const revokeBrandAdmin = (userId: string, brandId: string) => unsafeDb.brandAdmin.deleteMany({ where: { userId, brandId } });

export const listProfilesForSetup = () => unsafeDb.profile.findMany({ select: { id: true, name: true, scope: true, permissions: true, fieldPermissions: true, setupSections: true, _count: { select: { users: true } } }, orderBy: { name: "asc" } });
export const setProfileSetupSections = (profileId: string, sections: string[]) => unsafeDb.profile.update({ where: { id: profileId }, data: { setupSections: sections }, select: { id: true, name: true } });

export const listBrandsBasic = (brandIds: string[] | null) =>
  unsafeDb.brand.findMany({
    where: { status: { not: "INACTIVE" }, ...(brandIds === null ? {} : { id: { in: brandIds } }) },
    select: { id: true, code: true, name: true, color: true, discountApprovalPct: true, discountEscalationPct: true },
    orderBy: { code: "asc" },
  });

export const updateBrandThresholds = (brandId: string, data: { discountApprovalPct: number; discountEscalationPct: number }) =>
  unsafeDb.brand.update({ where: { id: brandId }, data, select: { id: true, code: true, discountApprovalPct: true, discountEscalationPct: true } });

// ───────────────────────────── brand team (territory membership) ─────────────────────────────

export const brandTerritoriesWithMembers = (brandId: string) =>
  unsafeDb.territory.findMany({
    where: { brandId },
    select: {
      id: true,
      name: true,
      regionId: true,
      members: { select: { isManager: true, user: { select: { id: true, name: true, email: true, active: true, role: { select: { name: true } } } } }, orderBy: { user: { name: "asc" } } },
    },
    orderBy: [{ level: "asc" }, { name: "asc" }],
  });

export const upsertMember = (territoryId: string, userId: string, isManager: boolean) =>
  unsafeDb.territoryMember.upsert({ where: { userId_territoryId: { userId, territoryId } }, update: { isManager }, create: { userId, territoryId, isManager } });
export const deleteMember = (territoryId: string, userId: string) => unsafeDb.territoryMember.deleteMany({ where: { territoryId, userId } });

// ───────────────────────────── re-authentication & sessions ─────────────────────────────

export const credentialsOf = (userId: string) => unsafeDb.user.findUnique({ where: { id: userId }, select: { passwordHash: true, totpSecret: true, totpEnabledAt: true, passwordHistory: true, passwordChangedAt: true } });

export const revokeSessions = (userId: string, at: Date) => unsafeDb.user.update({ where: { id: userId }, data: { sessionsValidAfter: at }, select: { id: true, name: true } });

/** Records a password change: time, and the previous hash at the front of the history (kept to `keep` entries). */
export async function recordPasswordChange(userId: string, previousHash: string | null, keep: number): Promise<void> {
  const row = await unsafeDb.user.findUnique({ where: { id: userId }, select: { passwordHistory: true } });
  const history = Array.isArray(row?.passwordHistory) ? (row!.passwordHistory as string[]) : [];
  const next = keep > 0 && previousHash ? [previousHash, ...history].slice(0, keep) : [];
  await unsafeDb.user.update({ where: { id: userId }, data: { passwordChangedAt: new Date(), passwordHistory: next }, select: { id: true } });
}

// ───────────────────────────── four-eyes approvals ─────────────────────────────

export const createApproval = (data: Prisma.SetupApprovalUncheckedCreateInput) => unsafeDb.setupApproval.create({ data });
export const getApproval = (id: string) => unsafeDb.setupApproval.findUnique({ where: { id } });
export const listApprovals = (take = 100) => unsafeDb.setupApproval.findMany({ orderBy: { requestedAt: "desc" }, take });
export const pendingApprovalCount = () => unsafeDb.setupApproval.count({ where: { status: "PENDING", expiresAt: { gt: new Date() } } });

/** Claims a pending request for a decision; false when someone else decided first or it expired. */
export async function claimApproval(id: string, status: "APPROVED" | "REJECTED" | "CANCELLED", decidedById: string): Promise<boolean> {
  const res = await unsafeDb.setupApproval.updateMany({ where: { id, status: "PENDING", expiresAt: { gt: new Date() } }, data: { status, decidedById, decidedAt: new Date() } });
  return res.count === 1;
}
export const setApprovalResult = (id: string, result: unknown) => unsafeDb.setupApproval.update({ where: { id }, data: { result: result as Prisma.InputJsonValue } });
export const expireApprovals = () => unsafeDb.setupApproval.updateMany({ where: { status: "PENDING", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });

export async function userNames(ids: string[]): Promise<Map<string, string>> {
  const rows = await unsafeDb.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ───────────────────────────── recycle bin, mass operations ─────────────────────────────

/** Models that are soft-deleted (they carry `deletedAt`). */
export const RECYCLABLE_MODELS: string[] = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === "deletedAt")).map((m) => m.name);

const fieldsOf = (model: string) => new Set(Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields.filter((f) => f.kind === "scalar").map((f) => f.name) ?? []);

const TITLE_FIELDS = ["name", "number", "subject", "title", "lastName", "body", "fileName"];

function titleOf(row: Record<string, unknown>): string {
  if (typeof row.firstName === "string" && typeof row.lastName === "string") return `${row.firstName} ${row.lastName}`.trim();
  for (const f of TITLE_FIELDS) if (typeof row[f] === "string" && row[f]) return String(row[f]).slice(0, 80);
  return String(row.id);
}

/** Deleted because they were merged into another record: not restorable (the master holds their data). */
const mergedFilter = (model: string) => (fieldsOf(model).has("mergedIntoId") ? { mergedIntoId: null } : {});

export async function deletedCounts(): Promise<Array<{ model: string; count: number }>> {
  const out: Array<{ model: string; count: number }> = [];
  for (const model of RECYCLABLE_MODELS) {
    out.push({ model, count: await (unsafeDb as any)[delegateName(model)].count({ where: { deletedAt: { not: null }, ...mergedFilter(model) } }) });
  }
  return out;
}

export async function listDeleted(model: string, take = 200) {
  const has = fieldsOf(model);
  const rows: Array<Record<string, unknown>> = await (unsafeDb as any)[delegateName(model)].findMany({
    where: { deletedAt: { not: null }, ...mergedFilter(model) },
    orderBy: { deletedAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    id: String(r.id),
    title: titleOf(r),
    brandId: has.has("brandId") ? ((r.brandId as string | null) ?? null) : null,
    deletedAt: r.deletedAt as Date,
    updatedById: has.has("updatedById") ? ((r.updatedById as string | null) ?? null) : null,
  }));
}

export async function restoreDeleted(model: string, ids: string[]): Promise<number> {
  const res = await (unsafeDb as any)[delegateName(model)].updateMany({ where: { id: { in: ids }, deletedAt: { not: null }, ...mergedFilter(model) }, data: { deletedAt: null } });
  return res.count;
}

/** Hard-deletes soft-deleted records one by one: a record something still refers to is kept and counted as `kept`. */
export async function purgeDeleted(model: string, where: { ids?: string[]; olderThan?: Date }): Promise<{ purged: number; kept: number }> {
  const delegate = (unsafeDb as any)[delegateName(model)];
  const rows: Array<{ id: string }> = await delegate.findMany({
    where: { deletedAt: where.olderThan ? { lte: where.olderThan } : { not: null }, ...(where.ids ? { id: { in: where.ids } } : {}) },
    select: { id: true },
    take: 5000,
  });
  let purged = 0;
  let kept = 0;
  for (const r of rows) {
    try {
      await delegate.delete({ where: { id: r.id } });
      purged++;
    } catch {
      kept++;
    }
  }
  return { purged, kept };
}

export interface MassCriteria {
  model: string;
  brandId?: string | null;
  ownerId?: string | null;
  /** records created before this day */
  createdBefore?: string | null;
}

function massWhere(c: MassCriteria): Record<string, unknown> {
  return {
    deletedAt: null,
    ...(c.brandId ? { brandId: c.brandId } : {}),
    ...(c.ownerId ? { ownerId: c.ownerId } : {}),
    ...(c.createdBefore ? { createdAt: { lt: new Date(`${c.createdBefore}T00:00:00Z`) } } : {}),
  };
}

export const massCount = (c: MassCriteria): Promise<number> => (unsafeDb as any)[delegateName(c.model)].count({ where: massWhere(c) });

/** Mass delete = move to the recycle bin (restorable until purged). */
export async function massSoftDelete(c: MassCriteria, userId: string): Promise<number> {
  const has = fieldsOf(c.model);
  const res = await (unsafeDb as any)[delegateName(c.model)].updateMany({ where: massWhere(c), data: { deletedAt: new Date(), ...(has.has("updatedById") ? { updatedById: userId } : {}) } });
  return res.count;
}

// ───────────────────────────── sample data ─────────────────────────────

/** Business data. Configuration (brands, territories, users, profiles, pipelines, rules, templates, products, price books, warehouses) is NOT in this list. */
export const BUSINESS_TABLES = [
  "Lead", "Deal", "DealStageHistory", "Note", "Attachment", "Account", "Contact", "ContactBrandConsent", "CustomerBrandLink",
  "Quote", "SalesOrder", "Invoice", "DocumentLine", "Payment", "DocumentCounter", "ApprovalRequest", "ApprovalTask", "DomainEvent",
  "Activity", "TestDrive", "Notification", "Job", "Target", "ForecastNote", "Message", "Campaign", "CampaignMember", "Case",
  "ImportJob", "ImportRecord", "ExportJob", "IdempotencyKey", "WebhookDelivery", "ExternalRef", "PaymentLink",
  "VehicleUnit", "VehicleStatusHistory", "StockMovement", "StockBalance", "InventoryDocument", "InventoryDocumentLine", "JournalEntry", "JournalLine",
] as const;

export async function businessCounts(): Promise<Array<{ table: string; count: number }>> {
  const out: Array<{ table: string; count: number }> = [];
  for (const table of BUSINESS_TABLES) out.push({ table, count: await (unsafeDb as any)[delegateName(table)].count() });
  return out.filter((r) => r.count > 0);
}

/**
 * Empties every business table in one statement. No CASCADE on purpose: if a table outside the list referred to one
 * of them, PostgreSQL refuses the whole statement instead of silently emptying configuration.
 */
export async function truncateBusinessData(): Promise<void> {
  await unsafeDb.$executeRawUnsafe(`TRUNCATE ${BUSINESS_TABLES.map((t) => `"${t}"`).join(", ")}`);
}

// ───────────────────────────── health, login history, audit trail ─────────────────────────────

export async function healthSnapshot(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const [jobs, lastDone, deadJobs, webhookFailed, messagesFailed, messagesSuppressed, importsFailed] = await Promise.all([
    unsafeDb.job.groupBy({ by: ["status"], _count: { _all: true } }),
    unsafeDb.job.findFirst({ where: { status: "DONE" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    unsafeDb.job.findMany({ where: { status: { in: ["FAILED", "DEAD"] } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, type: true, status: true, attempts: true, lastError: true, createdAt: true } }),
    unsafeDb.webhookDelivery.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
    unsafeDb.message.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
    unsafeDb.message.count({ where: { status: "SUPPRESSED", createdAt: { gte: dayAgo } } }),
    unsafeDb.importJob.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
  ]);
  const overdue = await unsafeDb.job.count({ where: { status: "QUEUED", runAt: { lt: new Date(now.getTime() - 15 * 60_000) } } });
  return {
    jobs: Object.fromEntries(jobs.map((j) => [j.status, j._count._all])) as Record<string, number>,
    lastJobFinishedAt: lastDone?.finishedAt ?? null,
    overdueJobs: overdue,
    failedJobs: deadJobs,
    webhookFailed24h: webhookFailed,
    messagesFailed24h: messagesFailed,
    messagesSuppressed24h: messagesSuppressed,
    importsFailed24h: importsFailed,
  };
}

export const loginEvents = (take: number, skip: number, filter: { failedOnly?: boolean; userId?: string }) =>
  unsafeDb.auditLog.findMany({
    where: { action: filter.failedOnly ? "LOGIN_FAILED" : { in: ["LOGIN", "LOGIN_FAILED", "LOGOUT"] }, ...(filter.userId ? { userId: filter.userId } : {}) },
    orderBy: { at: "desc" },
    take,
    skip,
    select: { id: true, at: true, action: true, ip: true, after: true, user: { select: { name: true, email: true } } },
  });

/** Entities whose changes are configuration, not business data. */
export const SETUP_ENTITIES = [
  "OrgSetting", "SetupApproval", "BrandAdmin", "SuperAdmin", "SetupPermissions", "ValidationRule", "SharingRule", "Session", "RecycleBin", "MassOperation", "SampleData", "Configuration",
  "Profile", "Role", "Brand", "BrandCodeAlias", "Region", "Territory", "TerritoryMember", "User", "Pipeline", "PipelineStage", "WorkflowRule", "ApprovalProcess", "AssignmentRule", "CustomField", "Layout", "WebhookSubscription", "OAuthClient", "ApiToken",
];

export const setupAuditRows = (take: number, skip: number, entity?: string) =>
  unsafeDb.auditLog.findMany({
    where: { entity: entity && SETUP_ENTITIES.includes(entity) ? entity : { in: SETUP_ENTITIES }, action: { in: ["CREATE", "UPDATE", "DELETE", "IMPORT", "EXPORT"] } },
    orderBy: { at: "desc" },
    take,
    skip,
    select: { id: true, at: true, action: true, entity: true, entityId: true, before: true, after: true, ip: true, user: { select: { name: true } } },
  });

export const getAuditRow = (id: string) => unsafeDb.auditLog.findUnique({ where: { id }, select: { id: true, entity: true, entityId: true, before: true, after: true, action: true } });

// ───────────────────────────── configuration as code ─────────────────────────────

export async function readConfiguration() {
  const [settings, roles, profiles, validationRules, customFields, layouts, pipelines, brands] = await Promise.all([
    unsafeDb.orgSetting.findMany({ orderBy: { key: "asc" }, select: { key: true, value: true } }),
    unsafeDb.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, parentRoleId: true } }),
    unsafeDb.profile.findMany({ orderBy: { name: "asc" }, select: { name: true, scope: true, permissions: true, fieldPermissions: true, setupSections: true } }),
    unsafeDb.validationRule.findMany({ orderBy: [{ module: "asc" }, { name: "asc" }], select: { module: true, brandId: true, name: true, expression: true, message: true, active: true } }),
    unsafeDb.customField.findMany({ orderBy: [{ module: "asc" }, { apiName: "asc" }], select: { module: true, apiName: true, label: true, type: true, options: true, lookupTarget: true, formula: true, brandId: true, required: true, active: true, position: true } }),
    unsafeDb.layout.findMany({ orderBy: [{ module: "asc" }, { brandId: "asc" }], select: { module: true, brandId: true, definition: true } }),
    unsafeDb.pipeline.findMany({ orderBy: [{ brandId: "asc" }, { name: "asc" }], select: { brandId: true, name: true, isDefault: true, stages: { orderBy: { order: "asc" }, select: { key: true, name: true, order: true, probability: true, type: true, requiredFields: true, allowedTransitions: true, maxDaysInStage: true } } } }),
    unsafeDb.brand.findMany({ select: { id: true, code: true } }),
  ]);
  return { settings, roles, profiles, validationRules, customFields, layouts, pipelines, brands };
}

export type ConfigurationRows = Awaited<ReturnType<typeof readConfiguration>>;

export interface ConfigurationWrite {
  settings: Array<{ key: string; value: unknown }>;
  roles: Array<{ name: string; parent: string | null }>;
  profiles: Array<{ name: string; scope: "ALL" | "TERRITORY"; permissions: unknown; fieldPermissions: unknown; setupSections: string[] }>;
  validationRules: Array<{ module: string; brandId: string | null; name: string; expression: string; message: string; active: boolean }>;
  customFields: Array<{ module: string; apiName: string; label: string; type: string; options: string[]; lookupTarget: string | null; formula: string | null; brandId: string | null; required: boolean; active: boolean; position: number }>;
  layouts: Array<{ module: string; brandId: string | null; definition?: unknown }>;
  pipelines: Array<{ brandId: string; name: string; isDefault: boolean; stages: Array<{ key: string; name: string; order: number; probability: number; type: "OPEN" | "WON" | "LOST"; requiredFields?: unknown; allowedTransitions?: unknown; maxDaysInStage: number | null }> }>;
}

/**
 * Applies a validated configuration in one transaction. Roles, profiles, custom fields and pipelines are updated by
 * their natural key and created when missing – never deleted (records refer to them). Organisation settings,
 * validation rules and layouts are replaced as a set: what the document does not contain goes back to the default.
 */
export async function applyConfiguration(cfg: ConfigurationWrite, userId: string): Promise<Record<string, number>> {
  const J = (v: unknown) => v as Prisma.InputJsonValue;
  return unsafeDb.$transaction(async (tx) => {
    await tx.orgSetting.deleteMany({ where: { key: { notIn: cfg.settings.map((s) => s.key) } } });
    for (const s of cfg.settings) {
      await tx.orgSetting.upsert({ where: { key: s.key }, update: { value: J(s.value), updatedById: userId }, create: { key: s.key, value: J(s.value), updatedById: userId } });
    }
    const roleIds = new Map<string, string>();
    for (const r of cfg.roles) {
      const existing = await tx.role.findUnique({ where: { name: r.name }, select: { id: true } });
      roleIds.set(r.name, (existing ?? (await tx.role.create({ data: { name: r.name }, select: { id: true } }))).id);
    }
    for (const r of cfg.roles) await tx.role.update({ where: { name: r.name }, data: { parentRoleId: r.parent ? (roleIds.get(r.parent) ?? null) : null } });
    for (const p of cfg.profiles) {
      const data = { scope: p.scope, permissions: J(p.permissions), fieldPermissions: J(p.fieldPermissions), setupSections: J(p.setupSections) };
      await tx.profile.upsert({ where: { name: p.name }, update: data, create: { name: p.name, ...data } });
    }
    await tx.validationRule.deleteMany({});
    if (cfg.validationRules.length) await tx.validationRule.createMany({ data: cfg.validationRules });
    for (const f of cfg.customFields) {
      await tx.customField.upsert({ where: { module_apiName: { module: f.module, apiName: f.apiName } }, update: { ...f }, create: { ...f } });
    }
    await tx.layout.deleteMany({});
    for (const l of cfg.layouts) await tx.layout.create({ data: { module: l.module, brandId: l.brandId, definition: J(l.definition ?? {}), updatedById: userId } });
    for (const p of cfg.pipelines) {
      const pipeline = await tx.pipeline.upsert({ where: { brandId_name: { brandId: p.brandId, name: p.name } }, update: { isDefault: p.isDefault }, create: { brandId: p.brandId, name: p.name, isDefault: p.isDefault }, select: { id: true } });
      for (const st of p.stages) {
        const data = { name: st.name, order: st.order, probability: st.probability, type: st.type, requiredFields: J(st.requiredFields ?? []), allowedTransitions: st.allowedTransitions === null || st.allowedTransitions === undefined ? Prisma.JsonNull : J(st.allowedTransitions), maxDaysInStage: st.maxDaysInStage };
        await tx.pipelineStage.upsert({ where: { pipelineId_key: { pipelineId: pipeline.id, key: st.key } }, update: data, create: { pipelineId: pipeline.id, key: st.key, ...data } });
      }
    }
    return { settings: cfg.settings.length, roles: cfg.roles.length, profiles: cfg.profiles.length, validationRules: cfg.validationRules.length, customFields: cfg.customFields.length, layouts: cfg.layouts.length, pipelines: cfg.pipelines.length };
  });
}
