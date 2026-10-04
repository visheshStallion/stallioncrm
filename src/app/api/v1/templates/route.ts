import { apiHandler } from "@/server/api";
import { listTemplates, saveTemplate } from "@/server/modules/messaging/campaigns";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/templates – group templates and those of the caller's brands. */
export const GET = apiHandler(async () => {
  const ctx = await requireApiContext();
  return Response.json({ data: await listTemplates(ctx) });
});

/** POST /api/v1/templates – brand templates: the brand's manager; group templates: management. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await saveTemplate(ctx, null, await req.json()) }, { status: 201 });
});
