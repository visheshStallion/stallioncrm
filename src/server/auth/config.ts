/**
 * Shared Auth.js config (no database or native modules). Middleware only verifies the token (see src/middleware.ts).
 * The JWT carries the user id ONLY; the access context is loaded server-side per request.
 */
import type { NextAuthConfig } from "next-auth";

/** No session required. /api/public = web-to-lead and channel webhooks (own abuse controls). */
export const PUBLIC_PATHS = ["/login", "/api/auth", "/api/public", "/api/v1/docs", "/sw.js", "/manifest.webmanifest", "/offline"];

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      // Strip name / email / picture: the token only identifies the user.
      const sub = user?.id ?? token.sub;
      // `lat` = when the user signed in (ms): session length and "sign out all sessions" are checked against it
      return sub ? { sub, lat: user ? Date.now() : token.lat } : {};
    },
    session({ session, token }) {
      return { ...session, user: { id: token.sub ?? "" }, loginAt: typeof token.lat === "number" ? token.lat : null } as unknown as typeof session;
    },
  },
} satisfies NextAuthConfig;
