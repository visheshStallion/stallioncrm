import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { isVisible } from "@/server/access/visibility";
import { scopedDb } from "@/server/db/scoped";
import { USERS } from "../../prisma/seed-data";
import { ctxFor, ids, unsafeDb } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let lagosHmnl: AccessContext;
let abuja: AccessContext;
let bmHmnl: AccessContext;
let md: AccessContext;
const createdDealIds: string[] = [];

beforeAll(async () => {
  I = await ids();
  [lagosHmnl, abuja, bmHmnl, md] = await Promise.all([
    ctxFor("exec.hmnl.1"),
    ctxFor("exec.abuja"),
    ctxFor("bm.hmnl"),
    ctxFor("md"),
  ]);
});

afterAll(async () => {
  await unsafeDb.auditLog.deleteMany({ where: { entityId: { in: createdDealIds } } });
  await unsafeDb.deal.deleteMany({ where: { id: { in: createdDealIds } } });
});

const cells = (deals: Array<{ brandId: string; regionId: string }>) =>
  [...new Set(deals.map((d) => `${I.brandCode(d.brandId)}|${I.regionName(d.regionId)}`))].sort();

describe("scopedDb – required isolation assertions (prompt 00 §8)", () => {
  it("HMNL Lagos exec gets only HMNL-Lagos deals", async () => {
    const deals = await scopedDb(lagosHmnl).deal.findMany();
    expect(deals).toHaveLength(5);
    expect(cells(deals)).toEqual(["HMNL|Lagos"]);
  });

  it("Abuja exec gets all brands, Abuja only", async () => {
    const deals = await scopedDb(abuja).deal.findMany();
    expect(deals).toHaveLength(25);
    expect(cells(deals)).toEqual(["HMNL|Abuja", "SMGL|Abuja", "SNMNL|Abuja", "THPL|Abuja", "ZANL|Abuja"]);
  });

  it("Brand Manager HMNL gets all HMNL regions", async () => {
    const deals = await scopedDb(bmHmnl).deal.findMany();
    expect(deals).toHaveLength(20);
    expect(cells(deals)).toEqual(["HMNL|Abuja", "HMNL|Ibadan", "HMNL|Lagos", "HMNL|Port Harcourt"]);
  });

  it("MD gets all deals", async () => {
    expect(await scopedDb(md).deal.count()).toBe(100);
  });
});

describe("scopedDb – matches the visibility rule for every seeded user", () => {
  it.each(USERS.map((u) => u.key))("%s", async (key) => {
    const ctx = await ctxFor(key);
    const all = await unsafeDb.deal.findMany({ where: { deletedAt: null } });
    const expected = all.filter((d) => isVisible(ctx, d)).map((d) => d.id).sort();
    const actual = (await scopedDb(ctx).deal.findMany({ select: { id: true } })).map((d) => d.id).sort();
    expect(actual).toEqual(expected);
  });
});

describe("scopedDb – every read path is scoped", () => {
  it("findUnique / findFirst on a hidden record → null; *OrThrow → throws", async () => {
    const hidden = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    const db = scopedDb(lagosHmnl);
    expect(await db.deal.findUnique({ where: { id: hidden.id } })).toBeNull();
    expect(await db.deal.findFirst({ where: { id: hidden.id } })).toBeNull();
    await expect(db.deal.findUniqueOrThrow({ where: { id: hidden.id } })).rejects.toThrow();
  });

  it("count / aggregate / groupBy", async () => {
    const db = scopedDb(lagosHmnl);
    expect(await db.deal.count({ where: { brandId: I.brand("SNMNL") } })).toBe(0);
    const agg = await db.deal.aggregate({ _count: { _all: true } });
    expect(agg._count._all).toBe(5);
    const groups = await db.deal.groupBy({ by: ["brandId"], _count: { _all: true } });
    expect(groups.map((g) => I.brandCode(g.brandId))).toEqual(["HMNL"]);
  });

  it("list relations via include / select / _count are scoped", async () => {
    const db = scopedDb(lagosHmnl);
    // exec.multi.1 owns HMNL-Lagos and SNMNL-Lagos deals; the HMNL exec must see only the HMNL ones.
    const multi = await db.user.findFirstOrThrow({
      where: { email: { startsWith: "exec.multi.1@" } },
      include: { ownedDeals: true, _count: { select: { ownedDeals: true } } },
    });
    const allOwned = await unsafeDb.deal.count({ where: { ownerId: multi.id } });
    expect(allOwned).toBeGreaterThan(multi.ownedDeals.length);
    expect(cells(multi.ownedDeals)).toEqual(["HMNL|Lagos"]);
    expect(multi._count.ownedDeals).toBe(multi.ownedDeals.length);

    const brand = await db.brand.findFirstOrThrow({
      where: { code: "SNMNL" },
      select: { code: true, deals: { select: { id: true } } },
    });
    expect(brand.deals).toHaveLength(0);
  });

  it("relation filters cannot probe hidden records", async () => {
    const db = scopedDb(lagosHmnl);
    const brands = await db.brand.findMany({ where: { deals: { some: { regionId: I.region("Abuja") } } } });
    expect(brands).toHaveLength(0);
  });

  it("$queryRaw on the scoped client is filtered by RLS", async () => {
    const rows = await scopedDb(lagosHmnl).$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "Deal"`;
    expect(Number(rows[0]!.n)).toBe(5);
  });

  it("AuditLog and password hashes are unreachable from a user session", async () => {
    const db = scopedDb(md);
    await expect(db.$queryRaw`SELECT * FROM "AuditLog"`).rejects.toThrow(/permission denied/);
    await expect(db.$queryRaw`SELECT "passwordHash" FROM "User"`).rejects.toThrow(/permission denied/);
  });
});

describe("scopedDb – writes", () => {
  it("create: validates territory, resolves territory, stamps owner, audits", async () => {
    const db = scopedDb(lagosHmnl);
    const deal = await db.deal.create({
      data: { name: "Integration deal", brandId: I.brand("HMNL"), regionId: I.region("Lagos"), ownerId: lagosHmnl.userId },
    });
    createdDealIds.push(deal.id);
    const territory = await unsafeDb.territory.findUniqueOrThrow({ where: { id: deal.territoryId! } });
    expect(territory.name).toBe("HMNL – Lagos");
    expect(deal.ownerId).toBe(lagosHmnl.userId);
    expect(deal.createdById).toBe(lagosHmnl.userId);
    const log = await unsafeDb.auditLog.findFirst({ where: { entityId: deal.id, action: "CREATE" } });
    expect(log?.userId).toBe(lagosHmnl.userId);
    expect(log?.brandId).toBe(I.brand("HMNL"));
  });

  it("create in another brand or region → ForbiddenError", async () => {
    const db = scopedDb(lagosHmnl);
    await expect(
      db.deal.create({ data: { name: "x", brandId: I.brand("SNMNL"), regionId: I.region("Lagos"), ownerId: lagosHmnl.userId } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      db.deal.create({ data: { name: "x", brandId: I.brand("HMNL"), regionId: I.region("Abuja"), ownerId: lagosHmnl.userId } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      db.deal.create({ data: { name: "x", brandId: I.brand("SNMNL"), regionId: I.region("Lagos"), ownerId: lagosHmnl.userId } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("brand change needs scope ALL; region move re-resolves territory", async () => {
    const bm = scopedDb(bmHmnl);
    const deal = await bm.deal.create({
      data: { name: "Movable", brandId: I.brand("HMNL"), regionId: I.region("Lagos"), ownerId: bmHmnl.userId },
    });
    createdDealIds.push(deal.id);

    await expect(
      bm.deal.update({ where: { id: deal.id }, data: { brandId: I.brand("SMGL") } }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const moved = await bm.deal.update({ where: { id: deal.id }, data: { regionId: I.region("Ibadan") } });
    const t = await unsafeDb.territory.findUniqueOrThrow({ where: { id: moved.territoryId! } });
    expect(t.name).toBe("HMNL – Ibadan");
    const log = await unsafeDb.auditLog.findFirst({ where: { entityId: deal.id, action: "UPDATE" } });
    expect((log?.before as { regionId: string }).regionId).toBe(I.region("Lagos"));

    const byMd = await scopedDb(md).deal.update({ where: { id: deal.id }, data: { brandId: I.brand("SMGL") } });
    const t2 = await unsafeDb.territory.findUniqueOrThrow({ where: { id: byMd.territoryId! } });
    expect(t2.name).toBe("SMGL – Ibadan");
  });

  it("update / delete of hidden records fail without revealing them", async () => {
    const hidden = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    const db = scopedDb(lagosHmnl);
    await expect(db.deal.update({ where: { id: hidden.id }, data: { name: "pwned" } })).rejects.toThrow();
    await expect(db.deal.delete({ where: { id: hidden.id } })).rejects.toThrow();
    expect((await db.deal.updateMany({ where: { id: hidden.id }, data: { name: "pwned" } })).count).toBe(0);
    expect((await db.deal.deleteMany({ where: { id: hidden.id } })).count).toBe(0);
    const after = await unsafeDb.deal.findUniqueOrThrow({ where: { id: hidden.id } });
    expect(after.name).toBe(hidden.name);
  });

  it("nested writes into brand-owned models are rejected", async () => {
    const db = scopedDb(lagosHmnl);
    await expect(
      db.user.update({
        where: { id: lagosHmnl.userId },
        data: {
          ownedDeals: { create: { name: "sneaky", brandId: I.brand("SNMNL"), regionId: I.region("Lagos") } },
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("soft-deleted records are invisible", async () => {
    const db = scopedDb(lagosHmnl);
    const deal = await db.deal.create({
      data: { name: "To delete", brandId: I.brand("HMNL"), regionId: I.region("Lagos"), ownerId: lagosHmnl.userId },
    });
    createdDealIds.push(deal.id);
    await db.deal.update({ where: { id: deal.id }, data: { deletedAt: new Date() } });
    expect(await db.deal.findUnique({ where: { id: deal.id } })).toBeNull();
  });

  it("owner keeps read access after leaving the territory (owner rule)", async () => {
    const ctx = await ctxFor("exec.hmnl.2");
    const deal = await scopedDb(ctx).deal.create({
      data: { name: "Owned", brandId: I.brand("HMNL"), regionId: I.region("Lagos"), ownerId: ctx.userId },
    });
    createdDealIds.push(deal.id);
    const withoutMembership: AccessContext = { ...ctx, memberships: [], brandIds: [] };
    const visible = await scopedDb(withoutMembership).deal.findMany();
    expect(visible.map((d) => d.id)).toContain(deal.id);
    expect(visible.every((d) => d.ownerId === ctx.userId)).toBe(true);
  });
});
