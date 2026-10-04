import { applyDeliveryStatus } from "@/server/db/messaging-system";
import { logger } from "@/server/log";
import { receiveInbound } from "@/server/modules/messaging/service";
import { checkWebhookToken, denied, verifyMetaSignature } from "@/server/webhook-auth";

/**
 * WhatsApp Business Cloud API webhook.
 *   GET  – subscription check (hub.verify_token = WHATSAPP_VERIFY_TOKEN).
 *   POST – inbound messages and delivery statuses. Authenticated by Meta's signature (WHATSAPP_APP_SECRET) or,
 *          for other gateways / the sandbox, by the shared MESSAGING_WEBHOOK_SECRET token. Disabled (404) when
 *          neither secret is configured.
 * The brand is decided by the phone-number id that RECEIVED the message.
 */
export function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === token) return new Response(sp.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

interface Value {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: Array<{ from?: string; id?: string; type?: string; text?: { body?: string }; button?: { text?: string } }>;
  statuses?: Array<{ id?: string; status?: string; errors?: Array<{ title?: string }> }>;
}
const STATUS: Record<string, "SENT" | "DELIVERED" | "OPENED" | "FAILED"> = { sent: "SENT", delivered: "DELIVERED", read: "OPENED", failed: "FAILED" };

export async function POST(req: Request) {
  const raw = await req.text();
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret && req.headers.get("x-hub-signature-256")) {
    if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) return denied("denied");
  } else {
    const state = checkWebhookToken(req, process.env.MESSAGING_WEBHOOK_SECRET);
    if (state !== "ok") return denied(appSecret ? "denied" : state);
  }
  let body: { entry?: Array<{ changes?: Array<{ value?: Value }> }> };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON" } }, { status: 400 });
  }
  let received = 0;
  let statuses = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const receiver = v.metadata?.phone_number_id ?? v.metadata?.display_phone_number ?? "";
      for (const m of v.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? (m.type ? `[${m.type}]` : "");
        if (!m.from || !text) continue;
        try {
          const res = await receiveInbound({ channel: "WHATSAPP", receiver, from: `+${m.from.replace(/\D/g, "")}`, text, providerMessageId: m.id ?? null, senderName: v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null });
          if (res.status !== "ignored") received++;
        } catch (err) {
          logger.error({ err }, "inbound WhatsApp message could not be processed");
        }
      }
      for (const s of v.statuses ?? []) {
        const status = STATUS[s.status ?? ""];
        if (s.id && status && (await applyDeliveryStatus(s.id, status, s.errors?.[0]?.title))) statuses++;
      }
    }
  }
  // Always 200 for authenticated calls: providers retry on anything else.
  return Response.json({ ok: true, received, statuses });
}
