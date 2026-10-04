import { apiHandler } from "@/server/api";
import { getActivity } from "@/server/modules/activities/queries";
import { updateActivity } from "@/server/modules/activities/service";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/activities/:id – 404 for missing and out-of-scope activities alike. */
export const GET = apiHandler(async (_req, { params }: Params) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await getActivity(ctx, (await params).id) });
});

/** PATCH /api/v1/activities/:id – reschedule / edit an open activity. */
export const PATCH = apiHandler(async (req, { params }: Params) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await updateActivity(ctx, (await params).id, await req.json()) });
});
