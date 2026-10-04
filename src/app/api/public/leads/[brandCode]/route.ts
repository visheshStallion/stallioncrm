import { ZodError } from "zod";
import { BadRequestError } from "@/server/errors";
import { logger } from "@/server/log";
import { ADAPTERS, intakeLead, NotImplementedError } from "@/server/modules/leads/intake";
import { rateLimit } from "@/server/rate-limit";

/**
 * Public Web-to-Lead endpoint (prompt 02 §5). The brand comes from the URL only.
 *   POST /api/public/leads/HMNL            – website form (JSON or form-encoded)
 *   POST /api/public/leads/HMNL?channel=whatsapp|facebook – channel webhooks (adapter stubs)
 * Abuse controls: honeypot field `website`, per-IP rate limit, optional reCAPTCHA (RECAPTCHA_SECRET_KEY).
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const RATE_LIMIT = Number(process.env.WEB_LEAD_RATE_LIMIT ?? 10);
const RATE_WINDOW_MS = 10 * 60 * 1000;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, ...extra } });

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request, { params }: { params: Promise<{ brandCode: string }> }) {
  const { brandCode } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const limited = rateLimit(`web-lead:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limited.ok) {
    return json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429, { "Retry-After": String(limited.retryAfterSec) });
  }

  const channel = new URL(req.url).searchParams.get("channel") ?? "web";
  const adapter = ADAPTERS[channel];
  if (!adapter) return json({ error: { code: "BAD_REQUEST", message: "Unknown channel" } }, 400);

  try {
    const payloads = await adapter.parse(req);
    const results = [];
    for (const p of payloads) results.push(await intakeLead(brandCode, p, { source: adapter.source, ip }));
    // Same response for honeypot hits so bots learn nothing.
    return json({ ok: true }, 201);
  } catch (err) {
    if (err instanceof NotImplementedError) return json({ error: { code: "NOT_IMPLEMENTED", message: err.message } }, 501);
    if (err instanceof ZodError) {
      return json({ error: { code: "VALIDATION", message: err.issues[0]?.message ?? "Invalid input", issues: err.issues } }, 400);
    }
    if (err instanceof BadRequestError) return json({ error: { code: err.code, message: err.message } }, 400);
    logger.error({ err, brandCode }, "web lead intake failed");
    return json({ error: { code: "INTERNAL", message: "Could not accept the lead" } }, 500);
  }
}
