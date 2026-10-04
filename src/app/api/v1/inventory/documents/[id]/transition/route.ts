import { apiHandler } from "@/server/api";
import { transition } from "@/server/modules/inventory/service";
import { requireApiContext } from "@/server/request";

/** POST { action, amount?, note? } – submit / approve / receive / allocate / ship … (the same rules as the buttons in the UI). */
export const POST = apiHandler<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const body = (await req.json()) as { action?: string; amount?: number; note?: string };
  return Response.json({ data: await transition(ctx, (await params).id, String(body.action ?? ""), { amount: body.amount, note: body.note }) });
});
