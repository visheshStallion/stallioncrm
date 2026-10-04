/**
 * Route-handler and server-action wrappers that map access errors to responses:
 * ForbiddenError → 403, NotFoundError (incl. Prisma "record not found") → 404, Unauthenticated → 401.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AccessError, isAccessError } from "@/server/access/errors";
import { BadRequestError } from "@/server/errors";
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
  if (err instanceof BadRequestError) {
    return { status: 400, body: { error: { code: err.code, message: err.message } } };
  }
  logger.error({ err }, "unhandled error");
  return { status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong" } } };
}

type Handler<C> = (req: Request, context: C) => Promise<Response>;

export function apiHandler<C>(fn: Handler<C>): Handler<C> {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      return Response.json(body, { status });
    }
  };
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
