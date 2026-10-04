import { apiHandler } from "@/server/api";
import { lookupVin } from "@/server/modules/inventory/queries";
import { requireApiContext } from "@/server/request";

/** Scanner lookup: GET ?vin= – a VIN of another brand is "not found" (404), exactly like an unknown VIN. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await lookupVin(ctx, new URL(req.url).searchParams.get("vin") ?? "") });
});
