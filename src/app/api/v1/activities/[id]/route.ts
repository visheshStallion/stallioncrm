import { apiHandler } from "@/server/api";
import { fieldMask } from "@/server/access/field-mask";
import { deleteHandler } from "@/server/modules/api/delete-route";
import { getActivity } from "@/server/modules/activities/queries";
import { updateActivity } from "@/server/modules/activities/service";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/activities/:id – 404 for missing and out-of-scope activities alike. */
export const GET = apiHandler(async (_req, { params }: Params) => {
  const ctx = await requireApiContext();
  return Response.json({ data: fieldMask(ctx, "activities", await getActivity(ctx, (await params).id)) });
});

/** PATCH /api/v1/activities/:id – reschedule / edit an open activity. */
export const PATCH = apiHandler(async (req, { params }: Params) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await updateActivity(ctx, (await params).id, await req.json()) });
});

/** Soft delete – needs the delete permission; 404 outside the caller's scope. */
export const DELETE = deleteHandler("activities");
