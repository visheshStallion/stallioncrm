import { apiHandler } from "@/server/api";
import { getDeal } from "@/server/modules/deals/queries";
import { updateDeal } from "@/server/modules/deals/service";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

/** 404 for missing AND out-of-scope deals. */
export const GET = apiHandler<Params>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  return Response.json({ data: await getDeal(ctx, id) });
});

export const PATCH = apiHandler<Params>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  return Response.json({ data: await updateDeal(ctx, id, await req.json()) });
});
