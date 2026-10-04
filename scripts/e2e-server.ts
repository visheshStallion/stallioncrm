/**
 * Web server for Playwright: database (E2E_DATABASE_URL, or a throw-away embedded PostgreSQL 16),
 * migrate + seed, then Next.js on $PORT (default 3100).
 *   E2E_USE_BUILD=1 → `next start` (run `pnpm build` first – CI); otherwise `next dev`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { migrateAndSeed, startEmbeddedPostgres } from "./lib/embedded-pg";

async function main() {
  let url = process.env.E2E_DATABASE_URL;
  let stop: (() => Promise<void>) | undefined;
  if (!url) {
    const db = await startEmbeddedPostgres();
    url = db.url;
    stop = db.stop;
  }
  migrateAndSeed(url);

  const port = process.env.PORT ?? "3100";
  const nextBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
  const child = spawn(nextBin, [process.env.E2E_USE_BUILD ? "start" : "dev", "-p", port], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      DATABASE_URL: url,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-not-for-production-0123456789",
      MESSAGING_WEBHOOK_SECRET: process.env.MESSAGING_WEBHOOK_SECRET ?? "e2e-webhook-secret",
      CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret",
      AUTH_TRUST_HOST: "true",
      AUTH_URL: `http://localhost:${port}`,
    },
  });

  const shutdown = async () => {
    child.kill();
    await stop?.();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  child.on("exit", async (code) => {
    await stop?.();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
