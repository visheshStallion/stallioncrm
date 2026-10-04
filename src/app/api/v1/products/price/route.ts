import { apiHandler } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { getPrice } from "@/server/modules/catalogue/queries";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/products/price?productId=&date=YYYY-MM-DD&priceBookId= – price resolution. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = new URL(req.url).searchParams;
  const productId = sp.get("productId");
  if (!productId) throw new BadRequestError("productId is required");
  const date = sp.get("date") ? new Date(`${sp.get("date")}T00:00:00Z`) : new Date();
  if (Number.isNaN(date.getTime())) throw new BadRequestError("Invalid date");
  return Response.json({ data: await getPrice(ctx, productId, date, sp.get("priceBookId")) });
});
