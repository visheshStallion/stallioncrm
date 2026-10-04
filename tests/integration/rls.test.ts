/**
 * Defence in depth: the same isolation assertions, but with raw SQL executed as the user's RLS
 * session – the Prisma extension (layer 1) is bypassed entirely, only Postgres RLS (layer 2) filters.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import { ctxFor, ids, rawAsUser, rawWithoutContext, unsafeDb } from "./helpers";

type Row = { brandId: string; regionId: string };
let I: Awaited<ReturnType<typeof ids>>;
let lagosHmnl: AccessContext;
let abuja: AccessContext;
let bmHmnl: AccessContext;
let md: AccessContext;

beforeAll(async () => {
  I = await ids();
  [lagosHmnl, abuja, bmHmnl, md] = await Promise.all([
    ctxFor("exec.hmnl.1"),
    ctxFor("exec.abuja"),
    ctxFor("bm.hmnl"),
    ctxFor("md"),
  ]);
});

const SELECT = `SELECT "brandId", "regionId" FROM "Deal" WHERE "deletedAt" IS NULL`;
const cells = (rows: Row[]) =>
  [...new Set(rows.map((d) => `${I.brandCode(d.brandId)}|${I.regionName(d.regionId)}`))].sort();

describe("RLS – raw SQL as the user (Prisma extension bypassed)", () => {
  it("HMNL Lagos exec → only HMNL-Lagos rows", async () => {
    const rows = await rawAsUser<Row>(lagosHmnl, SELECT);
    expect(rows.length).toBeGreaterThan(0);
    expect(cells(rows)).toEqual(["HMNL|Lagos"]);
  });

  it("Abuja exec → all brands, Abuja only", async () => {
    const rows = await rawAsUser<Row>(abuja, SELECT);
    expect(cells(rows)).toEqual(["HMNL|Abuja", "SMGL|Abuja", "SNMNL|Abuja", "THPL|Abuja", "ZANL|Abuja"]);
  });

  it("Brand Manager HMNL → all HMNL regions", async () => {
    const rows = await rawAsUser<Row>(bmHmnl, SELECT);
    expect(cells(rows)).toEqual(["HMNL|Abuja", "HMNL|Ibadan", "HMNL|Lagos", "HMNL|Port Harcourt"]);
  });

  it("MD → everything", async () => {
    const rows = await rawAsUser<Row>(md, SELECT);
    const total = await unsafeDb.deal.count({ where: { deletedAt: null } });
    expect(rows).toHaveLength(total);
  });

  it("no session context → no rows (fail closed)", async () => {
    expect(await rawWithoutContext(SELECT)).toHaveLength(0);
  });

  it("INSERT into another brand is rejected by the policy", async () => {
    const owner = lagosHmnl.userId;
    await expect(
      rawAsUser(
        lagosHmnl,
        `INSERT INTO "Deal" (id, name, "brandId", "regionId", "ownerId", "updatedAt")
         VALUES ('rls-test-x', 'x', '${I.brand("SNMNL")}', '${I.region("Lagos")}', '${owner}', now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("UPDATE cannot reach hidden rows", async () => {
    const hidden = await unsafeDb.deal.findFirstOrThrow({ where: { brandId: I.brand("SNMNL") } });
    await rawAsUser(lagosHmnl, `UPDATE "Deal" SET name = 'pwned' WHERE id = '${hidden.id}'`);
    expect((await unsafeDb.deal.findUniqueOrThrow({ where: { id: hidden.id } })).name).toBe(hidden.name);
  });

  it("UPDATE cannot move a visible row out of the user's reach", async () => {
    const mine = await unsafeDb.deal.findFirstOrThrow({
      where: { brandId: I.brand("HMNL"), regionId: I.region("Lagos"), ownerId: { not: lagosHmnl.userId } },
    });
    await expect(
      rawAsUser(lagosHmnl, `UPDATE "Deal" SET "brandId" = '${I.brand("SNMNL")}' WHERE id = '${mine.id}'`),
    ).rejects.toThrow(/row-level security/);
  });

  it("session settings do not leak between transactions", async () => {
    await rawAsUser(md, SELECT);
    expect(await rawWithoutContext(SELECT)).toHaveLength(0);
  });
});
