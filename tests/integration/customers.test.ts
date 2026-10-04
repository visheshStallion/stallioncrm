import { beforeAll, describe, expect, it } from "vitest";
import { brandOwnedModelsWith } from "@/server/access/brand-owned";
import { ForbiddenError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { accountBrands, accountDeals, contactConsents, findAccountMatches, getAccount, getContact, listAccounts } from "@/server/modules/customers/queries";
import * as svc from "@/server/modules/customers/service";
import { convertLead, createLead } from "@/server/modules/leads/service";
import { ctxFor, ids, rawAsUser, unsafeDb, userId } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let lagosHmnl: AccessContext;
let admin: AccessContext;
/** A customer that has both an HMNL-Lagos deal and SNMNL deals. */
let shared: { id: string; name: string; phone: string | null; email: string | null };
/** A customer with NO HMNL-Lagos deal. */
let unlinked: { id: string; phone: string | null };

beforeAll(async () => {
  I = await ids();
  [lagosHmnl, admin] = await Promise.all([ctxFor("exec.hmnl.1"), ctxFor("admin")]);
  const hmnlLagos = await unsafeDb.deal.findMany({ where: { brandId: I.brand("HMNL"), regionId: I.region("Lagos") }, select: { accountId: true } });
  const linkedIds = hmnlLagos.map((d) => d.accountId!);
  shared = await unsafeDb.account.findFirstOrThrow({ where: { id: { in: linkedIds }, deals: { some: { brandId: I.brand("SNMNL") } } } });
  unlinked = await unsafeDb.account.findFirstOrThrow({ where: { id: { notIn: linkedIds }, ownerId: null } });
});

describe("field tiers (prompt 03)", () => {
  it("HMNL exec opens a customer who also has SNMNL deals → basic + contact tier, only HMNL deals, no SNMNL hint", async () => {
    const acc = await getAccount(lagosHmnl, shared.id);
    expect(acc.tier).toBe("CONTACT");
    expect(acc.phone).toBe(shared.phone);
    expect(acc.email).toBe(shared.email);
    expect(acc.creditLimit).toBeNull();
    expect(acc.rcNumber).toBeNull();
    expect(acc.kycStatus).toBeNull();

    const deals = await accountDeals(lagosHmnl, { accountId: shared.id });
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((d) => d.brandId === I.brand("HMNL") && d.regionId === I.region("Lagos"))).toBe(true);
    const all = await unsafeDb.deal.count({ where: { accountId: shared.id } });
    expect(all).toBeGreaterThan(deals.length); // other brands' deals exist but are invisible

    // "Brands this customer buys" shows only the viewer's brands
    expect(await accountBrands(lagosHmnl, shared.id)).toEqual([I.brand("HMNL")]);
    expect((await accountBrands(admin, shared.id)).length).toBeGreaterThan(1);
  });

  it("exec with no linked record sees only the masked basic tier", async () => {
    const acc = await getAccount(lagosHmnl, unlinked.id);
    expect(acc.tier).toBe("BASIC");
    expect(acc.phone).toMatch(/^\+234\*{4}\d{2}$/);
    expect(acc.phone).not.toBe(unlinked.phone);
    expect(acc.email).toBeNull();
    expect(acc.address).toBeNull();
    expect(acc.creditLimit).toBeNull();
    expect(acc.name).toBeTruthy();
    expect(await accountDeals(lagosHmnl, { accountId: unlinked.id })).toEqual([]);
    expect(await accountBrands(lagosHmnl, unlinked.id)).toEqual([]);
  });

  it("Brand Manager of a linked brand and Management see the sensitive tier", async () => {
    const bm = await getAccount(await ctxFor("bm.hmnl"), shared.id);
    expect(bm.tier).toBe("SENSITIVE");
    expect(bm.creditLimit).not.toBeNull();
    expect((await getAccount(await ctxFor("md"), unlinked.id)).tier).toBe("SENSITIVE");
  });

  it("searching a full phone number finds the customer for everyone, still masked", async () => {
    const { rows } = await listAccounts(lagosHmnl, { q: unlinked.phone! });
    expect(rows.map((r) => r.id)).toEqual([unlinked.id]);
    expect(rows[0]!.phone).not.toBe(unlinked.phone);
    expect(rows[0]!.tier).toBe("BASIC");
  });

  it("contacts follow their account's tier", async () => {
    const linkedContact = await unsafeDb.contact.findFirstOrThrow({ where: { accountId: shared.id } });
    const c1 = await getContact(lagosHmnl, linkedContact.id);
    expect(c1.tier).toBe("CONTACT");
    expect(c1.mobile).toBe(linkedContact.mobile);
    const other = await unsafeDb.contact.findFirstOrThrow({ where: { accountId: unlinked.id } });
    const c2 = await getContact(lagosHmnl, other.id);
    expect(c2.tier).toBe("BASIC");
    expect(c2.email).toBeNull();
    expect(c2.mobile).not.toBe(other.mobile);
  });
});

describe("writes respect the tier", () => {
  it("basic tier cannot change contact details; contact tier cannot change sensitive fields", async () => {
    await expect(svc.updateAccount(lagosHmnl, unlinked.id, { email: "x@example.test" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.updateAccount(lagosHmnl, shared.id, { creditLimit: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await svc.updateAccount(lagosHmnl, shared.id, { address: "2 New Road" });
    expect((await unsafeDb.account.findUniqueOrThrow({ where: { id: shared.id } })).address).toBe("2 New Road");
    expect(await unsafeDb.auditLog.count({ where: { entity: "Account", entityId: shared.id, action: "UPDATE" } })).toBe(1);
  });

  it("the creator owns a new account and sees its contact tier", async () => {
    const { id } = await svc.createAccount(lagosHmnl, { name: "New Walk-in Customer", phone: "08055550001", city: "Lagos", creditLimit: 999 });
    const acc = await getAccount(lagosHmnl, id);
    expect(acc.tier).toBe("CONTACT");
    expect(acc.phone).toBe("+2348055550001");
    // sensitive values are not accepted from a non-management creator
    expect((await unsafeDb.account.findUniqueOrThrow({ where: { id } })).creditLimit).toBeNull();
  });

  it("users cannot forge customer–brand links (trigger only)", async () => {
    await expect(
      rawAsUser(lagosHmnl, `INSERT INTO "CustomerBrandLink" ("accountId", "brandId") VALUES ('${unlinked.id}', '${I.brand("HMNL")}')`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("customer ↔ brand links", () => {
  it("every brand-owned model with accountId has the customer_link trigger", async () => {
    for (const model of brandOwnedModelsWith("accountId")) {
      const rows = await unsafeDb.$queryRaw<Array<{ tgname: string }>>`
        SELECT tgname FROM pg_trigger WHERE tgrelid = ${`"${model}"`}::regclass AND tgname = 'customer_link'`;
      expect(rows, `run SELECT app_track_customer_links('"${model}"') in a migration`).toHaveLength(1);
    }
  });

  it("linking a deal to a customer creates the link automatically", async () => {
    const zanl = await ctxFor("exec.zanl.1");
    const { id } = await svc.createAccount(zanl, { name: "Trigger Test Customer", phone: "08055550002" });
    expect(await accountBrands(admin, id)).toEqual([]);
    const { scopedDb } = await import("@/server/db/scoped");
    await scopedDb(zanl).deal.create({ data: { name: "Linked deal", brandId: I.brand("ZANL"), regionId: I.region("Lagos"), ownerId: zanl.userId, accountId: id } });
    expect(await accountBrands(admin, id)).toEqual([I.brand("ZANL")]);
  });
});

describe("consent per brand", () => {
  it("opting out of HMNL does not opt out of SNMNL", async () => {
    const contact = await unsafeDb.contact.findFirstOrThrow({ where: { accountId: shared.id } });
    const snmnl = await ctxFor("exec.snmnl.1");
    await svc.setBrandConsent(snmnl, contact.id, I.brand("SNMNL"), true);
    await svc.setBrandConsent(lagosHmnl, contact.id, I.brand("HMNL"), false);
    const all = await contactConsents(admin, contact.id);
    expect(all.find((c) => c.brandId === I.brand("SNMNL"))?.consent).toBe(true);
    expect(all.find((c) => c.brandId === I.brand("HMNL"))?.consent).toBe(false);
    // a user only sees and sets consent for their own brands
    expect((await contactConsents(lagosHmnl, contact.id)).map((c) => c.brandId)).toEqual([I.brand("HMNL")]);
    await expect(svc.setBrandConsent(lagosHmnl, contact.id, I.brand("SNMNL"), false)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("duplicates & merge", () => {
  it("lead conversion reuses an existing customer with the same mobile", async () => {
    const before = await unsafeDb.account.count();
    const contact = await unsafeDb.contact.findFirstOrThrow({ where: { accountId: shared.id } });
    const lead = await createLead(lagosHmnl, { lastName: "Returning", mobile: contact.mobile!, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), consentMarketing: true });
    const res = await convertLead(lagosHmnl, lead.id, { account: { mode: "new", type: "INDIVIDUAL" }, contact: { mode: "new" }, deal: { name: "Repeat purchase" } });
    expect(res.contactId).toBe(contact.id);
    expect(res.accountId).toBe(shared.id);
    expect(await unsafeDb.account.count()).toBe(before);
    // the lead's consent was recorded for its brand only
    const consents = await contactConsents(admin, contact.id);
    expect(consents.filter((c) => c.consent).map((c) => c.brandId)).toContain(I.brand("HMNL"));
  });

  it("match rules find likely duplicates (masked for the viewer)", async () => {
    const m = await findAccountMatches(lagosHmnl, { name: "Totally Different", phone: unlinked.phone });
    expect(m.map((x) => x.account.id)).toEqual([unlinked.id]);
    expect(m[0]!.reasons).toEqual(["phone"]);
    expect(m[0]!.account.phone).not.toBe(unlinked.phone);
  });

  it("merge is for Administrators / Management only", async () => {
    await expect(svc.mergeAccounts(lagosHmnl, shared.id, [unlinked.id])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.mergeAccounts(await ctxFor("bm.hmnl"), shared.id, [unlinked.id])).rejects.toBeInstanceOf(ForbiddenError);
    expect(svc.canMergeCustomers(await ctxFor("md"))).toBe(true);
  });

  it("merge moves all children of every brand, fills blanks, soft-deletes the duplicate and audits", async () => {
    const dup = await unsafeDb.account.create({ data: { name: "Acme Logistcs Ltd", city: "Lagos", phone: "+2348055550003", website: "https://dup.example.test" } });
    const dupContact = await unsafeDb.contact.create({ data: { accountId: dup.id, lastName: "DupContact" } });
    const owner = await userId("exec.thpl.1");
    const deal = await unsafeDb.deal.create({ data: { name: "Dup deal", brandId: I.brand("THPL"), regionId: I.region("Lagos"), ownerId: owner, accountId: dup.id } });
    const master = await unsafeDb.account.findFirstOrThrow({ where: { name: "Acme Logistics" } });
    const dealsBefore = await unsafeDb.deal.count({ where: { accountId: master.id } });

    const res = await svc.mergeAccounts(admin, master.id, [dup.id]);
    expect(res.moved).toMatchObject({ Deal: 1, Contact: 1 });
    expect((await unsafeDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).accountId).toBe(master.id);
    expect((await unsafeDb.contact.findUniqueOrThrow({ where: { id: dupContact.id } })).accountId).toBe(master.id);
    expect(await unsafeDb.deal.count({ where: { accountId: master.id } })).toBe(dealsBefore + 1);
    const merged = await unsafeDb.account.findUniqueOrThrow({ where: { id: dup.id } });
    expect(merged.deletedAt).not.toBeNull();
    expect(merged.mergedIntoId).toBe(master.id);
    expect((await unsafeDb.account.findUniqueOrThrow({ where: { id: master.id } })).website).toBe("https://dup.example.test");
    expect(await unsafeDb.customerBrandLink.count({ where: { accountId: dup.id } })).toBe(0);
    expect(await unsafeDb.customerBrandLink.count({ where: { accountId: master.id, brandId: I.brand("THPL") } })).toBe(1);
    expect(await unsafeDb.auditLog.count({ where: { entity: "Account", entityId: dup.id, action: "DELETE" } })).toBe(1);
    expect(await unsafeDb.auditLog.count({ where: { entity: "Account", entityId: master.id, action: "UPDATE" } })).toBeGreaterThan(0);
    // merged record is gone from lists and direct access
    await expect(getAccount(admin, dup.id)).rejects.toThrow();
  });
});

describe("export", () => {
  it("is restricted per profile and masked per tier", async () => {
    await expect(svc.exportAccounts(lagosHmnl)).rejects.toBeInstanceOf(ForbiddenError);
    const bm = await ctxFor("bm.snmnl");
    const csv = await svc.exportAccounts(bm);
    const line = csv.split("\r\n").find((l) => l.startsWith(unlinked.id));
    if (line && (await getAccount(bm, unlinked.id)).tier === "BASIC") expect(line).not.toContain(unlinked.phone!);
    expect(await unsafeDb.auditLog.count({ where: { action: "EXPORT", entity: "Account", userId: bm.userId } })).toBe(1);
  });
});
