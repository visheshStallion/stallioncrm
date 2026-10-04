import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables forbidden() / unauthorized() + app/forbidden.tsx (403 page).
  experimental: { authInterrupts: true },
  serverExternalPackages: ["@node-rs/argon2", "pino"],
  poweredByHeader: false,
};

export default nextConfig;
