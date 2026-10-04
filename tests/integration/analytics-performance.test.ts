import { beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/server/access/types";
import { loadDashboard } from "@/server/modules/dashboards/service";
import { getForecast, parsePeriod } from "@/server/modules/forecasts/service";
import { runSavedReport } from "@/server/modules/reports/service";
import { ctxFor, unsafeDb } from "./helpers";

const DEALS = 100_000;
const BUDGET_MS = 2000;
let hos: AccessContext;
let bm: AccessContext;
let exec: AccessContext;

/**
 * Prompt 09 performance target: dashboards load in under 2 s with 100k deals. The deals are generated in SQL,
 * spread over every brand-region territory, owner and stage, with close dates across the year.
 */
beforeAll(async () => {
  [hos, bm, exec] = (await Promise.all(["hos", "bm.hmnl", "exec.hmnl.1"].map((k) => ctxFor(k)))) as [AccessContext, AccessContext, AccessContext];
  await unsafeDb.$executeRawUnsafe(`
    WITH terr AS (
      SELECT t.id AS "territoryId", t."brandId", t."regionId", row_number() OVER (ORDER BY t.id) AS n, count(*) OVER () AS total,
             (SELECT array_agg(m."userId") FROM "TerritoryMember" m WHERE m."territoryId" = t.id) AS owners
      FROM "Territory" t JOIN "Brand" b ON b.id = t."brandId" WHERE t.level = 2 AND b.status = 'ACTIVE'
    ), stages AS (
      SELECT p."brandId", array_agg(s.id ORDER BY s."order") AS ids, min(p.id) AS "pipelineId"
      FROM "Pipeline" p JOIN "PipelineStage" s ON s."pipelineId" = p.id WHERE p."isDefault" GROUP BY p."brandId"
    )
    INSERT INTO "Deal" (id, name, "brandId", "regionId", "territoryId", "ownerId", "pipelineId", "stageId", amount, quantity, "closeDate", "stageEnteredAt", "createdAt", "updatedAt")
    SELECT 'perf_' || g, 'Perf deal ' || g, terr."brandId", terr."regionId", terr."territoryId",
           terr.owners[1 + (g % array_length(terr.owners, 1))], stages."pipelineId", stages.ids[1 + (g % array_length(stages.ids, 1))],
           (20 + (g % 60)) * 1000000, 1 + (g % 3),
           date_trunc('year', now()) + ((g % 365) || ' days')::interval, now() - ((g % 300) || ' days')::interval, now() - ((g % 400) || ' days')::interval, now()
    FROM generate_series(1, ${DEALS}) g
    JOIN terr ON terr.n = 1 + (g % terr.total)
    JOIN stages ON stages."brandId" = terr."brandId"
    WHERE terr.owners IS NOT NULL`);
  await unsafeDb.$executeRawUnsafe(`ANALYZE "Deal"`);
}, 300_000);

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  return { ms: Math.round(performance.now() - start), value };
}

describe(`analytics with ${DEALS.toLocaleString("en")} deals`, () => {
  it("has the data", async () => {
    expect(await unsafeDb.deal.count({ where: { id: { startsWith: "perf_" } } })).toBeGreaterThan(DEALS * 0.9);
  });

  it.each([
    ["Head of Sales", "group"],
    ["Brand Manager", "brand"],
    ["Sales Exec", "my"],
  ] as const)(`%s dashboard loads in under ${BUDGET_MS} ms`, async (who, key) => {
    const ctx = who === "Head of Sales" ? hos : who === "Brand Manager" ? bm : exec;
    await loadDashboard(ctx, key); // warm-up (connections, plans)
    const { ms, value } = await timed(() => loadDashboard(ctx, key));
    console.log(`${who} / ${key}: ${ms} ms`);
    expect(value.widgets.length).toBeGreaterThan(4);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("forecast roll-up and a grouped standard report stay within the budget", async () => {
    const forecast = await timed(() => getForecast(hos, parsePeriod(null)));
    const report = await timed(() => runSavedReport(hos, "pipeline-by-stage-brand"));
    console.log(`forecast: ${forecast.ms} ms, pipeline report: ${report.ms} ms`);
    expect(forecast.ms).toBeLessThan(BUDGET_MS);
    expect(report.ms).toBeLessThan(BUDGET_MS);
    expect(report.value.result.rows.reduce((a, r) => a + Number(r[2]), 0)).toBeGreaterThan(DEALS * 0.5);
  });
});
