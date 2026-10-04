import { beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { ForbiddenError, NotFoundError } from "@/server/access/errors";
import type { AccessContext } from "@/server/access/types";
import { REPORT_MODULES } from "@/server/modules/reports/catalog";
import { definitionSchema } from "@/server/modules/reports/definition";
import { chartData, runReport } from "@/server/modules/reports/engine";
import * as svc from "@/server/modules/reports/service";
import { ctxFor, ids, rawAsUser, unsafeDb } from "./helpers";

let I: Awaited<ReturnType<typeof ids>>;
let hos: AccessContext; // Head of Sales (all brands)
let bm: AccessContext; // HMNL Brand Manager
let exec: AccessContext; // HMNL Lagos exec
let abuja: AccessContext; // Abuja exec, all active brands
let snmnl: AccessContext;

beforeAll(async () => {
  I = await ids();
  [hos, bm, exec, abuja, snmnl] = (await Promise.all(["hos", "bm.hmnl", "exec.hmnl.1", "exec.abuja", "exec.snmnl.1"].map((k) => ctxFor(k)))) as [AccessContext, AccessContext, AccessContext, AccessContext, AccessContext];
});

const def = (d: Record<string, unknown>) => definitionSchema.parse(d);
const column = (rows: Array<Array<string | number | null>>, i: number) => [...new Set(rows.map((r) => r[i]))];

describe("the same report shows each viewer only their own data", () => {
  it("Pipeline by brand: Head of Sales sees 5 brands, the HMNL manager HMNL only, the Abuja exec Abuja only", async () => {
    const pipelineByBrand = def({ module: "deals", filters: [{ field: "stageType", op: "eq", value: "OPEN" }], groupBy: [{ field: "brand" }, { field: "region" }], summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }] });
    const all = await runReport(hos, pipelineByBrand);
    expect(column(all.rows, 0).sort()).toEqual(["HMNL", "SMGL", "SNMNL", "THPL", "ZANL"]);
    expect(column(all.rows, 1).length).toBeGreaterThan(1);

    const hmnl = await runReport(bm, pipelineByBrand);
    expect(column(hmnl.rows, 0)).toEqual(["HMNL"]);
    expect(column(hmnl.rows, 1).length).toBeGreaterThan(1); // every region of the brand

    const ab = await runReport(abuja, pipelineByBrand);
    expect(column(ab.rows, 1)).toEqual(["Abuja"]);
    expect(column(ab.rows, 0).length).toBeGreaterThan(1); // all brands, Abuja only

    // totals match what each viewer can see through the normal (scoped) client
    const sum = (r: typeof all) => r.rows.reduce((a, row) => a + Number(row[2]), 0);
    const expected = async (ctx: AccessContext) => (await rawAsUser<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM "Deal" d JOIN "PipelineStage" s ON s.id = d."stageId" WHERE s.type = 'OPEN' AND d."deletedAt" IS NULL`))[0]!.n;
    expect(sum(all)).toBe(await expected(hos));
    expect(sum(hmnl)).toBe(await expected(bm));
    expect(sum(ab)).toBe(await expected(abuja));
    expect(sum(all)).toBe(await unsafeDb.deal.count({ where: { deletedAt: null, stage: { type: "OPEN" } } }));
    expect(sum(hmnl)).toBeLessThan(sum(all));
  });

  it("the standard report (seeded) runs for everyone; joins and sub-selects are scoped too", async () => {
    const { result } = await svc.runSavedReport(exec, "pipeline-by-stage-brand");
    expect(column(result.rows, 0)).toEqual(["HMNL"]);
    // related modules: account, model and activity counts come through RLS as well
    const detail = await runReport(exec, def({ module: "deals", columns: ["name", "brand", "region", "account", "model", "activityCount", "owner"], filters: [] }), { take: 500 });
    expect(detail.kind).toBe("tabular");
    expect(column(detail.rows, 1)).toEqual(["HMNL"]);
    expect(column(detail.rows, 2)).toEqual(["Lagos"]);
    expect(detail.ids!.length).toBe(detail.rows.length);
    // the brand switcher only narrows – another brand's id returns nothing
    expect((await runReport(exec, def({ module: "deals", columns: ["name"], filters: [] }), { brandId: I.brand("SNMNL") })).total).toBe(0);
  });

  it("every catalog field of every module can be selected, grouped and filtered", async () => {
    for (const mod of REPORT_MODULES) {
      const tabular = await runReport(hos, def({ module: mod.key, columns: mod.fields.map((f) => f.key).slice(0, 20), filters: [] }), { take: 5 });
      expect(tabular.columns.length).toBeGreaterThan(3);
      for (const f of mod.fields) {
        const numeric = ["number", "money", "percent"].includes(f.type);
        const grouped = await runReport(hos, def({ module: mod.key, groupBy: [{ field: f.key, ...(f.type === "date" ? { granularity: "quarter" } : {}) }], summaries: [{ fn: "count" }, ...(numeric ? [{ fn: "avg", field: f.key }] : [])], filters: [{ field: f.key, op: "notEmpty" }] }));
        expect(grouped.kind, `${mod.key}.${f.key}`).toBe("summary");
      }
    }
  });

  it("filters, date presets, grouping by month and three levels", async () => {
    const r = await runReport(
      hos,
      def({
        module: "deals",
        filters: [{ field: "amount", op: "gt", value: 0 }, { field: "brand", op: "in", value: "HMNL, SNMNL" }, { field: "name", op: "contains", value: "%" }],
        dateRange: { field: "createdAt", preset: "ALL" },
        groupBy: [{ field: "brand" }, { field: "stage" }, { field: "createdAt", granularity: "month" }],
        summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }, { fn: "max", field: "amount" }],
      }),
    );
    expect(r.rows).toEqual([]); // no deal name contains a literal "%": LIKE wildcards are escaped
    const ok = await runReport(hos, def({ module: "deals", filters: [{ field: "brand", op: "in", value: "HMNL, SNMNL" }], groupBy: [{ field: "brand" }, { field: "stage" }, { field: "createdAt", granularity: "month" }], summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }] }));
    expect(column(ok.rows, 0).sort()).toEqual(["HMNL", "SNMNL"]);
    expect(String(ok.rows[0]![2])).toMatch(/^\d{4}-\d{2}$/);
    const chart = chartData(ok, 1);
    expect(chart.categories.sort()).toEqual(["HMNL", "SNMNL"]);
    expect(chart.series.length).toBeGreaterThan(0);
    const future = await runReport(hos, def({ module: "deals", columns: ["name"], filters: [], dateRange: { field: "createdAt", preset: "CUSTOM", from: "2099-01-01", to: "2099-12-31" } }));
    expect(future.total).toBe(0);
  });

  it("rejects definitions that reach outside the catalog", () => {
    const bad = (d: Record<string, unknown>) => definitionSchema.safeParse(d).success;
    expect(bad({ module: "deals", columns: ['t."vinChassisNo"; DROP TABLE "Deal"'], filters: [] })).toBe(false);
    expect(bad({ module: "users", columns: ["passwordHash"], filters: [] })).toBe(false);
    expect(bad({ module: "leads", columns: ["mobile"], filters: [] })).toBe(false); // contact details are not reportable
    expect(bad({ module: "deals", groupBy: [{ field: "brand" }], summaries: [{ fn: "sum", field: "name" }], filters: [] })).toBe(false);
    expect(bad({ module: "deals", groupBy: [{ field: "a" }, { field: "b" }, { field: "c" }, { field: "d" }], filters: [] })).toBe(false);
  });
});

describe("special standard reports", () => {
  it("funnel, lead source ROI and exec performance are scoped to the viewer", async () => {
    const funnel = (await svc.runSavedReport(hos, "conversion-funnel", { dateRange: { preset: "ALL" } })).result;
    expect(funnel.rows.map((r) => r[0])).toEqual(["Leads", "Test Drive", "Booking", "Delivery"]);
    const mine = (await svc.runSavedReport(exec, "conversion-funnel", { dateRange: { preset: "ALL" } })).result;
    expect(Number(mine.rows[0]![1])).toBeLessThan(Number(funnel.rows[0]![1]));
    expect(Number(mine.rows[0]![1])).toBe(await unsafeDb.lead.count({ where: { deletedAt: null, brandId: I.brand("HMNL"), regionId: I.region("Lagos") } }));
    // monotone: each step is a subset of the previous deal step
    expect(Number(funnel.rows[1]![1])).toBeGreaterThanOrEqual(Number(funnel.rows[2]![1]));
    expect(Number(funnel.rows[2]![1])).toBeGreaterThanOrEqual(Number(funnel.rows[3]![1]));

    const roi = (await svc.runSavedReport(bm, "lead-source-roi", { dateRange: { preset: "ALL" } })).result;
    expect(column(roi.rows, 0)).toEqual(["HMNL"]);
    const perf = (await svc.runSavedReport(snmnl, "exec-performance", { dateRange: { preset: "ALL" } })).result;
    const snmnlOwners = (await unsafeDb.user.findMany({ where: { OR: [{ ownedLeads: { some: { brandId: I.brand("SNMNL"), regionId: I.region("Lagos") } } }, { ownedDeals: { some: { brandId: I.brand("SNMNL"), regionId: I.region("Lagos") } } }] }, select: { name: true } })).map((u) => u.name);
    for (const name of column(perf.rows, 0)) expect(snmnlOwners).toContain(name);
    for (const key of ["won-by-brand-region-month", "lost-by-reason-competitor", "stale-deals", "discount-given-vs-approved", "quote-aging"]) {
      const r = (await svc.runSavedReport(exec, key)).result;
      expect(r.columns.length, key).toBeGreaterThan(1);
    }
  });
});

describe("folders and sharing", () => {
  it("a report shared by the Head of Sales shows an exec only the exec's data", async () => {
    const shared = await svc.createReport(hos, { name: "All deals by brand", folder: "GROUP", definition: { module: "deals", groupBy: [{ field: "brand" }], summaries: [{ fn: "count" }, { fn: "sum", field: "amount" }], filters: [] } });
    const asHos = await svc.runSavedReport(hos, shared.id);
    const asExec = await svc.runSavedReport(exec, shared.id);
    expect(asHos.result.rows.length).toBe(5);
    expect(asExec.result.rows.map((r) => r[0])).toEqual(["HMNL"]);
    expect(Number(asExec.result.rows[0]![1])).toBe(await unsafeDb.deal.count({ where: { deletedAt: null, brandId: I.brand("HMNL"), regionId: I.region("Lagos") } }));
    expect(asExec.report.mine).toBe(false);
    // the exec can open it but not change or delete it
    await expect(svc.updateReport(exec, shared.id, { name: "x", definition: asExec.report.definition })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.deleteReport(exec, shared.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rawAsUser(exec, `UPDATE "Report" SET name = 'x' WHERE id = '${shared.id}' RETURNING id`)).resolves.toEqual([]);
  });

  it("private reports are the owner's; brand folders are for the brand's users; standard reports are read-only", async () => {
    const priv = await svc.createReport(bm, { name: "My private", definition: { module: "leads", columns: ["name", "status"], filters: [] } });
    await expect(svc.getReport(exec, priv.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.getReport(hos, priv.id)).rejects.toBeInstanceOf(NotFoundError); // management included
    const brand = await svc.createReport(bm, { name: "HMNL team report", folder: "BRAND", brandId: I.brand("HMNL"), definition: { module: "leads", groupBy: [{ field: "status" }], filters: [] } });
    expect((await svc.getReport(exec, brand.id)).name).toBe("HMNL team report");
    await expect(svc.getReport(snmnl, brand.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await svc.listReports(snmnl)).some((r) => r.id === brand.id)).toBe(false);
    expect((await svc.listReports(exec)).filter((r) => r.standard).length).toBe(12);
    // cannot share into a brand you do not belong to
    await expect(svc.createReport(bm, { name: "x", folder: "BRAND", brandId: I.brand("SNMNL"), definition: { module: "leads", columns: ["name"], filters: [] } })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rawAsUser(bm, `INSERT INTO "Report" (id, name, module, definition, folder, "brandId", "ownerId", "updatedAt") VALUES ('x1', 'x', 'leads', '{}', 'BRAND', '${I.brand("SNMNL")}', '${bm.userId}', now())`)).rejects.toThrow(/row-level security/);
    // standard reports cannot be changed or deleted
    const std = await svc.getReport(bm, "stale-deals");
    await expect(svc.updateReport(bm, std.id, { name: "x", definition: std.definition })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.deleteReport(bm, std.id)).rejects.toBeInstanceOf(ForbiddenError);
    await svc.updateReport(bm, priv.id, { name: "Renamed", definition: { module: "leads", columns: ["name"], filters: [] } });
    await svc.deleteReport(bm, priv.id);
    await expect(svc.getReport(bm, priv.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("export", () => {
  it("is blocked for the Sales Exec profile and audited with the row count for the others", async () => {
    await expect(svc.exportReport(exec, "pipeline-by-stage-brand", "csv")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.exportReport(exec, "pipeline-by-stage-brand", "xlsx")).rejects.toBeInstanceOf(ForbiddenError);
    const from = new Date();
    const csv = await svc.exportReport(bm, "pipeline-by-stage-brand", "csv");
    const rows = parseCsv(new TextDecoder().decode(csv.body));
    expect(rows[0]).toEqual(["Brand", "Stage", "Records", "Sum of Amount", "Sum of Weighted amount"]);
    expect(new Set(rows.slice(1).map((r) => r[0]))).toEqual(new Set(["HMNL"]));
    const entry = await unsafeDb.auditLog.findFirstOrThrow({ where: { action: "EXPORT", entity: "Report", userId: bm.userId, at: { gte: from } } });
    expect(entry.after).toMatchObject({ format: "csv", rows: rows.length - 1 });

    const xlsx = await svc.exportReport(hos, "stale-deals", "xlsx");
    expect(xlsx.fileName).toMatch(/^stale-deals-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(Buffer.from(xlsx.body.slice(0, 4)).toString("latin1")).toBe("PK\u0003\u0004"); // a zip container
    const text = Buffer.from(xlsx.body).toString("utf8");
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("Days in stage");
  });
});
