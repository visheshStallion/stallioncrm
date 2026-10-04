import { ZodError } from "zod";
import { BadRequestError } from "@/server/errors";
import { logger } from "@/server/log";
import { intakeCase } from "@/server/modules/cases/service";
import { rateLimit } from "@/server/rate-limit";

/**
 * Public case form / email-to-case gateway: POST /api/public/cases/HMNL (JSON or form-encoded;
 * `?channel=email` for a mail gateway). The brand comes from the URL only. Honeypot field `website`,
 * per-IP rate limit; the answer never reveals whether the customer is known.
 */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...CORS, ...extra } });

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request, { params }: { params: Promise<{ brandCode: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const limited = rateLimit(`web-case:${ip}`, Number(process.env.WEB_LEAD_RATE_LIMIT ?? 10), 10 * 60 * 1000);
  if (!limited.ok) return json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429, { "Retry-After": String(limited.retryAfterSec) });
  try {
    const type = req.headers.get("content-type") ?? "";
    const body = type.includes("application/json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
    const res = await intakeCase((await params).brandCode, body, new URL(req.url).searchParams.get("channel") === "email" ? "EMAIL" : "WEB");
    return json({ ok: true, ...(res.number ? { reference: res.number } : {}) }, 201);
  } catch (err) {
    if (err instanceof ZodError) return json({ error: { code: "VALIDATION", message: "Please fill in name, subject and message" } }, 400);
    if (err instanceof BadRequestError) return json({ error: { code: "BAD_REQUEST", message: err.message } }, 400);
    logger.error({ err }, "public case intake failed");
    return json({ error: { code: "INTERNAL", message: "Something went wrong" } }, 500);
  }
}
