import { apiHandler } from "@/server/api";
import { exportReport } from "@/server/modules/reports/service";
import { getUiFilters, requireApiContext } from "@/server/request";

/**
 * GET /api/v1/reports/:id/export?format=csv|xlsx – profiles with reports.export only (403 otherwise).
 * Audited with the row count. The brand switcher / region filter of the session applies, like on screen.
 */
export const GET = apiHandler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const ui = await getUiFilters(ctx);
  const file = await exportReport(ctx, (await params).id, sp.format === "xlsx" ? "xlsx" : "csv", {
    brandId: sp.brandId ?? ui.brandId,
    regionId: sp.regionId ?? ui.regionId,
    ...(sp.preset ? { dateRange: { preset: sp.preset, from: sp.from, to: sp.to } } : {}),
  });
  return new Response(file.body as BodyInit, { headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store" } });
});
