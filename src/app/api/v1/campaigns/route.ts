import { apiHandler } from "@/server/api";
import { createCampaign, listCampaigns } from "@/server/modules/messaging/campaigns";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/campaigns?brandId= – campaigns of the caller's brands. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await listCampaigns(ctx, { brandId: new URL(req.url).searchParams.get("brandId") }) });
});

/** POST /api/v1/campaigns – { brandId, name, type, channel, budget?, templateId?, audience }. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await createCampaign(ctx, await req.json()) }, { status: 201 });
});
