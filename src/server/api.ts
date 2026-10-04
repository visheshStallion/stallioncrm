/**
 * Route-handler and server-action wrappers that map access errors to responses:
 * ForbiddenError → 403, NotFoundError (incl. Prisma "record not found") → 404, Unauthenticated → 401.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AccessError, isAccessError } from "@/server/access/errors";
import { BadRequestError, RateLimitError } from "@/server/errors";
import { logger } from "@/server/log";

export interface ApiErrorBody {
  error: { code: string; message: string; issues?: unknown };
}

export function toErrorResponse(err: unknown): { status: number; body: ApiErrorBody } {
  if (isAccessError(err)) {
    return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return { status: 404, body: { error: { code: "NOT_FOUND", message: "Not found" } } };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = (err.meta?.target as string[] | string | undefined) ?? "value";
    return {
      status: 400,
      body: { error: { code: "DUPLICATE", message: `${Array.isArray(target) ? target.join(", ") : target} already exists` } },
    };
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const message = first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input";
    return { status: 400, body: { error: { code: "VALIDATION", message, issues: err.issues } } };
  }
  if (err instanceof Error && err.message.includes("RECORD_LOCKED")) {
    return { status: 409, body: { error: { code: "LOCKED", message: "This record is locked while an approval is pending" } } };
  }
  if (err instanceof RateLimitError) {
    return { status: 429, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof BadRequestError) {
    return { status: 400, body: { error: { code: err.code, message: err.message } } };
  }
  logger.error({ err }, "unhandled error");
  return { status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong" } } };
}

type Handler<C> = (req: Request, context: C) => Promise<Response>;

/**
 * Wraps a route handler: maps errors to JSON responses and honours `Idempotency-Key` on POST requests made
 * with an API token – the first response is stored for 24 hours and replayed for the same key and body
 * (a different body with the same key is a 422).
 */
export function apiHandler<C>(fn: Handler<C>): Handler<C> {
  return async (req, context) => {
    try {
      const key = req.method === "POST" ? req.headers.get("idempotency-key") : null;
      const bearer = req.headers.get("authorization");
      if (key && bearer?.startsWith("Bearer scrm_")) return await idempotent(req, key.slice(0, 200), bearer, () => fn(req, context));
      return await fn(req, context);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      return Response.json(body, { status, headers: err instanceof RateLimitError ? { "Retry-After": String(err.retryAfterSec) } : undefined });
    }
  };
}

async function idempotent(req: Request, key: string, bearer: string, run: () => Promise<Response>): Promise<Response> {
  const { createHash } = await import("node:crypto");
  const store = await import("@/server/db/api-store");
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const scope = sha(bearer);
  const requestHash = sha(`${new URL(req.url).pathname}\n${await req.clone().text()}`);
  const seen = await store.findIdempotent(scope, key);
  if (seen) {
    if (seen.requestHash !== requestHash) return Response.json({ error: { code: "IDEMPOTENCY_MISMATCH", message: "This Idempotency-Key was used with a different request" } }, { status: 422 });
    return Response.json(seen.body, { status: seen.status, headers: { "Idempotent-Replay": "true" } });
  }
  let res: Response;
  try {
    res = await run();
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    res = Response.json(body, { status });
  }
  // Only successful JSON results are remembered: a failed attempt may be retried with the same key.
  if (res.status < 400 && (res.headers.get("content-type") ?? "").includes("json")) await store.storeIdempotent(scope, key, requestHash, res.status, await res.clone().json());
  return res;
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/** Server actions return a result instead of throwing, so the UI can show a toast. */
export async function safeAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    // Next.js redirect()/notFound() are control flow – let them through.
    if (err && typeof err === "object" && "digest" in err && !(err instanceof AccessError)) throw err;
    const { body } = toErrorResponse(err);
    return { ok: false, error: { code: body.error.code, message: body.error.message } };
  }
}
