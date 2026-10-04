/**
 * Generates a new migration against a throw-away embedded PostgreSQL (no local data touched):
 *   pnpm db:new-migration <name>
 * Applies the existing migrations to a fresh database, then writes the SQL diff between that database and
 * prisma/schema.prisma to prisma/migrations/<timestamp>_<name>/migration.sql. Uses `prisma migrate diff`, so it
 * also works for changes Prisma considers destructive (review the SQL before committing).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startEmbeddedPostgres } from "./lib/embedded-pg";

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error("usage: pnpm db:new-migration <name>");
  const db = await startEmbeddedPostgres();
  try {
    const prisma = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
    const env = { ...process.env, DATABASE_URL: db.url };
    const opts = { env, shell: process.platform === "win32" } as const;
    execFileSync(prisma, ["migrate", "deploy"], { ...opts, stdio: "inherit" });
    const sql = execFileSync(
      prisma,
      ["migrate", "diff", "--from-url", `"${db.url}"`, "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
      { ...opts, encoding: "utf8" },
    );
    if (!sql.trim() || /empty migration/i.test(sql)) {
      console.log("No schema changes.");
      return;
    }
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const dir = path.join("prisma", "migrations", `${stamp}_${name}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "migration.sql"), sql);
    console.log(`Created migrations/${stamp}_${name}`);
  } finally {
    await db.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
