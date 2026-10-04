import { apiHandler } from "@/server/api";
import { deleteHandler } from "@/server/modules/api/delete-route";
import { getLead } from "@/server/modules/leads/queries";
import { changeLeadOwner, updateLead } from "@/server/modules/leads/service";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

/** 404 for missing AND out-of-scope leads. */
export const GET = apiHandler<Params>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await getLead(ctx, (await params).id) });
});

/** PATCH fields; `ownerId` changes the owner (must have access to the lead's brand-region). */
export const PATCH = apiHandler<Params>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  const { ownerId, ...rest } = (await req.json()) as Record<string, unknown>;
  if (typeof ownerId === "string") await changeLeadOwner(ctx, id, ownerId);
  if (Object.keys(rest).length) await updateLead(ctx, id, rest as never);
  return Response.json({ data: await getLead(ctx, id) });
});

/** Soft delete – needs the delete permission; 404 outside the caller's scope. */
export const DELETE = deleteHandler("leads");
