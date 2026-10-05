import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, PREFERENCE_SCHEMAS, schemaForKey } from "@/server/modules/preferences/schema";

describe("UI preferences", () => {
  it("defaults to the sidebar and the 13px standard density", () => {
    expect(DEFAULT_PREFERENCES.nav).toBe("sidebar");
    expect(DEFAULT_PREFERENCES.density).toBe("standard");
  });

  it("accepts the two navigation modes and the three densities only", () => {
    expect(PREFERENCE_SCHEMAS.nav.safeParse("classic").success).toBe(true);
    expect(PREFERENCE_SCHEMAS.nav.safeParse("tabs").success).toBe(false);
    for (const d of ["standard", "comfortable", "compact"]) expect(PREFERENCE_SCHEMAS.density.safeParse(d).success).toBe(true);
    expect(PREFERENCE_SCHEMAS.density.safeParse("huge").success).toBe(false);
  });

  it("stores column widths with the column layout, within sane limits", () => {
    const schema = schemaForKey("columns:deals")!;
    expect(schema.safeParse({ order: ["name"], hidden: [], freezeFirst: true }).success).toBe(true);
    expect(schema.safeParse({ order: ["name"], hidden: [], freezeFirst: true, widths: { name: 240 } }).success).toBe(true);
    expect(schema.safeParse({ order: ["name"], hidden: [], freezeFirst: true, widths: { name: 5000 } }).success).toBe(false);
  });
});
