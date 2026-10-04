import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Shared-secret check for provider webhooks: `?token=` or `Authorization: Bearer`. Returns "disabled" when the
 * secret is not configured (the endpoint answers 404 – nothing is accepted without a secret).
 */
export function checkWebhookToken(req: Request, secret: string | undefined): "ok" | "denied" | "disabled" {
  if (!secret) return "disabled";
  const given = new URL(req.url).searchParams.get("token") ?? req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return equal(given, secret) ? "ok" : "denied";
}

/** Meta (WhatsApp Cloud API) signature: `X-Hub-Signature-256: sha256=<hmac of the raw body>`. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  return equal(header.slice(7), createHmac("sha256", appSecret).update(rawBody).digest("hex"));
}

export const denied = (state: "denied" | "disabled") =>
  state === "disabled" ? Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 }) : Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
