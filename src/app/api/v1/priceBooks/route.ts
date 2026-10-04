import { apiHandler } from "@/server/api";
import { listPriceBooks } from "@/server/modules/catalogue/queries";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/priceBooks?brandId= – price books of the caller's brands. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await listPriceBooks(ctx, new URL(req.url).searchParams.get("brandId")) });
});
