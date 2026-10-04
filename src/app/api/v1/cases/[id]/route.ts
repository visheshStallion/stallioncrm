import { apiHandler } from "@/server/api";
import { getCase } from "@/server/modules/cases/queries";
import { assignCase, changeCaseStatus, updateCase } from "@/server/modules/cases/service";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/cases/:id (id or case number) – 404 for missing and out-of-scope cases alike. */
export const GET = apiHandler(async (_req, { params }: Params) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await getCase(ctx, (await params).id) });
});

/** PATCH /api/v1/cases/:id – fields; `status` (+ `resolution`) changes the status; `ownerId` reassigns ("" = take it). */
export const PATCH = apiHandler(async (req, { params }: Params) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  const { status, resolution, ownerId, ...fields } = (await req.json()) as Record<string, unknown>;
  if (Object.keys(fields).length) await updateCase(ctx, id, fields as never);
  if (ownerId !== undefined) await assignCase(ctx, id, (ownerId as string) || null);
  if (status) await changeCaseStatus(ctx, id, { status: String(status), resolution: (resolution as string | undefined) ?? null });
  return Response.json({ data: await getCase(ctx, id) });
});
