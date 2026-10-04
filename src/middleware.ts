import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_PATHS } from "@/server/auth/config";

/**
 * Only checks that a valid session token exists; authorisation happens server-side with the access engine.
 * Uses getToken (verify only) instead of the Auth.js middleware wrapper: the wrapper re-issues the session
 * cookie on every request, so an in-flight prefetch could resurrect a session right after sign-out.
 */
export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  // API tokens (prompt 13): validated by the route handler (requireApiContext) – never for pages.
  if (pathname.startsWith("/api/v1/") && req.headers.get("authorization")?.startsWith("Bearer scrm_")) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: req.nextUrl.protocol === "https:",
  });
  if (token?.sub) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Not signed in" } }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  login.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
