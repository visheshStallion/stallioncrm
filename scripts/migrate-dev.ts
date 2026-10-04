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

/**
 * Hand-written indexes and foreign keys (prisma/unmanaged.json) are unknown to the Prisma schema, so the diff
 * proposes to drop them. Those statements are removed; any other DROP INDEX / DROP CONSTRAINT is reported so it
 * is reviewed before the migration is committed.
 */
function keepUnmanaged(sql: string): string {
  const unmanaged = JSON.parse(fs.readFileSync(path.join("prisma", "unmanaged.json"), "utf8")) as { indexes: string[]; foreignKeys: string[] };
  const keep = new Set([...unmanaged.indexes, ...unmanaged.foreignKeys]);
  const kept: string[] = [];
  const out = sql.replace(/-- Drop(?:Index|ForeignKey)\r?\n(?:DROP INDEX "([^"]+)";|ALTER TABLE "[^"]+" DROP CONSTRAINT "([^"]+)";)\r?\n(?:\r?\n)?/g, (block, index?: string, fk?: string) => {
    const name = index ?? fk ?? "";
    if (!keep.has(name)) return block;
    kept.push(name);
    return "";
  });
  if (kept.length) console.log(`Kept ${kept.length} hand-written object(s) the diff wanted to drop: ${kept.join(", ")}`);
  const remaining = [...out.matchAll(/DROP INDEX "([^"]+)"|DROP CONSTRAINT "([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  if (remaining.length) console.warn(`REVIEW: the migration drops ${remaining.join(", ")} – if one of them is hand-written, add it to prisma/unmanaged.json and regenerate.`);
  return out;
}

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error("usage: pnpm db:new-migration <name>");
  const db = await startEmbeddedPostgres();
  try {
    const prisma = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
    const env = { ...process.env, DATABASE_URL: db.url };
    const opts = { env, shell: process.platform === "win32" } as const;
    execFileSync(prisma, ["migrate", "deploy"], { ...opts, stdio: "inherit" });
    const generated = execFileSync(
      prisma,
      ["migrate", "diff", "--from-url", `"${db.url}"`, "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
      { ...opts, encoding: "utf8" },
    );
    const sql = keepUnmanaged(generated);
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
