import { apiHandler } from "@/server/api";
import { createFromTemplate } from "@/server/modules/rectpl/service";
import { requireApiContext } from "@/server/request";

/**
 * POST /api/v1/{module}/from-template/{id} – creates a record of the module (leads, deals, cases, accounts,
 * contacts, quotes) from a published record template the caller may use. The body holds the values the caller adds
 * (e.g. the customer's name; for quotes `{ "dealId": "…" }`); locked and hidden fields of the template cannot be
 * overridden. The record is created by the module's own service with the caller's access. 404 for a template of
 * another brand or module.
 */
export const POST = apiHandler<{ params: Promise<{ module: string; id: string }> }>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { module, id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return Response.json({ data: await createFromTemplate(ctx, module, id, body && typeof body === "object" ? body : {}) }, { status: 201 });
});
