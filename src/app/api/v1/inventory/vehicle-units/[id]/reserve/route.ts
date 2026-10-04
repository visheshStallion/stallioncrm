import { apiHandler } from "@/server/api";
import { BadRequestError } from "@/server/errors";
import { reserveVin } from "@/server/modules/catalogue/service";
import { getUnit } from "@/server/modules/inventory/queries";
import { requireApiContext } from "@/server/request";

/** POST { dealId } – reserves the unit for a deal the caller can edit (same brand; one winner when two try at once). */
export const POST = apiHandler<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  const { dealId } = (await req.json()) as { dealId?: string };
  if (!dealId) throw new BadRequestError("dealId is required");
  await reserveVin(ctx, dealId, id);
  return Response.json({ data: await getUnit(ctx, id) });
});
