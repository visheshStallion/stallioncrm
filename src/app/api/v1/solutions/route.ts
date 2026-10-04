import { apiHandler } from "@/server/api";
import { listSolutions, saveSolution } from "@/server/modules/cases/admin";
import { requireApiContext } from "@/server/request";

/** GET /api/v1/solutions?q=&tag= – group articles and those of the caller's brands (drafts only for their managers). */
export const GET = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  const sp = new URL(req.url).searchParams;
  return Response.json({ data: await listSolutions(ctx, { q: sp.get("q") ?? undefined, tag: sp.get("tag") ?? undefined }) });
});

/** POST /api/v1/solutions – brand articles: the brand's manager; group articles: management. */
export const POST = apiHandler(async (req) => {
  const ctx = await requireApiContext();
  return Response.json({ data: await saveSolution(ctx, null, await req.json()) }, { status: 201 });
});
