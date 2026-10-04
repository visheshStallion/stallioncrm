/**
 * Docker-free local database: persistent embedded PostgreSQL 16 in ./.local/pg on port 54329.
 *   pnpm db:local            → start, migrate + seed on first run, print DATABASE_URL, keep running
 *   pnpm db:local --no-seed  → start + migrate only
 * Prefer `docker compose up -d` when Docker is available.
 */
import path from "node:path";
import fs from "node:fs";
import { migrateAndSeed, startEmbeddedPostgres } from "./lib/embedded-pg";

async function main() {
  const dataDir = path.join(process.cwd(), ".local", "pg");
  const firstRun = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });

  const db = await startEmbeddedPostgres({ dataDir, port: 54329, persistent: true });
  const migrate = !process.argv.includes("--no-migrate");
  const seed = migrate && firstRun && !process.argv.includes("--no-seed");
  if (migrate) migrateAndSeed(db.url, { seed });

  console.log(`\nPostgreSQL 16 running.\nDATABASE_URL="${db.url}"\n${seed ? "Seeded fictitious data.\n" : ""}Ctrl+C to stop.`);

  const shutdown = async () => {
    await db.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
