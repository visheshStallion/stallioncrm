import { apiHandler } from "@/server/api";
import { getPriceBook } from "@/server/modules/catalogue/queries";
import { requireApiContext } from "@/server/request";

export const GET = apiHandler<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await getPriceBook(ctx, (await params).id) });
});
