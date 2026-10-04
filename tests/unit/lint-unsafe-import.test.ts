import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const cwd = path.resolve(__dirname, "../..");
const eslint = new ESLint({ cwd });

async function restrictedImportErrors(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(cwd, filePath) });
  return result!.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

describe("ESLint guard: unscoped Prisma client", () => {
  it.each([
    ['import { unsafeDb } from "@/server/db/unsafe";', "src/app/(crm)/page.tsx"],
    ['import { unsafeDb } from "../db/unsafe";', "src/server/modules/deals/queries.ts"],
    ['import { unsafeDb } from "../../server/db/unsafe.ts";', "src/app/api/x.ts"],
    ['import { PrismaClient } from "@prisma/client";', "src/server/modules/deals/service.ts"],
    ['import { unsafeDb } from "@/server/db/unsafe";', "src/server/access/context.ts"],
  ])("blocks %s in %s", async (code, file) => {
    expect(await restrictedImportErrors(code, file)).toHaveLength(1);
  });

  it.each([
    ['import { unsafeDb } from "./unsafe";', "src/server/db/scoped.ts"],
    ['import { scopedDb } from "@/server/db";', "src/server/modules/deals/queries.ts"],
    ['import { Prisma } from "@prisma/client";', "src/server/modules/deals/queries.ts"],
    ['import { PrismaClient } from "@prisma/client";', "prisma/seed.ts"],
  ])("allows %s in %s", async (code, file) => {
    expect(await restrictedImportErrors(code, file)).toHaveLength(0);
  });
});
