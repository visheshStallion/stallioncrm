import { beforeAll, describe, expect, it } from "vitest";
import { can } from "@/server/access/can";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import { loadAccessContext } from "@/server/access/context";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db/scoped";
import * as q from "@/server/modules/admin/queries";
import * as svc from "@/server/modules/admin/service";
import { commitImport, dryRunImport } from "@/server/modules/admin/user-import";
import { REGIONS } from "../../prisma/seed-data";
import { ctxFor, ids, unsafeDb, userId } from "./helpers";

let admin: AccessContext;
let I: Awaited<ReturnType<typeof ids>>;

beforeAll(async () => {
  admin = await ctxFor("admin");
  I = await ids();
});

describe("brands & regions", () => {
  it("creating a brand creates 1 + N territories and audits", async () => {
    const activeRegions = await unsafeDb.region.count({ where: { active: true } });
    const brand = await svc.createBrand(admin, { code: "kia1", name: "Test brand", status: "FUTURE", brandManagerId: await userId("bm.hmnl") });
    expect(brand.code).toBe("KIA1");
    const territories = await unsafeDb.territory.findMany({ where: { brandId: brand.id }, orderBy: { level: "asc" } });
    expect(territories).toHaveLength(1 + activeRegions);
    expect(territories[0]!.name).toBe("KIA1");
    expect(territories.slice(1).map((t) => t.name).sort()).toEqual([...REGIONS].map((r) => `KIA1 – ${r}`).sort());
    // brand manager manages + is a member of the brand territory
    expect(territories[0]!.managerId).toBe(await userId("bm.hmnl"));
    expect(await unsafeDb.auditLog.count({ where: { entity: "Brand", entityId: brand.id, action: "CREATE" } })).toBe(1);
  });

  it("adding a region adds one territory per brand", async () => {
    const brands = await unsafeDb.brand.count();
    const region = await svc.createRegion(admin, { name: "Kano" });
    expect(await unsafeDb.territory.count({ where: { regionId: region.id } })).toBe(brands);
    await svc.renameRegion(admin, region.id, { name: "Kano North" });
    expect(await unsafeDb.territory.count({ where: { regionId: region.id, name: { endsWith: "– Kano North" } } })).toBe(brands);
  });

  it("brand code is immutable once used", async () => {
    const hmnl = await unsafeDb.brand.findUniqueOrThrow({ where: { code: "HMNL" } });
    await expect(svc.updateBrand(admin, hmnl.id, { code: "HMNX", name: hmnl.name, status: "ACTIVE" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("inactive brand: no new records, existing records read-only, hidden from pickers", async () => {
    const brand = await unsafeDb.brand.findUniqueOrThrow({ where: { code: "ZANL" } });
    await svc.updateBrand(admin, brand.id, { code: "ZANL", name: brand.name, status: "INACTIVE", brandManagerId: brand.brandManagerId });
    const bm = await ctxFor("bm.zanl");
    const db = scopedDb(bm);
    await expect(
      db.deal.create({ data: { name: "x", brandId: brand.id, regionId: I.region("Lagos"), ownerId: bm.userId } }),
    ).rejects.toThrow(/inactive/);
    const existing = await db.deal.findFirstOrThrow({ where: { brandId: brand.id } });
    await expect(db.deal.update({ where: { id: existing.id }, data: { name: "edit" } })).rejects.toThrow(/read-only/);
    expect((await db.deal.updateMany({ where: { brandId: brand.id }, data: { name: "edit" } })).count).toBe(0);
    expect((await q.adminLookups(admin)).pickableBrands.map((b) => b.code)).not.toContain("ZANL");
    // still readable
    expect(await db.deal.count({ where: { brandId: brand.id } })).toBeGreaterThan(0);
    await svc.updateBrand(admin, brand.id, { code: "ZANL", name: brand.name, status: "ACTIVE", brandManagerId: brand.brandManagerId });
  });

  it("aliases can be added and removed", async () => {
    await svc.addBrandAlias(admin, { alias: "hyu", brandId: I.brand("HMNL") });
    expect(await unsafeDb.brandCodeAlias.findUnique({ where: { alias: "HYU" } })).not.toBeNull();
    await svc.removeBrandAlias(admin, "HYU");
    expect(await unsafeDb.brandCodeAlias.findUnique({ where: { alias: "HYU" } })).toBeNull();
  });
});

describe("territories", () => {
  it("cannot delete a territory with records; move records then delete", async () => {
    const source = await unsafeDb.territory.findFirstOrThrow({ where: { name: "THPL – Ibadan" } });
    const target = await unsafeDb.territory.findFirstOrThrow({ where: { name: "THPL – Abuja" } });
    const n = await unsafeDb.deal.count({ where: { territoryId: source.id } });
    expect(n).toBeGreaterThan(0);
    await expect(svc.deleteTerritory(admin, source.id)).rejects.toBeInstanceOf(ForbiddenError);
    const moved = await svc.moveRecordsToTerritory(admin, source.id, target.id);
    expect(moved.Deal).toBe(n);
    const after = await unsafeDb.deal.findMany({ where: { id: { in: (await unsafeDb.deal.findMany({ where: { territoryId: target.id } })).map((d) => d.id) } } });
    expect(after.every((d) => d.regionId === target.regionId && d.brandId === target.brandId)).toBe(true);
    await svc.deleteTerritory(admin, source.id);
    expect(await unsafeDb.territory.findUnique({ where: { id: source.id } })).toBeNull();
  });

  it("root and brand territories with children cannot be deleted", async () => {
    const root = await unsafeDb.territory.findFirstOrThrow({ where: { level: 0 } });
    await expect(svc.deleteTerritory(admin, root.id)).rejects.toBeInstanceOf(ForbiddenError);
    const brandT = await unsafeDb.territory.findFirstOrThrow({ where: { name: "HMNL" } });
    await expect(svc.deleteTerritory(admin, brandT.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("membership changes take effect on the next access-context load", async () => {
    const uid = await userId("exec.hmnl.2");
    const snmnlLagos = await unsafeDb.territory.findFirstOrThrow({ where: { name: "SNMNL – Lagos" } });
    expect((await loadAccessContext(uid))!.brandIds).toEqual([I.brand("HMNL")]);
    await svc.addTerritoryMember(admin, snmnlLagos.id, uid);
    expect((await loadAccessContext(uid))!.brandIds.sort()).toEqual([I.brand("HMNL"), I.brand("SNMNL")].sort());
    await svc.removeTerritoryMember(admin, snmnlLagos.id, uid);
    expect((await loadAccessContext(uid))!.brandIds).toEqual([I.brand("HMNL")]);
  });
});

describe("roles & profiles", () => {
  it("role hierarchy rejects cycles", async () => {
    const md = await unsafeDb.role.findUniqueOrThrow({ where: { name: "Managing Director" } });
    const exec = await unsafeDb.role.findUniqueOrThrow({ where: { name: "Lagos Sales Exec" } });
    await expect(svc.updateRole(admin, md.id, { name: md.name, parentRoleId: exec.id })).rejects.toThrow(/descendant/);
  });

  it("profile permission change immediately affects can()", async () => {
    const exec = await ctxFor("exec.hmnl.1");
    expect(can(exec, "deals", "export")).toBe(false);
    const profile = await unsafeDb.profile.findUniqueOrThrow({ where: { name: "Sales Exec" } });
    const perms = profile.permissions as Record<string, Record<string, boolean>>;
    await svc.updateProfilePermissions(admin, profile.id, {
      scope: "TERRITORY",
      permissions: { ...perms, deals: { ...perms.deals, export: true } },
    });
    expect(can((await ctxFor("exec.hmnl.1")), "deals", "export")).toBe(true);
    await svc.updateProfilePermissions(admin, profile.id, { scope: "TERRITORY", permissions: perms });
    expect(can((await ctxFor("exec.hmnl.1")), "deals", "export")).toBe(false);
  });

  it("field-level security is stored per module and drives fieldMask", async () => {
    const profile = await unsafeDb.profile.findUniqueOrThrow({ where: { name: "Sales Exec" } });
    await svc.updateFieldPermissions(admin, profile.id, "deals", { amount: "hidden", name: "edit" });
    const exec = await ctxFor("exec.hmnl.1");
    expect(exec.profile.fieldPermissions.deals).toEqual({ amount: "hidden" });
  });

  it("the last Administrator cannot be deactivated or demoted", async () => {
    const adminId = admin.userId;
    const mgmt = await unsafeDb.profile.findUniqueOrThrow({ where: { name: "Management" } });
    const user = await unsafeDb.user.findUniqueOrThrow({ where: { id: adminId } });
    await expect(
      svc.updateUser(admin, adminId, { name: user.name, email: user.email, roleId: user.roleId, profileId: mgmt.id }),
    ).rejects.toThrow(/last remaining Administrator/);
    const adminProfile = await unsafeDb.profile.findUniqueOrThrow({ where: { name: "Administrator" } });
    await expect(
      svc.updateProfilePermissions(admin, adminProfile.id, { scope: "ALL", permissions: { deals: { read: true } } }),
    ).rejects.toThrow(/last remaining Administrator/);
    // a second admin makes deactivation possible; self-deactivation is still refused
    const second = await svc.createUser(admin, {
      name: "Second Admin",
      email: "admin2@stallioncrm.test",
      roleId: user.roleId,
      profileId: adminProfile.id,
    });
    const secondCtx = (await loadAccessContext(second.id))!;
    await expect(svc.deactivateUser(admin, adminId)).rejects.toThrow(/yourself/);
    await svc.deactivateUser(secondCtx, adminId);
    await expect(svc.deactivateUser(secondCtx, second.id)).rejects.toThrow(/yourself|last remaining/);
    await svc.activateUser(secondCtx, adminId);
  });
});

describe("users", () => {
  it("deactivation reassigns open records to each brand's Brand Manager (preview first)", async () => {
    const uid = await userId("exec.multi.1"); // owns HMNL + SNMNL Lagos deals
    const preview = await svc.deactivationPreview(admin, uid);
    expect(preview.map((l) => l.brandCode).sort()).toEqual(["HMNL", "SNMNL"]);
    const open = await unsafeDb.deal.count({ where: { ownerId: uid, stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } } });
    const closed = await unsafeDb.deal.count({ where: { ownerId: uid, stage: { in: ["CLOSED_WON", "CLOSED_LOST"] } } });
    expect(preview.reduce((a, l) => a + l.count, 0)).toBe(open);

    await svc.deactivateUser(admin, uid);
    expect(await unsafeDb.deal.count({ where: { ownerId: uid } })).toBe(closed);
    expect(await unsafeDb.deal.count({ where: { ownerId: await userId("bm.hmnl"), brandId: I.brand("HMNL") } })).toBeGreaterThan(0);
    expect((await unsafeDb.user.findUniqueOrThrow({ where: { id: uid } })).active).toBe(false);
    expect(await loadAccessContext(uid)).toBeNull();
  });

  it("setUserTerritories derives manager flags from the role", async () => {
    const uid = await userId("bm.smgl");
    const smgl = await unsafeDb.territory.findFirstOrThrow({ where: { name: "SMGL" } });
    await svc.setUserTerritories(admin, uid, [smgl.id]);
    const m = await unsafeDb.territoryMember.findUniqueOrThrow({ where: { userId_territoryId: { userId: uid, territoryId: smgl.id } } });
    expect(m.isManager).toBe(true);
  });

  it("user visibility matrix comes from the access engine", async () => {
    const v = await q.userVisibility(admin, await userId("exec.abuja"));
    const abuja = I.region("Abuja");
    expect(v.cells.every((c) => c.endsWith(`|${abuja}`))).toBe(true);
    expect(v.cells).toHaveLength(5);
  });
});

describe("CSV import", () => {
  const csv = [
    "name,email,company_codes,role,region",
    'Imported Rep,imported.rep@stallioncrm.test,"HMNL, SNML, SNMN",Sales Exec,Lagos',
    "No Company,no.company@stallioncrm.test,-,Sales Exec,Lagos",
    "Broken,not-an-email,HMNL,Sales Exec,Lagos",
  ].join("\n");

  it("dry-run does not write; commit imports OK rows, flagged rows only when overridden", async () => {
    const before = await unsafeDb.user.count();
    const plan = await dryRunImport(admin, csv);
    expect(plan.summary).toMatchObject({ total: 3, ok: 1, flagged: 1, errors: 1 });
    expect(await unsafeDb.user.count()).toBe(before);

    const res = await commitImport(admin, csv, []);
    expect(res).toMatchObject({ created: 1, skipped: 2 });
    const rep = await unsafeDb.user.findUniqueOrThrow({
      where: { email: "imported.rep@stallioncrm.test" },
      include: { memberships: { include: { territory: true } }, profile: true },
    });
    expect(rep.memberships.map((m) => m.territory.name).sort()).toEqual(["HMNL – Lagos", "SNMNL – Lagos"]);
    expect(rep.profile.name).toBe("Sales Exec");
    expect(await unsafeDb.user.findUnique({ where: { email: "no.company@stallioncrm.test" } })).toBeNull();

    const flaggedLine = plan.rows.find((r) => r.status === "flagged")!.line;
    const res2 = await commitImport(admin, csv, [flaggedLine]);
    expect(res2).toMatchObject({ created: 1, updated: 1 });
    const noCo = await unsafeDb.user.findUniqueOrThrow({ where: { email: "no.company@stallioncrm.test" }, include: { memberships: true } });
    expect(noCo.memberships).toHaveLength(0);
    expect(await unsafeDb.auditLog.count({ where: { action: "IMPORT" } })).toBe(2);
  });
});

describe("non-admins", () => {
  it.each(["md", "bm.hmnl", "rsm", "exec.hmnl.1"])("%s gets NotFound from every admin service", async (key) => {
    const ctx = await ctxFor(key);
    const calls: Array<() => Promise<unknown>> = [
      () => q.listBrands(ctx),
      () => q.listUsers(ctx),
      () => q.territoryTree(ctx),
      () => q.auditLog(ctx, {}),
      () => svc.createRegion(ctx, { name: "Nope" }),
      () => svc.createBrand(ctx, { code: "NOPE", name: "Nope" }),
      () => svc.setUserTerritories(ctx, ctx.userId, []),
      () => dryRunImport(ctx, "name,email,company_codes,role,region\n"),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(NotFoundError);
  });
});
