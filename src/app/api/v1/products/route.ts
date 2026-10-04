import { apiHandler } from "@/server/api";
import { listMeta, parseApiPaging } from "@/server/modules/api/paging";
import { BadRequestError } from "@/server/errors";
import { listProducts } from "@/server/modules/catalogue/queries";
import { createProduct } from "@/server/modules/catalogue/service";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/products?brandId=&q=&active=true – only products of the caller's brands (product pickers use this). */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const paging = parseApiPaging(sp);
  const { rows, total } = await listProducts(ctx, { brandId: sp.brandId, q: sp.q, activeOnly: sp.active === "true", take: paging.per, skip: paging.skip });
  return Response.json({ data: rows, meta: listMeta(total, paging) });
});

/** POST { brandId, ...product } – Brand Manager of that brand or administrator. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const { brandId, ...body } = (await req.json()) as Record<string, unknown>;
  if (typeof brandId !== "string") throw new BadRequestError("brandId is required");
  return Response.json({ data: await createProduct(ctx, brandId, body as never) }, { status: 201 });
});
