/**
 * Generates a new migration against a throw-away embedded PostgreSQL (no local data touched):
 *   pnpm db:new-migration <name>
 * Applies existing migrations to a fresh database, then runs `prisma migrate dev --create-only`.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { startEmbeddedPostgres } from "./lib/embedded-pg";

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error("usage: pnpm db:new-migration <name>");
  const db = await startEmbeddedPostgres();
  try {
    const prisma = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
    const env = { ...process.env, DATABASE_URL: db.url };
    const run = (args: string[]) =>
      execFileSync(prisma, args, { env, stdio: "inherit", shell: process.platform === "win32" });
    run(["migrate", "deploy"]);
    run(["migrate", "dev", "--create-only", "--skip-seed", "--name", name]);
  } finally {
    await db.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
