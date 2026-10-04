import { apiHandler } from "@/server/api";
import { snapshot } from "@/server/modules/offline/service";
import { requireApiContext } from "@/server/request";

/** The caller's own open leads, deals and activities for the offline cache, with the scope fingerprint. */
export const GET = apiHandler(async () => {
  const ctx = await requireApiContext();
  return Response.json({ data: await snapshot(ctx) }, { headers: { "Cache-Control": "no-store" } });
});
