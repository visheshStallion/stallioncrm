import { apiHandler } from "@/server/api";
import { openApiDocument } from "@/server/modules/api/openapi";

/** GET /api/v1/docs – the OpenAPI 3.1 document of the API (public: it describes the API, it contains no data). */
export const GET = apiHandler(async (req) => {
  const base = (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  return Response.json(openApiDocument(base), { headers: { "Cache-Control": "public, max-age=300" } });
});
