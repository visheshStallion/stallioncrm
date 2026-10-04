import { toCsv } from "@/lib/csv";
import { assertCan } from "@/server/access/can";
import { apiHandler } from "@/server/api";
import { audit } from "@/server/db";
import { runInvReport } from "@/server/modules/inventory/reports";
import { requireApiContext } from "@/server/request";

/** Inventory report as CSV – needs the inventory export permission; audited. */
export const GET = apiHandler<{ params: Promise<{ key: string }> }>(async (req, { params }) => {
  const ctx = await requireApiContext();
  assertCan(ctx, "inventory", "export");
  const sp = new URL(req.url).searchParams;
  const report = await runInvReport(ctx, (await params).key, { brandId: sp.get("brandId"), vin: sp.get("vin") ?? undefined, asOf: sp.get("asOf") ?? undefined });
  await audit({ ctx, action: "EXPORT", entity: "InventoryReport", after: { report: report.key, rows: report.rows.length } });
  return new Response("\uFEFF" + toCsv(report.columns, report.rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="inventory-${report.key}-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
