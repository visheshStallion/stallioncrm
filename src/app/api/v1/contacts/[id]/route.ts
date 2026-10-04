import { apiHandler } from "@/server/api";
import { deleteHandler } from "@/server/modules/api/delete-route";
import { accountDeals, contactConsents, getContact } from "@/server/modules/customers/queries";
import { updateContact } from "@/server/modules/customers/service";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

export const GET = apiHandler<Params>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  const contact = await getContact(ctx, id);
  const [consents, deals] = await Promise.all([contactConsents(ctx, id), accountDeals(ctx, { contactId: id })]);
  return Response.json({ data: { ...contact, consents, deals } });
});

export const PATCH = apiHandler<Params>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const { id } = await params;
  await updateContact(ctx, id, await req.json());
  return Response.json({ data: await getContact(ctx, id) });
});

/** Soft delete – needs the delete permission; 404 outside the caller's scope. */
export const DELETE = deleteHandler("contacts");
