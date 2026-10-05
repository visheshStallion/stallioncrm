import { apiHandler } from "@/server/api";
import { listTemplates, saveTemplate } from "@/server/modules/messaging/campaigns";
import { hubApiList } from "@/server/modules/templates/hub";
import { requireApiContext } from "@/server/request";

/**
 * GET /api/v1/templates – message templates (group and the caller's brands), as before.
 * GET /api/v1/templates?type=email|document|record|sms|whatsapp[&module=deals] – the templates hub: every template
 * of that type the caller can see, with status, scope, owner, usage and where it is used.
 */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const q = new URL(req.url).searchParams;
  if (q.has("type") || q.has("module")) return Response.json({ data: await hubApiList(ctx, q.get("type"), q.get("module")) });
  return Response.json({ data: await listTemplates(ctx) });
});

/** POST /api/v1/templates – brand templates: the brand's manager; group templates: management. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await saveTemplate(ctx, null, await req.json()) }, { status: 201 });
});
