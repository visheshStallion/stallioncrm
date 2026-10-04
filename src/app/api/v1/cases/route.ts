import { apiHandler } from "@/server/api";
import { parsePaging } from "@/server/list/filters";
import { listCases } from "@/server/modules/cases/queries";
import { createCase } from "@/server/modules/cases/service";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/cases?queue=my|unassigned|breaching|open|all&q=&brandId=&regionId=&dealId=&accountId= – cases in the caller's scope. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const paging = parsePaging(sp);
  const { rows, total } = await listCases(ctx, { queue: sp.queue ?? "all", q: sp.q, type: sp.type, dealId: sp.dealId, accountId: sp.accountId }, { brandId: sp.brandId, regionId: sp.regionId }, { take: paging.per, skip: paging.skip });
  return Response.json({ data: rows, meta: { total, page: paging.page, per: paging.per } });
});

/** POST /api/v1/cases – with dealId the brand comes from the deal (404 when hidden); otherwise brandId + regionId (403 outside the caller's territories). */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await createCase(ctx, await req.json()) }, { status: 201 });
});
