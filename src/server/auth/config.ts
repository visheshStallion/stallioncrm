/**
 * Shared Auth.js config (no database or native modules). Middleware only verifies the token (see src/middleware.ts).
 * The JWT carries the user id ONLY; the access context is loaded server-side per request.
 */
import type { NextAuthConfig } from "next-auth";

/** No session required. /api/public = web-to-lead and channel webhooks (own abuse controls). */
export const PUBLIC_PATHS = ["/login", "/api/auth", "/api/public", "/api/v1/docs"];

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      // Strip name / email / picture: the token only identifies the user.
      const sub = user?.id ?? token.sub;
      return sub ? { sub } : {};
    },
    session({ session, token }) {
      return { ...session, user: { id: token.sub ?? "" } } as typeof session;
    },
  },
} satisfies NextAuthConfig;
