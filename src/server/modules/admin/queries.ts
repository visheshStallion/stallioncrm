import "server-only";
import { loadAccessContext } from "@/server/access/context";
import type { ModuleKey } from "@/server/access/modules";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { auditEntities, countBrandOwnedRecords, queryAuditLog, type AuditQuery } from "@/server/db/system";
import { moduleFields } from "./fields";
import { assertAdmin } from "./guard";

/** Pickers shared by admin forms. Inactive brands are excluded from pickers. */
export async function adminLookups(ctx: AccessContext) {
  assertAdmin(ctx);
  const db = scopedDb(ctx);
  const [brands, regions, roles, profiles, users, territories] = await Promise.all([
    db.brand.findMany({ select: { id: true, code: true, name: true, color: true, status: true }, orderBy: { code: "asc" } }),
    db.region.findMany({ select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
    db.role.findMany({ select: { id: true, name: true, parentRoleId: true }, orderBy: { name: "asc" } }),
    db.profile.findMany({ select: { id: true, name: true, scope: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ select: { id: true, name: true, email: true, active: true }, orderBy: { name: "asc" } }),
    db.territory.findMany({
      select: { id: true, name: true, level: true, brandId: true, regionId: true },
      orderBy: [{ level: "asc" }, { name: "asc" }],
    }),
  ]);
  return {
    brands,
    pickableBrands: brands.filter((b) => b.status !== "INACTIVE"),
    regions,
    activeRegions: regions.filter((r) => r.active),
    roles,
    profiles,
    users,
    activeUsers: users.filter((u) => u.active),
    territories,
  };
}

export async function listBrands(ctx: AccessContext) {
  assertAdmin(ctx);
  return scopedDb(ctx).brand.findMany({
    omit: { logoData: true },
    include: {
      brandManager: { select: { id: true, name: true } },
      aliases: { orderBy: { alias: "asc" } },
      _count: { select: { territories: true } },
    },
    orderBy: { code: "asc" },
  });
}

export async function getBrand(ctx: AccessContext, id: string) {
  assertAdmin(ctx);
  const brand = await scopedDb(ctx).brand.findUnique({
    where: { id },
    omit: { logoData: true },
    include: { aliases: { orderBy: { alias: "asc" } }, brandManager: { select: { id: true, name: true } } },
  });
  if (!brand) return null;
  const records = await countBrandOwnedRecords({ brandId: id });
  return { ...brand, recordCount: Object.values(records).reduce((a, b) => a + b, 0) };
}

export async function listRegions(ctx: AccessContext) {
  assertAdmin(ctx);
  return scopedDb(ctx).region.findMany({
    include: { _count: { select: { territories: true } } },
    orderBy: { name: "asc" },
  });
}

export interface TerritoryNode {
  id: string;
  name: string;
  level: number;
  brandId: string | null;
  regionId: string | null;
  manager: { id: string; name: string } | null;
  memberCount: number;
  children: TerritoryNode[];
}

/** Group › Brand › Brand–Region tree. */
export async function territoryTree(ctx: AccessContext): Promise<TerritoryNode[]> {
  assertAdmin(ctx);
  const rows = await scopedDb(ctx).territory.findMany({
    include: { manager: { select: { id: true, name: true } }, _count: { select: { members: true } } },
    orderBy: [{ level: "asc" }, { name: "asc" }],
  });
  const nodes = new Map<string, TerritoryNode>(
    rows.map((t) => [
      t.id,
      {
        id: t.id,
        name: t.name,
        level: t.level,
        brandId: t.brandId,
        regionId: t.regionId,
        manager: t.manager,
        memberCount: t._count.members,
        children: [],
      },
    ]),
  );
  const roots: TerritoryNode[] = [];
  for (const t of rows) {
    const node = nodes.get(t.id)!;
    const parent = t.parentId ? nodes.get(t.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getTerritory(ctx: AccessContext, id: string) {
  assertAdmin(ctx);
  const t = await scopedDb(ctx).territory.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, name: true } },
      children: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      manager: { select: { id: true, name: true } },
      brand: { select: { id: true, code: true, name: true, color: true, status: true } },
      region: { select: { id: true, name: true } },
      members: {
        include: {
          user: { select: { id: true, name: true, email: true, active: true, role: { select: { name: true } } } },
        },
        orderBy: { user: { name: "asc" } },
      },
    },
  });
  if (!t) return null;
  return { ...t, records: await countBrandOwnedRecords({ territoryId: id }) };
}

export interface RoleNode {
  id: string;
  name: string;
  parentRoleId: string | null;
  userCount: number;
  children: RoleNode[];
}

export async function roleTree(ctx: AccessContext): Promise<RoleNode[]> {
  assertAdmin(ctx);
  const rows = await scopedDb(ctx).role.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { name: "asc" },
  });
  const nodes = new Map<string, RoleNode>(
    rows.map((r) => [r.id, { id: r.id, name: r.name, parentRoleId: r.parentRoleId, userCount: r._count.users, children: [] }]),
  );
  const roots: RoleNode[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id)!;
    const parent = r.parentRoleId ? nodes.get(r.parentRoleId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function listProfiles(ctx: AccessContext) {
  assertAdmin(ctx);
  return scopedDb(ctx).profile.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getProfile(ctx: AccessContext, id: string) {
  assertAdmin(ctx);
  return scopedDb(ctx).profile.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
}

export function profileModuleFields(module: ModuleKey, fieldPermissions: unknown): string[] {
  const configured = Object.keys(((fieldPermissions ?? {}) as Record<string, Record<string, string>>)[module] ?? {});
  return moduleFields(module, configured);
}

export async function listUsers(
  ctx: AccessContext,
  filters: { q?: string; status?: "active" | "inactive" | "all"; roleId?: string; profileId?: string; brandId?: string } = {},
) {
  assertAdmin(ctx);
  const q = filters.q?.trim();
  return scopedDb(ctx).user.findMany({
    where: {
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
      ...(filters.status === "inactive" ? { active: false } : filters.status === "all" ? {} : { active: true }),
      ...(filters.roleId ? { roleId: filters.roleId } : {}),
      ...(filters.profileId ? { profileId: filters.profileId } : {}),
      ...(filters.brandId ? { memberships: { some: { territory: { brandId: filters.brandId } } } } : {}),
    },
    include: {
      role: { select: { name: true } },
      profile: { select: { name: true } },
      manager: { select: { id: true, name: true } },
      memberships: { include: { territory: { select: { id: true, name: true, brandId: true } } } },
    },
    orderBy: { name: "asc" },
    take: 500,
  });
}

export async function getUser(ctx: AccessContext, id: string) {
  assertAdmin(ctx);
  return scopedDb(ctx).user.findUnique({
    where: { id },
    include: {
      role: true,
      profile: { select: { id: true, name: true, scope: true } },
      manager: { select: { id: true, name: true } },
      memberships: {
        include: { territory: { select: { id: true, name: true, level: true, brandId: true, regionId: true } } },
      },
    },
  });
}

/** "What can this user see?" – effective brand × region cells from the access engine itself. */
export async function userVisibility(ctx: AccessContext, userId: string) {
  assertAdmin(ctx);
  const target = await loadAccessContext(userId);
  const db = scopedDb(ctx);
  const [brands, regions] = await Promise.all([
    db.brand.findMany({ select: { id: true, code: true, name: true, color: true, status: true }, orderBy: { code: "asc" } }),
    db.region.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!target) return { active: false as const, brands, regions, scope: null, cells: [] as string[], profile: null };
  const cells =
    target.scope === "ALL"
      ? brands.flatMap((b) => regions.map((r) => `${b.id}|${r.id}`))
      : target.memberships.flatMap((m) =>
          m.regionId ? [`${m.brandId}|${m.regionId}`] : regions.map((r) => `${m.brandId}|${r.id}`),
        );
  return {
    active: true as const,
    brands,
    regions,
    scope: target.scope,
    cells: [...new Set(cells)],
    profile: target.profile,
  };
}

export async function auditLog(ctx: AccessContext, q: AuditQuery) {
  assertAdmin(ctx);
  return queryAuditLog(q);
}

export async function auditLogEntities(ctx: AccessContext) {
  assertAdmin(ctx);
  return auditEntities();
}
