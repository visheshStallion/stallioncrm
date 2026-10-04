import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { isVisible } from "@/server/access/visibility";
import { scopedDb } from "@/server/db/scoped";
import { intakeLead } from "@/server/modules/leads/intake";
import { findDuplicates, getLead, listLeads, searchLeads } from "@/server/modules/leads/queries";
import * as svc from "@/server/modules/leads/service";
import { createRule, updateRule } from "@/server/modules/leads/assignment-admin";
import { USERS } from "../../prisma/seed-data";
import { ctxFor, ids, rawAsUser, unsafeDb, userId } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let lagosHmnl: AccessContext;
let snmnlLead: { id: string; mobile: string | null };
let hmnlLagosLead: { id: string };

beforeAll(async () => {
  I = await ids();
  lagosHmnl = await ctxFor("exec.hmnl.1");
  snmnlLead = await unsafeDb.lead.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") }, select: { id: true, mobile: true } });
  hmnlLagosLead = await unsafeDb.lead.findFirstOrThrow({
    where: { brandId: I.brand("HMNL"), regionId: I.region("Lagos") },
    select: { id: true },
  });
});

const lagosRegion = () => I.region("Lagos");
const abujaRegion = () => I.region("Abuja");

describe("lead visibility per role (BUSINESS_CONTEXT §6)", () => {
  it.each(USERS.map((u) => u.key))("%s sees exactly the visibility rule", async (key) => {
    const ctx = await ctxFor(key);
    const all = await unsafeDb.lead.findMany({ where: { deletedAt: null } });
    const expected = all.filter((l) => isVisible(ctx, l)).map((l) => l.id).sort();
    const { rows } = await listLeads(ctx, {}, { take: 5000 });
    expect(rows.map((r) => r.id).sort()).toEqual(expected);
  });

  it("RLS on Lead filters raw SQL too", async () => {
    const rows = await rawAsUser<{ brandId: string; regionId: string }>(lagosHmnl, `SELECT "brandId", "regionId" FROM "Lead"`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.brandId === I.brand("HMNL") && r.regionId === lagosRegion())).toBe(true);
  });
});

describe("isolation rules (prompt 02)", () => {
  it("HMNL Lagos exec cannot open, list, search or export an SNMNL lead", async () => {
    await expect(getLead(lagosHmnl, snmnlLead.id)).rejects.toBeInstanceOf(NotFoundError);
    // A brand filter outside the user's access is dropped – it can only narrow, never widen.
    const { rows } = await listLeads(lagosHmnl, { brandId: I.brand("SNMNL") });
    expect(rows.every((r) => r.brandId === I.brand("HMNL"))).toBe(true);
    expect(rows.map((r) => r.id)).not.toContain(snmnlLead.id);
    const hits = await searchLeads(lagosHmnl, "SNMNL");
    expect(hits).toHaveLength(0);
    await expect(svc.exportLeads(lagosHmnl, {})).rejects.toBeInstanceOf(ForbiddenError); // no export permission
    const bm = await ctxFor("bm.hmnl");
    const csv = await svc.exportLeads(bm, {});
    expect(csv).not.toContain(snmnlLead.id);
    expect(await unsafeDb.auditLog.count({ where: { action: "EXPORT", entity: "Lead", userId: bm.userId } })).toBe(1);
  });

  it("changing owner to a user without access to the lead's brand-region is rejected", async () => {
    await expect(svc.changeLeadOwner(lagosHmnl, hmnlLagosLead.id, await userId("exec.snmnl.1"))).rejects.toThrow(/no access/);
    await expect(svc.changeLeadOwner(lagosHmnl, hmnlLagosLead.id, await userId("exec.abuja"))).rejects.toThrow(/no access/);
    // a Lagos HMNL colleague is fine
    await svc.changeLeadOwner(lagosHmnl, hmnlLagosLead.id, await userId("exec.hmnl.2"));
    expect((await unsafeDb.lead.findUniqueOrThrow({ where: { id: hmnlLagosLead.id } })).ownerId).toBe(await userId("exec.hmnl.2"));
  });

  it("mass actions need massUpdate and stay within one brand", async () => {
    await expect(svc.massChangeOwner(lagosHmnl, [hmnlLagosLead.id], lagosHmnl.userId)).rejects.toBeInstanceOf(ForbiddenError);
    const rsm = await ctxFor("rsm");
    const abujaLeads = await unsafeDb.lead.findMany({ where: { regionId: abujaRegion(), status: { not: "CONVERTED" } }, select: { id: true, brandId: true } });
    const twoBrands = [abujaLeads.find((l) => l.brandId === I.brand("HMNL"))!.id, abujaLeads.find((l) => l.brandId === I.brand("SMGL"))!.id];
    await expect(svc.massChangeOwner(rsm, twoBrands, await userId("exec.abuja"))).rejects.toThrow(/one brand/);
    const hmnlAbuja = abujaLeads.filter((l) => l.brandId === I.brand("HMNL")).map((l) => l.id);
    const res = await svc.massChangeOwner(rsm, hmnlAbuja, await userId("exec.abuja.2"));
    expect(res.count).toBe(hmnlAbuja.length);
    // owner without access to the brand-region is rejected for the whole batch
    await expect(svc.massChangeOwner(rsm, hmnlAbuja, await userId("exec.ph"))).rejects.toThrow(/no access/);
  });

  it("the HMNL web form can never create a lead for another brand, whatever the payload", async () => {
    const res = await intakeLead(
      "HMNL",
      { lastName: "Forger", mobile: "08099990001", region: "Abuja", brandId: I.brand("SNMNL"), brandCode: "SNMNL" },
      { source: "WEBSITE", ip: "1.2.3.4" },
    );
    expect(res.status).toBe("created");
    const lead = await unsafeDb.lead.findUniqueOrThrow({ where: { id: (res as { leadId: string }).leadId } });
    expect(lead.brandId).toBe(I.brand("HMNL"));
    expect(lead.source).toBe("WEBSITE");
    expect(lead.createdById).toBeNull();
    await expect(intakeLead("NOPE", { lastName: "X", mobile: "08099990002", region: "Abuja" }, { source: "WEBSITE", ip: null })).rejects.toThrow(/Unknown brand/);
    await expect(intakeLead("HMNL", { lastName: "X", mobile: "08099990003", region: "Atlantis" }, { source: "WEBSITE", ip: null })).rejects.toThrow(/Unknown region/);
    expect(await intakeLead("HMNL", { lastName: "Bot", mobile: "08099990004", region: "Abuja", website: "spam" }, { source: "WEBSITE", ip: null })).toEqual({ status: "ignored" });
  });
});

describe("assignment", () => {
  it("web leads round-robin among the Brand–Region members (managers excluded), pointer persisted", async () => {
    const owners: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await intakeLead("SMGL", { lastName: `RR ${i}`, email: `rr${i}@example.test`, region: "Abuja" }, { source: "WEBSITE", ip: null });
      owners.push((await unsafeDb.lead.findUniqueOrThrow({ where: { id: (res as { leadId: string }).leadId } })).ownerId);
    }
    const expected = [await userId("exec.abuja"), await userId("exec.abuja.2")].sort();
    expect([...new Set(owners)].sort()).toEqual(expected);
    expect(owners[0]).not.toBe(owners[1]);
    expect(owners[0]).toBe(owners[2]);
    expect(owners).not.toContain(await userId("rsm"));
  });

  it("specific-user rule wins when it matches; inactive users are skipped", async () => {
    const admin = await ctxFor("admin");
    const target = await userId("exec.thpl.2");
    const rule = await createRule(admin, {
      name: "THPL walk-ins to Bisi",
      brandId: I.brand("THPL"),
      source: "WALK_IN",
      action: "SPECIFIC_USER",
      userId: target,
    });
    await unsafeDb.assignmentRule.update({ where: { id: rule.id }, data: { position: 1 } });
    const thplExec = await ctxFor("exec.thpl.1");
    const a = await svc.createLead(thplExec, { lastName: "Walk", mobile: "08099990010", brandId: I.brand("THPL"), regionId: lagosRegion(), source: "WALK_IN" }, { autoAssign: true });
    expect(a.ownerId).toBe(target);

    await unsafeDb.user.update({ where: { id: target }, data: { active: false } });
    const b = await svc.createLead(thplExec, { lastName: "Walk2", mobile: "08099990011", brandId: I.brand("THPL"), regionId: lagosRegion(), source: "WALK_IN" }, { autoAssign: true });
    expect(b.ownerId).not.toBe(target);
    await unsafeDb.user.update({ where: { id: target }, data: { active: true } });
    await updateRule(admin, rule.id, { name: rule.name, active: false, action: "SPECIFIC_USER", userId: target });
  });
});

describe("create, duplicates, conversion", () => {
  it("brand is required and model must be of the same brand", async () => {
    await expect(svc.createLead(lagosHmnl, { lastName: "X", mobile: "08099990020", brandId: "", regionId: lagosRegion() })).rejects.toThrow();
    const snmnlModel = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await expect(
      svc.createLead(lagosHmnl, { lastName: "X", mobile: "08099990021", brandId: I.brand("HMNL"), regionId: lagosRegion(), modelOfInterestId: snmnlModel.id }),
    ).rejects.toThrow(/same brand|lead's brand/);
    await expect(svc.createLead(lagosHmnl, { lastName: "X", mobile: "08099990022", brandId: I.brand("SNMNL"), regionId: lagosRegion() })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("duplicate check warns within the brand and only informs across brands", async () => {
    const mine = await unsafeDb.lead.findFirstOrThrow({ where: { brandId: I.brand("HMNL"), regionId: lagosRegion() } });
    const same = await findDuplicates(lagosHmnl, { brandId: I.brand("HMNL"), mobile: mine.mobile, email: null });
    expect(same.sameBrand.map((d) => d.id)).toContain(mine.id);

    const other = await findDuplicates(lagosHmnl, { brandId: I.brand("HMNL"), mobile: snmnlLead.mobile, email: null });
    expect(other.sameBrand).toHaveLength(0);
    expect(other.existsElsewhere).toBe(true);
    expect(JSON.stringify(other)).not.toContain(snmnlLead.id);
  });

  it("conversion creates account, contact and a deal with brand/region/model/owner copied", async () => {
    const model = await unsafeDb.product.findFirstOrThrow({ where: { brandId: I.brand("HMNL") } });
    const created = await svc.createLead(lagosHmnl, {
      firstName: "Conv",
      lastName: "Ert",
      mobile: "08099990040",
      brandId: I.brand("HMNL"),
      regionId: lagosRegion(),
      modelOfInterestId: model.id,
    });
    const lead = await unsafeDb.lead.findUniqueOrThrow({ where: { id: created.id } });
    const res = await svc.convertLead(lagosHmnl, lead.id, {
      account: { mode: "new", type: "INDIVIDUAL" },
      contact: { mode: "new" },
      deal: { name: "Converted deal", amount: 25_000_000 },
    });
    const deal = await scopedDb(lagosHmnl).deal.findUniqueOrThrow({ where: { id: res.dealId } });
    expect(deal).toMatchObject({ brandId: lead.brandId, regionId: lead.regionId, ownerId: lead.ownerId, modelId: lead.modelOfInterestId, accountId: res.accountId, contactId: res.contactId });
    const after = await unsafeDb.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "CONVERTED", convertedDealId: res.dealId, convertedContactId: res.contactId });
    await expect(svc.convertLead(lagosHmnl, lead.id, { account: { mode: "new", type: "INDIVIDUAL" }, contact: { mode: "new" }, deal: { name: "again" } })).rejects.toThrow(/already converted/);
    await expect(svc.updateLead(lagosHmnl, lead.id, { city: "Ikeja" })).rejects.toThrow(/read-only/);
  });

  it("management can read but not create or convert", async () => {
    const md = await ctxFor("md");
    expect((await listLeads(md, {}, { take: 5000 })).total).toBe(await unsafeDb.lead.count({ where: { deletedAt: null } }));
    await expect(svc.createLead(md, { lastName: "X", mobile: "08099990030", brandId: I.brand("HMNL"), regionId: lagosRegion() })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
