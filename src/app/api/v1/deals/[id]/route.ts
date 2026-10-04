import { apiHandler } from "@/server/api";
import { getDeal } from "@/server/modules/deals/queries";
import { changeDealOwner, moveDealStage, updateDeal } from "@/server/modules/deals/service";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

/** 404 for missing AND out-of-scope deals. */
export const GET = apiHandler<Params>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await getDeal(ctx, (await params).id) });
});

/**
 * PATCH fields. `stageId` performs a Blueprint move (the other fields in the body count towards the stage's
 * requirements); `ownerId` changes the owner. A hidden deal returns 404, never 403.
 */
export const PATCH = apiHandler<Params>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  await getDeal(ctx, id); // 404 first
  const { stageId, ownerId, ...rest } = (await req.json()) as Record<string, unknown>;
  if (typeof ownerId === "string") await changeDealOwner(ctx, id, ownerId);
  if (typeof stageId === "string") await moveDealStage(ctx, id, stageId, rest as never);
  else if (Object.keys(rest).length) await updateDeal(ctx, id, rest as never);
  return Response.json({ data: await getDeal(ctx, id) });
});
