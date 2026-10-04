import { apiHandler } from "@/server/api";
import { parsePaging } from "@/server/list/filters";
import { runSavedReport } from "@/server/modules/reports/service";
import { requireApiContext } from "@/server/request";

/**
 * GET /api/v1/reports/:id?preset=&from=&to=&brandId=&regionId=&page=&per= – runs the report (id or standard
 * key) with the CALLER's access context: a shared report never returns more than the caller may see.
 */
export const GET = apiHandler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const paging = parsePaging(sp);
  const { report, result } = await runSavedReport(ctx, (await params).id, {
    brandId: sp.brandId,
    regionId: sp.regionId,
    take: paging.per,
    skip: paging.skip,
    ...(sp.preset ? { dateRange: { preset: sp.preset, from: sp.from, to: sp.to } } : {}),
  });
  return Response.json({ data: { id: report.id, key: report.key, name: report.name, module: report.module, folder: report.folder, ...result } });
});
