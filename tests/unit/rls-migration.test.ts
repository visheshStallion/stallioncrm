import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("RLS migration", () => {
  it("contains every prisma/rls/*.sql file verbatim (rls/ is the source of truth)", () => {
    const migration = read("prisma/migrations/20261004000100_rls/migration.sql");
    const files = fs.readdirSync(path.join(root, "prisma/rls")).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(migration).toContain(read(`prisma/rls/${f}`));
  });
});
