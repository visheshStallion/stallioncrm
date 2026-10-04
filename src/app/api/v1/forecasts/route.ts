import { apiHandler } from "@/server/api";
import { getForecast, parsePeriod, setTarget } from "@/server/modules/forecasts/service";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/forecasts?period=2026-10|2026-Q4&brandId=&regionId= – forecast tree of the deals the caller may see. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const period = parsePeriod(sp.period);
  return Response.json({ data: { period: { key: period.key, type: period.type, label: period.label }, forecast: await getForecast(ctx, period, { brandId: sp.brandId, regionId: sp.regionId }) } });
});

/** POST /api/v1/forecasts – set a target { period, brandId, regionId?, userId?, units, revenue } (Head of Sales / Brand Manager). */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await setTarget(ctx, await req.json()) }, { status: 201 });
});
