/**
 * Setup services (prompt 19). Every function starts with the tier check of its catalogue entry (assertSetup) – the
 * `setupPermission` of the function – then validates, writes through the Setup store and audits with before / after.
 */
import "server-only";
import { verify } from "@node-rs/argon2";
import { Prisma } from "@prisma/client";
import { BRAND_OWNED_MODELS, delegateName } from "@/server/access/brand-owned";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import { MODULES } from "@/server/access/modules";
import { parseFieldPermissions, parsePermissions } from "@/server/access/permissions";
import { ACTIONS, type AccessContext } from "@/server/access/types";
import { openSecret, verifyTotp } from "@/server/auth/protection";
import { audit, scopedDb } from "@/server/db";
import * as store from "@/server/db/setup-store";
import { BadRequestError } from "@/server/errors";
import { isRateLimited, rateLimit } from "@/server/rate-limit";
import { z } from "zod";
import { assertSetup, assertSetupBrand, assertSuperAdmin, setupBrandIds } from "./access";
import { SETUP_CATALOGUE } from "./catalogue";
import { ExpressionError, matches, parseExpression } from "./expression";
import { SETTINGS, isSettingKey, passwordProblem, resolveSetting, type PasswordPolicy, type SettingKey, type SettingValue } from "./settings";

/* eslint-disable @typescript-eslint/no-explicit-any -- generic delegate access over brand-owned models */

const log = (ctx: AccessContext, action: "CREATE" | "UPDATE" | "DELETE" | "EXPORT" | "IMPORT", entity: string, entityId: string | null, before?: unknown, after?: unknown, brandId?: string | null) =>
  audit({ ctx, action, entity, entityId, before, after, brandId: brandId ?? null });

// ───────────────────────────── settings ─────────────────────────────

/** A setting with defaults applied. No access check: policies are read by sign-in and by other services. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  return resolveSetting(key, await store.readSetting(key));
}

/** For the settings page of the function. */
export async function readSettingFor<K extends SettingKey>(ctx: AccessContext, key: K): Promise<SettingValue<K>> {
  assertSetup(ctx, SETTINGS[key].entry);
  return getSetting(key);
}

/** Writes a setting directly (not for four-eyes settings – those go through requestDestructive). */
export async function saveSetting<K extends SettingKey>(ctx: AccessContext, key: K, value: SettingValue<K>): Promise<void> {
  assertSetup(ctx, SETTINGS[key].entry);
  if (SETTINGS[key].fourEyes) throw new ForbiddenError("This setting changes how people sign in: it needs a second Super Admin's approval");
  await applySetting(ctx, key, value);
}

/** Validates and stores; used directly and by the approved four-eyes operation. */
export async function applySetting(ctx: Pick<AccessContext, "userId" | "ip">, key: SettingKey, value: unknown): Promise<void> {
  const parsed = (SETTINGS[key].schema as z.ZodTypeAny).parse(value);
  const before = await store.readSetting(key);
  await store.writeSetting(key, parsed, ctx.userId);
  await audit({ ctx, action: before === undefined ? "CREATE" : "UPDATE", entity: "OrgSetting", entityId: key, before: before ?? undefined, after: parsed });
}

/** One-click revert of a setting change from the Setup audit trail (not for four-eyes settings). */
export async function revertSetting(ctx: AccessContext, auditId: string): Promise<string> {
  assertSetup(ctx, "setup-audit-trail");
  const row = await store.getAuditRow(auditId);
  if (!row || row.entity !== "OrgSetting" || !row.entityId || !isSettingKey(row.entityId)) throw new NotFoundError();
  const key = row.entityId;
  assertSetup(ctx, SETTINGS[key].entry);
  if (SETTINGS[key].fourEyes) throw new ForbiddenError("Security policies cannot be reverted with one click: save the earlier values again (it needs a second Super Admin's approval)");
  if (row.before === null || row.before === undefined) throw new BadRequestError("There is no earlier value to go back to");
  await applySetting(ctx, key, row.before);
  return SETTINGS[key].title;
}

// ───────────────────────────── re-authentication ─────────────────────────────

/**
 * Re-authentication before a destructive operation: the password of the signed-in user (or, for an account without
 * a password, the authenticator code). Throttled per user.
 */
export async function reauthenticate(ctx: AccessContext, input: { password?: string | null; code?: string | null }): Promise<void> {
  // only FAILED attempts count towards the limit
  const key = `reauth:${ctx.userId}`;
  const WINDOW = 10 * 60_000;
  if (isRateLimited(key, 5, WINDOW)) throw new ForbiddenError("Too many wrong attempts – wait a few minutes");
  const cred = await store.credentialsOf(ctx.userId);
  if (!cred) throw new ForbiddenError("Re-authentication failed");
  if (cred.passwordHash) {
    if (!input.password || !(await verify(cred.passwordHash, input.password).catch(() => false))) {
      rateLimit(key, 5, WINDOW);
      await audit({ ctx, action: "LOGIN_FAILED", entity: "User", entityId: ctx.userId, after: { reason: "re-authentication: wrong password" } });
      throw new ForbiddenError("Wrong password – the operation was not started");
    }
    return;
  }
  const secret = cred.totpEnabledAt && cred.totpSecret ? openSecret(cred.totpSecret) : null;
  if (!secret) throw new ForbiddenError("This account has neither a password nor two-step sign-in: it cannot confirm destructive operations");
  if (!input.code || !verifyTotp(secret, input.code)) {
    rateLimit(key, 5, WINDOW);
    throw new ForbiddenError("Wrong authenticator code – the operation was not started");
  }
}

// ───────────────────────────── passwords (policy) ─────────────────────────────

/** Throws when the password breaks the policy or repeats one of the user's recent passwords. */
export async function assertPasswordAllowed(password: string, userId?: string): Promise<PasswordPolicy> {
  const policy = await getSetting("passwordPolicy");
  const problem = passwordProblem(policy, password);
  if (problem) throw new BadRequestError(`Password: ${problem}`);
  if (userId && policy.history > 0) {
    const cred = await store.credentialsOf(userId);
    const earlier = [cred?.passwordHash, ...(Array.isArray(cred?.passwordHistory) ? (cred!.passwordHistory as string[]) : [])].filter((h): h is string => !!h).slice(0, policy.history + 1);
    for (const h of earlier) {
      if (await verify(h, password).catch(() => false)) throw new BadRequestError(`Password: it was used before – the last ${policy.history} password(s) cannot be reused`);
    }
  }
  return policy;
}

// ───────────────────────────── profiles: compare ─────────────────────────────

export interface ProfileDifference {
  area: "Scope" | "Module permission" | "Field access" | "Setup permission";
  item: string;
  a: string;
  b: string;
}

export async function compareProfiles(ctx: AccessContext, aId: string, bId: string): Promise<{ a: string; b: string; differences: ProfileDifference[]; same: number }> {
  assertSetup(ctx, "profiles-compare");
  const profiles = await store.listProfilesForSetup();
  const a = profiles.find((p) => p.id === aId);
  const b = profiles.find((p) => p.id === bId);
  if (!a || !b) throw new NotFoundError();
  const differences: ProfileDifference[] = [];
  let same = 0;
  const add = (area: ProfileDifference["area"], item: string, x: string, y: string) => (x === y ? same++ : differences.push({ area, item, a: x, b: y }));
  add("Scope", "Data scope", a.scope, b.scope);
  const pa = parsePermissions(a.permissions), pb = parsePermissions(b.permissions);
  for (const m of MODULES) for (const action of ACTIONS) add("Module permission", `${m.label} – ${action}`, pa[m.key]?.[action] ? "Yes" : "No", pb[m.key]?.[action] ? "Yes" : "No");
  const fa = parseFieldPermissions(a.fieldPermissions), fb = parseFieldPermissions(b.fieldPermissions);
  for (const m of MODULES) {
    const fields = new Set([...Object.keys(fa[m.key] ?? {}), ...Object.keys(fb[m.key] ?? {})]);
    for (const f of [...fields].sort()) add("Field access", `${m.label} – ${f}`, fa[m.key]?.[f] ?? "edit", fb[m.key]?.[f] ?? "edit");
  }
  const sa = new Set(Array.isArray(a.setupSections) ? (a.setupSections as string[]) : []), sb = new Set(Array.isArray(b.setupSections) ? (b.setupSections as string[]) : []);
  for (const e of SETUP_CATALOGUE.filter((x) => x.delegable)) add("Setup permission", e.label, sa.has(e.key) ? "Yes" : "No", sb.has(e.key) ? "Yes" : "No");
  return { a: a.name, b: b.name, differences, same };
}

export async function profilesForSetup(ctx: AccessContext, entry: string) {
  assertSetup(ctx, entry);
  return (await store.listProfilesForSetup()).map((p) => ({ id: p.id, name: p.name, users: p._count.users, isAdmin: parsePermissions(p.permissions).admin?.edit === true, setupSections: Array.isArray(p.setupSections) ? (p.setupSections as string[]) : [] }));
}

// ───────────────────────────── validation rules ─────────────────────────────

/** Modules whose records validation rules can check: brand-owned records with a module of their own. */
export const RULE_MODULES = MODULES.filter((m) => m.model && BRAND_OWNED_MODELS.has(m.model) && ["leads", "deals", "accounts", "contacts", "cases", "quotes", "salesOrders", "invoices"].includes(m.key)).map((m) => ({ key: m.key as string, label: m.label as string, model: m.model as string }));

const ruleModule = (key: string) => {
  const m = RULE_MODULES.find((x) => x.key === key);
  if (!m) throw new BadRequestError("Validation rules are not available for this module");
  return m;
};

const HIDDEN_RULE_FIELDS = new Set(["id", "deletedAt", "createdById", "updatedById", "territoryId", "customFields", "mergedIntoId"]);

/** Field names a formula of the module may read (the scalar columns of its records). */
export function ruleFields(moduleKey: string): string[] {
  const model = ruleModule(moduleKey).model;
  return (Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields ?? [])
    .filter((f) => f.kind !== "object" && !HIDDEN_RULE_FIELDS.has(f.name))
    .map((f) => f.name)
    .sort();
}

const ruleSchema = z.object({
  module: z.string().min(1),
  brandId: z.string().min(1).nullable(),
  name: z.string().trim().min(2).max(80),
  expression: z.string().trim().min(1).max(500),
  message: z.string().trim().min(3).max(200),
  active: z.boolean(),
});
export type RuleInput = z.input<typeof ruleSchema>;

function checkedRule(input: RuleInput) {
  const data = ruleSchema.parse(input);
  try {
    parseExpression(data.expression, ruleFields(data.module));
  } catch (e) {
    if (e instanceof ExpressionError) throw new BadRequestError(`Formula: ${e.message}`);
    throw e;
  }
  return data;
}

export async function listValidationRules(ctx: AccessContext) {
  assertSetup(ctx, "validation-rules");
  return store.listValidationRules();
}

/** How many of the most recently changed records the rule would refuse if they were saved again. */
export async function previewValidationRule(ctx: AccessContext, input: RuleInput): Promise<{ checked: number; failing: number; examples: string[] }> {
  assertSetup(ctx, "validation-rules");
  const data = checkedRule(input);
  const rows = await store.sampleRecords(ruleModule(data.module).model, data.brandId, 500);
  const failing = rows.filter((r) => matches(data.expression, r));
  return { checked: rows.length, failing: failing.length, examples: failing.slice(0, 5).map((r) => String(r.name ?? r.number ?? r.subject ?? r.lastName ?? r.id)) };
}

export async function saveValidationRule(ctx: AccessContext, id: string | null, input: RuleInput) {
  assertSetup(ctx, "validation-rules");
  const data = checkedRule(input);
  const before = id ? await store.getValidationRule(id) : null;
  if (id && !before) throw new NotFoundError();
  const rule = await store.saveValidationRule(id, data);
  await log(ctx, id ? "UPDATE" : "CREATE", "ValidationRule", rule.id, before ?? undefined, rule, rule.brandId);
  return rule;
}

export async function deleteValidationRule(ctx: AccessContext, id: string) {
  assertSetup(ctx, "validation-rules");
  const before = await store.getValidationRule(id);
  if (!before) throw new NotFoundError();
  await store.deleteValidationRule(id);
  await log(ctx, "DELETE", "ValidationRule", id, before, undefined, before.brandId);
}

const MODEL_TO_RULE_MODULE = new Map(RULE_MODULES.map((m) => [m.model, m.key]));

/**
 * Called by scopedDb before a single create / update of a rule-enabled model: throws BadRequestError with the
 * rule's message when an active rule matches the record as it would be saved. A rule whose formula no longer
 * parses (a field was removed) is skipped, never blocks.
 */
export async function enforceValidationRules(model: string, record: Record<string, unknown>): Promise<void> {
  const moduleKey = MODEL_TO_RULE_MODULE.get(model);
  if (!moduleKey) return;
  const rules = await store.activeValidationRules(moduleKey);
  for (const rule of rules) {
    if (rule.brandId && rule.brandId !== record.brandId) continue;
    let violated = false;
    try {
      violated = matches(rule.expression, record);
    } catch {
      continue;
    }
    if (violated) throw new BadRequestError(rule.message);
  }
}

export const hasValidationRules = (model: string) => MODEL_TO_RULE_MODULE.has(model);

// ───────────────────────────── data sharing ─────────────────────────────

const sharingSchema = z.object({
  name: z.string().trim().min(2).max(80),
  module: z.string().min(1),
  sourceTerritoryId: z.string().min(1),
  targetType: z.enum(["ROLE", "TERRITORY", "USER"]),
  targetId: z.string().min(1),
  access: z.enum(["READ", "READ_WRITE"]),
});
export type SharingInput = z.input<typeof sharingSchema>;

export interface SharingImpact {
  /** null = the rule is acceptable */
  blocked: string | null;
  records: number;
  users: number;
  /** users who would see records of a brand they have no territory in */
  crossBrandUsers: string[];
  summary: string;
}

/**
 * Impact preview (prompt 19 §3.4) and the brand-isolation check: a rule may only share a territory's records with
 * people who already work in that brand. Anything else would expose one brand's data to another brand's staff and
 * is refused – there is no override in the application.
 */
export async function previewSharingRule(ctx: AccessContext, input: SharingInput): Promise<SharingImpact> {
  assertSetup(ctx, "data-sharing");
  const data = sharingSchema.parse(input);
  const mod = ruleModule(data.module);
  const territory = await store.getTerritory(data.sourceTerritoryId);
  if (!territory?.brandId) throw new BadRequestError("Choose a territory of a brand as the source");
  if (data.targetType === "TERRITORY") {
    const target = await store.getTerritory(data.targetId);
    if (!target?.brandId) throw new BadRequestError("Choose a territory of a brand as the target");
  }
  const userIds = await store.targetUserIds(data.targetType, data.targetId);
  const reach = await store.userBrandReach(userIds);
  const crossBrandUsers = [...reach.values()].filter((u) => !u.all && !u.brandIds.has(territory.brandId!)).map((u) => u.name).sort();
  const records = await store.countTerritoryRecords(mod.model, { brandId: territory.brandId, regionId: territory.regionId });
  const summary = `This rule would expose ${records} ${mod.label.toLowerCase()} of ${territory.name} to ${userIds.length} user(s), ${data.access === "READ" ? "read-only" : "read and write"}.`;
  const blocked = crossBrandUsers.length
    ? `Refused: ${crossBrandUsers.length} of these users (${crossBrandUsers.slice(0, 5).join(", ")}${crossBrandUsers.length > 5 ? ", …" : ""}) do not work in the brand of ${territory.name}. A sharing rule must never carry one brand's records to another brand's staff. Give them a territory in that brand instead.`
    : null;
  return { blocked, records, users: userIds.length, crossBrandUsers, summary };
}

export async function createSharingRule(ctx: AccessContext, input: SharingInput) {
  assertSetup(ctx, "data-sharing");
  const data = sharingSchema.parse(input);
  const impact = await previewSharingRule(ctx, data);
  if (impact.blocked) throw new ForbiddenError(impact.blocked);
  const rule = await store.createSharingRule({ ...data, createdById: ctx.userId });
  const territory = await store.getTerritory(data.sourceTerritoryId);
  await log(ctx, "CREATE", "SharingRule", rule.id, undefined, { ...rule, impact: { records: impact.records, users: impact.users } }, territory?.brandId);
  return rule;
}

export async function deleteSharingRule(ctx: AccessContext, id: string) {
  assertSetup(ctx, "data-sharing");
  const before = await store.getSharingRule(id);
  if (!before) throw new NotFoundError();
  await store.deleteSharingRule(id);
  await log(ctx, "DELETE", "SharingRule", id, before);
}

export async function sharingPageData(ctx: AccessContext) {
  assertSetup(ctx, "data-sharing");
  const [rules, territories, roles] = await Promise.all([store.listSharingRules(), store.listTerritories(null), store.listRoles()]);
  return { rules, territories, roles, modules: RULE_MODULES };
}

// ───────────────────────────── tiers ─────────────────────────────

export const MAX_SUPER_ADMINS = 3;

export async function tiersPageData(ctx: AccessContext) {
  assertSetup(ctx, "admin-tiers");
  const [admins, brandAdmins, profiles, brands] = await Promise.all([store.listAdministrators(), store.listBrandAdmins(), store.listProfilesForSetup(), store.listBrandsBasic(null)]);
  return {
    admins,
    brandAdmins,
    brands,
    profiles: profiles.map((p) => ({ id: p.id, name: p.name, isAdmin: parsePermissions(p.permissions).admin?.edit === true, setupSections: Array.isArray(p.setupSections) ? (p.setupSections as string[]) : [] })),
    delegable: SETUP_CATALOGUE.filter((e) => e.delegable).map((e) => ({ key: e.key, label: e.label })),
  };
}

/** Appoints a Super Admin (re-authentication required). Only an active user with the Administrator profile; at most three. */
export async function grantSuperAdmin(ctx: AccessContext, userId: string, auth: { password?: string | null; code?: string | null }) {
  assertSuperAdmin(ctx);
  await reauthenticate(ctx, auth);
  const user = await store.getUserBasics(userId);
  if (!user || !user.active || user.isIntegration) throw new NotFoundError();
  if (parsePermissions(user.profile.permissions).admin?.edit !== true) throw new BadRequestError("Only a user with the Administrator profile can be a Super Admin");
  if (user.isSuperAdmin) return;
  if ((await store.countActiveSuperAdmins()) >= MAX_SUPER_ADMINS) throw new BadRequestError(`There are already ${MAX_SUPER_ADMINS} Super Admins – revoke one first`);
  await store.setSuperAdminFlag(userId, true);
  await log(ctx, "UPDATE", "SuperAdmin", userId, { isSuperAdmin: false }, { isSuperAdmin: true, user: user.email });
}

export async function grantBrandAdmin(ctx: AccessContext, email: string, brandId: string) {
  assertSuperAdmin(ctx);
  const user = await store.findUserByEmail(email);
  if (!user) throw new BadRequestError("No active user has this e-mail address");
  const brand = (await store.listBrandsBasic([brandId]))[0];
  if (!brand) throw new NotFoundError();
  const reach = (await store.userBrandReach([user.id])).get(user.id);
  if (reach && !reach.all && !reach.brandIds.has(brandId)) throw new BadRequestError(`${user.name} does not work in ${brand.code}: add them to a ${brand.code} territory first`);
  await store.grantBrandAdmin(user.id, brandId, ctx.userId);
  await log(ctx, "CREATE", "BrandAdmin", `${user.id}:${brandId}`, undefined, { user: user.email, brand: brand.code }, brandId);
  return { user, brand };
}

export async function revokeBrandAdmin(ctx: AccessContext, userId: string, brandId: string) {
  assertSuperAdmin(ctx);
  const res = await store.revokeBrandAdmin(userId, brandId);
  if (res.count) await log(ctx, "DELETE", "BrandAdmin", `${userId}:${brandId}`, { userId, brandId }, undefined, brandId);
}

/** "Setup permissions" of a profile: delegable functions only – security and tier functions can never be delegated. */
export async function setProfileSetupSections(ctx: AccessContext, profileId: string, sections: string[]) {
  assertSuperAdmin(ctx);
  const allowed = new Set(SETUP_CATALOGUE.filter((e) => e.delegable).map((e) => e.key));
  const clean = [...new Set(sections)].filter((s) => allowed.has(s)).sort();
  const before = (await store.listProfilesForSetup()).find((p) => p.id === profileId);
  if (!before) throw new NotFoundError();
  const profile = await store.setProfileSetupSections(profileId, clean);
  await log(ctx, "UPDATE", "SetupPermissions", profileId, { profile: before.name, sections: before.setupSections }, { profile: profile.name, sections: clean });
}

// ───────────────────────────── brand-scoped functions (Brand Admin) ─────────────────────────────

export async function brandsInSetupScope(ctx: AccessContext, entry: string) {
  assertSetup(ctx, entry);
  return store.listBrandsBasic(setupBrandIds(ctx));
}

export async function brandTeam(ctx: AccessContext, brandId: string) {
  assertSetup(ctx, "brand-members");
  assertSetupBrand(ctx, brandId);
  return store.brandTerritoriesWithMembers(brandId);
}

async function brandTerritory(ctx: AccessContext, territoryId: string) {
  assertSetup(ctx, "brand-members");
  const territory = await store.getTerritory(territoryId);
  if (!territory?.brandId) throw new NotFoundError();
  assertSetupBrand(ctx, territory.brandId);
  return territory as { id: string; name: string; brandId: string; regionId: string | null };
}

export async function addBrandMember(ctx: AccessContext, territoryId: string, email: string, isManager: boolean) {
  const territory = await brandTerritory(ctx, territoryId);
  const user = await store.findUserByEmail(email);
  if (!user) throw new BadRequestError("No active user has this e-mail address");
  await store.upsertMember(territoryId, user.id, isManager);
  await log(ctx, "CREATE", "TerritoryMember", `${user.id}:${territoryId}`, undefined, { user: user.email, territory: territory.name, isManager }, territory.brandId);
  return user;
}

export async function setBrandMemberManager(ctx: AccessContext, territoryId: string, userId: string, isManager: boolean) {
  const territory = await brandTerritory(ctx, territoryId);
  await store.upsertMember(territoryId, userId, isManager);
  await log(ctx, "UPDATE", "TerritoryMember", `${userId}:${territoryId}`, { isManager: !isManager }, { territory: territory.name, isManager }, territory.brandId);
}

export async function removeBrandMember(ctx: AccessContext, territoryId: string, userId: string) {
  const territory = await brandTerritory(ctx, territoryId);
  const res = await store.deleteMember(territoryId, userId);
  if (res.count) await log(ctx, "DELETE", "TerritoryMember", `${userId}:${territoryId}`, { userId, territory: territory.name }, undefined, territory.brandId);
}

const thresholdSchema = z
  .object({ discountApprovalPct: z.coerce.number().min(0).max(100), discountEscalationPct: z.coerce.number().min(0).max(100) })
  .refine((v) => v.discountEscalationPct >= v.discountApprovalPct, { message: "The Head of Sales threshold cannot be below the Brand Manager threshold", path: ["discountEscalationPct"] });

export async function saveBrandThresholds(ctx: AccessContext, brandId: string, input: { discountApprovalPct: unknown; discountEscalationPct: unknown }) {
  assertSetup(ctx, "brand-thresholds");
  assertSetupBrand(ctx, brandId);
  const data = thresholdSchema.parse(input);
  const before = (await store.listBrandsBasic([brandId]))[0];
  if (!before) throw new NotFoundError();
  const brand = await store.updateBrandThresholds(brandId, data);
  await log(ctx, "UPDATE", "Brand", brandId, { discountApprovalPct: before.discountApprovalPct, discountEscalationPct: before.discountEscalationPct }, data, brandId);
  return brand;
}

// ───────────────────────────── sessions, login history ─────────────────────────────

export async function signOutEverywhere(ctx: AccessContext, userId: string) {
  assertSetup(ctx, "session-settings");
  const user = await store.revokeSessions(userId, new Date());
  await log(ctx, "UPDATE", "Session", userId, undefined, { signedOutEverywhere: user.name });
  return user;
}

export async function loginHistory(ctx: AccessContext, opts: { page: number; failedOnly?: boolean }) {
  assertSetup(ctx, "login-history");
  const take = 50;
  const rows = await store.loginEvents(take + 1, (opts.page - 1) * take, { failedOnly: opts.failedOnly });
  return { rows: rows.slice(0, take), more: rows.length > take };
}

// ───────────────────────────── recycle bin, mass operations, sample data ─────────────────────────────

const recyclable = (model: string) => {
  if (!store.RECYCLABLE_MODELS.includes(model)) throw new BadRequestError("This module has no recycle bin");
  return model;
};

export async function recycleBin(ctx: AccessContext, model?: string) {
  assertSetup(ctx, "recycle-bin");
  const counts = await store.deletedCounts();
  const current = model && store.RECYCLABLE_MODELS.includes(model) ? model : (counts.find((c) => c.count > 0)?.model ?? store.RECYCLABLE_MODELS[0]!);
  return { counts, model: current, rows: await store.listDeleted(current) };
}

export async function restoreFromRecycleBin(ctx: AccessContext, model: string, ids: string[]) {
  assertSetup(ctx, "recycle-bin");
  if (!ids.length) throw new BadRequestError("Select at least one record");
  const restored = await store.restoreDeleted(recyclable(model), ids);
  await log(ctx, "UPDATE", "RecycleBin", null, undefined, { restored, model, ids: ids.slice(0, 50) });
  return restored;
}

/** Brand-owned modules with an owner: what mass transfer and mass delete work on. */
export const MASS_MODULES = MODULES.filter((m) => m.model && BRAND_OWNED_MODELS.has(m.model)).map((m) => ({ key: m.key as string, label: m.label as string, model: m.model as string }));

const massSchema = z.object({
  module: z.string().min(1),
  brandId: z.string().min(1).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
  createdBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type MassInput = z.input<typeof massSchema>;

export function massCriteria(input: MassInput): store.MassCriteria {
  const data = massSchema.parse(input);
  const mod = MASS_MODULES.find((m) => m.key === data.module);
  if (!mod) throw new BadRequestError("Choose a module");
  if (!store.RECYCLABLE_MODELS.includes(mod.model)) throw new BadRequestError(`${mod.label} cannot be mass-deleted (they have no recycle bin)`);
  if (!data.brandId && !data.ownerId && !data.createdBefore) throw new BadRequestError("Give at least one criterion (brand, owner or date) – deleting a whole module is not offered");
  return { model: mod.model, brandId: data.brandId ?? null, ownerId: data.ownerId ?? null, createdBefore: data.createdBefore ?? null };
}

export async function previewMassDelete(ctx: AccessContext, input: MassInput): Promise<number> {
  assertSetup(ctx, "mass-operations");
  assertSuperAdmin(ctx);
  return store.massCount(massCriteria(input));
}

/** Mass transfer of ownership. Runs as the administrator through scopedDb, so the new owner must be allowed to own every record. */
export async function massTransfer(ctx: AccessContext, input: { module: string; fromUserId: string; toUserId: string; brandId?: string | null }): Promise<number> {
  assertSetup(ctx, "mass-operations");
  if (!ctx.isAdmin) throw new NotFoundError();
  const mod = MASS_MODULES.find((m) => m.key === input.module);
  if (!mod) throw new BadRequestError("Choose a module");
  if (!input.fromUserId || !input.toUserId || input.fromUserId === input.toUserId) throw new BadRequestError("Choose two different users");
  const res = await (scopedDb(ctx) as any)[delegateName(mod.model)].updateMany({ where: { ownerId: input.fromUserId, ...(input.brandId ? { brandId: input.brandId } : {}) }, data: { ownerId: input.toUserId } });
  await log(ctx, "UPDATE", "MassOperation", null, { ownerId: input.fromUserId }, { transfer: mod.key, toUserId: input.toUserId, brandId: input.brandId ?? null, count: res.count }, input.brandId ?? null);
  return res.count as number;
}

export async function sampleDataCounts(ctx: AccessContext) {
  assertSetup(ctx, "remove-sample-data");
  return store.businessCounts();
}

// ───────────────────────────── health, audit trail ─────────────────────────────

export async function systemHealth(ctx: AccessContext) {
  assertSetup(ctx, "system-health");
  return store.healthSnapshot();
}

export async function setupAuditTrail(ctx: AccessContext, opts: { page: number; entity?: string }) {
  assertSetup(ctx, "setup-audit-trail");
  const take = 50;
  const rows = await store.setupAuditRows(take + 1, (opts.page - 1) * take, opts.entity);
  return { rows: rows.slice(0, take), more: rows.length > take, entities: store.SETUP_ENTITIES };
}

/** Field-by-field difference of two audit snapshots (top level; nested values compared as JSON). */
export function diffSnapshots(before: unknown, after: unknown): Array<{ field: string; before: string; after: string }> {
  const a = before && typeof before === "object" && !Array.isArray(before) ? (before as Record<string, unknown>) : before === null || before === undefined ? {} : { value: before };
  const b = after && typeof after === "object" && !Array.isArray(after) ? (after as Record<string, unknown>) : after === null || after === undefined ? {} : { value: after };
  const show = (v: unknown) => (v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => !["updatedAt", "createdAt"].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort()
    .map((k) => ({ field: k, before: show(a[k]), after: show(b[k]) }));
}
