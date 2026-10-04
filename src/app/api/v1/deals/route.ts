import { z } from "zod";
import { apiHandler } from "@/server/api";
import { listDeals } from "@/server/modules/deals/queries";
import { createDeal } from "@/server/modules/deals/service";
import { requireApiContext } from "@/server/request";

const listParams = z.object({
  brandId: z.string().optional(),
  regionId: z.string().optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
  skip: z.coerce.number().int().min(0).default(0),
});

/** GET /api/v1/deals – deals in the caller's scope (filters only narrow). */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const p = listParams.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { rows, total } = await listDeals(ctx, { brandId: p.brandId, regionId: p.regionId }, p);
  return Response.json({ data: rows, meta: { total, take: p.take, skip: p.skip } });
});

/** POST /api/v1/deals – 403 when the brand/region is outside the caller's territories. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const deal = await createDeal(ctx, await req.json());
  return Response.json({ data: deal }, { status: 201 });
});
