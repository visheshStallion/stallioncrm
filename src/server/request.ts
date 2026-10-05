/**
 * Per-request access context for Server Components, Server Actions and route handlers.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAccessContext } from "@/server/access/context";
import { ForbiddenError, UnauthenticatedError } from "@/server/access/errors";
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
  // Session settings (Setup → Security Control): maximum session length and "sign out all sessions".
  const loginAt = (session as { loginAt?: number | null }).loginAt;
  if (typeof loginAt === "number") {
    const { getSetting } = await import("@/server/modules/setup/service");
    const policy = await getSetting("sessionPolicy");
    if (Date.now() - loginAt > policy.maxHours * 3_600_000) return null;
    if (ctx.sessionsValidAfter && loginAt < ctx.sessionsValidAfter.getTime()) return null;
  }
  return { ...ctx, ip: await clientIp() };
});

/**
 * What the security policies still require from this user before they can work: switch on two-step sign-in
 * (MFA policy of the profile) or choose a new password (password expiry). Null = nothing.
 */
export const securityRequirement = cache(async (ctx: AccessContext): Promise<"two-step" | "password" | null> => {
  const { getSetting } = await import("@/server/modules/setup/service");
  const { passwordExpired } = await import("@/server/modules/setup/settings");
  const [mfa, password] = await Promise.all([getSetting("mfaPolicy"), getSetting("passwordPolicy")]);
  if (!ctx.twoStep && mfa.requiredProfileIds.includes(ctx.profile.id)) return "two-step";
  if (passwordExpired(password, ctx.passwordChangedAt ?? null)) return "password";
  return null;
});

/** Pages / actions: redirects to /login when not signed in (or deactivated), and to Sign-in security while a policy requires it. */
export async function requireContext(): Promise<AccessContext> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  const path = (await headers()).get("x-crm-path");
  if (path && !path.startsWith("/security")) {
    const need = await securityRequirement(ctx);
    if (need) redirect(`/security?required=${need}`);
  }
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
  const token = await getTokenContext();
  const ctx = token ?? (await getRequestContext());
  if (!ctx) throw new UnauthenticatedError();
  // a browser session that still owes a security step (two-step sign-in, new password) cannot use the API either
  if (!token && (await securityRequirement(ctx))) throw new ForbiddenError("Complete the step on the Sign-in security page first");
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
