/**
 * Administration services (prompt 01). Every function: assertAdmin → validate → scopedDb write →
 * audit(). Writes to admin tables are not brand-owned, so they are audited explicitly here.
 */
import "server-only";
import { hash } from "@node-rs/argon2";
import type { AuditAction, Prisma } from "@prisma/client";
import { BRAND_OWNED_MODELS, delegateName } from "@/server/access/brand-owned";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import { MODULE_KEYS, type ModuleKey } from "@/server/access/modules";
import { parsePermissions } from "@/server/access/permissions";
import { HEAD_OFFICE_REGION, roleKind } from "@/server/access/quick-assign";
import {
  brandRegionTerritoryName,
  brandTerritoryName,
  ensureBrandTerritories,
  ensureRegionTerritories,
} from "@/server/access/territory";
import type { AccessContext } from "@/server/access/types";
import { audit, scopedDb } from "@/server/db";
import { countBrandOwnedRecords, moveTerritoryRecords } from "@/server/db/system";
import { BadRequestError } from "@/server/errors";
import { assertAdmin } from "./guard";
import {
  aliasSchema,
  brandSchema,
  fieldPermissionSchema,
  passwordSchema,
  permissionGridSchema,
  profileCreateSchema,
  regionSchema,
  roleSchema,
  userSchema,
  type BrandInput,
  type UserInput,
} from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any -- generic delegate access over brand-owned models */

const db = (ctx: AccessContext) => scopedDb(ctx);
/** Territory helpers take a TransactionClient; the scoped client provides the same delegates. */
const tx = (ctx: AccessContext) => scopedDb(ctx) as unknown as Prisma.TransactionClient;

function log(ctx: AccessContext, action: AuditAction, entity: string, entityId: string | null, before?: unknown, after?: unknown, brandId?: string | null) {
  return audit({ ctx, action, entity, entityId, before, after, brandId: brandId ?? null });
}

const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

// ───────────────────────────────────── Brands ─────────────────────────────────────

/** Brand manager ↔ brand territory manager + brand-level manager membership. */
async function syncBrandManager(ctx: AccessContext, brandId: string, userId: string | null) {
  const d = db(ctx);
  const brandTerritory = await d.territory.findFirst({ where: { brandId, level: 1 } });
  if (!brandTerritory) return;
  await d.territory.update({ where: { id: brandTerritory.id }, data: { managerId: userId } });
  if (userId) {
    await d.territoryMember.upsert({
      where: { userId_territoryId: { userId, territoryId: brandTerritory.id } },
      update: { isManager: true },
      create: { userId, territoryId: brandTerritory.id, isManager: true },
    });
  }
}

export async function createBrand(ctx: AccessContext, input: BrandInput) {
  assertAdmin(ctx);
  const data = brandSchema.parse(input);
  const brand = await db(ctx).brand.create({ data });
  await ensureBrandTerritories(tx(ctx), brand.id);
  if (data.brandManagerId) await syncBrandManager(ctx, brand.id, data.brandManagerId);
  await log(ctx, "CREATE", "Brand", brand.id, undefined, brand, brand.id);
  return brand;
}

export async function updateBrand(ctx: AccessContext, id: string, input: BrandInput) {
  assertAdmin(ctx);
  const data = brandSchema.parse(input);
  const d = db(ctx);
  const before = await d.brand.findUnique({ where: { id }, omit: { logoData: true } });
  if (!before) throw new NotFoundError();

  if (data.code !== before.code) {
    const used = total(await countBrandOwnedRecords({ brandId: id }));
    if (used > 0) throw new ForbiddenError(`Brand code ${before.code} is used by ${used} record(s) and cannot change`);
    // Rename the brand's territories to the new code.
    const territories = await d.territory.findMany({ where: { brandId: id }, include: { region: true } });
    for (const t of territories) {
      await d.territory.update({
        where: { id: t.id },
        data: { name: t.region ? brandRegionTerritoryName(data.code, t.region.name) : brandTerritoryName(data.code) },
      });
    }
  }

  const brand = await d.brand.update({ where: { id }, data, omit: { logoData: true } });
  if (data.brandManagerId !== before.brandManagerId) await syncBrandManager(ctx, id, data.brandManagerId);
  await log(ctx, "UPDATE", "Brand", id, before, brand, id);
  return brand;
}

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]);
export const MAX_LOGO_BYTES = 256 * 1024;

export async function setBrandLogo(ctx: AccessContext, id: string, file: { bytes: Uint8Array<ArrayBuffer>; type: string }) {
  assertAdmin(ctx);
  if (!LOGO_TYPES.has(file.type)) throw new BadRequestError("Logo must be PNG, JPEG, SVG or WebP");
  if (file.bytes.byteLength > MAX_LOGO_BYTES) throw new BadRequestError("Logo must be 256 KB or smaller");
  await db(ctx).brand.update({
    where: { id },
    data: { logoData: file.bytes, logoMimeType: file.type },
    select: { id: true },
  });
  await log(ctx, "UPDATE", "Brand", id, undefined, { logo: `${file.type}, ${file.bytes.byteLength} bytes` }, id);
}

export async function clearBrandLogo(ctx: AccessContext, id: string) {
  assertAdmin(ctx);
  await db(ctx).brand.update({ where: { id }, data: { logoData: null, logoMimeType: null }, select: { id: true } });
  await log(ctx, "UPDATE", "Brand", id, undefined, { logo: null }, id);
}

export async function addBrandAlias(ctx: AccessContext, input: { alias: string; brandId: string; note?: string | null }) {
  assertAdmin(ctx);
  const data = aliasSchema.parse(input);
  const alias = await db(ctx).brandCodeAlias.create({ data });
  await log(ctx, "CREATE", "BrandCodeAlias", alias.alias, undefined, alias, alias.brandId);
  return alias;
}

export async function removeBrandAlias(ctx: AccessContext, alias: string) {
  assertAdmin(ctx);
  const removed = await db(ctx).brandCodeAlias.delete({ where: { alias } });
  await log(ctx, "DELETE", "BrandCodeAlias", alias, removed, undefined, removed.brandId);
}

// ───────────────────────────────────── Regions ─────────────────────────────────────

export async function createRegion(ctx: AccessContext, input: { name: string }) {
  assertAdmin(ctx);
  const { name } = regionSchema.parse(input);
  const region = await db(ctx).region.create({ data: { name } });
  await ensureRegionTerritories(tx(ctx), region.id);
  await log(ctx, "CREATE", "Region", region.id, undefined, region);
  return region;
}

export async function renameRegion(ctx: AccessContext, id: string, input: { name: string }) {
  assertAdmin(ctx);
  const { name } = regionSchema.parse(input);
  const d = db(ctx);
  const before = await d.region.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  const region = await d.region.update({ where: { id }, data: { name } });
  const territories = await d.territory.findMany({ where: { regionId: id }, include: { brand: true } });
  for (const t of territories) {
    if (t.brand) await d.territory.update({ where: { id: t.id }, data: { name: brandRegionTerritoryName(t.brand.code, name) } });
  }
  await log(ctx, "UPDATE", "Region", id, before, region);
  return region;
}

export async function setRegionActive(ctx: AccessContext, id: string, active: boolean) {
  assertAdmin(ctx);
  const d = db(ctx);
  const before = await d.region.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  const region = await d.region.update({ where: { id }, data: { active } });
  if (active) await ensureRegionTerritories(tx(ctx), id);
  await log(ctx, "UPDATE", "Region", id, before, region);
  return region;
}

// ──────────────────────────────────── Territories ────────────────────────────────────

export async function setTerritoryManager(ctx: AccessContext, territoryId: string, userId: string | null) {
  assertAdmin(ctx);
  const d = db(ctx);
  const before = await d.territory.findUnique({ where: { id: territoryId } });
  if (!before) throw new NotFoundError();
  if (before.level === 1 && before.brandId) {
    // The brand-level node's manager IS the brand manager.
    await d.brand.update({ where: { id: before.brandId }, data: { brandManagerId: userId }, select: { id: true } });
    await syncBrandManager(ctx, before.brandId, userId);
  } else {
    await d.territory.update({ where: { id: territoryId }, data: { managerId: userId } });
    if (userId) {
      await d.territoryMember.upsert({
        where: { userId_territoryId: { userId, territoryId } },
        update: { isManager: true },
        create: { userId, territoryId, isManager: true },
      });
    }
  }
  await log(ctx, "UPDATE", "Territory", territoryId, { managerId: before.managerId }, { managerId: userId }, before.brandId);
}

export async function addTerritoryMember(ctx: AccessContext, territoryId: string, userId: string, isManager = false) {
  assertAdmin(ctx);
  const member = await db(ctx).territoryMember.upsert({
    where: { userId_territoryId: { userId, territoryId } },
    update: { isManager },
    create: { userId, territoryId, isManager },
    include: { territory: { select: { brandId: true } } },
  });
  await log(ctx, "CREATE", "TerritoryMember", `${userId}:${territoryId}`, undefined, { userId, territoryId, isManager }, member.territory.brandId);
}

export async function removeTerritoryMember(ctx: AccessContext, territoryId: string, userId: string) {
  assertAdmin(ctx);
  const removed = await db(ctx).territoryMember.delete({
    where: { userId_territoryId: { userId, territoryId } },
    include: { territory: { select: { brandId: true } } },
  });
  await log(ctx, "DELETE", "TerritoryMember", `${userId}:${territoryId}`, { userId, territoryId, isManager: removed.isManager }, undefined, removed.territory.brandId);
}

export async function deleteTerritory(ctx: AccessContext, territoryId: string) {
  assertAdmin(ctx);
  const d = db(ctx);
  const t = await d.territory.findUnique({ where: { id: territoryId }, include: { _count: { select: { children: true } } } });
  if (!t) throw new NotFoundError();
  if (t.level === 0) throw new ForbiddenError("The group root territory cannot be deleted");
  if (t._count.children > 0) throw new ForbiddenError("Delete or move the child territories first");
  const records = total(await countBrandOwnedRecords({ territoryId }));
  if (records > 0) throw new ForbiddenError(`Territory has ${records} record(s) – move them to another territory first`);
  await d.territoryMember.deleteMany({ where: { territoryId } });
  await d.territory.delete({ where: { id: territoryId } });
  await log(ctx, "DELETE", "Territory", territoryId, t, undefined, t.brandId);
}

/** "Move records to…" – re-points every record of a territory (incl. soft-deleted) to a level-2 target. */
export async function moveRecordsToTerritory(ctx: AccessContext, sourceId: string, targetId: string) {
  assertAdmin(ctx);
  if (sourceId === targetId) throw new BadRequestError("Choose a different target territory");
  const d = db(ctx);
  const target = await d.territory.findUnique({ where: { id: targetId }, include: { brand: true } });
  if (!target || target.level !== 2 || !target.brandId || !target.regionId) {
    throw new BadRequestError("Target must be a Brand – Region territory");
  }
  if (target.brand?.status === "INACTIVE") throw new ForbiddenError(`Brand ${target.brand.code} is inactive`);
  const moved = await moveTerritoryRecords(
    sourceId,
    { territoryId: target.id, brandId: target.brandId, regionId: target.regionId },
    ctx.userId,
  );
  await log(ctx, "UPDATE", "Territory", sourceId, undefined, { movedTo: target.name, moved }, target.brandId);
  return moved;
}

// ─────────────────────────────────────── Roles ───────────────────────────────────────

async function assertNoRoleCycle(ctx: AccessContext, roleId: string, parentId: string | null) {
  let cursor = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === roleId) throw new BadRequestError("A role cannot report to itself or its own descendant");
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const parent: { parentRoleId: string | null } | null = await db(ctx).role.findUnique({
      where: { id: cursor },
      select: { parentRoleId: true },
    });
    cursor = parent?.parentRoleId ?? null;
  }
}

export async function createRole(ctx: AccessContext, input: { name: string; parentRoleId?: string | null }) {
  assertAdmin(ctx);
  const data = roleSchema.parse(input);
  const role = await db(ctx).role.create({ data });
  await log(ctx, "CREATE", "Role", role.id, undefined, role);
  return role;
}

export async function updateRole(ctx: AccessContext, id: string, input: { name: string; parentRoleId?: string | null }) {
  assertAdmin(ctx);
  const data = roleSchema.parse(input);
  const before = await db(ctx).role.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  await assertNoRoleCycle(ctx, id, data.parentRoleId);
  const role = await db(ctx).role.update({ where: { id }, data });
  await log(ctx, "UPDATE", "Role", id, before, role);
  return role;
}

export async function deleteRole(ctx: AccessContext, id: string) {
  assertAdmin(ctx);
  const role = await db(ctx).role.findUnique({ where: { id }, include: { _count: { select: { users: true, childRoles: true } } } });
  if (!role) throw new NotFoundError();
  if (role._count.users > 0) throw new ForbiddenError(`Role has ${role._count.users} user(s)`);
  if (role._count.childRoles > 0) throw new ForbiddenError("Role has subordinate roles");
  await db(ctx).role.delete({ where: { id } });
  await log(ctx, "DELETE", "Role", id, role);
}

// ────────────────────────────────────── Profiles ──────────────────────────────────────

const isAdminPermissions = (json: unknown) => parsePermissions(json).admin?.edit === true;

/**
 * Last-administrator rule: simulate the change and require at least one active user whose profile
 * keeps admin.edit.
 */
async function assertAdminsRemain(
  ctx: AccessContext,
  change: { userId?: string; deactivate?: boolean; newProfileId?: string; profileId?: string; newPermissions?: unknown },
) {
  const d = db(ctx);
  const [users, profiles] = await Promise.all([
    d.user.findMany({ where: { active: true }, select: { id: true, profileId: true } }),
    d.profile.findMany({ select: { id: true, permissions: true } }),
  ]);
  const adminProfiles = new Set(
    profiles
      .filter((p) => isAdminPermissions(p.id === change.profileId ? change.newPermissions : p.permissions))
      .map((p) => p.id),
  );
  const remaining = users.filter((u) => {
    if (u.id === change.userId && change.deactivate) return false;
    const profileId = u.id === change.userId && change.newProfileId ? change.newProfileId : u.profileId;
    return adminProfiles.has(profileId);
  });
  if (remaining.length === 0) {
    throw new ForbiddenError("The last remaining Administrator cannot be deactivated or demoted");
  }
}

export async function createProfile(ctx: AccessContext, input: { name: string; cloneFromId: string }) {
  assertAdmin(ctx);
  const data = profileCreateSchema.parse(input);
  const source = await db(ctx).profile.findUnique({ where: { id: data.cloneFromId } });
  if (!source) throw new NotFoundError();
  const profile = await db(ctx).profile.create({
    data: {
      name: data.name,
      scope: source.scope,
      permissions: source.permissions ?? {},
      fieldPermissions: source.fieldPermissions ?? {},
    },
  });
  await log(ctx, "CREATE", "Profile", profile.id, undefined, profile);
  return profile;
}

/** Permission grid + scope. Takes effect on each affected user's next request. */
export async function updateProfilePermissions(
  ctx: AccessContext,
  id: string,
  input: { scope: "ALL" | "TERRITORY"; permissions: Partial<Record<ModuleKey, Record<string, boolean>>> },
) {
  assertAdmin(ctx);
  const data = permissionGridSchema.parse(input);
  const before = await db(ctx).profile.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  // Keep only true flags; drop empty modules.
  const permissions = Object.fromEntries(
    MODULE_KEYS.map((m) => [m, Object.fromEntries(Object.entries(data.permissions[m] ?? {}).filter(([, v]) => v))]).filter(
      ([, v]) => Object.keys(v as object).length > 0,
    ),
  );
  await assertAdminsRemain(ctx, { profileId: id, newPermissions: permissions });
  const profile = await db(ctx).profile.update({ where: { id }, data: { scope: data.scope, permissions } });
  await log(ctx, "UPDATE", "Profile", id, before, profile);
  return profile;
}

export async function updateFieldPermissions(
  ctx: AccessContext,
  id: string,
  module: ModuleKey,
  fields: Record<string, "hidden" | "masked" | "read" | "edit">,
) {
  assertAdmin(ctx);
  const parsed = fieldPermissionSchema.parse(fields);
  const before = await db(ctx).profile.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  const current = (before.fieldPermissions ?? {}) as Record<string, Record<string, string>>;
  // "edit" is the default – store only restrictions.
  const restricted = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== "edit"));
  const next = { ...current, [module]: restricted };
  if (Object.keys(restricted).length === 0) delete next[module];
  const profile = await db(ctx).profile.update({ where: { id }, data: { fieldPermissions: next } });
  await log(ctx, "UPDATE", "Profile", id, { fieldPermissions: before.fieldPermissions }, { fieldPermissions: next });
  return profile;
}

// ─────────────────────────────────────── Users ───────────────────────────────────────

/**
 * Replaces a user's territory memberships. isManager is derived from the role: Brand Managers manage
 * their brand-level territory, the RSM manages every non-Lagos brand-region territory.
 */
export async function setUserTerritories(ctx: AccessContext, userId: string, territoryIds: string[]) {
  assertAdmin(ctx);
  const d = db(ctx);
  const user = await d.user.findUnique({ where: { id: userId }, include: { role: true, memberships: true } });
  if (!user) throw new NotFoundError();
  const ids = [...new Set(territoryIds)];
  const territories = await d.territory.findMany({ where: { id: { in: ids } }, include: { region: true } });
  if (territories.length !== ids.length) throw new BadRequestError("Unknown territory");
  const kind = roleKind(user.role.name);
  const isManagerOf = (t: (typeof territories)[number]) =>
    (kind === "BRAND_MANAGER" && t.level === 1) ||
    (kind === "RSM" && t.level === 2 && t.region?.name !== HEAD_OFFICE_REGION);

  const before = user.memberships.map((m) => m.territoryId).sort();
  await d.territoryMember.deleteMany({ where: { userId, territoryId: { notIn: ids } } });
  for (const t of territories) {
    await d.territoryMember.upsert({
      where: { userId_territoryId: { userId, territoryId: t.id } },
      update: { isManager: isManagerOf(t) },
      create: { userId, territoryId: t.id, isManager: isManagerOf(t) },
    });
  }
  await log(ctx, "UPDATE", "User", userId, { territories: before }, { territories: ids.sort() });
}

export async function createUser(ctx: AccessContext, input: UserInput, territoryIds: string[] = []) {
  assertAdmin(ctx);
  const { password, ...data } = userSchema.parse(input);
  const user = await db(ctx).user.create({
    data: { ...data, passwordHash: password ? await hash(password) : null },
  });
  if (territoryIds.length) await setUserTerritories(ctx, user.id, territoryIds);
  await log(ctx, "CREATE", "User", user.id, undefined, user);
  return user;
}

export async function updateUser(ctx: AccessContext, id: string, input: UserInput) {
  assertAdmin(ctx);
  const { password, ...data } = userSchema.parse(input);
  const d = db(ctx);
  const before = await d.user.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  if (data.managerId === id) throw new BadRequestError("A user cannot be their own manager");
  if (data.profileId !== before.profileId) await assertAdminsRemain(ctx, { userId: id, newProfileId: data.profileId });
  const user = await d.user.update({
    where: { id },
    data: { ...data, ...(password ? { passwordHash: await hash(password) } : {}) },
  });
  await log(ctx, "UPDATE", "User", id, before, { ...user, ...(password ? { password: "changed" } : {}) });
  return user;
}

export async function setUserPassword(ctx: AccessContext, id: string, password: string) {
  assertAdmin(ctx);
  const pw = passwordSchema.parse(password);
  await db(ctx).user.update({ where: { id }, data: { passwordHash: await hash(pw) }, select: { id: true } });
  await log(ctx, "UPDATE", "User", id, undefined, { password: "changed" });
}

/** Open = not soft-deleted, plus per-model rules (e.g. deals not closed). Later modules add theirs. */
const OPEN_RECORD_FILTERS: Record<string, object> = {
  Deal: { stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } },
  Lead: { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } },
};

export interface ReassignmentLine {
  model: string;
  brandId: string;
  brandCode: string;
  count: number;
  targetUserId: string | null;
  targetName: string | null;
  problem: string | null;
}

/** Preview of the reassignment that deactivation performs: open records → that brand's Brand Manager. */
export async function deactivationPreview(ctx: AccessContext, userId: string): Promise<ReassignmentLine[]> {
  assertAdmin(ctx);
  const d = db(ctx);
  const brands = await d.brand.findMany({
    select: { id: true, code: true, brandManagerId: true, brandManager: { select: { name: true, active: true } } },
  });
  const lines: ReassignmentLine[] = [];
  for (const model of BRAND_OWNED_MODELS) {
    const groups: Array<{ brandId: string; _count: { _all: number } }> = await (d as any)[delegateName(model)].groupBy({
      by: ["brandId"],
      where: { ownerId: userId, ...(OPEN_RECORD_FILTERS[model] ?? {}) },
      _count: { _all: true },
    });
    for (const g of groups) {
      const brand = brands.find((b) => b.id === g.brandId);
      const bm = brand?.brandManagerId ?? null;
      const problem = !bm
        ? "Brand has no Brand Manager – records stay with the user"
        : bm === userId
          ? "User is this brand's Brand Manager – assign a new one first"
          : brand?.brandManager?.active === false
            ? "Brand Manager is inactive – records stay with the user"
            : null;
      lines.push({
        model,
        brandId: g.brandId,
        brandCode: brand?.code ?? "?",
        count: g._count._all,
        targetUserId: problem ? null : bm,
        targetName: problem ? null : brand?.brandManager?.name ?? null,
        problem,
      });
    }
  }
  return lines;
}

export async function deactivateUser(ctx: AccessContext, userId: string) {
  assertAdmin(ctx);
  if (userId === ctx.userId) throw new ForbiddenError("You cannot deactivate yourself");
  await assertAdminsRemain(ctx, { userId, deactivate: true });
  const d = db(ctx);
  const preview = await deactivationPreview(ctx, userId);
  for (const line of preview) {
    if (!line.targetUserId) continue;
    await (d as any)[delegateName(line.model)].updateMany({
      where: { ownerId: userId, brandId: line.brandId, ...(OPEN_RECORD_FILTERS[line.model] ?? {}) },
      data: { ownerId: line.targetUserId },
    });
  }
  await d.user.update({ where: { id: userId }, data: { active: false }, select: { id: true } });
  await log(ctx, "UPDATE", "User", userId, { active: true }, { active: false, reassigned: preview });
  return preview;
}

export async function activateUser(ctx: AccessContext, userId: string) {
  assertAdmin(ctx);
  await db(ctx).user.update({ where: { id: userId }, data: { active: true }, select: { id: true } });
  await log(ctx, "UPDATE", "User", userId, { active: false }, { active: true });
}
