import { timingSafeEqual } from "node:crypto";
import { logger } from "@/server/log";
import { tick } from "@/server/modules/workflow/engine";

/**
 * POST /api/public/cron/tick – the scheduler heartbeat (every minute or so) with `Authorization: Bearer
 * $CRON_SECRET`: evaluates scheduled workflow rules, runs due jobs, sends activity reminders and applies
 * approval auto-approvals. Every part is idempotent. Disabled (404) when CRON_SECRET is not configured.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  }
  const result = await tick();
  logger.info(result, "scheduler tick");
  return Response.json({ ok: true, ...result });
}
