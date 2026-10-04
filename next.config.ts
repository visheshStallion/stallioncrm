import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables forbidden() / unauthorized() + app/forbidden.tsx (403 page).
  experimental: {
    authInterrupts: true,
    // Attachments are uploaded through server actions (10 MB limit enforced in the service).
    serverActions: { bodySizeLimit: "12mb" },
  },
  serverExternalPackages: ["@node-rs/argon2", "pino"],
  poweredByHeader: false,
};

export default nextConfig;
