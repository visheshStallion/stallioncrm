import { apiHandler } from "@/server/api";
import { fieldMask, fieldMaskMany } from "@/server/access/field-mask";
import { listMeta, parseApiPaging } from "@/server/modules/api/paging";
import { conditionsToWhere, parseConditions } from "@/server/list/filters";
import { dealFilterFields, listDeals } from "@/server/modules/deals/queries";
import { createDeal } from "@/server/modules/deals/service";
import { requireApiContext } from "@/server/request";

/**
 * GET /api/v1/deals?brandId=&regionId=&pipelineId=&q=&f=field~op~value&page=&per= – deals in the caller's scope
 * (brand / region / filters only narrow).
 */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
  const paging = parseApiPaging(sp);
  const fields = dealFilterFields({ brands: [], regions: [], users: [] }).filter((f) => !["brandId", "regionId", "ownerId"].includes(f.key));
  const q = sp.q?.trim();
  // ?sort=amount | -amount | closeDate | -closeDate | createdAt | -createdAt | name | -name
  const sortKey = sp.sort?.replace(/^-/, "");
  const orderBy = sortKey && ["amount", "closeDate", "createdAt", "name"].includes(sortKey) ? [{ [sortKey]: sp.sort!.startsWith("-") ? "desc" : "asc" } as never, { id: "asc" } as never] : undefined;
  const { rows, total } = await listDeals(
    ctx,
    { brandId: sp.brandId, regionId: sp.regionId },
    {
      take: paging.per,
      skip: paging.skip,
      ...(orderBy ? { orderBy } : {}),
      where: {
        AND: [
          conditionsToWhere(parseConditions(url.searchParams.getAll("f"), fields), fields),
          sp.pipelineId ? { pipelineId: sp.pipelineId } : {},
          sp.ownerId ? { ownerId: sp.ownerId } : {},
          q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }] } : {},
        ],
      },
    },
  );
  return Response.json({ data: fieldMaskMany(ctx, "deals", rows), meta: listMeta(total, paging) });
});

/** POST /api/v1/deals – 403 when the brand/region is outside the caller's territories. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const deal = await createDeal(ctx, await req.json());
  return Response.json({ data: fieldMask(ctx, "deals", deal) }, { status: 201 });
});
