import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/**
 * Security headers (prompt 15, docs/SECURITY.md). The CSP allows inline scripts because Next.js renders inline
 * bootstrap scripts; everything else is restricted to this origin. `unsafe-eval` only in development (HMR).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // Enables forbidden() / unauthorized() + app/forbidden.tsx (403 page).
  experimental: {
    authInterrupts: true,
    // Attachments are uploaded through server actions (10 MB limit enforced in the service).
    serverActions: { bodySizeLimit: "12mb" },
  },
  serverExternalPackages: ["@node-rs/argon2", "pino"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
