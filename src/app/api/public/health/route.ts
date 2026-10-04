import { pingDatabase } from "@/server/db/system";

export const dynamic = "force-dynamic";

/**
 * Health check for load balancers and uptime monitors: 200 when the application answers and the database is
 * reachable, 503 otherwise. No data, no version details.
 */
export async function GET() {
  const database = await pingDatabase();
  return Response.json({ status: database ? "ok" : "degraded", database, time: new Date().toISOString() }, { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
