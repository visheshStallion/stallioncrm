/**
 * Per-request access context for Server Components, Server Actions and route handlers.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAccessContext } from "@/server/access/context";
import { UnauthenticatedError } from "@/server/access/errors";
import { sanitizeFilters, type UiFilters } from "@/server/access/filters";
import type { AccessContext } from "@/server/access/types";
import { auth } from "@/server/auth";

export const FILTER_COOKIES = { brand: "crm_brand", region: "crm_region" } as const;

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** The signed-in user's access context, or null. Cached for the request. */
export const getRequestContext = cache(async (): Promise<AccessContext | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const ctx = await getAccessContext(userId);
  if (!ctx) return null;
  return { ...ctx, ip: await clientIp() };
});

/** Pages / actions: redirects to /login when not signed in (or deactivated). */
export async function requireContext(): Promise<AccessContext> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** `Authorization: Bearer scrm_…` → the token's access context (prompt 13). Cached for the request. */
const getTokenContext = cache(async (): Promise<AccessContext | null> => {
  const header = (await headers()).get("authorization");
  if (!header?.startsWith("Bearer scrm_")) return null;
  const { authenticateToken } = await import("@/server/modules/api/tokens");
  return { ...(await authenticateToken(header.slice(7).trim())), ip: await clientIp() };
});

/**
 * Route handlers: the API token's context when a bearer token is sent, otherwise the session's.
 * Throws UnauthenticatedError (→ 401).
 */
export async function requireApiContext(): Promise<AccessContext> {
  const ctx = (await getTokenContext()) ?? (await getRequestContext());
  if (!ctx) throw new UnauthenticatedError();
  return ctx;
}

/** Brand switcher / region filter from cookies, sanitized against the user's access. */
export async function getUiFilters(ctx: AccessContext): Promise<UiFilters> {
  const c = await cookies();
  return sanitizeFilters(ctx, {
    brandId: c.get(FILTER_COOKIES.brand)?.value ?? null,
    regionId: c.get(FILTER_COOKIES.region)?.value ?? null,
  });
}
