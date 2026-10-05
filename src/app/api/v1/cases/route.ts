import { apiHandler } from "@/server/api";
import { fieldMask, fieldMaskMany } from "@/server/access/field-mask";
import { listMeta, parseApiPaging } from "@/server/modules/api/paging";
import { listCases } from "@/server/modules/cases/queries";
import { createCase } from "@/server/modules/cases/service";
import { requireApiContext } from "@/server/request";
import { createWithTemplate } from "@/server/modules/rectpl/service";

/** GET /api/v1/cases?queue=my|unassigned|breaching|open|all&q=&brandId=&regionId=&dealId=&accountId= – cases in the caller's scope. */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const paging = parseApiPaging(sp);
  const { rows, total } = await listCases(ctx, { queue: sp.queue ?? "all", q: sp.q, type: sp.type, dealId: sp.dealId, accountId: sp.accountId }, { brandId: sp.brandId, regionId: sp.regionId }, { take: paging.per, skip: paging.skip });
  return Response.json({ data: fieldMaskMany(ctx, "cases", rows), meta: listMeta(total, paging) });
});

/** POST /api/v1/cases – with dealId the brand comes from the deal (404 when hidden); otherwise brandId + regionId (403 outside the caller's territories). */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const { templateId, ...input } = (await req.json()) as Record<string, unknown>;
  const made = await createWithTemplate(ctx, "cases", typeof templateId === "string" ? templateId : null, input, (i) => createCase(ctx, i as never));
  return Response.json({ data: fieldMask(ctx, "cases", made.record) }, { status: 201 });
});
