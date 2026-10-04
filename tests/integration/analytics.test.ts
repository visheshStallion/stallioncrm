import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { DASHBOARDS, defaultDashboard, loadDashboard } from "@/server/modules/dashboards/service";
import { createDeal } from "@/server/modules/deals/service";
import { addForecastNote, getForecast, parsePeriod, setTarget, shiftPeriod, viewerNode, type ForecastNode } from "@/server/modules/forecasts/service";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let hos: AccessContext;
let bm: AccessContext; // HMNL Brand Manager
let bmSnmnl: AccessContext;
let exec: AccessContext; // HMNL Lagos exec
let exec2: AccessContext; // HMNL Lagos exec (colleague)
let rsm: AccessContext;
let snmnl: AccessContext;
const period = parsePeriod(null);

beforeAll(async () => {
  I = await ids();
  [hos, bm, bmSnmnl, exec, exec2, rsm, snmnl] = (await Promise.all(["hos", "bm.hmnl", "bm.snmnl", "exec.hmnl.1", "exec.hmnl.2", "rsm", "exec.snmnl.1"].map((k) => ctxFor(k)))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
});

const find = (n: ForecastNode, pred: (x: ForecastNode) => boolean): ForecastNode | undefined => (pred(n) ? n : n.children.map((c) => find(c, pred)).find(Boolean));
const stage = (brand: string, key: string) => unsafeDb.pipelineStage.findFirstOrThrow({ where: { key, pipeline: { brandId: I.brand(brand), isDefault: true } } });
async function dealAt(ctx: AccessContext, key: string, amount: number) {
  const d = await createDeal(ctx, { name: `Forecast ${key} ${Math.random().toString(36).slice(2, 7)}`, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), amount, closeDate: new Date().toISOString().slice(0, 10) } as never);
  if (key !== "ENQUIRY") await unsafeDb.deal.update({ where: { id: d.id }, data: { stageId: (await stage("HMNL", key)).id } });
  return d.id;
}

describe("periods", () => {
  it("parses months and quarters and steps between them", () => {
    const now = new Date("2026-10-04T10:00:00Z");
    expect(parsePeriod(null, now)).toMatchObject({ type: "MONTH", key: "2026-10", label: "October 2026" });
    expect(parsePeriod("2026-Q4")).toMatchObject({ type: "QUARTER", label: "Q4 2026" });
    expect(parsePeriod("garbage", now).key).toBe("2026-10");
    expect(shiftPeriod(parsePeriod("2026-01"), -1)).toBe("2025-12");
    expect(shiftPeriod(parsePeriod("2026-Q4"), 1)).toBe("2027-Q1");
    // Lagos is UTC+1: 23:30 UTC on the last day of the month is already the next month
    expect(parsePeriod(null, new Date("2026-10-31T23:30:00Z")).key).toBe("2026-11");
  });
});

describe("targets", () => {
  it("are set by the Head of Sales or the brand's own Brand Manager only", async () => {
    await setTarget(bm, { period: period.key, brandId: I.brand("HMNL"), units: 40, revenue: 2_000_000_000 });
    await setTarget(hos, { period: period.key, brandId: I.brand("SNMNL"), units: 30, revenue: 900_000_000 });
    await setTarget(bm, { period: period.key, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), units: 25, revenue: 1_200_000_000 });
    await setTarget(bm, { period: period.key, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), userId: exec.userId, units: 5, revenue: 250_000_000 });
    await setTarget(bm, { period: period.key, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), userId: exec2.userId, units: 6, revenue: 300_000_000 });
    // update in place (one target per level and period)
    await setTarget(bm, { period: period.key, brandId: I.brand("HMNL"), units: 42, revenue: 2_100_000_000 });
    expect(await unsafeDb.target.count({ where: { brandId: I.brand("HMNL"), regionId: null, userId: null } })).toBe(1);

    await expect(setTarget(exec, { period: period.key, brandId: I.brand("HMNL"), revenue: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setTarget(bm, { period: period.key, brandId: I.brand("SNMNL"), revenue: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setTarget(rsm, { period: period.key, brandId: I.brand("HMNL"), regionId: I.region("Abuja"), revenue: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    // a user target needs a user who works in that brand-region
    await expect(setTarget(bm, { period: period.key, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), userId: snmnl.userId, revenue: 1 })).rejects.toThrow(/does not work/);
    // RLS: no writes for execs, no reads across brands
    await expect(rawAsUser(exec, `UPDATE "Target" SET revenue = 1 RETURNING id`)).resolves.toEqual([]);
    await expect(rawAsUser(exec, `INSERT INTO "Target" (id, "periodType", "periodStart", "brandId", units, revenue, "updatedAt") VALUES ('t1', 'MONTH', '2030-01-01', '${I.brand("HMNL")}', 1, 1, now())`)).rejects.toThrow(/row-level security/);
    expect(await rawAsUser(bmSnmnl, `SELECT id FROM "Target" WHERE "brandId" = '${I.brand("HMNL")}'`)).toEqual([]);
    // an exec sees the region target and their own, not the brand-wide one
    const visible = await rawAsUser<{ regionId: string | null; userId: string | null }>(exec, `SELECT "regionId", "userId" FROM "Target" WHERE "brandId" = '${I.brand("HMNL")}'`);
    expect(visible.some((t) => t.regionId === null)).toBe(false);
    expect(visible.some((t) => t.userId === exec.userId)).toBe(true);
  });
});

describe("forecast roll-up", () => {
  it("won + committed + weighted pipeline, rolled up user → region → brand → group, scoped to the viewer", async () => {
    const before = await getForecast(hos, period);
    const [open, booked, wonId] = [await dealAt(exec, "ENQUIRY", 10_000_000), await dealAt(exec, "BOOKING", 20_000_000), await dealAt(exec, "CLOSED_WON", 30_000_000)];
    expect([open, booked, wonId].every(Boolean)).toBe(true);
    const enquiry = await stage("HMNL", "ENQUIRY");
    const after = await getForecast(hos, period);
    expect(after.won - before.won).toBe(30_000_000);
    expect(after.committed - before.committed).toBe(20_000_000);
    expect(Math.round(after.weighted - before.weighted)).toBe(10_000_000 * (enquiry.probability / 100));
    expect(after.pipeline - before.pipeline).toBe(30_000_000);
    expect(Math.round(after.forecast - before.forecast)).toBe(50_000_000 + 10_000_000 * (enquiry.probability / 100));

    // roll-up is consistent at every level
    const check = (n: ForecastNode) => {
      if (n.children.length === 0) return;
      for (const k of ["won", "committed", "weighted", "pipeline", "openDeals"] as const) expect(Math.round(n.children.reduce((a, c) => a + c[k], 0))).toBe(Math.round(n[k]));
      n.children.forEach(check);
    };
    check(after);
    expect(after.children.map((b) => b.level)).toContain("brand");
    const hmnl = find(after, (n) => n.level === "brand" && n.brandId === I.brand("HMNL"))!;
    expect(hmnl).toMatchObject({ target: 2_100_000_000, targetUnits: 42, targetSet: true });
    const lagos = find(hmnl, (n) => n.level === "region" && n.regionId === I.region("Lagos"))!;
    expect(lagos.target).toBe(1_200_000_000);
    const mine = find(lagos, (n) => n.userId === exec.userId)!;
    expect(mine).toMatchObject({ target: 250_000_000, won: expect.any(Number) });
    expect(mine.won).toBeGreaterThanOrEqual(30_000_000);
    expect(mine.attainment).toBe(Math.round((mine.won * 1000) / 250_000_000) / 10);
    // group target = sum of the brand targets
    expect(after.target).toBe(after.children.reduce((a, c) => a + c.target, 0));
    expect(after.target).toBeGreaterThanOrEqual(3_000_000_000);

    // viewers: the Brand Manager gets one brand, the exec one brand-region, another brand nothing of HMNL
    const asBm = await getForecast(bm, period);
    expect(asBm.children.map((b) => b.brandId)).toEqual([I.brand("HMNL")]);
    expect(Math.round(asBm.won)).toBe(Math.round(hmnl.won));
    expect(viewerNode(bm, asBm).level).toBe("brand");
    const asExec = await getForecast(exec, period);
    expect(asExec.children.map((b) => b.brandId)).toEqual([I.brand("HMNL")]);
    expect(asExec.children[0]!.children.map((r) => r.regionId)).toEqual([I.region("Lagos")]);
    // the exec sees the colleague's numbers of the shared territory, but not the colleague's personal target
    const colleague = find(asExec, (n) => n.userId === exec2.userId);
    expect(colleague?.targetSet ?? false).toBe(false);
    expect(find(asExec, (n) => n.userId === exec.userId)!.target).toBe(250_000_000);
    expect(viewerNode(exec, asExec)).toMatchObject({ level: "user", target: 250_000_000 });
    const asSnmnl = await getForecast(snmnl, period);
    expect(find(asSnmnl, (n) => n.brandId === I.brand("HMNL"))).toBeUndefined();
    expect(viewerNode(hos, after).level).toBe("group");
    // the brand switcher narrows
    expect((await getForecast(hos, period, { brandId: I.brand("SNMNL") })).children.map((b) => b.brandId)).toEqual([I.brand("SNMNL")]);
    // next quarter has other numbers (different period)
    const next = await getForecast(hos, parsePeriod(shiftPeriod(parsePeriod("2026-Q4"), 8)));
    expect(next.won).toBe(0);
  });

  it("managers add commit / adjustment notes; execs cannot", async () => {
    const base = (await getForecast(bm, period)).forecast;
    await addForecastNote(bm, { period: period.key, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), adjustment: -5_000_000, note: "Two fleet deals slip to next month" });
    const withNote = await getForecast(bm, period);
    expect(Math.round(withNote.forecast - base)).toBe(-5_000_000);
    const lagos = find(withNote, (n) => n.level === "region" && n.regionId === I.region("Lagos"))!;
    expect(lagos.notes[0]).toMatchObject({ note: "Two fleet deals slip to next month", adjustment: -5_000_000, mine: true });
    await expect(addForecastNote(exec, { period: period.key, brandId: I.brand("HMNL"), regionId: I.region("Lagos"), note: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addForecastNote(bmSnmnl, { period: period.key, brandId: I.brand("HMNL"), note: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rawAsUser(snmnl, `SELECT id FROM "ForecastNote"`)).resolves.toEqual([]);
  });
});

describe("dashboards", () => {
  it("each role lands on its dashboard", () => {
    expect(defaultDashboard(hos)).toBe("group");
    expect(defaultDashboard(bm)).toBe("brand");
    expect(defaultDashboard(rsm)).toBe("region");
    expect(defaultDashboard(exec)).toBe("my");
    expect(DASHBOARDS.map((d) => d.key)).toEqual(["group", "brand", "region", "my"]);
  });

  it("the same definition shows different data per viewer", async () => {
    const chart = async (ctx: AccessContext, key: string, id: string) => {
      const w = (await loadDashboard(ctx, key)).widgets.find((x) => x.def.id === id)!.data;
      if (w.type !== "chart") throw new Error("not a chart");
      return w;
    };
    expect((await chart(hos, "group", "stages")).categories.sort()).toEqual(["HMNL", "SMGL", "SNMNL", "THPL", "ZANL"]);
    expect((await chart(bm, "group", "stages")).categories).toEqual(["HMNL"]);
    expect((await chart(exec, "group", "stages")).categories).toEqual(["HMNL"]);
    // Brand dashboard: Lagos + regions for the Brand Manager, one region for the Lagos exec
    expect((await chart(bm, "brand", "regions")).categories.length).toBeGreaterThan(1);
    expect((await chart(exec, "brand", "regions")).categories).toEqual(["Lagos"]);
    // Region dashboard for the RSM: the three regions, never Lagos
    const regions = (await chart(rsm, "region", "brands")).categories;
    expect(regions).not.toContain("Lagos");
    expect(regions.length).toBeGreaterThan(0);

    // KPIs: pipeline value equals what each viewer may see
    const kpi = async (ctx: AccessContext, key: string, id: string) => {
      const w = (await loadDashboard(ctx, key)).widgets.find((x) => x.def.id === id)!.data;
      return w.type === "kpi" ? w.value : NaN;
    };
    const sum = async (where: Record<string, unknown>) => Number((await unsafeDb.deal.aggregate({ where: { deletedAt: null, stage: { type: "OPEN" }, ...where }, _sum: { amount: true } }))._sum.amount ?? 0);
    expect(await kpi(hos, "group", "pipeline")).toBe(await sum({}));
    expect(await kpi(bm, "brand", "pipeline")).toBe(await sum({ brandId: I.brand("HMNL") }));
    expect(await kpi(exec, "my", "pipeline")).toBe(await sum({ ownerId: exec.userId }));
    expect(await kpi(exec, "group", "pipeline")).toBe(await sum({ brandId: I.brand("HMNL"), regionId: I.region("Lagos") }));

    // target meter follows the viewer's level; leaderboard only lists execs the viewer can see
    const my = await loadDashboard(exec, "my");
    expect(my.widgets.find((w) => w.def.id === "target")!.data).toMatchObject({ type: "meter", target: 250_000_000 });
    const group = await loadDashboard(hos, "group");
    expect(group.widgets.find((w) => w.def.id === "target")!.data).toMatchObject({ type: "meter" });
    const top = group.widgets.find((w) => w.def.id === "top")!.data;
    expect(top.type).toBe("leaderboard");
    if (top.type === "leaderboard") expect(top.rows.length).toBeLessThanOrEqual(10);
    // unknown keys fall back to the viewer's default dashboard
    expect((await loadDashboard(exec, "nope")).dashboard.key).toBe("my");
  });
});
