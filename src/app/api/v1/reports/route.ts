import { apiHandler } from "@/server/api";
import { createReport, listReports } from "@/server/modules/reports/service";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/reports – the reports the caller may open (own, brand folders, group folder, standard). */
export const GET = apiHandler(async () => {
  const ctx = await requireApiContext();
  const reports = await listReports(ctx);
  return Response.json({ data: reports.map(({ definition: _definition, ...r }) => r) });
});

/** POST /api/v1/reports – { name, folder, brandId?, definition }. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await createReport(ctx, await req.json()) }, { status: 201 });
});
