import { apiHandler } from "@/server/api";
import { campaignStats, getCampaign, updateCampaign } from "@/server/modules/messaging/campaigns";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/campaigns/:id – campaign with member funnel and ROI; 404 for other brands' campaigns. */
export const GET = apiHandler(async (_req, { params }: Params) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  const [campaign, stats] = [await getCampaign(ctx, id), await campaignStats(ctx, id)];
  return Response.json({ data: { ...campaign, stats } });
});

/** PATCH /api/v1/campaigns/:id – change a draft campaign. */
export const PATCH = apiHandler(async (req, { params }: Params) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await updateCampaign(ctx, (await params).id, await req.json()) });
});
