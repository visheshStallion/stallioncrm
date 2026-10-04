import { apiHandler } from "@/server/api";
import { launchCampaign } from "@/server/modules/messaging/campaigns";
import { requireApiContext } from "@/server/request";

/** POST /api/v1/campaigns/:id/launch – needs the massEmail permission (403 otherwise). */
export const POST = apiHandler(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await launchCampaign(ctx, (await params).id) });
});
