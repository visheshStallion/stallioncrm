import { applyDeliveryStatus } from "@/server/db/messaging-system";
import { receiveInbound } from "@/server/modules/messaging/service";
import { checkWebhookToken, denied } from "@/server/webhook-auth";

/**
 * SMS gateway webhook (Termii, Africa's Talking or any gateway that can call a URL with a token):
 *   POST /api/public/webhooks/sms?token=…                 – inbound SMS { to, from, text, id }
 *   POST /api/public/webhooks/sms?token=…&event=delivery  – delivery report { id, status }
 * JSON and form-encoded bodies are accepted; the usual field names of both providers are understood.
 * The brand is decided by the number that RECEIVED the SMS. Disabled (404) without MESSAGING_WEBHOOK_SECRET.
 */
async function fields(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]));
  }
  const form = await req.formData().catch(() => null);
  return form ? Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])) : {};
}
const pick = (f: Record<string, string>, ...keys: string[]) => keys.map((k) => f[k]).find((v) => v) ?? "";
const DELIVERY: Record<string, "DELIVERED" | "FAILED" | "SENT"> = { delivered: "DELIVERED", success: "DELIVERED", sent: "SENT", failed: "FAILED", rejected: "FAILED", expired: "FAILED", undelivered: "FAILED" };

export async function POST(req: Request) {
  const state = checkWebhookToken(req, process.env.MESSAGING_WEBHOOK_SECRET);
  if (state !== "ok") return denied(state);
  const f = await fields(req);
  if (new URL(req.url).searchParams.get("event") === "delivery" || (!pick(f, "text", "message", "sms") && pick(f, "status"))) {
    const status = DELIVERY[pick(f, "status").toLowerCase()];
    const id = pick(f, "id", "message_id", "messageId");
    const applied = id && status ? await applyDeliveryStatus(id, status, pick(f, "failureReason", "reason")) : false;
    return Response.json({ ok: true, applied });
  }
  const res = await receiveInbound({ channel: "SMS", receiver: pick(f, "to", "receiver", "shortCode"), from: pick(f, "from", "sender"), text: pick(f, "text", "message", "sms"), providerMessageId: pick(f, "id", "message_id", "messageId") || null });
  return Response.json({ ok: true, status: res.status });
}
