import { apiHandler } from "@/server/api";
import { deleteHandler } from "@/server/modules/api/delete-route";
import { accountBrands, accountDeals, getAccount } from "@/server/modules/customers/queries";
import { updateAccount } from "@/server/modules/customers/service";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

/** Account (masked per tier) + accessible brands + accessible related deals – no hint of hidden ones. */
export const GET = apiHandler<Params>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  const account = await getAccount(ctx, id);
  const [brandIds, deals] = await Promise.all([accountBrands(ctx, id), accountDeals(ctx, { accountId: id })]);
  return Response.json({ data: { ...account, brandIds, deals } });
});

export const PATCH = apiHandler<Params>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  await updateAccount(ctx, id, await req.json());
  return Response.json({ data: await getAccount(ctx, id) });
});

/** Soft delete – needs the delete permission; 404 outside the caller's scope. */
export const DELETE = deleteHandler("accounts");
