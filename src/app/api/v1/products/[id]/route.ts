import { apiHandler } from "@/server/api";
import { getProduct } from "@/server/modules/catalogue/queries";
import { updateProduct } from "@/server/modules/catalogue/service";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

/** 404 for products of brands the caller does not work in. */
export const GET = apiHandler<Params>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await getProduct(ctx, (await params).id) });
});

export const PATCH = apiHandler<Params>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  const current = await getProduct(ctx, id);
  await updateProduct(ctx, id, { ...current, ...((await req.json()) as object) } as never);
  return Response.json({ data: await getProduct(ctx, id) });
});
