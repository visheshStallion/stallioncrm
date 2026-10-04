import { isAccessError } from "@/server/access/errors";
import { RateLimitError } from "@/server/errors";
import { logger } from "@/server/log";
import { issueClientToken } from "@/server/modules/api/tokens";

const fail = (status: number, error: string, headers?: HeadersInit) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * OAuth2 token endpoint (RFC 6749 §4.4, client credentials). Credentials as HTTP Basic or in the form body;
 * answers with a one-hour bearer token that acts as the client's integration principal.
 */
export async function POST(req: Request) {
  try {
    const type = req.headers.get("content-type") ?? "";
    const body: Record<string, string> = type.includes("json") ? ((await req.json()) as Record<string, string>) : Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
    if (body.grant_type !== "client_credentials") return fail(400, "unsupported_grant_type");
    let id = body.client_id ?? "";
    let secret = body.client_secret ?? "";
    const basic = req.headers.get("authorization");
    if (basic?.startsWith("Basic ")) {
      const [u, ...p] = Buffer.from(basic.slice(6), "base64").toString().split(":");
      id = decodeURIComponent(u ?? "");
      secret = decodeURIComponent(p.join(":"));
    }
    if (!id || !secret) return fail(400, "invalid_request");
    return Response.json(await issueClientToken(id, secret), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof RateLimitError) return fail(429, "slow_down", { "Retry-After": String(err.retryAfterSec) });
    if (isAccessError(err)) return fail(401, "invalid_client");
    logger.error({ err }, "oauth token endpoint failed");
    return fail(400, "invalid_request");
  }
}
