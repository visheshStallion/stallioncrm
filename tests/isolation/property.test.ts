/**
 * Property-based isolation test (prompt 15 §1): random users with random territories and random records in
 * random brand–regions; for every generated user the scoped client and row-level security must return exactly
 * what a pure reference implementation of the visibility rule allows. The generator is seeded – a failure
 * prints the seed, and `ISOLATION_SEED=<seed>` replays it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadAccessContext } from "@/server/access/context";
import type { AccessContext } from "@/server/access/types";
import { scopedDb } from "@/server/db";
import { rawAsUser, unsafeDb } from "../integration/helpers";

const SEED = Number(process.env.ISOLATION_SEED ?? Date.now() % 2_147_483_647);
/** mulberry32 – small deterministic PRNG */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = prng(SEED);
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const some = <T>(xs: T[], max: number): T[] => [...new Set(Array.from({ length: Math.floor(rnd() * (max + 1)) }, () => pick(xs)))];

interface Rec {
  id: string;
  brandId: string;
  regionId: string;
  ownerId: string | null;
}
function reference(ctx: AccessContext, r: Rec): boolean {
  if (ctx.scope === "ALL") return true;
  if (r.ownerId === ctx.userId) return true;
  return ctx.memberships.some((m) => m.brandId === r.brandId && (m.regionId === null || m.regionId === r.regionId));
}

const USERS = 24;
const RECORDS = 120;
const users: AccessContext[] = [];
const created: { leads: string[]; deals: string[] } = { leads: [], deals: [] };

beforeAll(async () => {
  const tag = SEED.toString(36);
  const [brands, regions, territories, roles, profiles, stages] = await Promise.all([
    unsafeDb.brand.findMany({ where: { status: { not: "INACTIVE" } }, select: { id: true } }),
    unsafeDb.region.findMany({ select: { id: true } }),
    unsafeDb.territory.findMany({ where: { brandId: { not: null } }, select: { id: true } }),
    unsafeDb.role.findMany({ select: { id: true } }),
    unsafeDb.profile.findMany({ where: { name: { in: ["Sales Exec", "Brand Manager", "RSM", "Management"] } }, select: { id: true } }),
    unsafeDb.pipelineStage.findMany({ where: { type: "OPEN" }, select: { id: true, pipeline: { select: { brandId: true } } } }),
  ]);
  // users: random profile, 0–5 random territories (brand-level and brand–region), some with none at all
  for (let i = 0; i < USERS; i++) {
    const u = await unsafeDb.user.create({ data: { name: `Prop ${tag} ${i}`, email: `prop.${tag}.${i}@isolation.test`, roleId: pick(roles).id, profileId: pick(profiles).id } });
    const ts = some(territories, 5);
    if (ts.length) await unsafeDb.territoryMember.createMany({ data: ts.map((t) => ({ userId: u.id, territoryId: t.id, isManager: rnd() < 0.3 })) });
    users.push((await loadAccessContext(u.id))!);
  }
  const owners = [...users.map((u) => u.userId)];
  for (let i = 0; i < RECORDS; i++) {
    const brand = pick(brands);
    const region = pick(regions);
    const ownerId = pick(owners);
    if (rnd() < 0.5) {
      const l = await unsafeDb.lead.create({ data: { lastName: `Prop ${tag} ${i}`, mobile: `+2347${String(10_000_000 + Math.floor(rnd() * 89_999_999))}${i % 10}`, source: "WALK_IN", brandId: brand.id, regionId: region.id, ownerId }, select: { id: true } });
      created.leads.push(l.id);
    } else {
      const stage = stages.find((s) => s.pipeline.brandId === brand.id);
      if (!stage) continue;
      const d = await unsafeDb.deal.create({ data: { name: `Prop ${tag} ${i}`, brandId: brand.id, regionId: region.id, ownerId, stageId: stage.id }, select: { id: true } });
      created.deals.push(d.id);
    }
  }
  // a few soft-deleted rows: never visible to anyone
  for (const id of created.deals.slice(0, 5)) await unsafeDb.deal.update({ where: { id }, data: { deletedAt: new Date() } });
}, 300_000);

describe(`property: scopedDb ≡ reference rule ≡ RLS (seed ${SEED})`, () => {
  it.each(["Lead", "Deal"] as const)("%s", async (model) => {
    const delegate = model === "Lead" ? "lead" : "deal";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- two delegates with the same shape
    const all: Array<Rec & { deletedAt: Date | null }> = await (unsafeDb as any)[delegate].findMany({ select: { id: true, brandId: true, regionId: true, ownerId: true, deletedAt: true } });
    const live = all.filter((r) => r.deletedAt === null);
    expect(live.length).toBeGreaterThan(20);
    let hiddenChecks = 0;
    for (const ctx of users) {
      const expected = live.filter((r) => reference(ctx, r)).map((r) => r.id).sort();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const viaClient: Array<{ id: string }> = await (scopedDb(ctx) as any)[delegate].findMany({ select: { id: true } });
      expect(viaClient.map((r) => r.id).sort(), `seed ${SEED}: ${model} via scopedDb for ${ctx.user.email}`).toEqual(expected);
      const viaSql = await rawAsUser<{ id: string }>(ctx, `SELECT id FROM "${model}" WHERE "deletedAt" IS NULL`);
      expect(viaSql.map((r) => r.id).sort(), `seed ${SEED}: ${model} via RLS for ${ctx.user.email}`).toEqual(expected);
      // random probes by id
      for (let i = 0; i < 6; i++) {
        const r = pick(live);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found = await (scopedDb(ctx) as any)[delegate].findUnique({ where: { id: r.id }, select: { id: true } });
        expect(!!found, `seed ${SEED}: ${model} ${r.id} by id for ${ctx.user.email}`).toBe(reference(ctx, r));
        if (!reference(ctx, r)) hiddenChecks++;
      }
    }
    expect(hiddenChecks, "the run exercised hidden records").toBeGreaterThan(0);
  });

  it("writes: a random user can never update or delete a record the rule hides from them", async () => {
    const deals: Rec[] = await unsafeDb.deal.findMany({ where: { id: { in: created.deals }, deletedAt: null }, select: { id: true, brandId: true, regionId: true, ownerId: true } });
    for (const ctx of users) {
      const hidden = deals.filter((d) => !reference(ctx, d)).slice(0, 5);
      for (const d of hidden) {
        expect((await scopedDb(ctx).deal.updateMany({ where: { id: d.id }, data: { name: "tampered" } })).count).toBe(0);
        await expect(scopedDb(ctx).deal.update({ where: { id: d.id }, data: { name: "tampered" }, select: { id: true } })).rejects.toThrow();
        const viaSql = await rawAsUser<{ id: string }>(ctx, `UPDATE "Deal" SET "name" = 'tampered' WHERE id = '${d.id}' RETURNING id`).catch(() => []);
        expect(viaSql).toEqual([]);
      }
    }
    expect(await unsafeDb.deal.count({ where: { name: "tampered" } })).toBe(0);
  });
});
