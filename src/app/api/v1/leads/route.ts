import { apiHandler } from "@/server/api";
import { listMeta, parseApiPaging } from "@/server/modules/api/paging";
import { listLeads } from "@/server/modules/leads/queries";
import { parseLeadFilters } from "@/server/modules/leads/schema";
import { createLead } from "@/server/modules/leads/service";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/leads?status=&source=&brandId=&regionId=&ownerId=&mine=&from=&to=&q=&take=&skip= (scoped) */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  if (sp.cursor !== undefined || sp.limit !== undefined) {
    const paging = parseApiPaging(sp);
    const page = await listLeads(ctx, parseLeadFilters(sp), { take: paging.per, skip: paging.skip });
    return Response.json({ data: page.rows, meta: listMeta(page.total, paging) });
  }
  const take = Math.min(Math.max(Number(sp.take ?? 100) || 100, 1), 500);
  const skip = Math.max(Number(sp.skip ?? 0) || 0, 0);
  const { rows, total } = await listLeads(ctx, parseLeadFilters(sp), { take, skip });
  return Response.json({ data: rows, meta: { total, take, skip, nextCursor: null } });
});

/** POST /api/v1/leads – body as CreateLeadInput; `autoAssign: true` applies the assignment rules. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const body = (await req.json()) as Record<string, unknown>;
  const lead = await createLead(ctx, body as never, { autoAssign: body.autoAssign === true });
  return Response.json({ data: lead }, { status: 201 });
});
