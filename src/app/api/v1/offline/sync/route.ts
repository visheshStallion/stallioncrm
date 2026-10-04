import { apiHandler } from "@/server/api";
import { syncOutbox } from "@/server/modules/offline/service";
import { requireApiContext } from "@/server/request";

/** POST { ops: [{ key, type, payload, at }] } – quick actions recorded offline; each is applied at most once. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const body = (await req.json()) as { ops?: unknown };
  return Response.json({ data: await syncOutbox(ctx, body.ops) });
});
