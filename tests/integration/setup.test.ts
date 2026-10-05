import { beforeAll, describe, expect, it } from "vitest";
import { loadAccessContext } from "@/server/access/context";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { clearSetupCaches } from "@/server/db/setup-store";
import * as admin from "@/server/modules/admin/service";
import { assertSetup, setupAccess, tierOf } from "@/server/modules/setup/access";
import { SETUP_CATALOGUE } from "@/server/modules/setup/catalogue";
import { buildConfiguration, exportConfiguration, importConfiguration, validateConfiguration } from "@/server/modules/setup/config";
import { approvalsPageData, decideDestructive, requestDestructive } from "@/server/modules/setup/destructive";
import { setupMaintenance } from "@/server/modules/setup/maintenance";
import * as setup from "@/server/modules/setup/service";
import { resetRateLimits } from "@/server/rate-limit";
import { SEED_PASSWORD } from "../../prisma/seed-data";
import { ctxFor, ids, unsafeDb, userId } from "./helpers";

/**
 * Setup (prompt 19): tiers, Brand Admin isolation, four-eyes, sharing rules, validation rules, configuration as
 * code, last Super Admin. The sample-data removal runs last – it empties the business tables of this file's database.
 */
let sa: AccessContext; // superadmin – Super Admin
let sa2: AccessContext; // admin – the second Super Admin
let adminOnly: AccessContext; // crmadmin – Administrator, not Super Admin
let ba: AccessContext; // ba.hmnl – Brand Admin of HMNL
let bm: AccessContext; // bm.hmnl – Brand Manager
let exec: AccessContext; // exec.hmnl.1 – Sales Exec
let id: Awaited<ReturnType<typeof ids>>;
const pw = { password: SEED_PASSWORD };

const reload = async (ctx: AccessContext) => (await loadAccessContext(ctx.userId))!;
/** A lead created by the Super Admin through the scoped client (owner = the Super Admin). */
const mkLead = (data: { lastName: string; mobile?: string | null; brandId: string; regionId: string }) => scopedDb(sa).lead.create({ data: { ownerId: sa.userId, ...data } });

beforeAll(async () => {
  [sa, sa2, adminOnly, ba, bm, exec] = (await Promise.all(["superadmin", "admin", "crmadmin", "ba.hmnl", "bm.hmnl", "exec.hmnl.1"].map(ctxFor))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
  id = await ids();
});

describe("admin tiers", () => {
  it("the seed has two Super Admins, an Administrator and a Brand Admin of HMNL", () => {
    expect([sa, sa2, adminOnly, ba, bm, exec].map(tierOf)).toEqual(["SA", "SA", "ADMIN", "BRAND_ADMIN", "USER", "USER"]);
    expect(ba.brandAdminOf).toEqual([id.brand("HMNL")]);
    expect(ba.isAdmin).toBe(false);
  });

  it("matrix: every Setup function × Super Admin / Administrator / Brand Admin / Brand Manager / Sales Exec → allowed or 404", () => {
    const expected = (e: (typeof SETUP_CATALOGUE)[number]) => {
      const everyone = e.tiers.includes("ALL");
      return { sa: true, admin: everyone || e.tiers.includes("ADMIN"), ba: everyone || e.brandAdminReady === true, other: everyone };
    };
    for (const e of SETUP_CATALOGUE) {
      const want = expected(e);
      const got = { sa: setupAccess(sa, e), admin: setupAccess(adminOnly, e), ba: setupAccess(ba, e), other: setupAccess(bm, e) && setupAccess(exec, e) };
      expect(got, e.key).toEqual(want);
      // "not allowed" is always the 404 error – Setup does not say that the function exists
      for (const [ctx, ok] of [[adminOnly, want.admin], [ba, want.ba], [bm, want.other], [exec, want.other]] as const) {
        if (ok) expect(() => assertSetup(ctx, e.key), e.key).not.toThrow();
        else expect(() => assertSetup(ctx, e.key), e.key).toThrow(/not found/i);
      }
    }
  });

  it("the services behind Super Admin pages refuse an Administrator", async () => {
    await expect(setup.readSettingFor(adminOnly, "passwordPolicy")).rejects.toThrow(/not found/i);
    await expect(setup.tiersPageData(adminOnly)).rejects.toThrow(/not found/i);
    await expect(setup.sampleDataCounts(adminOnly)).rejects.toThrow(/not found/i);
    await expect(exportConfiguration(adminOnly)).rejects.toThrow(/not found/i);
    await expect(approvalsPageData(adminOnly)).rejects.toThrow(/not found/i);
    await expect(setup.grantBrandAdmin(adminOnly, "exec.hmnl.1@stallioncrm.test", id.brand("HMNL"))).rejects.toThrow(/not found/i);
    await expect(admin.createBrand(adminOnly, { code: "NEWB", name: "New brand", status: "FUTURE", discountApprovalPct: "3", discountEscalationPct: "7" } as never)).rejects.toThrow(/Super Admin/);
    // …and work for a Super Admin
    expect((await setup.readSettingFor(sa, "passwordPolicy")).minLength).toBe(10);
  });

  it("the Super Admin flag cannot be changed from a user session – not even by an administrator's own database client", async () => {
    await expect(scopedDb(adminOnly).user.update({ where: { id: adminOnly.userId }, data: { isSuperAdmin: true }, select: { id: true } })).rejects.toThrow();
    expect((await reload(adminOnly)).isSuperAdmin).toBe(false);
  });

  it("a Super Admin needs the Administrator profile; at most three; appointing asks for the password", async () => {
    await expect(setup.grantSuperAdmin(sa, exec.userId, pw)).rejects.toThrow(/Administrator profile/);
    await expect(setup.grantSuperAdmin(sa, adminOnly.userId, { password: "wrong-password" })).rejects.toThrow(/Wrong password/);
    await setup.grantSuperAdmin(sa, adminOnly.userId, pw);
    expect((await reload(adminOnly)).isSuperAdmin).toBe(true);
    const extra = await admin.createUser(sa, { name: "Fourth Admin", email: "admin4@stallioncrm.test", roleId: (await unsafeDb.user.findUniqueOrThrow({ where: { id: sa.userId } })).roleId, profileId: sa.profile.id });
    await expect(setup.grantSuperAdmin(sa, extra.id, pw)).rejects.toThrow(/already 3 Super Admins/);
    await unsafeDb.user.update({ where: { id: adminOnly.userId }, data: { isSuperAdmin: false } });
  });
});

describe("Brand Admin: Setup for the own brand only", () => {
  it("sees and changes the HMNL team and thresholds; SNMNL does not exist for them", async () => {
    const hmnl = id.brand("HMNL");
    const snmnl = id.brand("SNMNL");
    expect((await setup.brandsInSetupScope(ba, "brand-members")).map((b) => b.code)).toEqual(["HMNL"]);
    const team = await setup.brandTeam(ba, hmnl);
    expect(team.length).toBeGreaterThan(1);
    await expect(setup.brandTeam(ba, snmnl)).rejects.toThrow(/not found/i);

    const hmnlLagos = team.find((t) => t.name === "HMNL – Lagos")!;
    const snmnlLagos = await unsafeDb.territory.findFirstOrThrow({ where: { brandId: snmnl, region: { name: "Lagos" } } });
    await setup.addBrandMember(ba, hmnlLagos.id, "exec.abuja@stallioncrm.test", false);
    expect(await unsafeDb.territoryMember.count({ where: { territoryId: hmnlLagos.id, userId: await userId("exec.abuja") } })).toBe(1);
    await setup.removeBrandMember(ba, hmnlLagos.id, await userId("exec.abuja"));
    await expect(setup.addBrandMember(ba, snmnlLagos.id, "exec.hmnl.1@stallioncrm.test", false)).rejects.toThrow(/not found/i);
    await expect(setup.removeBrandMember(ba, snmnlLagos.id, await userId("exec.snmnl.1"))).rejects.toThrow(/not found/i);
    expect(await unsafeDb.territoryMember.count({ where: { territoryId: snmnlLagos.id, userId: await userId("exec.snmnl.1") } })).toBe(1);

    await setup.saveBrandThresholds(ba, hmnl, { discountApprovalPct: "4", discountEscalationPct: "8" });
    expect(Number((await unsafeDb.brand.findUniqueOrThrow({ where: { id: hmnl } })).discountApprovalPct)).toBe(4);
    await expect(setup.saveBrandThresholds(ba, snmnl, { discountApprovalPct: "1", discountEscalationPct: "2" })).rejects.toThrow(/not found/i);
    await expect(setup.saveBrandThresholds(ba, hmnl, { discountApprovalPct: "9", discountEscalationPct: "2" })).rejects.toThrow();
    const entry = await unsafeDb.auditLog.findFirstOrThrow({ where: { entity: "Brand", entityId: hmnl, userId: ba.userId }, orderBy: { at: "desc" } });
    expect(entry.after).toMatchObject({ discountApprovalPct: 4 });
  });

  it("cannot open users, templates, pipelines, rules, security or organisation settings of anyone", async () => {
    for (const key of ["users", "profiles", "pipelines", "workflow-rules", "templates", "validation-rules", "data-sharing", "password-policy", "company-details", "audit-log", "recycle-bin", "admin-tiers"]) {
      expect(() => assertSetup(ba, key), key).toThrow(/not found/i);
    }
    await expect(admin.setUserTerritories(ba, exec.userId, [])).rejects.toThrow(/not found/i);
    await expect(setup.listValidationRules(ba)).rejects.toThrow(/not found/i);
    await expect(setup.massTransfer(ba, { module: "leads", fromUserId: exec.userId, toUserId: ba.userId })).rejects.toThrow(/not found/i);
    // the Brand Manager and the Sales Exec have no Setup beyond their personal settings
    await expect(setup.brandTeam(bm, id.brand("HMNL"))).rejects.toThrow(/not found/i);
    await expect(setup.saveBrandThresholds(exec, id.brand("HMNL"), { discountApprovalPct: "1", discountEscalationPct: "2" })).rejects.toThrow(/not found/i);
  });

  it("a Brand Admin can only be appointed for a brand they work in, by a Super Admin", async () => {
    await expect(setup.grantBrandAdmin(sa, "exec.snmnl.1@stallioncrm.test", id.brand("HMNL"))).rejects.toThrow(/does not work in HMNL/);
    await setup.grantBrandAdmin(sa, "exec.snmnl.1@stallioncrm.test", id.brand("SNMNL"));
    const other = await ctxFor("exec.snmnl.1");
    expect(other.brandAdminOf).toEqual([id.brand("SNMNL")]);
    await expect(setup.brandTeam(other, id.brand("HMNL"))).rejects.toThrow(/not found/i);
    await setup.revokeBrandAdmin(sa, other.userId, id.brand("SNMNL"));
    expect((await ctxFor("exec.snmnl.1")).brandAdminOf).toEqual([]);
  });
});

describe("setup permissions of a profile", () => {
  it("open the ticked delegable functions – and nothing else", async () => {
    const finance = await unsafeDb.profile.findUniqueOrThrow({ where: { name: "Inventory Finance" } });
    await setup.setProfileSetupSections(sa, finance.id, ["currencies", "password-policy", "users"]);
    const acct = await ctxFor("acct.hmnl");
    expect(acct.setupSections).toEqual(["currencies"]); // the security and user functions were dropped
    await setup.saveSetting(acct, "currencies", { home: "NGN", rates: { USD: 1550 }, rounding: 2 });
    expect((await setup.getSetting("currencies")).rates).toEqual({ USD: 1550 });
    await expect(setup.readSettingFor(acct, "fiscalYear")).rejects.toThrow(/not found/i);
    await expect(setup.readSettingFor(acct, "company")).rejects.toThrow(/not found/i);
    await setup.setProfileSetupSections(sa, finance.id, []);
  });
});

describe("four eyes for destructive operations", () => {
  it("authentication policies cannot be saved directly", async () => {
    await expect(setup.saveSetting(sa, "passwordPolicy", { ...(await setup.getSetting("passwordPolicy")), minLength: 14 })).rejects.toThrow(/second Super Admin/);
    expect((await setup.getSetting("passwordPolicy")).minLength).toBe(10);
  });

  it("request needs re-authentication; the requester cannot approve; a second Super Admin's approval carries it out; the audit names both", async () => {
    resetRateLimits();
    const value = { ...(await setup.getSetting("passwordPolicy")), minLength: 14, requireDigit: true, history: 1 };
    await expect(requestDestructive(adminOnly, "security.policy", { key: "passwordPolicy", value }, pw)).rejects.toThrow(/not found/i);
    await expect(requestDestructive(sa, "security.policy", { key: "passwordPolicy", value }, { password: "not-my-password" })).rejects.toThrow(/Wrong password/);
    const request = await requestDestructive(sa, "security.policy", { key: "passwordPolicy", value }, pw);
    expect(request.status).toBe("PENDING");
    expect((await setup.getSetting("passwordPolicy")).minLength).toBe(10); // nothing changed yet

    await expect(decideDestructive(sa, request.id, "APPROVED", pw)).rejects.toThrow(/second Super Admin must decide/);
    await expect(decideDestructive(adminOnly, request.id, "APPROVED", pw)).rejects.toThrow(/not found/i);
    await expect(decideDestructive(sa2, request.id, "APPROVED", { password: "wrong" })).rejects.toThrow(/Wrong password/);
    await decideDestructive(sa2, request.id, "APPROVED", pw);
    clearSetupCaches();
    expect(await setup.getSetting("passwordPolicy")).toMatchObject({ minLength: 14, requireDigit: true, history: 1 });
    await expect(decideDestructive(sa2, request.id, "APPROVED", pw)).rejects.toThrow(/no longer waiting/);

    const entry = await unsafeDb.auditLog.findFirstOrThrow({ where: { entity: "SetupApproval", entityId: request.id, action: "UPDATE" } });
    expect(entry.userId).toBe(sa2.userId);
    expect(entry.after).toMatchObject({ status: "APPROVED", requestedById: sa.userId, approvedById: sa2.userId });
    expect(await unsafeDb.auditLog.count({ where: { entity: "SetupApproval", entityId: request.id, action: "CREATE", userId: sa.userId } })).toBe(1);
    expect(await unsafeDb.auditLog.count({ where: { entity: "OrgSetting", entityId: "passwordPolicy" } })).toBe(1);
  });

  it("the approved password policy is enforced: complexity and no reuse of the last password", async () => {
    const roleId = (await unsafeDb.user.findUniqueOrThrow({ where: { id: exec.userId } })).roleId;
    const input = { name: "Policy Test", email: "policy.test@stallioncrm.test", roleId, profileId: exec.profile.id };
    await expect(admin.createUser(sa, { ...input, password: "onlyletters-long" })).rejects.toThrow(/digit/);
    await expect(admin.createUser(sa, { ...input, password: "Short1!abcd" })).rejects.toThrow(/14 characters/);
    const user = await admin.createUser(sa, { ...input, password: "First-Password-2026" });
    await expect(admin.setUserPassword(sa, user.id, "First-Password-2026")).rejects.toThrow(/used before/);
    await admin.setUserPassword(sa, user.id, "Second-Password-2026");
    await expect(admin.setUserPassword(sa, user.id, "First-Password-2026")).rejects.toThrow(/used before/); // still in the history (1)
    await admin.setUserPassword(sa, user.id, "Third-Password-2026");
    await admin.setUserPassword(sa, user.id, "First-Password-2026"); // two changes later it may be used again
  });

  it("a rejected request changes nothing; a request with one Super Admin left is refused", async () => {
    const request = await requestDestructive(sa, "security.policy", { key: "sessionPolicy", value: { maxHours: 2 } }, pw);
    await decideDestructive(sa2, request.id, "REJECTED", pw);
    clearSetupCaches();
    expect((await setup.getSetting("sessionPolicy")).maxHours).toBe(12);
    await unsafeDb.user.update({ where: { id: sa2.userId }, data: { active: false } });
    await expect(requestDestructive(sa, "security.policy", { key: "sessionPolicy", value: { maxHours: 2 } }, pw)).rejects.toThrow(/only Super Admin/);
    await unsafeDb.user.update({ where: { id: sa2.userId }, data: { active: true } });
  });

  it("recycle bin: an administrator restores; purging for good is a Super Admin four-eyes operation", async () => {
    const mk = (lastName: string) => mkLead({ lastName, mobile: "+2348030000000", brandId: id.brand("HMNL"), regionId: id.region("Lagos") });
    const [a, b] = [await mk("Recycle One"), await mk("Recycle Two")];
    await unsafeDb.lead.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { deletedAt: new Date() } });
    const bin = await setup.recycleBin(adminOnly, "Lead");
    expect(bin.rows.map((r) => r.title)).toEqual(expect.arrayContaining(["Recycle One", "Recycle Two"]));
    await expect(setup.recycleBin(bm)).rejects.toThrow(/not found/i);

    expect(await setup.restoreFromRecycleBin(adminOnly, "Lead", [a.id])).toBe(1);
    expect(await scopedDb(sa).lead.findUnique({ where: { id: a.id } })).not.toBeNull();

    await expect(requestDestructive(adminOnly, "recycle.purge", { model: "Lead", ids: [b.id] }, pw)).rejects.toThrow(/not found/i);
    const request = await requestDestructive(sa, "recycle.purge", { model: "Lead", ids: [b.id] }, pw);
    expect(await unsafeDb.lead.count({ where: { id: b.id } })).toBe(1);
    const done = await decideDestructive(sa2, request.id, "APPROVED", pw);
    expect(done.result).toMatchObject({ purged: 1 });
    expect(await unsafeDb.lead.count({ where: { id: b.id } })).toBe(0);
    expect(await unsafeDb.lead.count({ where: { id: a.id } })).toBe(1);
  });

  it("recycle-bin retention purges old deleted records with the scheduler, never fresh ones", async () => {
    const mk = (lastName: string) => mkLead({ lastName, mobile: "+2348030000001", brandId: id.brand("HMNL"), regionId: id.region("Lagos") });
    const [old, fresh] = [await mk("Old Deleted"), await mk("Fresh Deleted")];
    await unsafeDb.lead.update({ where: { id: old.id }, data: { deletedAt: new Date(Date.now() - 40 * 86_400_000) } });
    await unsafeDb.lead.update({ where: { id: fresh.id }, data: { deletedAt: new Date() } });
    expect(await setupMaintenance()).toBe(0); // retention is off by default
    await setup.saveSetting(adminOnly, "recycleBin", { purgeAfterDays: 30 });
    expect(await setupMaintenance()).toBe(1);
    expect(await unsafeDb.lead.count({ where: { id: { in: [old.id, fresh.id] } } })).toBe(1);
    await setup.saveSetting(adminOnly, "recycleBin", { purgeAfterDays: 0 });
  });

  it("mass transfer needs an eligible new owner; mass delete is previewed, approved by two, and lands in the recycle bin", async () => {
    const from = await ctxFor("exec.hmnl.1");
    const to = await ctxFor("exec.hmnl.2");
    const outsider = await ctxFor("exec.snmnl.1");
    const owned = await unsafeDb.lead.count({ where: { ownerId: from.userId, deletedAt: null } });
    expect(owned).toBeGreaterThan(0);
    await expect(setup.massTransfer(adminOnly, { module: "leads", fromUserId: from.userId, toUserId: outsider.userId })).rejects.toThrow(/cannot own/);
    expect(await setup.massTransfer(adminOnly, { module: "leads", fromUserId: from.userId, toUserId: to.userId })).toBe(owned);
    expect(await unsafeDb.lead.count({ where: { ownerId: from.userId, deletedAt: null } })).toBe(0);

    await expect(setup.previewMassDelete(adminOnly, { module: "leads", ownerId: to.userId })).rejects.toThrow(/not found/i);
    expect(() => setup.massCriteria({ module: "leads" })).toThrow(/at least one criterion/);
    const matching = await setup.previewMassDelete(sa, { module: "leads", ownerId: to.userId });
    const request = await requestDestructive(sa, "data.massDelete", { module: "leads", ownerId: to.userId }, pw);
    expect(request.summary).toContain(String(matching));
    const done = await decideDestructive(sa2, request.id, "APPROVED", pw);
    expect(done.result).toEqual({ deleted: matching });
    expect(await unsafeDb.lead.count({ where: { ownerId: to.userId, deletedAt: null } })).toBe(0);
    expect(await unsafeDb.lead.count({ where: { ownerId: to.userId, deletedAt: { not: null } } })).toBeGreaterThanOrEqual(matching);
  });
});

describe("data sharing rules", () => {
  it("a rule that would cross brands is rejected with an explanation; one inside a brand is previewed and stored", async () => {
    const hmnlLagos = await unsafeDb.territory.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), region: { name: "Lagos" } } });
    const snmnlLagos = await unsafeDb.territory.findFirstOrThrow({ where: { brandId: id.brand("SNMNL"), region: { name: "Lagos" } } });
    const hmnlAbuja = await unsafeDb.territory.findFirstOrThrow({ where: { brandId: id.brand("HMNL"), region: { name: "Abuja" } } });
    const cross = { name: "HMNL deals to Nissan Lagos", module: "deals", sourceTerritoryId: hmnlLagos.id, targetType: "TERRITORY" as const, targetId: snmnlLagos.id, access: "READ" as const };
    const impact = await setup.previewSharingRule(adminOnly, cross);
    expect(impact.records).toBeGreaterThan(0);
    expect(impact.crossBrandUsers.length).toBeGreaterThan(0);
    expect(impact.blocked).toMatch(/never carry one brand's records to another brand's staff/);
    await expect(setup.createSharingRule(adminOnly, cross)).rejects.toThrow(/Refused: .* do not work in the brand of HMNL – Lagos/);
    await expect(setup.createSharingRule(sa, cross)).rejects.toThrow(/Refused/); // no override for a Super Admin either
    expect(await unsafeDb.sharingRule.count()).toBe(0);

    const within = { ...cross, name: "HMNL Lagos deals to HMNL Abuja", targetId: hmnlAbuja.id };
    const ok = await setup.previewSharingRule(adminOnly, within);
    expect(ok.blocked).toBeNull();
    expect(ok.summary).toMatch(/would expose \d+ deals of HMNL – Lagos to \d+ user\(s\), read-only/);
    const rule = await setup.createSharingRule(adminOnly, within);
    expect(await unsafeDb.auditLog.count({ where: { entity: "SharingRule", entityId: rule.id } })).toBe(1);
    await setup.deleteSharingRule(adminOnly, rule.id);
  });
});

describe("validation rules", () => {
  it("refuse a save through the scoped client, per brand, with the rule's message; the preview counts existing records", async () => {
    await expect(setup.saveValidationRule(adminOnly, null, { module: "leads", brandId: null, name: "Bad", expression: "nosuchfield > 1", message: "never", active: true })).rejects.toThrow(/Unknown field/);
    await expect(setup.saveValidationRule(adminOnly, null, { module: "products", brandId: null, name: "Bad", expression: "1 == 1", message: "never", active: true })).rejects.toThrow(/not available/);

    const input = { module: "leads", brandId: id.brand("HMNL"), name: "No placeholder names", expression: 'lower(lastName) == "unknown" || (isBlank(mobile) && isBlank(email))', message: "Enter the real surname and a phone number or e-mail", active: true };
    expect((await setup.previewValidationRule(adminOnly, input)).failing).toBe(0);
    const rule = await setup.saveValidationRule(adminOnly, null, input);

    const hmnl = { brandId: id.brand("HMNL"), regionId: id.region("Lagos") };
    await expect(mkLead({ lastName: "Unknown", mobile: "+2348031111111", ...hmnl })).rejects.toThrow("Enter the real surname and a phone number or e-mail");
    await expect(mkLead({ lastName: "Adeyemi", ...hmnl })).rejects.toThrow(/real surname/);
    const lead = await mkLead({ lastName: "Adeyemi", mobile: "+2348031111111", ...hmnl });
    // an update is checked against the record as it would be saved
    await expect(scopedDb(sa).lead.update({ where: { id: lead.id }, data: { mobile: null } })).rejects.toThrow(/real surname/);
    await scopedDb(sa).lead.update({ where: { id: lead.id }, data: { mobile: null, email: "a@example.test" } });
    // the rule belongs to HMNL: another brand is not affected
    await mkLead({ lastName: "Unknown", mobile: "+2348032222222", brandId: id.brand("SNMNL"), regionId: id.region("Lagos") });

    await setup.saveValidationRule(adminOnly, rule.id, { ...input, active: false });
    await mkLead({ lastName: "Unknown", mobile: "+2348033333333", ...hmnl });
    expect((await setup.previewValidationRule(adminOnly, input)).failing).toBe(1);
    await setup.deleteValidationRule(adminOnly, rule.id);
  });
});

describe("configuration as code", () => {
  it("export → change the configuration → import the export → the configuration is identical again", async () => {
    const snapshot = await exportConfiguration(sa);
    expect(snapshot.version).toBe(1);
    expect(snapshot.profiles.length).toBeGreaterThan(5);
    expect(snapshot.pipelines.every((p) => p.stages.length > 0)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/passwordHash|totpSecret/);
    expect(await buildConfiguration()).toEqual(snapshot); // deterministic

    // drift: settings, a profile's permissions, a role's parent, a validation rule, a stage, a custom field
    await setup.saveSetting(sa, "fiscalYear", { startMonth: 4 });
    const exe = await unsafeDb.profile.findUniqueOrThrow({ where: { name: "Sales Exec" } });
    await unsafeDb.profile.update({ where: { id: exe.id }, data: { permissions: { leads: { read: true, delete: true } }, setupSections: ["currencies"] } });
    await unsafeDb.role.updateMany({ where: { name: "Regional Sales Exec" }, data: { parentRoleId: null } });
    await setup.saveValidationRule(sa, null, { module: "deals", brandId: id.brand("HMNL"), name: "Drift", expression: "amount < 0", message: "No negative amounts", active: true });
    const stage = await unsafeDb.pipelineStage.findFirstOrThrow({ where: { key: "QUOTATION" } });
    await unsafeDb.pipelineStage.update({ where: { id: stage.id }, data: { probability: 99, name: "Changed" } });
    await unsafeDb.customField.create({ data: { module: "leads", apiName: "driftField", label: "Drift", type: "TEXT" } });
    expect(await buildConfiguration()).not.toEqual(snapshot);

    // the drifted custom field is not in the snapshot: an import adds and updates, it does not delete fields
    const applied = await importConfiguration(sa, JSON.parse(JSON.stringify(snapshot)));
    expect(applied.profiles).toBe(snapshot.profiles.length);
    const after = await buildConfiguration();
    expect({ ...after, customFields: after.customFields.filter((f) => f.apiName !== "driftField") }).toEqual(snapshot);
    expect((await setup.getSetting("fiscalYear")).startMonth).toBe(1);
    expect(await unsafeDb.auditLog.count({ where: { entity: "Configuration", action: "IMPORT", userId: sa.userId } })).toBe(1);
  });

  it("validates references before applying: an unknown brand, a broken formula or a lock-out document changes nothing", async () => {
    const snapshot = await buildConfiguration();
    const bad = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    bad.validationRules.push({ module: "deals", brand: "NOPE", name: "Ghost brand", expression: "amount >", message: "x", active: true });
    bad.pipelines[0]!.brand = "NOPE";
    bad.settings.fiscalYear = { startMonth: 13 };
    bad.profiles = bad.profiles.map((p) => ({ ...p, permissions: { ...p.permissions, admin: {} }, setupSections: p.name === "Sales Exec" ? ["password-policy"] : [] }));
    const { problems } = await validateConfiguration(bad);
    expect(problems.join("\n")).toMatch(/brand NOPE does not exist/);
    expect(problems.join("\n")).toMatch(/validationRules\.Ghost brand: .*(ends too early|Unexpected)/);
    expect(problems.join("\n")).toMatch(/settings\.fiscalYear/);
    expect(problems.join("\n")).toMatch(/lock everyone out/);
    expect(problems.join("\n")).toMatch(/not a setup permission that can be delegated/);
    await expect(importConfiguration(sa, bad)).rejects.toThrow(/was not imported/);
    expect(await buildConfiguration()).toEqual(snapshot);
    await expect(importConfiguration(sa, { version: 99 })).rejects.toThrow(/was not imported/);
    // an import cannot be used to get around the four-eyes rule for authentication policies
    const weaker = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    weaker.settings.passwordPolicy = { minLength: 8 };
    await expect(importConfiguration(sa, weaker)).rejects.toThrow(/would change "Password policy".*second Super Admin/);
    expect((await setup.getSetting("passwordPolicy")).minLength).toBe(14);
    await expect(importConfiguration(adminOnly, snapshot)).rejects.toThrow(/not found/i);
  });
});

describe("sessions and audit trail", () => {
  it("sign out everywhere stamps the user; one-click revert restores an ordinary setting but not a security policy", async () => {
    await expect(setup.signOutEverywhere(adminOnly, exec.userId)).rejects.toThrow(/not found/i);
    await setup.signOutEverywhere(sa, exec.userId);
    expect((await reload(exec)).sessionsValidAfter).toBeInstanceOf(Date);

    await setup.saveSetting(adminOnly, "fiscalYear", { startMonth: 7 });
    await setup.saveSetting(adminOnly, "fiscalYear", { startMonth: 10 });
    const change = await unsafeDb.auditLog.findFirstOrThrow({ where: { entity: "OrgSetting", entityId: "fiscalYear", action: "UPDATE" }, orderBy: { at: "desc" } });
    expect(setup.diffSnapshots(change.before, change.after)).toEqual([{ field: "startMonth", before: "7", after: "10" }]);
    await setup.revertSetting(adminOnly, change.id);
    expect((await setup.getSetting("fiscalYear")).startMonth).toBe(7);
    const policy = await unsafeDb.auditLog.findFirstOrThrow({ where: { entity: "OrgSetting", entityId: "passwordPolicy" } });
    await expect(setup.revertSetting(sa, policy.id)).rejects.toThrow();
    const trail = await setup.setupAuditTrail(adminOnly, { page: 1, entity: "OrgSetting" });
    expect(trail.rows.every((r) => r.entity === "OrgSetting")).toBe(true);
    await expect(setup.setupAuditTrail(ba, { page: 1 })).rejects.toThrow(/not found/i);
  });

  it("system health is readable by an administrator, not by a brand manager", async () => {
    const h = await setup.systemHealth(adminOnly);
    expect(h).toHaveProperty("jobs");
    await expect(setup.systemHealth(bm)).rejects.toThrow(/not found/i);
  });
});

describe("the last Super Admin", () => {
  it("cannot be revoked, deactivated or demoted – service and database agree", async () => {
    // with two Super Admins a revoke can be requested; with one it cannot
    const request = await requestDestructive(sa, "admin.revokeSuperAdmin", { userId: sa2.userId }, pw);
    await unsafeDb.setupApproval.update({ where: { id: request.id }, data: { status: "CANCELLED" } });
    await unsafeDb.user.update({ where: { id: sa2.userId }, data: { isSuperAdmin: false } });
    await expect(requestDestructive(sa, "admin.revokeSuperAdmin", { userId: sa.userId }, pw)).rejects.toThrow(/last Super Admin cannot be disabled or demoted/);
    await expect(admin.deactivateUser(await reload(sa2), sa.userId, { fourEyesApproved: true })).rejects.toThrow(/last Super Admin/);
    // the database refuses it even for the system client
    await expect(unsafeDb.user.update({ where: { id: sa.userId }, data: { isSuperAdmin: false } })).rejects.toThrow(/last Super Admin/);
    await expect(unsafeDb.user.update({ where: { id: sa.userId }, data: { active: false } })).rejects.toThrow(/last Super Admin/);
    expect((await reload(sa)).isSuperAdmin).toBe(true);
    await unsafeDb.user.update({ where: { id: sa2.userId }, data: { isSuperAdmin: true } });
  });

  it("disabling an administrator takes two Super Admins", async () => {
    await expect(admin.deactivateUser(sa, adminOnly.userId)).rejects.toThrow(/second Super Admin/);
    const request = await requestDestructive(sa, "admin.deactivate", { userId: adminOnly.userId }, pw);
    await decideDestructive(sa2, request.id, "APPROVED", pw);
    expect((await unsafeDb.user.findUniqueOrThrow({ where: { id: adminOnly.userId } })).active).toBe(false);
    await unsafeDb.user.update({ where: { id: adminOnly.userId }, data: { active: true } });
  });
});

describe("remove sample data", () => {
  it("after two Super Admins agreed, every business table is empty and the configuration is untouched", async () => {
    const config = async () => ({
      brands: await unsafeDb.brand.count(),
      territories: await unsafeDb.territory.count(),
      users: await unsafeDb.user.count(),
      members: await unsafeDb.territoryMember.count(),
      profiles: await unsafeDb.profile.count(),
      pipelines: await unsafeDb.pipeline.count(),
      stages: await unsafeDb.pipelineStage.count(),
      products: await unsafeDb.product.count(),
      priceBooks: await unsafeDb.priceBook.count(),
      templates: await unsafeDb.template.count(),
      workflowRules: await unsafeDb.workflowRule.count(),
      approvalProcesses: await unsafeDb.approvalProcess.count(),
      warehouses: await unsafeDb.warehouse.count(),
      brandAdmins: await unsafeDb.brandAdmin.count(),
    });
    const before = await config();
    const auditBefore = await unsafeDb.auditLog.count();
    expect((await setup.sampleDataCounts(sa)).length).toBeGreaterThan(10);
    await expect(requestDestructive(adminOnly, "data.removeSample", {}, pw)).rejects.toThrow(/not found/i);

    const request = await requestDestructive(sa, "data.removeSample", {}, pw);
    expect(await unsafeDb.deal.count()).toBeGreaterThan(0); // still there until the second Super Admin approves
    const done = await decideDestructive(sa2, request.id, "APPROVED", pw);
    expect((done.result as { removed: Record<string, number> }).removed.Deal).toBeGreaterThan(0);

    expect(await setup.sampleDataCounts(sa)).toEqual([]);
    for (const model of ["lead", "deal", "account", "contact", "quote", "invoice", "activity", "case", "vehicleUnit", "stockMovement", "journalEntry", "message"] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over delegates
      expect(await (unsafeDb as any)[model].count(), model).toBe(0);
    }
    expect(await config()).toEqual(before);
    expect(await unsafeDb.auditLog.count()).toBeGreaterThan(auditBefore); // the audit log is kept and records the removal
    // the application still works on the empty installation
    const lead = await mkLead({ lastName: "First Real Lead", mobile: "+2348034444444", brandId: id.brand("HMNL"), regionId: id.region("Lagos") });
    expect(lead.id).toBeTruthy();
  });
});
