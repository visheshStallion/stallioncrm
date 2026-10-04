import { apiHandler } from "@/server/api";
import { recordMessages, sendMessage } from "@/server/modules/messaging/service";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/messages?parentType=Lead|Deal&parentId= – messages of a record the caller can see (else empty). */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = new URL(req.url).searchParams;
  return Response.json({ data: await recordMessages(ctx, sp.get("parentType") ?? "", sp.get("parentId") ?? "") });
});

/**
 * POST /api/v1/messages – { channel, parentType, parentId, templateId?, subject?, body? }. The sender is always
 * the brand of the record; 404 when the record is hidden.
 */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const res = await sendMessage(ctx, await req.json());
  return Response.json({ data: res }, { status: res.status === "SENT" ? 201 : 502 });
});
