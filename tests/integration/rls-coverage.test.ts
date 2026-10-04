/** Every brand-owned model (auto-detected from the schema) must have RLS + all four policies. */
import { describe, expect, it } from "vitest";
import { BRAND_OWNED_MODELS } from "@/server/access/brand-owned";
import { unsafeDb } from "./helpers";

describe("RLS coverage", () => {
  it("detects brand-owned models", () => {
    expect([...BRAND_OWNED_MODELS]).toContain("Deal");
  });

  it.each([...BRAND_OWNED_MODELS])("%s has RLS enabled with brand policies", async (table) => {
    const [rel] = await unsafeDb.$queryRaw<Array<{ relrowsecurity: boolean }>>`
      SELECT relrowsecurity FROM pg_class WHERE oid = ${`"${table}"`}::regclass`;
    expect(rel?.relrowsecurity, `run SELECT app_enable_brand_rls('"${table}"') in a migration`).toBe(true);

    const policies = await unsafeDb.$queryRaw<Array<{ policyname: string }>>`
      SELECT policyname FROM pg_policies WHERE tablename = ${table} ORDER BY policyname`;
    expect(policies.map((p) => p.policyname)).toEqual([
      "brand_delete",
      "brand_insert",
      "brand_read",
      "brand_update",
    ]);
  });
});
