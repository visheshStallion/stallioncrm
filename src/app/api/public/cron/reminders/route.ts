import { timingSafeEqual } from "node:crypto";
import type { AccessContext } from "@/server/access/types";
import { logger } from "@/server/log";
import { processReminders } from "@/server/modules/activities/service";

/**
 * POST /api/public/cron/reminders – called by the scheduler every few minutes with `Authorization: Bearer
 * $CRON_SECRET`. Turns due activity reminders into in-app notifications (email delivery joins with prompt 10).
 * Disabled (404) when CRON_SECRET is not configured.
 */
const systemContext: AccessContext = {
  userId: "",
  user: { name: "Scheduler", email: "", roleName: "System" },
  scope: "ALL",
  profile: { id: "system", name: "System", permissions: { activities: { read: true, edit: true } }, fieldPermissions: {} },
  memberships: [],
  brandIds: [],
  isAdmin: false,
  system: true,
};

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  }
  const sent = await processReminders(systemContext);
  logger.info({ sent }, "activity reminders processed");
  return Response.json({ ok: true, sent });
}
