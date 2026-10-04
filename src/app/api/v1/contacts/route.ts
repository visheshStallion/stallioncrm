import { apiHandler } from "@/server/api";
import { listMeta, parseApiPaging } from "@/server/modules/api/paging";
import { listContacts } from "@/server/modules/customers/queries";
import { createContact } from "@/server/modules/customers/service";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/contacts?q=&page=&per= – shared customers, masked per the caller's field tier (same as the UI). */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const paging = parseApiPaging(sp);
  const { rows, total } = await listContacts(ctx, { q: sp.q, take: paging.per, skip: paging.skip });
  return Response.json({ data: rows, meta: listMeta(total, paging) });
});

export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await createContact(ctx, await req.json()) }, { status: 201 });
});
