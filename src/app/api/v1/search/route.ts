import { apiHandler } from "@/server/api";
import { globalSearch } from "@/server/modules/search/queries";
import { requireApiContext } from "@/server/request";

export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ data: await globalSearch(ctx, q) });
});
