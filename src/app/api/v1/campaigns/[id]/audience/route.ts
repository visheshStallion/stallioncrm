import { apiHandler } from "@/server/api";
import { buildAudience } from "@/server/modules/messaging/campaigns";
import { requireApiContext } from "@/server/request";

/** POST /api/v1/campaigns/:id/audience – (re)builds the members with the caller's access and the brand's consent. */
export const POST = apiHandler(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await buildAudience(ctx, (await params).id) });
});
