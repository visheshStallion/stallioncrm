import { apiHandler } from "@/server/api";
import { createPaymentLink, invoicePaymentLinks } from "@/server/integrations/payments";
import { requireApiContext } from "@/server/request";

type Params = { params: Promise<{ id: string }> };

/** Payment links of an invoice the caller can see. */
export const GET = apiHandler<Params>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await invoicePaymentLinks(ctx, (await params).id) });
});

/** POST { provider?, amount?, email? } – online payment link for the balance (or a deposit) of an issued invoice. */
export const POST = apiHandler<Params>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const body = (await req.json().catch(() => ({}))) as { provider?: string; amount?: number; email?: string };
  return Response.json({ data: await createPaymentLink(ctx, (await params).id, body) }, { status: 201 });
});
