import { applyDeliveryStatus } from "@/server/db/messaging-system";
import { checkWebhookToken, denied } from "@/server/webhook-auth";

/**
 * Email event webhook: POST /api/public/webhooks/email?token=…  with one event or an array of
 * { messageId, event: delivered | opened | clicked | bounced | failed, reason? }. Updates the message and its
 * campaign member. Disabled (404) without MESSAGING_WEBHOOK_SECRET.
 */
const EVENT: Record<string, "DELIVERED" | "OPENED" | "CLICKED" | "FAILED"> = { delivered: "DELIVERED", opened: "OPENED", open: "OPENED", clicked: "CLICKED", click: "CLICKED", bounced: "FAILED", bounce: "FAILED", failed: "FAILED", dropped: "FAILED" };

export async function POST(req: Request) {
  const state = checkWebhookToken(req, process.env.MESSAGING_WEBHOOK_SECRET);
  if (state !== "ok") return denied(state);
  const body = (await req.json().catch(() => null)) as unknown;
  const events = (Array.isArray(body) ? body : body ? [body] : []).slice(0, 500) as Array<{ messageId?: string; event?: string; reason?: string }>;
  let applied = 0;
  for (const e of events) {
    const status = EVENT[String(e.event ?? "").toLowerCase()];
    if (e.messageId && status && (await applyDeliveryStatus(String(e.messageId), status, e.reason))) applied++;
  }
  return Response.json({ ok: true, applied });
}
