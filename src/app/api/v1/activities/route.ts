import { apiHandler } from "@/server/api";
import { fieldMaskMany } from "@/server/access/field-mask";
import { listMeta, parseApiPaging } from "@/server/modules/api/paging";
import { listActivities } from "@/server/modules/activities/queries";
import { createActivity } from "@/server/modules/activities/service";
import { requireApiContext } from "@/server/request";

/**
 * GET /api/v1/activities?view=my|open|overdue|today|all&type=&ownerId=&parentType=&parentId=&from=&to=&q=&brandId=&regionId=
 * Activities in the caller's scope only (they inherit brand and region from their parent record).
 */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const paging = parseApiPaging(sp);
  const date = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);
  const { rows, total } = await listActivities(
    ctx,
    { view: sp.view ?? "all", type: sp.type, ownerIds: sp.ownerId ? [sp.ownerId] : undefined, parentType: sp.parentType, parentId: sp.parentId, from: date(sp.from), to: date(sp.to), q: sp.q },
    { brandId: sp.brandId, regionId: sp.regionId },
    { take: paging.per, skip: paging.skip },
  );
  return Response.json({ data: fieldMaskMany(ctx, "activities", rows), meta: listMeta(total, paging) });
});

/** POST /api/v1/activities – 404 when the parent record is hidden, 400 when a demo vehicle is double-booked. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const activity = await createActivity(ctx, await req.json());
  return Response.json({ data: activity }, { status: 201 });
});
